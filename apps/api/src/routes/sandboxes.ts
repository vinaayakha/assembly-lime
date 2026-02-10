import { Elysia, t } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { requireAuth } from "../middleware/auth";
import {
  createSandbox,
  getSandbox,
  listSandboxes,
  destroySandbox,
  getSandboxLogs,
} from "../services/sandbox.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "sandbox-routes" });

export function sandboxRoutes(db: Db) {
  return new Elysia({ prefix: "/sandboxes" })
    .use(requireAuth)
    .post(
      "/",
      async ({ auth, body }) => {
        log.info({ tenantId: auth!.tenantId, repositoryId: body.repositoryId, branch: body.branch }, "creating sandbox");
        const row = await createSandbox(db, auth!.tenantId, {
          repositoryId: body.repositoryId,
          branch: body.branch,
          clusterId: body.clusterId,
          envVarSetId: body.envVarSetId,
          ports: body.ports,
          createdBy: auth!.userId,
        });
        return {
          id: String(row.id),
          repositoryId: String(row.repositoryId),
          branch: row.branch,
          k8sNamespace: row.k8sNamespace,
          k8sPod: row.k8sPod,
          status: row.status,
          portsJson: row.portsJson,
          createdAt: row.createdAt.toISOString(),
        };
      },
      {
        body: t.Object({
          repositoryId: t.Number(),
          branch: t.String({ minLength: 1 }),
          clusterId: t.Optional(t.Number()),
          envVarSetId: t.Optional(t.Number()),
          ports: t.Optional(
            t.Array(
              t.Object({
                containerPort: t.Number(),
                hostPort: t.Optional(t.Number()),
                protocol: t.Optional(t.String()),
              })
            )
          ),
        }),
      }
    )
    .get("/", async ({ auth }) => {
      const rows = await listSandboxes(db, auth!.tenantId);
      return rows.map((r) => ({
        id: String(r.id),
        repositoryId: String(r.repositoryId),
        clusterId: r.clusterId ? String(r.clusterId) : null,
        branch: r.branch,
        k8sNamespace: r.k8sNamespace,
        k8sPod: r.k8sPod,
        status: r.status,
        portsJson: r.portsJson,
        createdAt: r.createdAt.toISOString(),
        destroyedAt: r.destroyedAt?.toISOString() ?? null,
      }));
    })
    .get(
      "/:id",
      async ({ auth, params }) => {
        const row = await getSandbox(db, auth!.tenantId, Number(params.id));
        if (!row) return { error: "not found" };
        return {
          id: String(row.id),
          repositoryId: String(row.repositoryId),
          clusterId: row.clusterId ? String(row.clusterId) : null,
          branch: row.branch,
          k8sNamespace: row.k8sNamespace,
          k8sPod: row.k8sPod,
          status: row.status,
          portsJson: row.portsJson,
          resourceLimitsJson: row.resourceLimitsJson,
          createdAt: row.createdAt.toISOString(),
          destroyedAt: row.destroyedAt?.toISOString() ?? null,
        };
      },
      { params: t.Object({ id: t.String() }) }
    )
    .get(
      "/:id/logs",
      async ({ auth, params }) => {
        const logs = await getSandboxLogs(db, auth!.tenantId, Number(params.id));
        return { logs: logs ?? "" };
      },
      { params: t.Object({ id: t.String() }) }
    )
    .delete(
      "/:id",
      async ({ auth, params }) => {
        const row = await destroySandbox(db, auth!.tenantId, Number(params.id));
        if (!row) return { error: "not found" };
        log.info({ sandboxId: params.id, tenantId: auth!.tenantId }, "sandbox destroyed");
        return { id: String(row.id), status: row.status };
      },
      { params: t.Object({ id: t.String() }) }
    );
}
