import {
  pgTable,
  bigint,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { repositories } from "./connectors";

export const repositoryConfigs = pgTable(
  "repository_configs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    fileType: text("file_type").notNull(),
    detectedKeys: jsonb("detected_keys").notNull().default([]),
    contentHash: text("content_hash"),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("repo_configs_tenant_repo_path_uniq").on(
      t.tenantId,
      t.repositoryId,
      t.filePath
    ),
    index("repo_configs_tenant_repo_idx").on(t.tenantId, t.repositoryId),
  ]
);
