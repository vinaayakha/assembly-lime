import { Elysia } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import {
  getGitHubAuthUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
  FRONTEND_URL,
} from "../lib/github-oauth";
import {
  createSession,
  deleteSession,
  buildCookieHeader,
  SESSION_COOKIE_NAME,
} from "../lib/session";
import { findOrCreateUserFromGitHub } from "../services/auth.service";
import { optionalAuth } from "../middleware/auth";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "auth-routes" });

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function redirect(set: any, url: string, extraHeaders?: Record<string, string | string[]>) {
  set.status = 302;
  set.headers["Location"] = url;
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      set.headers[k] = v;
    }
  }
}

export function authRoutes(db: Db) {
  return new Elysia({ prefix: "/auth" })
    .get("/github", ({ set }) => {
      const state = generateState();
      log.info("initiating GitHub OAuth flow");
      const stateCookie = `al_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
      redirect(set, getGitHubAuthUrl(state), { "Set-Cookie": stateCookie });
    })

    .get("/github/callback", async ({ request, set }) => {
      try {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        // GitHub may redirect with an error (e.g. user denied access)
        if (error) {
          log.warn({ error }, "GitHub OAuth returned error");
          redirect(set, `${FRONTEND_URL}/login?error=${encodeURIComponent(error)}`);
          return;
        }

        // Verify state
        const cookieHeader = request.headers.get("cookie");
        const savedState = parseCookie(cookieHeader, "al_oauth_state");
        if (!state || !savedState || state !== savedState) {
          log.warn("OAuth state mismatch");
          redirect(set, `${FRONTEND_URL}/login?error=invalid_state`);
          return;
        }

        if (!code) {
          log.warn("OAuth callback missing code");
          redirect(set, `${FRONTEND_URL}/login?error=missing_code`);
          return;
        }

        // Exchange code for token + fetch user
        log.info("exchanging OAuth code for token");
        const accessToken = await exchangeCodeForToken(code);
        const ghUser = await fetchGitHubUser(accessToken);
        log.info({ githubLogin: ghUser.login, githubId: ghUser.id }, "fetched GitHub user");

        // Find or create user (also auto-creates connector + syncs repos)
        const { userId, tenantId } = await findOrCreateUserFromGitHub(
          db,
          ghUser,
          accessToken,
        );
        log.info({ userId, tenantId, githubLogin: ghUser.login }, "user authenticated");

        // Create session
        const sessionToken = await createSession({ userId, tenantId });

        // Return raw Response to properly set multiple Set-Cookie headers
        const clearState =
          "al_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
        return new Response(null, {
          status: 302,
          headers: [
            ["Location", FRONTEND_URL],
            ["Set-Cookie", clearState],
            ["Set-Cookie", buildCookieHeader(sessionToken)],
          ],
        });
      } catch (err) {
        log.error({ err }, "OAuth callback error");
        redirect(set, `${FRONTEND_URL}/login?error=auth_failed`);
      }
    })

    .use(optionalAuth)
    .post("/logout", async ({ request, set }) => {
      const cookieHeader = request.headers.get("cookie");
      const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
      if (token) {
        await deleteSession(token);
        log.info("user logged out, session deleted");
      }
      set.headers["Set-Cookie"] = buildCookieHeader(undefined, true);
      return { ok: true };
    });
}
