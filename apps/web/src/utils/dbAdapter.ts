import type { BillingPlan } from './entitlements';
import { getSupabaseAdminConfig, getSupabaseConfig } from './env';

export type { BillingPlan };

export interface User {
  id: string;
  name: string;
  email: string;
  avatar_url: string;
}

export interface Organization {
  id: string;
  name: string;
  billing_plan: BillingPlan;
  stripe_customer_id?: string;
  github_org_id?: number;
  github_installation_id?: string;
  created_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  organization_id: string;
  role: 'admin' | 'member';
  created_at: string;
}

export interface Repository {
  id: string;
  organization_id: string;
  name: string;
  github_repo_id: number;
  is_active: boolean;
  created_at: string;
}

export interface Scan {
  id: string;
  repository_id: string;
  commit_sha: string;
  branch: string;
  status: 'success' | 'failed';
  error_count: number;
  warning_count: number;
  share_token?: string | null;
  created_at: string;
}

export interface ScanFinding {
  id: string;
  scan_id: string;
  rule_id: string;
  severity: 'error' | 'warning';
  /**
   * Confidence used by the Ship Gate to separate blockers (error + high) from
   * review items (error + medium/low). Optional for legacy rows persisted before
   * this column existed — the Ship Gate treats a missing value as 'high'.
   */
  confidence?: 'high' | 'medium' | 'low';
  file_path: string;
  line_number?: number;
  message: string;
  suggestion?: string;
  fix_pr_url?: string | null;
  created_at: string;
}

export type TargetKind = 'repo' | 'url';
export type TargetVerdict = 'ready' | 'review' | 'blocked' | 'unknown';
export type TargetOwnershipMethod = 'github_app' | 'dns_txt' | 'meta_tag' | 'file' | 'deploy_link';

/**
 * The persistent "current verdict" for one monitored app. Scans remain the
 * source of truth; a target is the current-state projection plus metadata scans
 * don't carry (generator fingerprint, ownership, badge token). See the Phase 1
 * section of docs/roadmap/10-genius-rebuild-master-plan.md.
 */
