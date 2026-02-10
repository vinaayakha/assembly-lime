import { Elysia, t } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { requireAuth } from "../middleware/auth";
import {
  createConnector,
  listConnectors,
  getConnector,
  revokeConnector,
} from "../services/connector.service";
import { listOrgRepos, importRepos } from "../services/github.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "connector-routes" });

export function connectorRoutes(db: Db) {
  return new Elysia({ prefix: "/connectors" })
    .use(requireAuth)
    .post(
      "/",
      async ({ auth, body }) => {
        log.info({ tenantId: auth!.tenantId, provider: body.provider }, "creating connector");
        const row = await createConnector(db, auth!.tenantId, {
          provider: body.provider,
          externalOrg: body.externalOrg,
          authType: body.authType,
          accessToken: body.accessToken,
          scopes: body.scopes,
        });
        return {
          id: String(row.id),
          provider: row.provider,
          externalOrg: row.externalOrg,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
        };
      },
      {
        body: t.Object({
          provider: t.Number(),
          externalOrg: t.Optional(t.String()),
          authType: t.Number(),
          accessToken: t.String({ minLength: 1 }),
          scopes: t.Optional(t.Array(t.String())),
        }),
      }
    )
    .get("/", async ({ auth }) => {
      const rows = await listConnectors(db, auth!.tenantId);
      return rows.map((r) => ({
        id: String(r.id),
        provider: r.provider,
        externalOrg: r.externalOrg,
        authType: r.authType,
        scopes: r.scopesJson,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        revokedAt: r.revokedAt?.toISOString() ?? null,
      }));
    })
    .get(
      "/:id",
      async ({ auth, params }) => {
        const row = await getConnector(db, auth!.tenantId, Number(params.id));
        if (!row) return { error: "not found" };
        return {
          id: String(row.id),
          provider: row.provider,
          externalOrg: row.externalOrg,
          authType: row.authType,
          scopes: row.scopesJson,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          revokedAt: row.revokedAt?.toISOString() ?? null,
        };
      },
      { params: t.Object({ id: t.String() }) }
    )
    .delete(
      "/:id",
      async ({ auth, params }) => {
        const row = await revokeConnector(db, auth!.tenantId, Number(params.id));
        if (!row) return { error: "not found" };
        log.info({ connectorId: params.id, tenantId: auth!.tenantId }, "connector revoked");
        return { id: String(row.id), status: row.status };
      },
      { params: t.Object({ id: t.String() }) }
    )
    .post(
      "/:id/sync",
      async ({ auth, params }) => {
        log.info({ tenantId: auth!.tenantId, connectorId: params.id }, "syncing all repos from connector");
        const repos = await listOrgRepos(db, auth!.tenantId, Number(params.id));
        const toImport = repos.map((r) => ({
          externalRepoId: r.id,
          owner: r.owner.login,
          name: r.name,
          fullName: r.full_name,
          cloneUrl: r.clone_url,
          defaultBranch: r.default_branch,
        }));
        const rows = await importRepos(db, auth!.tenantId, Number(params.id), toImport);
        log.info({ tenantId: auth!.tenantId, connectorId: params.id, fetched: repos.length, imported: rows.length }, "sync complete");
        return { fetched: repos.length, imported: rows.length };
      },
      { params: t.Object({ id: t.String() }) }
    )
    .get(
      "/:id/repos/remote",
      async ({ auth, params }) => {
        const repos = await listOrgRepos(db, auth!.tenantId, Number(params.id));
        return repos.map((r) => ({
          externalRepoId: r.id,
          owner: r.owner.login,
          name: r.name,
          fullName: r.full_name,
          cloneUrl: r.clone_url,
          defaultBranch: r.default_branch,
          private: r.private,
          description: r.description,
          language: r.language,
          updatedAt: r.updated_at,
        }));
      },
      { params: t.Object({ id: t.String() }) }
    )
    .post(
      "/:id/repos/import",
      async ({ auth, params, body }) => {
        log.info({ tenantId: auth!.tenantId, connectorId: params.id, count: body.repos.length }, "importing repos");
        const rows = await importRepos(db, auth!.tenantId, Number(params.id), body.repos);
        return rows.map((r) => ({
          id: String(r.id),
          owner: r.owner,
          name: r.name,
          fullName: r.fullName,
          cloneUrl: r.cloneUrl,
          defaultBranch: r.defaultBranch,
        }));
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          repos: t.Array(
            t.Object({
              externalRepoId: t.Number(),
              owner: t.String(),
              name: t.String(),
              fullName: t.String(),
              cloneUrl: t.String(),
              defaultBranch: t.String(),
            })
          ),
        }),
      }
    );
}
