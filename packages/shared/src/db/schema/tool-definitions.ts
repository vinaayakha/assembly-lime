import {
  pgTable,
  bigint,
  text,
  smallint,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const toolDefinitions = pgTable(
  "tool_definitions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    description: text("description").notNull(),
    inputSchemaJson: jsonb("input_schema_json").notNull(),
    code: text("code").notNull(),
    runtime: smallint("runtime").notNull().default(1),
    provider: text("provider"),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: bigint("created_by", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tool_defs_tenant_name_uniq").on(t.tenantId, t.name),
    index("tool_defs_tenant_provider_enabled_idx").on(t.tenantId, t.provider, t.enabled),
  ]
);
