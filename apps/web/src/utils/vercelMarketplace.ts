import { z } from 'zod';
import type { DbAdapter, LiveLockResourceRow, VercelInstallationRow } from './dbAdapter';
import type { LiveLockMode } from './liveLockCheck';
import type { VercelMarketplaceApi } from './vercelMarketplaceApi';

/**
 * The Partner API behind the native "Live Lock" product. Route handlers stay
 * thin: they verify the caller, then call these functions, which only touch
 * what the deps give them.
 *
 * Shapes follow Vercel's Partner API reference and its example integration:
 * a resource is `{ id, productId, name, metadata, status, billingPlan }`, and
 * an error is `{ error: { code, message, user? } }`.
 */

export const LIVE_LOCK_PRODUCT_ID = 'live-lock';

export type MarketplacePlanId = 'free' | 'pro';

/**
 * Vercel bills Marketplace plans in USD only. Assurly Pro is €17 through
 * Stripe; through Vercel it is $17 (decided 2026-10-25).
 */
const PRO_MONTHLY_USD = '17.00';

export interface MarketplaceBillingPlan {
  id: MarketplacePlanId;
  type: 'subscription';
  scope: 'installation';
  name: string;
  description: string;
  paymentMethodRequired: boolean;
  cost?: string;
  details: { label: string; value?: string }[];
  highlightedDetails?: { label: string; value?: string }[];
}

export const MARKETPLACE_PLANS: Record<MarketplacePlanId, MarketplaceBillingPlan> = {
  free: {
    id: 'free',
    type: 'subscription',
    scope: 'installation',
    name: 'Free',
    description: 'Watch one production project. Assurly reports and never blocks.',
    paymentMethodRequired: false,
    details: [
      { label: 'Guarded projects', value: '1' },
      { label: 'Mode', value: 'Monitor' },
    ],
  },
  pro: {
    id: 'pro',
    type: 'subscription',
    scope: 'installation',
    name: 'Pro',
    description: 'Hold back a production deploy when the live check proves a blocker.',
    paymentMethodRequired: true,
    cost: `$${PRO_MONTHLY_USD}/month`,
    details: [
      { label: 'Guarded projects', value: 'Unlimited' },
      { label: 'Mode', value: 'Monitor or Enforce' },
      { label: 'Assurly dashboard', value: 'Pro' },
    ],
    highlightedDetails: [{ label: 'Blocks unsafe production deploys' }],
  },
};

/** Free guards one project; Pro is unlimited. */
const FREE_RESOURCE_LIMIT = 1;

export class MarketplaceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Shown to the person in the Vercel dashboard. */
    readonly userMessage: string | null = null,
    readonly fields: { key: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'MarketplaceError';
  }

  toBody(): Record<string, unknown> {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.userMessage ? { user: { message: this.userMessage } } : {}),
        ...(this.fields.length ? { fields: this.fields } : {}),
      },
    };
  }
}

export interface MarketplaceDeps {
  db: DbAdapter;
  encryptToken: (plaintext: string) => string;
  decryptToken: (ciphertext: string) => string;
  apiFor: (token: string) => VercelMarketplaceApi;
}

// ---------------------------------------------------------------------------
// Request bodies (Partner API reference)
// ---------------------------------------------------------------------------

const planIdSchema = z.enum(['free', 'pro']);

export const upsertInstallationBodySchema = z
  .object({
    scopes: z.array(z.string().max(100)).max(100),
    acceptedPolicies: z.record(z.string(), z.string()),
    credentials: z.object({
      access_token: z.string().min(1).max(4000),
      token_type: z.string().min(1).max(40),
    }),
    account: z
      .object({
        name: z.string().max(200).optional(),
        url: z.string().max(2000),
        contact: z
          .object({ email: z.string().max(320), name: z.string().max(200).optional() })
          .nullable()
          .optional(),
      })
      .passthrough()
      .optional(),
    billingPlanId: z.string().max(40).optional(),
  })
  .passthrough();

export const updateInstallationBodySchema = z.object({ billingPlanId: z.string().max(40) });

const metadataSchema = z.record(z.string(), z.unknown());

export const provisionResourceBodySchema = z
  .object({
    productId: z.string().max(100),
    name: z.string().trim().min(1).max(100),
    metadata: metadataSchema.optional().default({}),
    billingPlanId: z.string().max(40).optional(),
  })
  .passthrough();

export const updateResourceBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    metadata: metadataSchema.optional(),
    billingPlanId: z.string().max(40).optional(),
    status: z.string().max(40).optional(),
  })
  .passthrough();

