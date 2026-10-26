/**
 * Pure rules for Live Lock on Vercel Checks: what an integration webhook says,
 * and which check conclusion a probe outcome becomes. No I/O here.
 */

export type LiveLockMode = 'monitor' | 'enforce';

/** Why a deployment check ended the way it did. Stored on the check row. */
export type DeploymentCheckOutcome =
  | 'clear'
  | 'runtime_blocker'
  | 'ownership_unverified'
  | 'deployment_protected'
  | 'probe_refused'
  | 'probe_unavailable';

export type DeploymentCheckConclusion = 'succeeded' | 'failed' | 'neutral';

/** What a deployment check found. Rule ids and messages only, never samples. */
export interface DeploymentBlocker {
  ruleId: string;
  message: string;
  location: string;
}

/**
 * Only a blocker the probe proved fails the check, and only in enforce mode.
 * Everything Assurly could not decide is neutral: Vercel releases the
 * deployment and the dashboard says it was not verified. Assurly being down,
 * slow or locked out never holds someone's production.
 */
export function conclusionFor(
  mode: LiveLockMode,
  outcome: DeploymentCheckOutcome,
): DeploymentCheckConclusion {
  if (outcome === 'clear') return 'succeeded';
  if (outcome === 'runtime_blocker' && mode === 'enforce') return 'failed';
  return 'neutral';
}

/** Hosts Vercel generates for a deployment. A custom domain is never one. */
export function isVercelDeploymentUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (url.pathname !== '/' || url.search || url.hash) return false;
  const host = url.hostname.toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/.test(host);
}

const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{1,64}$/;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const TEAM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CHECK_ID = /^[A-Za-z0-9_-]{1,120}$/;
const CONFIGURATION_ID = /^icfg_[A-Za-z0-9]{1,64}$/;
const GIT_SHA = /^[0-9a-f]{7,64}$/;
const RESOURCE_ID = /^[A-Za-z0-9_-]{1,120}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A public DNS name only: no scheme games, ports, paths, IPs or `localhost`. */
function productionOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/$/, '');
  return HOST.test(host) ? `https://${host}` : null;
}

export type IntegrationEvent =
  | {
      type: 'deployment.created' | 'deployment.ready';
      deploymentId: string;
      projectId: string;
      teamId: string | null;
      production: boolean;
      deploymentUrl: string | null;
      gitSha: string | null;
    }
  | { type: 'deployment.check-rerequested'; deploymentId: string; checkId: string }
  | { type: 'integration-configuration.removed'; configurationId: string }
  | {
      type: 'integration-resource.project-connected';
      installationId: string;
      resourceId: string;
      projectId: string;
      projectName: string;
      /** `https://<production domain>`, as Vercel reports it for the project. */
      productionOrigin: string | null;
    }
  | {
      type: 'integration-resource.project-disconnected';
      installationId: string;
      resourceId: string;
      projectId: string;
    }
  | {
      type: 'deployment.checkrun.start';
      installationId: string;
      resourceId: string;
      deploymentId: string;
      checkRunId: string;
    }
  | {
      type: 'marketplace.invoice';
      state: VercelInvoiceEventState;
      installationId: string;
      invoiceId: string;
    }
  | { type: 'ignored' };

/** What an invoice webhook says happened to an invoice Assurly sent. */
export type VercelInvoiceEventState = 'invoiced' | 'paid' | 'notpaid' | 'overdue' | 'refunded';

