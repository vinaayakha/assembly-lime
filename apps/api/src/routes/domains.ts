import { Elysia, t } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { requireAuth } from "../middleware/auth";
import { createDomain, listDomains, deleteDomain } from "../services/domain.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "domain-routes" });

export function domainRoutes(db: Db) {
  return new Elysia({ prefix: "/domains" })
    .use(requireAuth)
    .post(
      "/",
      async ({ auth, body }) => {
        log.info({ tenantId: auth!.tenantId, domain: body.domain }, "creating domain");
        const row = await createDomain(db, auth!.tenantId, {
          domain: body.domain,
          previewDeploymentId: body.previewDeploymentId,
          sandboxId: body.sandboxId,
        });
        return {
          id: String(row.id),
          domain: row.domain,
          status: row.status,
          ingressName: row.ingressName,
          createdAt: row.createdAt.toISOString(),
        };
      },
      {
        body: t.Object({
          domain: t.String({ minLength: 1 }),
          previewDeploymentId: t.Optional(t.Number()),
          sandboxId: t.Optional(t.Number()),
        }),
      }
    )
    .get("/", async ({ auth }) => {
      const rows = await listDomains(db, auth!.tenantId);
      return rows.map((r) => ({
        id: String(r.id),
        domain: r.domain,
        previewDeploymentId: r.previewDeploymentId ? String(r.previewDeploymentId) : null,
        sandboxId: r.sandboxId ? String(r.sandboxId) : null,
        ingressName: r.ingressName,
        tlsCertSecret: r.tlsCertSecret,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      }));
    })
    .delete(
      "/:id",
      async ({ auth, params }) => {
        const row = await deleteDomain(db, auth!.tenantId, Number(params.id));
        if (!row) return { error: "not found" };
        log.info({ domainId: params.id, tenantId: auth!.tenantId }, "domain deleted");
        return { id: String(row.id), status: row.status };
      },
      { params: t.Object({ id: t.String() }) }
    );
}