export interface Target {
  id: string;
  organization_id: string;
  kind: TargetKind;
  identifier: string;
  display_name: string | null;
  repository_id: string | null;
  generator_fingerprint: string | null;
  ownership_verified: boolean;
  ownership_method: TargetOwnershipMethod | null;
  current_verdict: TargetVerdict | null;
  current_ship_score: number | null;
  verdict_evidence: unknown | null;
  last_checked_at: string | null;
  badge_token: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Partial upsert: only the provided fields are written. On conflict with an
 * existing (organization_id, kind, identifier) target, unspecified columns
 * (e.g. a previously detected fingerprint, or ownership) are preserved.
 */
export interface UpsertTargetInput {
  organizationId: string;
  kind: TargetKind;
  identifier: string;
  displayName?: string | null;
  repositoryId?: string | null;
  generatorFingerprint?: string | null;
  currentVerdict?: TargetVerdict | null;
  currentShipScore?: number | null;
  verdictEvidence?: unknown;
  lastCheckedAt?: string | null;
  badgeToken?: string | null;
}

export type AlertChannel = 'email' | 'slack' | 'discord';

/** Per-target alert delivery preferences (Phase 6 guardian). */
export interface TargetAlertPref {
  id: string;
  organization_id: string;
  target_id: string;
  channel: AlertChannel;
  webhook_url: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertTargetAlertPrefInput {
  organizationId: string;
  targetId: string;
  channel: AlertChannel;
  webhookUrl?: string | null;
  enabled: boolean;
}

/** Input for marking a target's ownership as proven (Phase 3). */
export interface SetTargetOwnershipInput {
  ownershipVerified: boolean;
  ownershipMethod: TargetOwnershipMethod | null;
}

export type ProbeEvidenceKind = 'rls_rows' | 'exposed_secret' | 'open_endpoint' | 'missing_header';

/** A persisted, already-redacted proof artifact behind a runtime finding (Phase 2). */
export interface ProbeEvidenceRow {
  id: string;
  organization_id: string;
  scan_id: string | null;
  finding_rule_id: string;
  kind: ProbeEvidenceKind;
  summary: string;
  redacted_sample: unknown | null;
  created_at: string;
}

/** Input for persisting probe evidence. `redactedSample` must already be masked. */
export interface ProbeEvidenceInput {
  organizationId: string;
  scanId?: string | null;
  findingRuleId: string;
  kind: ProbeEvidenceKind;
  summary: string;
  redactedSample?: unknown;
}

export type FixOutcomeStatus = 'verified_fixed' | 'still_open' | 'regressed';

/** A persisted verified-fix loop record (Phase 5). */
export interface FixOutcomeRow {
  id: string;
  organization_id: string;
  target_id: string | null;
  scan_id: string | null;
  finding_rule_id: string;
  generator_fingerprint: string | null;
  fix_strategy: string | null;
  outcome: FixOutcomeStatus;
  pr_url: string | null;
  deploy_id: string | null;
  created_at: string;
}

/** Input for recording a verified-fix outcome. `deployId` dedupes deploy re-fires. */
export interface FixOutcomeInput {
  organizationId: string;
  targetId: string | null;
  scanId?: string | null;
  findingRuleId: string;
  generatorFingerprint?: string | null;
  fixStrategy?: string | null;
  outcome: FixOutcomeStatus;
  prUrl?: string | null;
  deployId?: string | null;
}

/** Pattern-only projection of fix outcomes for the corpus rollup (§2.8). */
export interface FixOutcomeCorpusRow {
  generator_fingerprint: string | null;
  finding_rule_id: string;
  fix_strategy: string | null;
  outcome: FixOutcomeStatus;
}

/**
 * A programmatic API key row for org-scoped management (Phase 7). NEVER carries
 * the key hash or plaintext — the dashboard only shows the label + non-secret
 * display prefix. The plaintext is returned to the creator exactly once, out of
 * band (the create route response), and never persisted.
 */
export interface ApiKeyRow {
  id: string;
  organization_id: string;
  label: string;
  key_prefix: string;
  plan: BillingPlan;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Minimal projection used at request-time key authentication (service role). */
export interface ApiKeyAuthContext {
  id: string;
  organization_id: string;
  plan: BillingPlan;
  revoked_at: string | null;
}

/** Input for issuing a new key. `keyHash`/`keyPrefix` come from utils/apiKeys.ts. */
export interface CreateApiKeyInput {
  organizationId: string;
  label: string;
  keyHash: string;
  keyPrefix: string;
  plan: BillingPlan;
}

export interface StripeBillingEvent {
  eventId: string;
  eventType: string;
  organizationId: string;
  plan: 'free' | 'pro';
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
}

export interface GitHubRepositoryMapping {
  id: number;
  fullName: string;
}

export interface ApiRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface DbAdapter {
  consumeApiRateLimit(
    keyHash: string,
    routeId: string,
    limit: number,
    windowSeconds: number,
  ): Promise<ApiRateLimitResult>;
  getOrganization(orgId: string): Promise<Organization | null>;
  getOrganizationByUserId(userId: string): Promise<Organization | null>;
  createOrganization(name: string): Promise<Organization>;
  getMembership(userId: string, orgId: string): Promise<Membership | null>;
  setOrganizationStripeCustomerId(organizationId: string, stripeCustomerId: string): Promise<void>;
  processStripeBillingEvent(event: StripeBillingEvent): Promise<boolean>;
  connectGitHubInstallation(
    organizationId: string,
    githubAccountId: number,
    installationId: string,
    repositories: GitHubRepositoryMapping[],
  ): Promise<number>;
  claimGitHubDelivery(
    deliveryId: string,
    eventType: string,
    githubRepositoryId: number,
    installationId: string,
  ): Promise<boolean>;
  finishGitHubDelivery(
    deliveryId: string,
    succeeded: boolean,
    failureMessage?: string,
  ): Promise<void>;
  getRepositories(orgId: string): Promise<Repository[]>;
  getRepository(repoId: string): Promise<Repository | null>;
  getRepositoryByGithubRepoId(githubRepoId: number): Promise<Repository | null>;
  addRepository(orgId: string, name: string, githubRepoId: number): Promise<Repository>;
  saveScan(
    repoId: string,
    commitSha: string,
    branch: string,
    status: 'success' | 'failed',
    errors: number,
    warnings: number,
    findings: Omit<ScanFinding, 'id' | 'scan_id' | 'created_at'>[],
  ): Promise<Scan>;
  getScan(scanId: string): Promise<Scan | null>;
  getRecentScans(repoId: string): Promise<Scan[]>;
  /** Permanently deletes one scan. Findings/probe evidence cascade; fix outcomes null out. */
  deleteScan(scanId: string): Promise<void>;
  getScanFindings(scanId: string): Promise<ScanFinding[]>;
  getFinding(findingId: string): Promise<ScanFinding | null>;
  setScanShareToken(scanId: string, shareToken: string): Promise<Scan>;
  getScanByShareToken(shareToken: string): Promise<Scan | null>;
  getRepositoryNameForScan(scanId: string): Promise<string | null>;
  getOrganizationAdminEmails(organizationId: string): Promise<string[]>;
  updateFindingFixPrUrl(findingId: string, fixPrUrl: string): Promise<void>;
  updateFindingFixPrUrls(updates: { findingId: string; fixPrUrl: string }[]): Promise<void>;
  getTargets(organizationId: string): Promise<Target[]>;
  getTargetById(id: string): Promise<Target | null>;
  getTargetByIdentifier(
    organizationId: string,
    kind: TargetKind,
    identifier: string,
  ): Promise<Target | null>;
  upsertTarget(input: UpsertTargetInput): Promise<Target>;
  setTargetOwnership(id: string, input: SetTargetOwnershipInput): Promise<Target>;
  insertProbeEvidence(rows: ProbeEvidenceInput[]): Promise<void>;
  getProbeEvidenceForScan(scanId: string): Promise<ProbeEvidenceRow[]>;
  findVerifiedUrlTargetByOrigin(origin: string): Promise<Target | null>;
  /** All ownership-verified url targets for the guardian cron (admin/service role). */
  listVerifiedUrlTargets(): Promise<Target[]>;
  getTargetByBadgeToken(badgeToken: string): Promise<Target | null>;
  getTargetAlertPrefs(targetId: string): Promise<TargetAlertPref[]>;
  upsertTargetAlertPref(input: UpsertTargetAlertPrefInput): Promise<TargetAlertPref>;
  claimVercelDelivery(
    deployId: string,
    eventType: string,
    organizationId: string,
    targetId: string,
  ): Promise<boolean>;
  finishVercelDelivery(
    deployId: string,
    succeeded: boolean,
    failureMessage?: string,
  ): Promise<void>;
  insertFixOutcomes(rows: FixOutcomeInput[]): Promise<void>;
  getFixOutcomesForTarget(targetId: string): Promise<FixOutcomeRow[]>;
  getFixOutcomeCorpus(): Promise<FixOutcomeCorpusRow[]>;
  /**
   * Total number of monitored apps (targets) across all orgs. Aggregate scalar
   * ONLY — never returns a row or any customer-identifying field. Used by the
   * exit-metrics surface (Phase 8) alongside the pattern-only corpus.
   */
  countMonitoredApps(): Promise<number>;
  createApiKey(input: CreateApiKeyInput): Promise<ApiKeyRow>;
  listApiKeys(organizationId: string): Promise<ApiKeyRow[]>;
  /** Request-time key auth (service role). Returns null when no key hashes to this. */
  getApiKeyByHash(keyHash: string): Promise<ApiKeyAuthContext | null>;
  revokeApiKey(id: string): Promise<void>;
  /** Hard-delete a key row. Callers must ensure the key is already revoked. */
  deleteApiKey(id: string): Promise<void>;
  touchApiKey(id: string): Promise<void>;
}

function eq(value: string | number): string {
  return encodeURIComponent(String(value));
}

/** api_keys columns safe to expose to a client — `key_hash` is deliberately absent. */
const API_KEY_SAFE_COLUMNS =
  'id,organization_id,label,key_prefix,plan,last_used_at,revoked_at,created_at';

export class SupabaseDbAdapter implements DbAdapter {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly authorizationToken: string,
  ) {}

