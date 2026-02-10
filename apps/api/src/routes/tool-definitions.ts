import { Elysia, t } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { requireAuth } from "../middleware/auth";
import {
  createTool,
  listTools,
  getTool,
  updateTool,
  deleteTool,
} from "../services/tool-definition.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "tool-definition-routes" });

export function toolDefinitionRoutes(db: Db) {
  return new Elysia({ prefix: "/tool-definitions" })
    .use(requireAuth)
    .post(
      "/",
      async ({ auth, body }) => {
        log.info({ tenantId: auth!.tenantId, name: body.name }, "creating tool definition");
        const row = await createTool(db, auth!.tenantId, {
          name: body.name,
          description: body.description,
          inputSchemaJson: body.inputSchemaJson,
          code: body.code,
          runtime: body.runtime,
          provider: body.provider,
          createdBy: auth!.userId,
        });
        return {
          id: String(row.id),
          name: row.name,
          description: row.description,
          runtime: row.runtime,
          provider: row.provider,
          enabled: row.enabled,
          createdAt: row.createdAt.toISOString(),
        };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          description: t.String({ minLength: 1 }),
          inputSchemaJson: t.Any(),
          code: t.String({ minLength: 1 }),
          runtime: t.Optional(t.Number()),
          provider: t.Optional(t.String()),
        }),
      }
    )
    .get(
      "/",
      async ({ auth, query }) => {
        const rows = await listTools(db, auth!.tenantId, query.provider);
        return rows.map((r) => ({
          id: String(r.id),
          name: r.name,
          description: r.description,
          inputSchemaJson: r.inputSchemaJson,
          code: r.code,
          runtime: r.runtime,
          provider: r.provider,
          enabled: r.enabled,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }));
      },
      { query: t.Object({ provider: t.Optional(t.String()) }) }
    )
    .get(
      "/:id",
      async ({ auth, params }) => {
        const row = await getTool(db, auth!.tenantId, Number(params.id));
        if (!row) return { error: "not found" };
        return {
          id: String(row.id),
          name: row.name,
          description: row.description,
          inputSchemaJson: row.inputSchemaJson,
          code: row.code,
          runtime: row.runtime,
          provider: row.provider,
          enabled: row.enabled,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      },
      { params: t.Object({ id: t.String() }) }
    )
    .patch(
      "/:id",
      async ({ auth, params, body }) => {
        const row = await updateTool(db, auth!.tenantId, Number(params.id), body);
        if (!row) return { error: "not found" };
        return {
          id: String(row.id),
          name: row.name,
          description: row.description,
          enabled: row.enabled,
          updatedAt: row.updatedAt.toISOString(),
        };
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          name: t.Optional(t.String()),
          description: t.Optional(t.String()),
          inputSchemaJson: t.Optional(t.Any()),
          code: t.Optional(t.String()),
          runtime: t.Optional(t.Number()),
          provider: t.Optional(t.String()),
          enabled: t.Optional(t.Boolean()),
        }),
      }
    )
    .delete(
      "/:id",
      async ({ auth, params }) => {
        const row = await deleteTool(db, auth!.tenantId, Number(params.id));
        if (!row) return { error: "not found" };
        return { id: String(row.id), deleted: true };
      },
      { params: t.Object({ id: t.String() }) }
    );
}