function planFrom(value: string | undefined): MarketplacePlanId | null {
  const parsed = planIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The product's Metadata Schema has one field, `mode`; Monitor is the default. */
function modeFrom(metadata: Record<string, unknown> | undefined): LiveLockMode | 'invalid' {
  const value = metadata?.mode;
  if (value === undefined || value === null || value === '') return 'monitor';
  return value === 'monitor' || value === 'enforce' ? value : 'invalid';
}

function invalidMode(): MarketplaceError {
  return new MarketplaceError(
    400,
    'validation_error',
    'metadata.mode must be "monitor" or "enforce".',
    null,
    [{ key: 'mode', message: 'Choose Monitor or Enforce.' }],
  );
}

function enforceNeedsPro(): MarketplaceError {
  return new MarketplaceError(
    400,
    'validation_error',
    'Enforce mode needs the Pro plan.',
    'Enforce holds back production deploys and is part of the Pro plan. Choose Monitor, or upgrade the installation to Pro.',
    [{ key: 'mode', message: 'Enforce needs the Pro plan.' }],
  );
}

// ---------------------------------------------------------------------------
// Installations
// ---------------------------------------------------------------------------

export async function upsertInstallation(
  installationId: string,
  accountId: string,
  body: z.infer<typeof upsertInstallationBodySchema>,
  deps: MarketplaceDeps,
): Promise<void> {
  await deps.db.upsertVercelInstallation({
    installationId,
    accountId,
    tokenCiphertext: deps.encryptToken(body.credentials.access_token),
    accountName: body.account?.name?.trim() || null,
    contactEmail: body.account?.contact?.email?.trim() || null,
  });
  const plan = planFrom(body.billingPlanId);
  if (plan) await deps.db.setVercelInstallationPlan(installationId, plan);
}

async function requireInstallation(
  installationId: string,
  deps: MarketplaceDeps,
): Promise<VercelInstallationRow> {
  const installation = await deps.db.getVercelInstallation(installationId);
  if (!installation) {
    throw new MarketplaceError(404, 'not_found', 'Installation not found.');
  }
  return installation;
}

export async function getInstallation(
  installationId: string,
  deps: MarketplaceDeps,
): Promise<{ billingPlan: MarketplaceBillingPlan }> {
  const installation = await requireInstallation(installationId, deps);
  return { billingPlan: MARKETPLACE_PLANS[installation.billing_plan_id] };
}

/**
 * A plan change. Going to Free switches every Enforce lock to Monitor first,
 * so a downgrade never leaves a deploy held by a plan nobody pays for.
 */
export async function updateInstallationPlan(
  installationId: string,
  billingPlanId: string,
  deps: MarketplaceDeps,
): Promise<void> {
  const installation = await requireInstallation(installationId, deps);
  const plan = planFrom(billingPlanId);
  if (!plan) throw new MarketplaceError(400, 'validation_error', 'Unknown billing plan.');
  if (plan === 'free') {
    const resources = await deps.db.listLiveLockResources(installationId);
    for (const resource of resources.filter((item) => item.mode === 'enforce')) {
      await applyMode(installation, resource, 'monitor', deps);
    }
  }
  await deps.db.setVercelInstallationPlan(installationId, plan);
}

/**
 * Uninstall. Our project checks are removed while the token still works, so
 * Vercel is not left waiting on a check nobody will conclude. There are no
 * open invoices to settle yet, so the installation is finalized at once.
 */
export async function deleteInstallation(
  installationId: string,
  deps: MarketplaceDeps,
): Promise<{ finalized: true }> {
  const installation = await deps.db.getVercelInstallation(installationId);
  if (installation) {
    const api = deps.apiFor(deps.decryptToken(installation.token_ciphertext));
    const resources = await deps.db.listLiveLockResources(installationId);
    await Promise.allSettled(
      resources.map((resource) =>
        resource.vercel_project_id && resource.vercel_check_id
          ? api.deleteProjectCheck(resource.vercel_project_id, resource.vercel_check_id)
          : Promise.resolve(),
      ),
    );
    await deps.db.deleteVercelInstallation(installationId);
  }
  return { finalized: true };
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export interface MarketplaceResource {
  id: string;
  productId: string;
  name: string;
  metadata: { mode: LiveLockMode };
  status: 'ready' | 'suspended';
  billingPlan: MarketplaceBillingPlan;
  notification?: { level: 'info' | 'warn' | 'error'; title: string; message?: string };
}

export function resourceView(
  resource: LiveLockResourceRow,
  plan: MarketplacePlanId,
): MarketplaceResource {
  return {
    id: resource.resource_id,
    productId: LIVE_LOCK_PRODUCT_ID,
    name: resource.name,
    metadata: { mode: resource.mode },
    status: resource.status,
    billingPlan: MARKETPLACE_PLANS[plan],
    ...(resource.vercel_project_id
      ? {}
      : {
          notification: {
            level: 'info' as const,
            title: 'Connect a project',
            message:
              'Connect this Live Lock to the Vercel project whose production deploys it should check.',
          },
        }),
  };
}

export async function provisionResource(
  installationId: string,
  body: z.infer<typeof provisionResourceBodySchema>,
  deps: MarketplaceDeps,
): Promise<MarketplaceResource & { secrets: { name: string; value: string }[] }> {
  if (body.productId !== LIVE_LOCK_PRODUCT_ID) {
    throw new MarketplaceError(400, 'validation_error', 'Unknown product.');
  }
  const installation = await requireInstallation(installationId, deps);
  // Installation-level billing: a plan picked in this flow applies to the installation.
  const requestedPlan = planFrom(body.billingPlanId);
  const plan = requestedPlan ?? installation.billing_plan_id;
  const mode = modeFrom(body.metadata);
  if (mode === 'invalid') throw invalidMode();
  if (mode === 'enforce' && plan !== 'pro') throw enforceNeedsPro();

  if (plan === 'free') {
    const existing = await deps.db.listLiveLockResources(installationId);
    if (existing.length >= FREE_RESOURCE_LIMIT) {
      throw new MarketplaceError(
        409,
        'conflict',
        'The Free plan guards one project.',
        'The Free plan guards one project. Upgrade to Pro to guard more.',
      );
    }
  }
  if (requestedPlan && requestedPlan !== installation.billing_plan_id) {
    await deps.db.setVercelInstallationPlan(installationId, requestedPlan);
  }

  const resource = await deps.db.createLiveLockResource({
    installationId,
    organizationId: installation.organization_id,
    name: body.name,
    mode,
  });
  return {
    ...resourceView(resource, plan),
    // Nothing secret is needed at build time. The id lets a build or a support
    // request name the lock it belongs to.
    secrets: [{ name: 'ASSURLY_LIVE_LOCK_ID', value: resource.resource_id }],
  };
}

async function requireResource(
  installationId: string,
  resourceId: string,
  deps: MarketplaceDeps,
): Promise<LiveLockResourceRow> {
  const resource = await deps.db.getLiveLockResource(installationId, resourceId);
  if (!resource) throw new MarketplaceError(404, 'not_found', 'Resource not found.');
  return resource;
}

export async function getResource(
  installationId: string,
  resourceId: string,
  deps: MarketplaceDeps,
): Promise<MarketplaceResource> {
  const installation = await requireInstallation(installationId, deps);
  const resource = await requireResource(installationId, resourceId, deps);
  return resourceView(resource, installation.billing_plan_id);
}

/**
 * Mirrors a mode into the three places that hold it: the resource, the lock
 * row the dashboard reads, and the project check Vercel enforces.
 */
async function applyMode(
  installation: VercelInstallationRow,
  resource: LiveLockResourceRow,
  mode: LiveLockMode,
  deps: MarketplaceDeps,
): Promise<LiveLockResourceRow> {
  if (resource.vercel_project_id && resource.vercel_check_id) {
    const api = deps.apiFor(deps.decryptToken(installation.token_ciphertext));
    await api.setProjectCheckBlocking(
      resource.vercel_project_id,
      resource.vercel_check_id,
      mode === 'enforce',
    );
  }
  if (resource.target_id) await deps.db.setLiveLockMode(resource.target_id, mode);
  const updated = await deps.db.updateLiveLockResource(
    resource.installation_id,
    resource.resource_id,
    { mode },
  );
  return updated ?? { ...resource, mode };
}

export async function updateResource(
  installationId: string,
  resourceId: string,
  body: z.infer<typeof updateResourceBodySchema>,
  deps: MarketplaceDeps,
): Promise<MarketplaceResource> {
  const installation = await requireInstallation(installationId, deps);
  let resource = await requireResource(installationId, resourceId, deps);
  if (body.metadata !== undefined) {
    const mode = modeFrom(body.metadata);
    if (mode === 'invalid') throw invalidMode();
    if (mode === 'enforce' && installation.billing_plan_id !== 'pro') throw enforceNeedsPro();
    if (mode !== resource.mode) resource = await applyMode(installation, resource, mode, deps);
  }
  if (body.name !== undefined && body.name !== resource.name) {
    resource =
      (await deps.db.updateLiveLockResource(installationId, resourceId, { name: body.name })) ??
      resource;
  }
  return resourceView(resource, installation.billing_plan_id);
}

export async function deleteResource(
  installationId: string,
  resourceId: string,
  deps: MarketplaceDeps,
): Promise<void> {
  const installation = await requireInstallation(installationId, deps);
  const resource = await deps.db.getLiveLockResource(installationId, resourceId);
  if (!resource) return;
  if (resource.vercel_project_id && resource.vercel_check_id) {
    const api = deps.apiFor(deps.decryptToken(installation.token_ciphertext));
    await api.deleteProjectCheck(resource.vercel_project_id, resource.vercel_check_id);
  }
  // The lock row cascades with the resource.
  await deps.db.deleteLiveLockResource(installationId, resourceId);
}