const INVOICE_EVENTS: Record<string, VercelInvoiceEventState> = {
  'marketplace.invoice.created': 'invoiced',
  'marketplace.invoice.paid': 'paid',
  'marketplace.invoice.notpaid': 'notpaid',
  'marketplace.invoice.overdue': 'overdue',
  'marketplace.invoice.refunded': 'refunded',
};
const INVOICE_ID = /^[A-Za-z0-9_-]{1,120}$/;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function matching(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

/**
 * Reads the fields Live Lock acts on from a signed integration webhook. A
 * field that does not have the shape Vercel documents is treated as absent.
 */
export function readIntegrationEvent(raw: unknown): IntegrationEvent {
  const root = record(raw);
  const payload = record(root.payload);
  const deployment = record(payload.deployment);
  const type = root.type;

  if (type === 'deployment.created' || type === 'deployment.ready') {
    const deploymentId = matching(deployment.id, DEPLOYMENT_ID);
    const projectId =
      matching(record(payload.project).id, PROJECT_ID) ?? matching(payload.projectId, PROJECT_ID);
    if (!deploymentId || !projectId) return { type: 'ignored' };
    const host = typeof deployment.url === 'string' ? deployment.url.trim().toLowerCase() : '';
    const candidate = host ? `https://${host.replace(/^https:\/\//, '')}/` : '';
    const sha = record(deployment.meta).githubCommitSha;
    return {
      type,
      deploymentId,
      projectId,
      teamId: matching(record(payload.team).id, TEAM_ID),
      production: payload.target === 'production',
      deploymentUrl: isVercelDeploymentUrl(candidate) ? candidate.slice(0, -1) : null,
      gitSha: typeof sha === 'string' ? matching(sha.toLowerCase(), GIT_SHA) : null,
    };
  }

  if (type === 'deployment.check-rerequested') {
    const deploymentId = matching(deployment.id, DEPLOYMENT_ID);
    const checkId = matching(record(payload.check).id, CHECK_ID);
    return deploymentId && checkId ? { type, deploymentId, checkId } : { type: 'ignored' };
  }

  if (type === 'integration-configuration.removed') {
    const configurationId = matching(record(payload.configuration).id, CONFIGURATION_ID);
    return configurationId ? { type, configurationId } : { type: 'ignored' };
  }

  if (
    type === 'integration-resource.project-connected' ||
    type === 'integration-resource.project-disconnected'
  ) {
    const installationId =
      matching(payload.installationId, CONFIGURATION_ID) ??
      matching(record(payload.configuration).id, CONFIGURATION_ID);
    const resourceId = matching(payload.resourceId, RESOURCE_ID);
    const project = record(payload.project);
    const projectId = matching(project.id, PROJECT_ID) ?? matching(payload.projectId, PROJECT_ID);
    if (!installationId || !resourceId || !projectId) return { type: 'ignored' };
    if (type === 'integration-resource.project-disconnected') {
      return { type, installationId, resourceId, projectId };
    }
    const name = typeof project.name === 'string' ? project.name.trim().slice(0, 100) : '';
    return {
      type,
      installationId,
      resourceId,
      projectId,
      projectName: name || projectId,
      productionOrigin: productionOrigin(payload.productionDomain),
    };
  }

  if (typeof type === 'string' && Object.hasOwn(INVOICE_EVENTS, type)) {
    const installationId =
      matching(record(payload.configuration).id, CONFIGURATION_ID) ??
      matching(payload.installationId, CONFIGURATION_ID);
    const invoiceId = matching(payload.invoiceId, INVOICE_ID);
    const state = INVOICE_EVENTS[type];
    return installationId && invoiceId && state
      ? { type: 'marketplace.invoice', state, installationId, invoiceId }
      : { type: 'ignored' };
  }

  if (type === 'deployment.checkrun.start') {
    const checkRun = record(payload.checkRun);
    const source = record(checkRun.source);
    const installationId = matching(source.integrationConfigurationId, CONFIGURATION_ID);
    const resourceId = matching(source.externalResourceId, RESOURCE_ID);
    const deploymentId =
      matching(deployment.id, DEPLOYMENT_ID) ?? matching(checkRun.deploymentId, DEPLOYMENT_ID);
    const checkRunId = matching(checkRun.id, CHECK_ID);
    if (
      source.kind !== 'integration' ||
      !installationId ||
      !resourceId ||
      !deploymentId ||
      !checkRunId
    ) {
      return { type: 'ignored' };
    }
    return { type, installationId, resourceId, deploymentId, checkRunId };
  }

  return { type: 'ignored' };
}
