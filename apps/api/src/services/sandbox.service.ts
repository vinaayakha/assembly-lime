import { eq, and } from "drizzle-orm";
import * as k8s from "@kubernetes/client-node";
import type { Db } from "@assembly-lime/shared/db";
import { sandboxes, repositories } from "@assembly-lime/shared/db/schema";
import { getClusterClient } from "./k8s-cluster.service";
import { coreApi, K8S_NAMESPACE } from "../lib/k8s";
import { childLogger } from "../lib/logger";

const log = childLogger({ module: "sandbox-service" });

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 53);
}

type CreateSandboxInput = {
  repositoryId: number;
  branch: string;
  clusterId?: number;
  envVarSetId?: number;
  ports?: Array<{ containerPort: number; hostPort?: number; protocol?: string }>;
  createdBy?: number;
};

export async function createSandbox(db: Db, tenantId: number, input: CreateSandboxInput) {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.id, input.repositoryId), eq(repositories.tenantId, tenantId)));
  if (!repo) throw new Error("Repository not found");

  const name = slugify(`sandbox-${repo.name}-${input.branch}`);
  const ns = K8S_NAMESPACE;
  const ports = input.ports ?? [{ containerPort: 3000 }];

  // Get the right K8s client
  let core: k8s.CoreV1Api;
  if (input.clusterId) {
    const kc = await getClusterClient(db, tenantId, input.clusterId);
    core = kc.makeApiClient(k8s.CoreV1Api);
  } else {
    core = coreApi;
  }

  // Create namespace if needed
  try {
    await core.readNamespace({ name: ns });
  } catch {
    await core.createNamespace({ body: { metadata: { name: ns } } });
  }

  // Create pod with init-container that clones repo
  const pod: k8s.V1Pod = {
    metadata: { name, namespace: ns, labels: { "assembly-lime/sandbox": name } },
    spec: {
      initContainers: [
        {
          name: "git-clone",
          image: "alpine/git:latest",
          command: ["sh", "-c", `git clone --branch ${input.branch} --depth 1 ${repo.cloneUrl} /workspace`],
          volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
        },
      ],
      containers: [
        {
          name: "sandbox",
          image: "node:24-alpine",
          command: ["sh", "-c", "cd /workspace && if [ -f package.json ]; then npm install && npm start; else sleep infinity; fi"],
          ports: ports.map((p) => ({ containerPort: p.containerPort })),
          volumeMounts: [{ name: "workspace", mountPath: "/workspace" }],
          resources: {
            requests: { cpu: "100m", memory: "128Mi" },
            limits: { cpu: "500m", memory: "512Mi" },
          },
        },
      ],
      volumes: [{ name: "workspace", emptyDir: {} }],
      restartPolicy: "Never",
    },
  };

  try {
    await core.createNamespacedPod({ namespace: ns, body: pod });
  } catch (err) {
    log.error({ err, name }, "failed to create sandbox pod");
    throw err;
  }

  const [row] = await db
    .insert(sandboxes)
    .values({
      tenantId,
      clusterId: input.clusterId,
      repositoryId: input.repositoryId,
      branch: input.branch,
      k8sNamespace: ns,
      k8sPod: name,
      status: "creating",
      portsJson: ports,
      envVarSetId: input.envVarSetId,
      createdBy: input.createdBy,
    })
    .returning();

  log.info({ sandboxId: row!.id, tenantId, pod: name }, "sandbox created");
  return row!;
}

export async function getSandbox(db: Db, tenantId: number, sandboxId: number) {
  const [row] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)));
  if (!row) return null;

  // Get live K8s status
  try {
    let core: k8s.CoreV1Api;
    if (row.clusterId) {
      const kc = await getClusterClient(db, tenantId, row.clusterId);
      core = kc.makeApiClient(k8s.CoreV1Api);
    } else {
      core = coreApi;
    }
    const pod = await core.readNamespacedPod({ namespace: row.k8sNamespace, name: row.k8sPod });
    const phase = pod.status?.phase?.toLowerCase() ?? "unknown";
    const statusMap: Record<string, string> = {
      pending: "creating",
      running: "running",
      succeeded: "stopped",
      failed: "error",
    };
    const liveStatus = statusMap[phase] ?? row.status;

    if (liveStatus !== row.status) {
      await db.update(sandboxes).set({ status: liveStatus }).where(eq(sandboxes.id, sandboxId));
    }
    return { ...row, status: liveStatus };
  } catch {
    return row;
  }
}

export async function listSandboxes(db: Db, tenantId: number) {
  return db
    .select()
    .from(sandboxes)
    .where(eq(sandboxes.tenantId, tenantId));
}

export async function destroySandbox(db: Db, tenantId: number, sandboxId: number) {
  const [row] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)));
  if (!row) return null;

  try {
    let core: k8s.CoreV1Api;
    if (row.clusterId) {
      const kc = await getClusterClient(db, tenantId, row.clusterId);
      core = kc.makeApiClient(k8s.CoreV1Api);
    } else {
      core = coreApi;
    }
    await core.deleteNamespacedPod({ namespace: row.k8sNamespace, name: row.k8sPod });
  } catch (err) {
    log.error({ err, sandboxId }, "failed to delete sandbox pod");
  }

  const [updated] = await db
    .update(sandboxes)
    .set({ status: "destroyed", destroyedAt: new Date() })
    .where(eq(sandboxes.id, sandboxId))
    .returning();

  log.info({ sandboxId, tenantId }, "sandbox destroyed");
  return updated;
}

export async function getSandboxLogs(db: Db, tenantId: number, sandboxId: number) {
  const [row] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.tenantId, tenantId)));
  if (!row) return null;

  try {
    let core: k8s.CoreV1Api;
    if (row.clusterId) {
      const kc = await getClusterClient(db, tenantId, row.clusterId);
      core = kc.makeApiClient(k8s.CoreV1Api);
    } else {
      core = coreApi;
    }
    const logResponse = await core.readNamespacedPodLog({
      namespace: row.k8sNamespace,
      name: row.k8sPod,
      container: "sandbox",
      tailLines: 500,
    });
    return logResponse;
  } catch (err) {
    log.error({ err, sandboxId }, "failed to get sandbox logs");
    return null;
  }
}
