import { eq, and } from "drizzle-orm";
import type { Db } from "@assembly-lime/shared/db";
import { domains } from "@assembly-lime/shared/db/schema";
import { networkingApi, K8S_NAMESPACE, PREVIEW_INGRESS_CLASS } from "../lib/k8s";
import { childLogger } from "../lib/logger";
import type * as k8s from "@kubernetes/client-node";

const log = childLogger({ module: "domain-service" });

type CreateDomainInput = {
  domain: string;
  previewDeploymentId?: number;
  sandboxId?: number;
};

export async function createDomain(db: Db, tenantId: number, input: CreateDomainInput) {
  const ingressName = input.domain.replace(/\./g, "-").slice(0, 53);
  const ns = K8S_NAMESPACE;

  // Determine backend service name
  let serviceName = "default-backend";
  if (input.previewDeploymentId) {
    serviceName = `preview-${input.previewDeploymentId}`;
  } else if (input.sandboxId) {
    serviceName = `sandbox-${input.sandboxId}`;
  }

  const ingress: k8s.V1Ingress = {
    metadata: {
      name: ingressName,
      namespace: ns,
      annotations: {
        "cert-manager.io/cluster-issuer": "letsencrypt-prod",
        "nginx.ingress.kubernetes.io/proxy-body-size": "50m",
      },
    },
    spec: {
      ingressClassName: PREVIEW_INGRESS_CLASS,
      tls: [
        {
          hosts: [input.domain],
          secretName: `tls-${ingressName}`,
        },
      ],
      rules: [
        {
          host: input.domain,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: { name: serviceName, port: { number: 80 } },
                },
              },
            ],
          },
        },
      ],
    },
  };

  try {
    await networkingApi.createNamespacedIngress({ namespace: ns, body: ingress });
  } catch (err) {
    log.error({ err, domain: input.domain }, "failed to create ingress");
    throw err;
  }

  const [row] = await db
    .insert(domains)
    .values({
      tenantId,
      previewDeploymentId: input.previewDeploymentId,
      sandboxId: input.sandboxId,
      domain: input.domain,
      ingressName,
      tlsCertSecret: `tls-${ingressName}`,
      status: "provisioning",
    })
    .returning();

  log.info({ domainId: row!.id, domain: input.domain }, "domain created");
  return row!;
}

export async function listDomains(db: Db, tenantId: number) {
  return db
    .select()
    .from(domains)
    .where(eq(domains.tenantId, tenantId));
}

export async function deleteDomain(db: Db, tenantId: number, domainId: number) {
  const [row] = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, domainId), eq(domains.tenantId, tenantId)));
  if (!row) return null;

  if (row.ingressName) {
    try {
      await networkingApi.deleteNamespacedIngress({
        namespace: K8S_NAMESPACE,
        name: row.ingressName,
      });
    } catch (err) {
      log.error({ err, domainId }, "failed to delete ingress");
    }
  }

  const [updated] = await db
    .update(domains)
    .set({ status: "deleted" })
    .where(eq(domains.id, domainId))
    .returning();

  log.info({ domainId, tenantId }, "domain deleted");
  return updated;
}
