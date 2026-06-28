import { getSupabaseAdminConfig, getSupabaseConfig } from './env';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar_url: string;
}

export interface Organization {
  id: string;
  name: string;
  billing_plan: 'free' | 'pro';
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
  file_path: string;
  line_number?: number;
  message: string;
  suggestion?: string;
  fix_pr_url?: string | null;
  created_at: string;
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
  getScanFindings(scanId: string): Promise<ScanFinding[]>;
  getFinding(findingId: string): Promise<ScanFinding | null>;
  setScanShareToken(scanId: string, shareToken: string): Promise<Scan>;
  getScanByShareToken(shareToken: string): Promise<Scan | null>;
  getRepositoryNameForScan(scanId: string): Promise<string | null>;
  updateFindingFixPrUrl(findingId: string, fixPrUrl: string): Promise<void>;
  updateFindingFixPrUrls(updates: { findingId: string; fixPrUrl: string }[]): Promise<void>;
}

function eq(value: string | number): string {
  return encodeURIComponent(String(value));
}

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

    return (response.status === 204 ? null : await response.json()) as T;
  }

  private async first<T>(path: string): Promise<T | null> {
    const rows = await this.fetchDb<T[]>(`${path}&limit=1`);
    return rows[0] || null;
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
      await this.fetchDb('scan_findings', {
        method: 'POST',
        body: JSON.stringify(findings.map((finding) => ({ ...finding, scan_id: scan.id }))),
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
    return rows[0];
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