  private async fetchDb<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.url}/rest/v1/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
        Authorization: `Bearer ${this.authorizationToken}`,
        Prefer: 'return=representation',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase request failed (${response.status}): ${detail}`);
    }

    // Parse on body presence, not status code. `Prefer: return=minimal` yields an
    // empty body with 201 (POST) or 204 (PATCH/DELETE); `return=representation`
    // yields JSON. Keying on 204 alone made a minimal POST (201, empty) throw
    // "Unexpected end of JSON input" (hit by insertProbeEvidence / insertFixOutcomes).
    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : null) as T;
  }

  private async first<T>(path: string): Promise<T | null> {
    const rows = await this.fetchDb<T[]>(`${path}&limit=1`);
    return rows[0] || null;
  }

  /**
   * Returns the exact row count for a query without transferring the rows. Uses
   * PostgREST's `count=exact` + a zero-length Range so the body stays empty and
   * the total comes from the `content-range` header (`*​/N`). Aggregate-only.
   */
  private async count(path: string): Promise<number> {
    const response = await fetch(`${this.url}/rest/v1/${path}`, {
      method: 'HEAD',
      headers: {
        apikey: this.apiKey,
        Authorization: `Bearer ${this.authorizationToken}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    });
    if (!response.ok && response.status !== 206) {
      throw new Error(`Supabase count failed (${response.status})`);
    }
    const total = response.headers.get('content-range')?.split('/')[1];
    return total && total !== '*' ? Number(total) : 0;
  }

  async consumeApiRateLimit(
    keyHash: string,
    routeId: string,
    limit: number,
    windowSeconds: number,
  ): Promise<ApiRateLimitResult> {
    const result = await this.fetchDb<{
      allowed: boolean;
      remaining: number;
      reset_at: number;
    }>('rpc/consume_api_rate_limit', {
      method: 'POST',
      body: JSON.stringify({
        target_key_hash: keyHash,
        target_route_id: routeId,
        target_limit: limit,
        target_window_seconds: windowSeconds,
      }),
    });
    return {
      allowed: result.allowed,
      remaining: result.remaining,
      resetAt: result.reset_at,
    };
  }

  getOrganization(orgId: string): Promise<Organization | null> {
    return this.first(`organizations?select=*&id=eq.${eq(orgId)}`);
  }

  async getOrganizationByUserId(userId: string): Promise<Organization | null> {
    const membership = await this.first<Membership>(
      `memberships?select=*&user_id=eq.${eq(userId)}`,
    );
    return membership ? this.getOrganization(membership.organization_id) : null;
  }

  async createOrganization(name: string): Promise<Organization> {
    const result = await this.fetchDb<Organization | Organization[]>(
      'rpc/create_organization_for_current_user',
      { method: 'POST', body: JSON.stringify({ organization_name: name }) },
    );
    return Array.isArray(result) ? result[0] : result;
  }

  getMembership(userId: string, orgId: string): Promise<Membership | null> {
    return this.first(
      `memberships?select=*&user_id=eq.${eq(userId)}&organization_id=eq.${eq(orgId)}`,
    );
  }

  async setOrganizationStripeCustomerId(
    organizationId: string,
    stripeCustomerId: string,
  ): Promise<void> {
    await this.fetchDb(`organizations?id=eq.${eq(organizationId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ stripe_customer_id: stripeCustomerId }),
    });
  }

  async processStripeBillingEvent(event: StripeBillingEvent): Promise<boolean> {
    return this.fetchDb<boolean>('rpc/process_stripe_billing_event', {
      method: 'POST',
      body: JSON.stringify({
        stripe_event_id: event.eventId,
        stripe_event_type: event.eventType,
        target_organization_id: event.organizationId,
        target_plan: event.plan,
        target_stripe_customer_id: event.stripeCustomerId,
        target_stripe_subscription_id: event.stripeSubscriptionId,
        target_stripe_price_id: event.stripePriceId,
      }),
    });
  }

  async connectGitHubInstallation(
    organizationId: string,
    githubAccountId: number,
    installationId: string,
    repositories: GitHubRepositoryMapping[],
  ): Promise<number> {
    return this.fetchDb<number>('rpc/connect_github_installation', {
      method: 'POST',
      body: JSON.stringify({
        target_organization_id: organizationId,
        target_github_account_id: githubAccountId,
        target_github_installation_id: installationId,
        target_repositories: repositories.map((repository) => ({
          id: repository.id,
          full_name: repository.fullName,
        })),
      }),
    });
  }

  async claimGitHubDelivery(
    deliveryId: string,
    eventType: string,
    githubRepositoryId: number,
    installationId: string,
  ): Promise<boolean> {
    return this.fetchDb<boolean>('rpc/claim_github_webhook_delivery', {
      method: 'POST',
      body: JSON.stringify({
        target_delivery_id: deliveryId,
        target_event_type: eventType,
        target_github_repository_id: githubRepositoryId,
        target_github_installation_id: installationId,
      }),
    });
  }

  async finishGitHubDelivery(
    deliveryId: string,
    succeeded: boolean,
    failureMessage?: string,
  ): Promise<void> {
    await this.fetchDb('rpc/finish_github_webhook_delivery', {
      method: 'POST',
      body: JSON.stringify({
        target_delivery_id: deliveryId,
        succeeded,
        failure_message: failureMessage || null,
      }),
    });
  }

  async getRepositories(orgId: string): Promise<Repository[]> {
    return this.fetchDb(
      `repositories?select=*&organization_id=eq.${eq(orgId)}&order=created_at.desc`,
    );
  }

  getRepository(repoId: string): Promise<Repository | null> {
    return this.first(`repositories?select=*&id=eq.${eq(repoId)}`);
  }

  getRepositoryByGithubRepoId(githubRepoId: number): Promise<Repository | null> {
    return this.first(`repositories?select=*&github_repo_id=eq.${eq(githubRepoId)}`);
  }

  async addRepository(orgId: string, name: string, githubRepoId: number): Promise<Repository> {
    const rows = await this.fetchDb<Repository[]>('repositories', {
      method: 'POST',
      body: JSON.stringify({
        organization_id: orgId,
        name,
        github_repo_id: githubRepoId,
      }),
    });
    return rows[0];
  }

  async saveScan(
    repoId: string,
    commitSha: string,
    branch: string,
    status: 'success' | 'failed',
    errors: number,
    warnings: number,
    findings: Omit<ScanFinding, 'id' | 'scan_id' | 'created_at'>[],
  ): Promise<Scan> {
    const rows = await this.fetchDb<Scan[]>('scans', {
      method: 'POST',
      body: JSON.stringify({
        repository_id: repoId,
        commit_sha: commitSha,
        branch,
        status,
        error_count: errors,
        warning_count: warnings,
      }),
    });
    const scan = rows[0];

    if (findings.length) {
      // PostgREST rejects a bulk insert whose objects do not all share the same
      // key set (error PGRST102 "All object keys must match"). Callers legitimately
      // omit optional fields — e.g. `confidence` is undefined for rules that do not
      // set it — and JSON.stringify drops undefined keys, producing a mismatched
      // array. Normalise every row to the same explicit shape, coercing absent
      // optionals to null so the key set is always identical.
      const findingRows = findings.map((finding) => ({
        scan_id: scan.id,
        rule_id: finding.rule_id,
        severity: finding.severity,
        confidence: finding.confidence ?? null,
        file_path: finding.file_path,
        line_number: finding.line_number ?? null,
        message: finding.message,
        suggestion: finding.suggestion ?? null,
      }));
      await this.fetchDb('scan_findings', {
        method: 'POST',
        body: JSON.stringify(findingRows),
      });
    }

    return scan;
  }

  getScan(scanId: string): Promise<Scan | null> {
    return this.first(`scans?select=*&id=eq.${eq(scanId)}`);
  }

  getRecentScans(repoId: string): Promise<Scan[]> {
    return this.fetchDb(`scans?select=*&repository_id=eq.${eq(repoId)}&order=created_at.desc`);
  }

  async deleteScan(scanId: string): Promise<void> {
    // RLS scopes this DELETE to the caller's org (user token), so a member can
    // only delete a scan on a repository their organization owns. Findings and
    // probe evidence cascade; fix outcomes have their scan_id set null.
    //
    // `return=representation` so a zero-row delete is caught rather than reported
    // as success — see deleteApiKey for the failure this guards against.
    const rows = await this.fetchDb<Scan[]>(`scans?id=eq.${eq(scanId)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (!rows?.length) {
      throw new Error(`Supabase delete matched no scans row (${scanId}).`);
    }
  }

  getScanFindings(scanId: string): Promise<ScanFinding[]> {
    return this.fetchDb(`scan_findings?select=*&scan_id=eq.${eq(scanId)}&order=created_at.asc`);
  }

  getFinding(findingId: string): Promise<ScanFinding | null> {
    return this.first(`scan_findings?select=*&id=eq.${eq(findingId)}`);
  }

  async setScanShareToken(scanId: string, shareToken: string): Promise<Scan> {
    const rows = await this.fetchDb<Scan[]>(`scans?id=eq.${eq(scanId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ share_token: shareToken }),
    });
    const scan = rows?.[0];
    if (!scan) {
      // A PATCH matching no row returns an empty array, not an error — an RLS
      // policy filtering the row out is indistinguishable here from "no such
      // scan". Returning `rows[0]` unchecked surfaced as an opaque TypeError
      // one frame later, which is what masked the missing UPDATE grant as a
      // bare 500 (see 20260720000000_scan_share_token_update).
      throw new Error(`Supabase update matched no scan row (${scanId}).`);
    }
    return scan;
  }

  getScanByShareToken(shareToken: string): Promise<Scan | null> {
    return this.first(`scans?select=*&share_token=eq.${eq(shareToken)}`);
  }

  async getRepositoryNameForScan(scanId: string): Promise<string | null> {
    const scan = await this.getScan(scanId);
    if (!scan) return null;
    const repository = await this.getRepository(scan.repository_id);
    return repository?.name ?? null;
  }

  async getOrganizationAdminEmails(organizationId: string): Promise<string[]> {
    const memberships = await this.fetchDb<Array<{ user_id: string }>>(
      `memberships?select=user_id&organization_id=eq.${eq(organizationId)}&role=eq.admin`,
    );
    const emails: string[] = [];
    for (const membership of memberships) {
      const response = await fetch(
        `${this.url}/auth/v1/admin/users/${encodeURIComponent(membership.user_id)}`,
        {
          headers: {
            apikey: this.apiKey,
            Authorization: `Bearer ${this.authorizationToken}`,
          },
        },
      );
      if (!response.ok) continue;
      const user = (await response.json()) as { email?: string | null };
      if (user.email) emails.push(user.email);
    }
    return emails;
  }

  async updateFindingFixPrUrl(findingId: string, fixPrUrl: string): Promise<void> {
    await this.fetchDb(`scan_findings?id=eq.${eq(findingId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ fix_pr_url: fixPrUrl }),
    });
  }

  async updateFindingFixPrUrls(updates: { findingId: string; fixPrUrl: string }[]): Promise<void> {
    await Promise.all(
      updates.map((update) => this.updateFindingFixPrUrl(update.findingId, update.fixPrUrl)),
    );
  }

  getTargets(organizationId: string): Promise<Target[]> {
    return this.fetchDb(
      `targets?select=*&organization_id=eq.${eq(organizationId)}&order=updated_at.desc`,
    );
  }

  getTargetById(id: string): Promise<Target | null> {
    return this.first(`targets?select=*&id=eq.${eq(id)}`);
  }

  getTargetByIdentifier(
    organizationId: string,
    kind: TargetKind,
    identifier: string,
  ): Promise<Target | null> {
    return this.first(
      `targets?select=*&organization_id=eq.${eq(organizationId)}&kind=eq.${eq(kind)}&identifier=eq.${eq(identifier)}`,
    );
  }

  async upsertTarget(input: UpsertTargetInput): Promise<Target> {
    // Only send the fields the caller specified. PostgREST's merge-duplicates
    // upsert updates exactly the columns present in the payload, so unspecified
    // fields (a previously detected fingerprint, ownership) are preserved on
    // conflict. `updated_at` is always refreshed.
    const row: Record<string, unknown> = {
      organization_id: input.organizationId,
      kind: input.kind,
      identifier: input.identifier,
      updated_at: new Date().toISOString(),
    };
    if (input.displayName !== undefined) row.display_name = input.displayName;
    if (input.repositoryId !== undefined) row.repository_id = input.repositoryId;
    if (input.generatorFingerprint !== undefined) {
      row.generator_fingerprint = input.generatorFingerprint;
    }
    if (input.currentVerdict !== undefined) row.current_verdict = input.currentVerdict;
    if (input.currentShipScore !== undefined) row.current_ship_score = input.currentShipScore;
    if (input.verdictEvidence !== undefined) row.verdict_evidence = input.verdictEvidence;
    if (input.lastCheckedAt !== undefined) row.last_checked_at = input.lastCheckedAt;
    if (input.badgeToken !== undefined) row.badge_token = input.badgeToken;

    const rows = await this.fetchDb<Target[]>(
      'targets?on_conflict=organization_id,kind,identifier',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(row),
      },
    );
    return rows[0];
  }

  async setTargetOwnership(id: string, input: SetTargetOwnershipInput): Promise<Target> {
    // RLS restricts this PATCH to org members via the caller's user token, so a
    // user can only flip ownership on a target their organization owns.
    const rows = await this.fetchDb<Target[]>(`targets?id=eq.${eq(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        ownership_verified: input.ownershipVerified,
        ownership_method: input.ownershipMethod,
        updated_at: new Date().toISOString(),
      }),
    });
    return rows[0];
  }

  async insertProbeEvidence(rows: ProbeEvidenceInput[]): Promise<void> {
    if (rows.length === 0) return;
    // Uniform key set so PostgREST accepts the bulk insert (see saveScan / PGRST102).
    const payload = rows.map((row) => ({
      organization_id: row.organizationId,
      scan_id: row.scanId ?? null,
      finding_rule_id: row.findingRuleId,
      kind: row.kind,
      summary: row.summary,
      redacted_sample: row.redactedSample ?? null,
    }));
    await this.fetchDb('probe_evidence', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });
  }

  getProbeEvidenceForScan(scanId: string): Promise<ProbeEvidenceRow[]> {
    return this.fetchDb(`probe_evidence?select=*&scan_id=eq.${eq(scanId)}&order=created_at.asc`);
  }

  findVerifiedUrlTargetByOrigin(origin: string): Promise<Target | null> {
    // Resolve a deploy to a guarded app by matching the origin against a target
    // our org already OWNS and has verified. This is a lookup against our own DB;
    // the origin is only ever a key, never a probe target (see api/vercel/webhook).
    return this.first(
      `targets?select=*&kind=eq.url&ownership_verified=is.true&identifier=eq.${eq(origin)}`,
    );
  }

  listVerifiedUrlTargets(): Promise<Target[]> {
    // Guardian cron candidate set: ownership-verified url targets only. Unverified
    // urls are never scheduled — the gate remains the authority inside each check.
    return this.fetchDb(
      'targets?select=*&kind=eq.url&ownership_verified=is.true&order=last_checked_at.asc.nullsfirst',
    );
  }

  getTargetByBadgeToken(badgeToken: string): Promise<Target | null> {
    return this.first(`targets?select=*&badge_token=eq.${eq(badgeToken)}`);
  }

  getTargetAlertPrefs(targetId: string): Promise<TargetAlertPref[]> {
    return this.fetchDb(
      `target_alert_prefs?select=*&target_id=eq.${eq(targetId)}&order=channel.asc`,
    );
  }

  async upsertTargetAlertPref(input: UpsertTargetAlertPrefInput): Promise<TargetAlertPref> {
    const row = {
      organization_id: input.organizationId,
      target_id: input.targetId,
      channel: input.channel,
      webhook_url: input.webhookUrl ?? null,
      enabled: input.enabled,
      updated_at: new Date().toISOString(),
    };
    const rows = await this.fetchDb<TargetAlertPref[]>(
      'target_alert_prefs?on_conflict=target_id,channel',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(row),
      },
    );
    return rows[0];
  }

  async claimVercelDelivery(
    deployId: string,
    eventType: string,
    organizationId: string,
    targetId: string,
  ): Promise<boolean> {
    return this.fetchDb<boolean>('rpc/claim_vercel_webhook_delivery', {
      method: 'POST',
      body: JSON.stringify({
        target_deploy_id: deployId,
        target_event_type: eventType,
        target_organization_id: organizationId,
        target_target_id: targetId,
      }),
    });
  }

  async finishVercelDelivery(
    deployId: string,
    succeeded: boolean,
    failureMessage?: string,
  ): Promise<void> {
    await this.fetchDb('rpc/finish_vercel_webhook_delivery', {
      method: 'POST',
      body: JSON.stringify({
        target_deploy_id: deployId,
        succeeded,
        failure_message: failureMessage || null,
      }),
    });
  }

  async insertFixOutcomes(rows: FixOutcomeInput[]): Promise<void> {
    if (rows.length === 0) return;
    // Uniform key set so PostgREST accepts the bulk insert (see saveScan / PGRST102).
    const payload = rows.map((row) => ({
      organization_id: row.organizationId,
      target_id: row.targetId,
      scan_id: row.scanId ?? null,
      finding_rule_id: row.findingRuleId,
      generator_fingerprint: row.generatorFingerprint ?? null,
      fix_strategy: row.fixStrategy ?? null,
      outcome: row.outcome,
      pr_url: row.prUrl ?? null,
      deploy_id: row.deployId ?? null,
    }));
    // ignore-duplicates so a re-fired deploy (same target/rule/deploy_id) is a
    // no-op against the partial unique index rather than a hard error.
    await this.fetchDb('fix_outcome', {
      method: 'POST',
      headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
      body: JSON.stringify(payload),
    });
  }

  getFixOutcomesForTarget(targetId: string): Promise<FixOutcomeRow[]> {
    return this.fetchDb(`fix_outcome?select=*&target_id=eq.${eq(targetId)}&order=created_at.asc`);
  }

  getFixOutcomeCorpus(): Promise<FixOutcomeCorpusRow[]> {
    // Pattern columns ONLY — never organization_id, target_id, pr_url, or any
    // customer-identifying field (§2.8). This is the aggregate exit asset.
    return this.fetchDb(
      'fix_outcome?select=generator_fingerprint,finding_rule_id,fix_strategy,outcome',
    );
  }

  countMonitoredApps(): Promise<number> {
    // Scalar count only — the select is a single indexed column and the rows are
    // never transferred (HEAD + count=exact). No customer data leaves the DB.
    return this.count('targets?select=id');
  }

  async createApiKey(input: CreateApiKeyInput): Promise<ApiKeyRow> {
    // `select` on the insert return keeps `key_hash` out of the response so the
    // hash is never round-tripped to a client. The plaintext is never here at all.
    const rows = await this.fetchDb<ApiKeyRow[]>(`api_keys?select=${API_KEY_SAFE_COLUMNS}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        organization_id: input.organizationId,
        label: input.label,
        key_hash: input.keyHash,
        key_prefix: input.keyPrefix,
        plan: input.plan,
      }),
    });
    return rows[0];
  }

  listApiKeys(organizationId: string): Promise<ApiKeyRow[]> {
    // Safe columns only — `key_hash` is never selected for a client surface.
    return this.fetchDb(
      `api_keys?select=${API_KEY_SAFE_COLUMNS}&organization_id=eq.${eq(organizationId)}&order=created_at.desc`,
    );
  }

  getApiKeyByHash(keyHash: string): Promise<ApiKeyAuthContext | null> {
    return this.first(
      `api_keys?select=id,organization_id,plan,revoked_at&key_hash=eq.${eq(keyHash)}`,
    );
  }

  async revokeApiKey(id: string): Promise<void> {
    // RLS scopes this PATCH to the caller's org (user token), so a user can only
    // revoke their own org's keys. Idempotent: re-revoking keeps the first stamp.
    await this.fetchDb(`api_keys?id=eq.${eq(id)}&revoked_at=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    });
  }

  async deleteApiKey(id: string): Promise<void> {
    // RLS scopes this DELETE to the caller's org. The route must refuse live keys
    // before calling here — deleting an active key would silently break agents.
    //
    // `return=representation` is load-bearing: under RLS a DELETE that matches no
    // row is NOT an error, it just affects zero rows. With `return=minimal` that
    // is indistinguishable from a real delete, which is exactly how a missing
    // DELETE policy reported success while every key survived the round trip.
    // Asserting a row came back turns that silent no-op into a loud failure.
    const rows = await this.fetchDb<ApiKeyRow[]>(`api_keys?id=eq.${eq(id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (!rows?.length) {
      throw new Error(`Supabase delete matched no api_keys row (${id}).`);
    }
  }

  async touchApiKey(id: string): Promise<void> {
    // Best-effort usage telemetry; runs under the service role at auth time.
    await this.fetchDb(`api_keys?id=eq.${eq(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    });
  }
}

export function getUserDbAdapter(accessToken: string): DbAdapter {
  if (!accessToken) throw new Error('A verified user access token is required.');
  const { url, anonKey } = getSupabaseConfig();
  return new SupabaseDbAdapter(url, anonKey, accessToken);
}

export function getAdminDbAdapter(): DbAdapter {
  const { url, serviceRoleKey } = getSupabaseAdminConfig();
  return new SupabaseDbAdapter(url, serviceRoleKey, serviceRoleKey);
}
