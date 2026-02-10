import { Elysia, t } from "elysia";
import type { Db } from "@assembly-lime/shared/db";
import { uploadImage, getImage, deleteImage } from "../services/image.service";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "image-routes" });

export function imageRoutes(db: Db) {
  return new Elysia({ prefix: "/images" })
    .post(
      "/upload",
      async ({ body }) => {
        const file = body.file;
        const bytes = new Uint8Array(await file.arrayBuffer());

        log.info({ tenantId: body.tenantId, fileName: file.name, sizeBytes: bytes.length }, "uploading image");
        const result = await uploadImage(db, {
          tenantId: body.tenantId,
          agentRunId: body.agentRunId,
          ticketId: body.ticketId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          body: bytes,
          purpose: body.purpose,
        });

        log.info({ imageId: result.id, fileName: result.fileName }, "image uploaded");
        return {
          id: String(result.id),
          fileName: result.fileName,
          mimeType: result.mimeType,
          sizeBytes: result.sizeBytes,
          presignedUrl: result.presignedUrl,
          createdAt: result.createdAt.toISOString(),
        };
      },
      {
        body: t.Object({
          file: t.File(),
          tenantId: t.Number(),
          agentRunId: t.Optional(t.Number()),
          ticketId: t.Optional(t.Number()),
          purpose: t.Optional(t.String()),
        }),
      }
    )
    .get(
      "/:id",
      async ({ params, query }) => {
        const tenantId = Number(query.tenantId);
        const image = await getImage(db, tenantId, Number(params.id));
        if (!image) return { error: "not found" };
        return {
          id: String(image.id),
          fileName: image.fileName,
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
          presignedUrl: image.presignedUrl,
          createdAt: image.createdAt.toISOString(),
        };
      },
      {
        params: t.Object({ id: t.String() }),
        query: t.Object({ tenantId: t.String() }),
      }
    )
    .delete(
      "/:id",
      async ({ params, query }) => {
        const tenantId = Number(query.tenantId);
        const ok = await deleteImage(db, tenantId, Number(params.id));
        log.info({ tenantId, imageId: params.id, deleted: ok }, "delete image");
        return { deleted: ok };
      },
      {
        params: t.Object({ id: t.String() }),
        query: t.Object({ tenantId: t.String() }),
      }
    );
}
