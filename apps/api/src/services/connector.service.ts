import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { connectors } from "@assembly-lime/shared/db/schema";
import { encryptToken, decryptToken } from "../lib/encryption";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "connector-service" });

type CreateConnectorInput = {
  provider: number;
  externalOrg?: string;
  authType: number;
  accessToken: string;
  scopes?: string[];
};

export async function createConnector(db: Db, tenantId: number, input: CreateConnectorInput) {
  const accessTokenEnc = encryptToken(input.accessToken);

  const [row] = await db
    .insert(connectors)
    .values({
      tenantId,
      provider: input.provider,
      externalOrg: input.externalOrg,
      authType: input.authType,
      accessTokenEnc,
      scopesJson: input.scopes ?? [],
      status: 1,
    })
    .returning();

  log.info({ connectorId: row!.id, tenantId }, "connector created");
  return row!;
}

export async function listConnectors(db: Db, tenantId: number) {
  return db
    .select({
      id: connectors.id,
      tenantId: connectors.tenantId,
      provider: connectors.provider,
      externalOrg: connectors.externalOrg,
      authType: connectors.authType,
      scopesJson: connectors.scopesJson,
      status: connectors.status,
      createdAt: connectors.createdAt,
      revokedAt: connectors.revokedAt,
    })
    .from(connectors)
    .where(and(eq(connectors.tenantId, tenantId), eq(connectors.status, 1)));
}

export async function getConnector(db: Db, tenantId: number, connectorId: number) {
  const [row] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.tenantId, tenantId)));
  return row ?? null;
}

export function getConnectorToken(connector: { accessTokenEnc: Buffer }): string {
  return decryptToken(connector.accessTokenEnc);
}

export async function revokeConnector(db: Db, tenantId: number, connectorId: number) {
  const [row] = await db
    .update(connectors)
    .set({ status: 0, revokedAt: new Date() })
    .where(and(eq(connectors.id, connectorId), eq(connectors.tenantId, tenantId)))
    .returning();

  if (row) log.info({ connectorId, tenantId }, "connector revoked");
  return row ?? null;
}
