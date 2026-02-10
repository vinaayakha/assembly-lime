import { Elysia, t } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { requireAuth } from "../middleware/auth";
import {
  listProjects,
  getProject,
  createProject,
  getBoard,
  createTicket,
} from "../services/project.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "project-routes" });

export function projectRoutes(db: Db) {
  return new Elysia({ prefix: "/projects" })
    .use(requireAuth)

    .get("/", async ({ auth }) => {
      const rows = await listProjects(db, auth!.tenantId);
      log.debug({ tenantId: auth!.tenantId, count: rows.length }, "listed projects");
      return rows.map((p) => ({
        id: String(p.id),
        name: p.name,
        key: p.key,
        createdAt: p.createdAt.toISOString(),
      }));
    })

    .post(
      "/",
      async ({ auth, body }) => {
        const project = await createProject(db, auth!.tenantId, body);
        log.info({ tenantId: auth!.tenantId, projectId: project.id, name: body.name, key: body.key }, "created project");
        return {
          id: String(project.id),
          name: project.name,
          key: project.key,
          createdAt: project.createdAt.toISOString(),
        };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          key: t.String({ minLength: 1, maxLength: 10 }),
        }),
      },
    )

    .get(
      "/:id",
      async ({ auth, params }) => {
        const project = await getProject(
          db,
          auth!.tenantId,
          Number(params.id),
        );
        if (!project) {
          log.warn({ tenantId: auth!.tenantId, projectId: params.id }, "project not found");
          return { error: "not found" };
        }
        return {
          id: String(project.id),
          name: project.name,
          key: project.key,
          createdAt: project.createdAt.toISOString(),
        };
      },
      { params: t.Object({ id: t.String() }) },
    )

    .get(
      "/:id/board",
      async ({ auth, params }) => {
        const result = await getBoard(
          db,
          auth!.tenantId,
          Number(params.id),
        );
        if (!result) {
          log.warn({ tenantId: auth!.tenantId, projectId: params.id }, "board not found");
          return { error: "no board found" };
        }
        log.debug({ tenantId: auth!.tenantId, projectId: params.id, ticketCount: result.tickets.length }, "fetched board");
        return result;
      },
      { params: t.Object({ id: t.String() }) },
    )

    .post(
      "/:id/tickets",
      async ({ auth, params, body }) => {
        const ticket = await createTicket(
          db,
          auth!.tenantId,
          Number(params.id),
          body,
          auth!.userId,
        );
        log.info({ tenantId: auth!.tenantId, projectId: params.id, ticketId: ticket.id, title: body.title }, "created ticket");
        return ticket;
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          title: t.String({ minLength: 1 }),
          descriptionMd: t.Optional(t.String()),
          columnKey: t.Optional(t.String()),
          priority: t.Optional(t.Number()),
          labelsJson: t.Optional(t.Array(t.String())),
        }),
      },
    );
}
