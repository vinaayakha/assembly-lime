import { Elysia } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { requireAuth } from "../middleware/auth";
import { getCurrentUser } from "../services/auth.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "me-route" });

export function meRoutes(db: Db) {
  return new Elysia()
    .use(requireAuth)
    .get("/me", async ({ auth }) => {
      const me = await getCurrentUser(db, auth!.userId, auth!.tenantId);
      if (!me) {
        log.warn({ userId: auth!.userId, tenantId: auth!.tenantId }, "user not found for /me");
        return { error: "User not found" };
      }
      log.debug({ userId: auth!.userId }, "served /me");
      return me;
    });
}
