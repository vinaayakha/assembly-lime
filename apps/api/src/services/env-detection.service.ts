import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { repositoryConfigs, repositories } from "@assembly-lime/shared/db/schema";
import { getConnector, getConnectorToken } from "./connector.service";
import { childLogger } from "../lib/logger";
import { createHash } from "crypto";

const log = childLogger({ module: "env-detection" });

const GITHUB_API = "https://api.github.com";

const CONFIG_PATTERNS = [
  { pattern: ".env.example", type: "env_example" },
  { pattern: ".env.sample", type: "env_example" },
  { pattern: ".env.template", type: "env_example" },
  { pattern: "docker-compose.yml", type: "yaml_config" },
  { pattern: "docker-compose.yaml", type: "yaml_config" },
  { pattern: "Dockerfile", type: "dockerfile" },
  { pattern: ".env.local.example", type: "env_example" },
];

const CONFIG_DIRS = ["config", "deploy", "infra", ".github"];

async function githubFetch(token: string, path: string) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) return null;
  return res.json();
}

function detectFileType(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".env.example") || lower.endsWith(".env.sample") || lower.endsWith(".env.template")) return "env_example";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml_config";
  if (lower.endsWith(".json") && (lower.includes("config") || lower.includes("tsconfig"))) return "json_config";
  if (lower.endsWith(".toml")) return "toml_config";
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "dockerfile";
  return null;
}

export function parseEnvFile(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)[\s]*=/i);
    if (match) keys.push(match[1]);
  }
  return keys;
}

type DetectedConfig = {
  filePath: string;
  fileType: string;
  detectedKeys: string[];
  contentHash: string;
};

export async function scanRepoForConfigs(
  db: Db,
  tenantId: number,
  connectorId: number,
  repositoryId: number
) {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.id, repositoryId), eq(repositories.tenantId, tenantId)));
  if (!repo) throw new Error("Repository not found");

  const connector = await getConnector(db, tenantId, connectorId);
  if (!connector) throw new Error("Connector not found");
  const token = getConnectorToken(connector);

  const configs: DetectedConfig[] = [];

  // Scan root directory
  const rootContents = await githubFetch(token, `/repos/${repo.owner}/${repo.name}/contents`);
  if (Array.isArray(rootContents)) {
    for (const item of rootContents) {
      if (item.type !== "file") continue;
      const fileType = detectFileType(item.name);
      if (!fileType) {
        // Check specific known patterns
        const known = CONFIG_PATTERNS.find((p) => item.name.toLowerCase() === p.pattern.toLowerCase());
        if (!known) continue;
      }
      const ft = fileType ?? CONFIG_PATTERNS.find((p) => item.name.toLowerCase() === p.pattern.toLowerCase())?.type ?? "unknown";

      // Fetch content for env files to extract keys
      let detectedKeys: string[] = [];
      let contentHash = "";
      if (ft === "env_example") {
        const fileData = await githubFetch(token, `/repos/${repo.owner}/${repo.name}/contents/${item.path}`);
        if (fileData?.content) {
          const decoded = Buffer.from(fileData.content, "base64").toString("utf-8");
          detectedKeys = parseEnvFile(decoded);
          contentHash = createHash("sha256").update(decoded).digest("hex");
        }
      } else {
        contentHash = item.sha ?? "";
      }

      configs.push({ filePath: item.path, fileType: ft, detectedKeys, contentHash });
    }

    // Check for config directories
    for (const dir of CONFIG_DIRS) {
      const dirItem = rootContents.find((i: any) => i.name === dir && i.type === "dir");
      if (!dirItem) continue;

      const dirContents = await githubFetch(token, `/repos/${repo.owner}/${repo.name}/contents/${dir}`);
      if (!Array.isArray(dirContents)) continue;

      for (const item of dirContents) {
        if (item.type !== "file") continue;
        const ft = detectFileType(item.name);
        if (!ft) continue;
        configs.push({
          filePath: item.path,
          fileType: ft,
          detectedKeys: [],
          contentHash: item.sha ?? "",
        });
      }
    }
  }

  // Store results
  await storeDetectedConfigs(db, tenantId, repositoryId, configs);

  log.info({ tenantId, repositoryId, count: configs.length }, "config scan completed");
  return configs;
}

export async function storeDetectedConfigs(
  db: Db,
  tenantId: number,
  repositoryId: number,
  configs: DetectedConfig[]
) {
  for (const config of configs) {
    await db
      .insert(repositoryConfigs)
      .values({
        tenantId,
        repositoryId,
        filePath: config.filePath,
        fileType: config.fileType,
        detectedKeys: config.detectedKeys,
        contentHash: config.contentHash,
      })
      .onConflictDoUpdate({
        target: [repositoryConfigs.tenantId, repositoryConfigs.repositoryId, repositoryConfigs.filePath],
        set: {
          fileType: config.fileType,
          detectedKeys: config.detectedKeys,
          contentHash: config.contentHash,
          lastScannedAt: new Date(),
        },
      });
  }
}

export async function listRepoConfigs(db: Db, tenantId: number, repositoryId: number) {
  return db
    .select()
    .from(repositoryConfigs)
    .where(
      and(
        eq(repositoryConfigs.tenantId, tenantId),
        eq(repositoryConfigs.repositoryId, repositoryId)
      )
    );
}
