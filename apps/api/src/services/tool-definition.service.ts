import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { toolDefinitions } from "@assembly-lime/shared/db/schema";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "tool-definition-service" });

type CreateToolInput = {
  name: string;
  description: string;
  inputSchemaJson: unknown;
  code: string;
  runtime?: number;
  provider?: string;
  createdBy?: number;
};

export async function createTool(db: Db, tenantId: number, input: CreateToolInput) {
  const [row] = await db
    .insert(toolDefinitions)
    .values({
      tenantId,
      name: input.name,
      description: input.description,
      inputSchemaJson: input.inputSchemaJson,
      code: input.code,
      runtime: input.runtime ?? 1,
      provider: input.provider,
      createdBy: input.createdBy,
    })
    .returning();

  log.info({ toolId: row!.id, tenantId, name: input.name }, "tool definition created");
  return row!;
}

export async function listTools(db: Db, tenantId: number, provider?: string) {
  if (provider) {
    return db
      .select()
      .from(toolDefinitions)
      .where(
        and(
          eq(toolDefinitions.tenantId, tenantId),
          eq(toolDefinitions.enabled, true),
          eq(toolDefinitions.provider, provider)
        )
      );
  }
  return db
    .select()
    .from(toolDefinitions)
    .where(and(eq(toolDefinitions.tenantId, tenantId), eq(toolDefinitions.enabled, true)));
}

export async function getTool(db: Db, tenantId: number, toolId: number) {
  const [row] = await db
    .select()
    .from(toolDefinitions)
    .where(and(eq(toolDefinitions.id, toolId), eq(toolDefinitions.tenantId, tenantId)));
  return row ?? null;
}

export async function updateTool(
  db: Db,
  tenantId: number,
  toolId: number,
  partial: Partial<{
    name: string;
    description: string;
    inputSchemaJson: unknown;
    code: string;
    runtime: number;
    provider: string;
    enabled: boolean;
  }>
) {
  const [row] = await db
    .update(toolDefinitions)
    .set({ ...partial, updatedAt: new Date() })
    .where(and(eq(toolDefinitions.id, toolId), eq(toolDefinitions.tenantId, tenantId)))
    .returning();
  return row ?? null;
}

export async function deleteTool(db: Db, tenantId: number, toolId: number) {
  const [row] = await db
    .delete(toolDefinitions)
    .where(and(eq(toolDefinitions.id, toolId), eq(toolDefinitions.tenantId, tenantId)))
    .returning();
  return row ?? null;
}
