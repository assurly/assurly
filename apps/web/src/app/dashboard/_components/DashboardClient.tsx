'use client';

import React, { useState, useEffect, useEffectEvent, useRef, Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  collectDependencyNames,
  countCleanScannedFiles,
  parsePackageJsonDependencies,
  type SourceInput,
} from '@assurly/scanner-core';
import type { User, Organization, Repository, Scan, ScanFinding } from '../../../utils/dbAdapter';
import {
  scanSqlMigrations,
  scanStripeWebhook,
  scanSupabaseClientLeaks,
  scanEnvVariables,
  scanRscDataLeaks,
  scanColdStart,
  scanEdgeRuntime,
  scanMaxDuration,
  scanRouteHandlerAuth,
  scanServerActionAuth,
  scanServiceRoleBypass,
  scanStripeMissingSubscriptionEvents,
  scanStripeWebhookIdempotencyForProject,
  scanAgentStack,
  incompleteScanFinding,
  selectFiles,
  buildScanScope,
  isAgentStackFile,
  isAnalyzedCodeFile,
  isScannableFile,
  rankFilesByRelevance,
  instantGateSurfaceFiles,
  summarizeUnanalyzedSource,
  unanalyzedLanguageCounts,
  unanalyzedSourceFinding,
  formatUnanalyzedLogLine,
  detectStackFromManifests,
  describeDetectedStack,
  selectPackageManifestPaths,
  INSTANT_GATE_MAX_FILES,
  githubActionsIntegrationMessage,
  WebFinding,
  type ScanScope,
} from '../../../utils/browserScanner';
import ManualChecker from './manual-checker/ManualChecker';
import { detectGeneratorFingerprint } from '../../../utils/generatorFingerprint';
import { UnauthenticatedDashboard } from './UnauthenticatedDashboard';
import {
  clientApi,
  ClientApiError,
  githubApi,
  type SessionResult,
  type TargetCard,
} from '../../../utils/clientApi';
import { useAccessibleMenu } from '../../../hooks/useAccessibleMenu';
import { dedupeRepositoriesByGithubId } from '../../../utils/repositories';
import { isAutoFixableFinding } from '../../../utils/githubAutoFix';
import { summarizeScanFixes } from '../../../utils/fixSummary';
import { isGitHubRepositoryName } from '../../../utils/githubApp';
import { parsePublicRepoInput } from '../../../utils/publicRepoInput';
import { preferPublicScanForRepository } from '../../../utils/scanProxy';
import {
  branchQueryParam,
  parseGithubBranchList,
  suggestAlternateScanBranches,
} from '../../../utils/scanBranch';
import {
  buildShipGateFromScanFindings,
  buildShipGateFromWebFindings,
} from '../../../utils/shipGate';
import { resolveDisplayedShipScore } from '../../../utils/shipScoreDisplay';
import {
  countVisibleScanHistory,
  excludeTooLargeFailedScans,
  selectLatestScanPerCommit,
} from '../../../utils/scanHistoryDisplay';
import { resolveShipGateScanContext } from '../../../utils/shipGateScanContext';
import { RepoListPanel } from './RepoListPanel';
import { buildRepoTargetLookup } from './buildRepoTargetLookup';
import { VerdictCardsSection } from './VerdictCardsSection';
import { ApiKeys } from './ApiKeys';
import { CanarySilentAlarm } from './CanarySilentAlarm';
import { CanaryTokens, CanaryTokensNotice } from './CanaryTokens';
import { WorkspaceHeader } from './WorkspaceHeader';
import { DashboardNav } from './DashboardNav';
import { PublicRepoConnect } from './PublicRepoConnect';
import { DeployedUrlScanCard, DeployedUrlScanResults, useDeployedUrlScan } from './DeployedUrlScan';
import { ScanWorkspace } from './ScanWorkspace';
import { DashboardToast } from './DashboardToast';
import { DashboardHeader, DASHBOARD_NAV_OVERLAY_MQ } from './DashboardHeader';
import { DashboardSplash } from './DashboardSplash';
import { DashboardOverview } from './DashboardOverview';
import { DashboardAppView } from './DashboardAppView';
import { DashboardSettings } from './DashboardSettings';
import {
  navIdForView,
  parseDashboardRoute,
  replaceDashboardUrl,
  routeAfterNavChange,
  routeAfterRepositorySelect,
  type DashboardNavId,
  type DashboardRoute,
  type DashboardView,
} from './dashboardView';
import { planAllowsShareableReports } from '../../../utils/entitlements';
import { PRO_TRIAL_COPY } from '../../../utils/pricing';
import { SiteFooter } from '../../_components/SiteFooter';
import {
  createRepoSelectionReset,
  findingsMatchScan,
  markRepoDetailReady,
  resolveRepoDetailStatusAfterScans,
  type RepoDetailStatus,
} from './repoSelection';
import {
  createPublicRepoConnectSession,
  INITIAL_PUBLIC_REPO_CONNECT_SESSION,
  shouldClearPublicRepoInputOnRepoSelect,
  shouldClearPublicRepoInputOnViewChange,
  type PublicRepoConnectSession,
} from './publicRepoInputReset';
import { scrollToRepoWorkspace, scrollToScanDetails } from '../../../utils/scrollToScanDetails';
import { consumeDashboardSplashRequest } from '../../../utils/splashSignal';
import { invalidateRepoScansCache, loadRepoScans } from '../../../utils/scansQueryCache';
import {
  subscribeToUnauthorizedSession,
  notifyUnauthorizedSession,
} from '../../../utils/unauthorizedSession';

type ToastNotification = {
  message: string;
  type: 'success' | 'error' | 'info';
  /** When `null`, the toast stays until the user dismisses it. */
  autoDismissMs?: number | null;
  /** Optional call-to-action link (e.g. "View pull request →"). */
  actionLabel?: string;
  actionHref?: string;
};

const DEFAULT_TOAST_DISMISS_MS: Record<ToastNotification['type'], number> = {
  success: 4000,
  info: 4000,
  error: 12000,
};

/**
 * The `/api/scans` endpoint hard-caps the persisted `findings` array at 100 items
 * and rejects the whole request if the array is larger. We therefore persist at
 * most this many findings while still displaying every finding locally.
 */
const SAVE_FINDINGS_LIMIT = 100;

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  );
}

/**
 * Client-generated (not yet persisted) scans use a `scan-...` id, whereas scans
 * returned by the API use a database UUID. Telling them apart lets a visibility
 * refresh reconcile server state without erasing a freshly computed local scan.
 */
function isLocalScanId(id: string): boolean {
  return id.startsWith('scan-');
}

/**
 * Auto-fix operates on a database-persisted finding via /api/github/fix, which
 * requires a real id. Client-generated findings — those from an unsaved local
 * scan, or the in-session overflow beyond the persistence cap — carry a
 * `find-...` id and cannot be fixed; offering the action for them would only
 * fail request validation.
 */
function isLocalFindingId(id: string): boolean {
  return id.startsWith('find-');
}

/**
 * Picks the canary panel for a repository, given what we currently know about
 * its target.
 *
 * Four outcomes, each stating something that is true at the moment it renders.
 * The one that matters is `loading`: a repository's target arrives on a separate
 * request, so during that window the map is empty for every repository — and
 * telling someone to scan a repository they scanned last week is worse than
 * saying nothing, because it reads as the feature being broken.
 */
export function renderCanaryPanel(
  lookup: { status: 'loading' | 'ready' | 'error'; byRepoId: Record<string, string> },
  repositoryId: string,
  variant: 'alarm' | 'settings',
  options?: { hasGitHubInstallation?: boolean },
): React.ReactElement {
  const targetId = lookup.byRepoId[repositoryId];
  if (targetId) {
    switch (variant) {
      case 'alarm':
        return (
          <CanarySilentAlarm
            targetId={targetId}
            hasGitHubInstallation={Boolean(options?.hasGitHubInstallation)}
          />
        );
      case 'settings':
        return <CanaryTokens targetId={targetId} />;
      default: {
        const neverVariant: never = variant;
        throw new Error(`Unhandled canary panel variant: ${String(neverVariant)}`);
      }
    }
  }

  if (lookup.status === 'loading') {
    return (
      <CanaryTokensNotice ariaLabel={variant === 'alarm' ? 'Silent alarm' : 'Canary tokens'}>
        {variant === 'alarm'
          ? 'Loading silent alarm for this repository…'
          : 'Loading canary tokens for this repository…'}
      </CanaryTokensNotice>
    );
  }

  if (lookup.status === 'error') {
    return (
      <CanaryTokensNotice ariaLabel={variant === 'alarm' ? 'Silent alarm' : 'Canary tokens'}>
        {variant === 'alarm'
          ? 'Could not load the silent alarm for this repository. Refresh to try again.'
          : 'Could not load canary tokens for this repository. Refresh to try again.'}
      </CanaryTokensNotice>
    );
  }

  return (
    <CanaryTokensNotice ariaLabel={variant === 'alarm' ? 'Silent alarm' : 'Canary tokens'}>
      {variant === 'alarm'
        ? 'Scan this repository once to add a silent alarm. If someone steals your env, Assurly will let you know.'
        : 'Scan this repository once to enable canary tokens. A canary is a tripwire URL you plant in .env.example — if anyone ever fetches it, Assurly records a hit.'}
    </CanaryTokensNotice>
  );
}

/**
 * Extracts a human-readable reason from a failed proxy/public-scan response.
 * Both endpoints return a structured `{ error: { message } }` body; fall back to
 * the status text so the scanner always surfaces an actionable reason instead of
 * an empty "No scans found" state.
 */
async function readProxyError(response: Response): Promise<{ message: string; code?: string }> {
  try {
    const data = (await response.clone().json()) as {
      error?: { message?: unknown; code?: unknown };
    };
    const code = typeof data?.error?.code === 'string' ? data.error.code : undefined;
    const message = data?.error?.message;
    if (typeof message === 'string' && message.trim()) {
      if (code === 'invalid_request' || /validation failed/i.test(message)) {
        return {
          code,
          message: 'Repository name must be owner/repo (for example acme/saas).',
        };
      }
      return { message, code };
    }
  } catch {
    // Non-JSON body – fall through to a generic, still-actionable description.
  }
  return {
    message: response.statusText || `Request failed with status ${response.status}.`,
  };
}

interface GitHubTreeNode {
  path: string;
  type: string;
}

interface DashboardContentProps {
  initialSession: SessionResult;
  loginUrl?: string;
  /** Optional SSR seed for the Ship Score trend chart (E2E hydration coverage). */
  initialTrendPoints?: Array<{ date: string; shipScore: number }>;
  /** False on deployments without Stripe credentials: every upgrade surface hides. */
  billingEnabled?: boolean;
}

function DashboardContent({
  initialSession,
  loginUrl = '/api/auth/login',
  initialTrendPoints,
  billingEnabled = true,
}: DashboardContentProps): React.ReactElement {
  const searchParams = useSearchParams();

  // Splash plays on every entry to the dashboard *from the landing page*: the
  // OAuth callback signals the first login via ?welcome=1, and landing
  // navigations signal every return via a per-tab sessionStorage flag. Both are
  // consumed on mount, so the splash never replays on a plain refresh or on
  // internal dashboard navigation.
  const [showSplash, setShowSplash] = useState<boolean>(() => searchParams.get('welcome') === '1');

  useEffect(() => {
    const fromCallback = new URLSearchParams(window.location.search).get('welcome') === '1';
    const fromLanding = consumeDashboardSplashRequest();
    if (!fromCallback && !fromLanding) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowSplash(true);

    if (fromCallback) {
      // Strip ?welcome=1 so a refresh does not replay the splash.
      const params = new URLSearchParams(window.location.search);
      params.delete('welcome');
      const query = params.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
      );
    }
  }, []);

  const [user, setUser] = useState<User | null>(initialSession.user);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [org] = useState<Organization | null>(initialSession.organization);
  const [repos, setRepos] = useState<Repository[]>(() =>
    dedupeRepositoriesByGithubId(initialSession.repositories),
  );
  const initialRoute = parseDashboardRoute(
    { view: searchParams.get('view'), repo: searchParams.get('repo') },
    initialSession.repositories.map((repository) => repository.id),
  );
  const [dashboardView, setDashboardView] = useState<DashboardView>(initialRoute.view);
  const [publicRepoInput, setPublicRepoInput] = useState('');
  const [isAddingRepo, setIsAddingRepo] = useState(false);
  const autoStartScanRef = useRef(false);

  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(() => {
    if (initialRoute.repoId) {
      return (
        initialSession.repositories.find((repository) => repository.id === initialRoute.repoId) ??
        null
      );
    }
    return initialSession.repositories[0] ?? null;
  });
  const [scans, setScans] = useState<Scan[]>([]);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const [findings, setFindings] = useState<ScanFinding[]>([]);
  // Which flow owns the wide results canvas: the repo scan (default) or a
  // deployed-URL scan. "Last action wins" — flipped to 'url' when a URL scan
  // starts (onActivate) and back to 'repo' on repo select / repo scan.
  const [resultsView, setResultsView] = useState<'repo' | 'url'>('repo');
  // Verdict cards re-fetch whenever a scan finishes (repo or URL), so "Your apps"
  // reflects the new Ship Gate projection without a full page reload.
  const [verdictRefreshKey, setVerdictRefreshKey] = useState(0);
  // The arrow's identity may change per render; the hook stores it in a ref and
  // always calls the latest, so no memoisation is needed here.
  const urlScan = useDeployedUrlScan(
    () => setResultsView('url'),
    () => setVerdictRefreshKey((key) => key + 1),
  );
  const [repoDetailStatus, setRepoDetailStatus] = useState<RepoDetailStatus>('loading');
  // A scan that finished locally but could not be persisted (e.g. backend
  // misconfiguration). Kept in dedicated state so a visibility refresh never wipes it.
  const [localScan, setLocalScan] = useState<Scan | null>(null);
  const localScanRef = useRef<Scan | null>(null);
  const [localFindings, setLocalFindings] = useState<ScanFinding[]>([]);
  const [currency] = useState<'USD' | 'EUR'>('USD');
  const currencySymbol = currency === 'USD' ? '$' : '€';
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const { menuRef: profileMenuRef, rememberTrigger: rememberProfileTrigger } =
    useAccessibleMenu<HTMLDivElement>({
      open: isProfileOpen,
      onClose: () => setIsProfileOpen(false),
      trapAt: DASHBOARD_NAV_OVERLAY_MQ,
    });

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  /** Last scan failure for the current repository — shown in-panel until cleared or retried. */
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanBranch, setScanBranch] = useState<string | null>(null);
  const [repoBranches, setRepoBranches] = useState<string[]>([]);
  const [emptyScanAltBranches, setEmptyScanAltBranches] = useState<string[]>([]);
  const [scanCountsByRepoId, setScanCountsByRepoId] = useState<Record<string, number>>({});
  const [shareUrlsByScanId, setShareUrlsByScanId] = useState<Record<string, string>>({});
  const [sharingScanId, setSharingScanId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [deleteScanError, setDeleteScanError] = useState<string | null>(null);
  const [lastScanFileCount, setLastScanFileCount] = useState<number | null>(null);
  const [lastScanScope, setLastScanScope] = useState<ScanScope | null>(null);
  const scanControllerRef = useRef<AbortController | null>(null);
  const scanMountedRef = useRef(true);

  useEffect(() => {
    localScanRef.current = localScan;
  }, [localScan]);

  useEffect(() => {
    scanMountedRef.current = true;
    return () => {
      scanMountedRef.current = false;
      scanControllerRef.current?.abort();
    };
  }, []);
  /** Per-repo Instant Gate session cache keyed by HEAD commit SHA. */
  const scanSessionCacheRef = useRef<
    Map<string, { commitSha: string; contents: Map<string, string | null> }>
  >(new Map());
  const initialToast = useMemo<ToastNotification | null>(() => {
    const success = searchParams.get('success');
    const cancel = searchParams.get('cancel');
    if (success === 'stripe_upgrade')
      return { message: PRO_TRIAL_COPY.checkoutSuccess, type: 'success' };
    if (success === 'stripe_downgrade')
      return { message: 'Subscription cancelled. Downgraded to Free Plan.', type: 'info' };
    if (success === 'github_app_installed')
      return { message: 'GitHub App installed successfully!', type: 'success' };
    if (cancel === 'stripe_cancelled') return { message: 'Checkout cancelled.', type: 'info' };
    return null;
  }, [searchParams]);
  const [toast, setToast] = useState(initialToast);
  const [billingAction, setBillingAction] = useState<'checkout' | 'portal' | null>(null);

  const [fixingFindingId, setFixingFindingId] = useState<string | null>(null);

  const [publicRepoConnectError, setPublicRepoConnectError] = useState<string | null>(null);
  const publicConnectSessionRef = useRef<PublicRepoConnectSession>(
    INITIAL_PUBLIC_REPO_CONNECT_SESSION,
  );

  const clearPublicRepoConnectUi = (): void => {
    setPublicRepoInput('');
    setPublicRepoConnectError(null);
  };

  const navigateDashboard = (route: DashboardRoute): void => {
    setDashboardView(route.view);
    replaceDashboardUrl(route);
  };

  const handleDashboardNavChange = (nextNav: DashboardNavId): void => {
    if (shouldClearPublicRepoInputOnViewChange(dashboardView, nextNav)) {
      clearPublicRepoConnectUi();
      publicConnectSessionRef.current = INITIAL_PUBLIC_REPO_CONNECT_SESSION;
    }
    navigateDashboard(routeAfterNavChange(nextNav, selectedRepo?.id ?? null));
  };

  const applyRepositorySelection = (repo: Repository): void => {
    if (
      shouldClearPublicRepoInputOnRepoSelect(
        repo.id,
        selectedRepo?.id ?? null,
        publicConnectSessionRef.current,
      )
    ) {
      clearPublicRepoConnectUi();
      publicConnectSessionRef.current = INITIAL_PUBLIC_REPO_CONNECT_SESSION;
    }

    if (selectedRepo?.id === repo.id) {
      setResultsView('repo');
      return;
    }

    const reset = createRepoSelectionReset();
    setResultsView('repo');
    setSelectedRepo(repo);
    setSelectedScan(reset.selectedScan);
    setFindings(reset.findings);
    setScans(reset.scans);
    setShareError(reset.shareError);
    setRepoDetailStatus(reset.repoDetailStatus);
    setLastScanScope(reset.lastScanScope);
    setLastScanFileCount(reset.lastScanFileCount);
    setScanError(null);
    setScanBranch(null);
    setRepoBranches([]);
    setEmptyScanAltBranches([]);
    setDeleteScanError(null);
    setScanLogs([]);
  };

  const handleSelectRepo = (repo: Repository): void => {
    applyRepositorySelection(repo);
    navigateDashboard(routeAfterRepositorySelect(dashboardView, repo.id));
  };

  useEffect(() => {
    if (!selectedRepo || !org) return;
    const repoId = selectedRepo.id;
    const repoFullName = selectedRepo.name;
    if (!isGitHubRepositoryName(repoFullName)) return;
    const controller = new AbortController();
    void (async () => {
      const usePrivateProxy =
        Boolean(org.github_installation_id) && !preferPublicScanForRepository(repoFullName, repos);
      const url = usePrivateProxy
        ? `/api/github/proxy?repoId=${repoId}&type=branches`
        : `/api/github/public-scan?repo=${encodeURIComponent(repoFullName)}&type=branches`;
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return;
        const parsed = parseGithubBranchList(await response.json());
        if (controller.signal.aborted) return;
        setRepoBranches(parsed.branches);
        setScanBranch((current) => current ?? parsed.default_branch);
      } catch {
        // Branch picker is best-effort; scans still run against GitHub's default.
      }
    })();
    return () => controller.abort();
  }, [selectedRepo, org, repos]);

  // Opening a verdict card always drops into the app workspace, even if the
  // same repository is already selected on Settings.
  const handleOpenVerdict = (repositoryId: string): void => {
    const repo = repos.find((candidate) => candidate.id === repositoryId);
    if (!repo) return;
    applyRepositorySelection(repo);
    navigateDashboard({ view: 'app', repoId: repo.id });
  };

  /**
   * Real UUID target ids keyed by repository id — synthetic `repo:…` cards are
   * omitted.
   *
   * The status is carried alongside the map rather than inferred from it. An
   * empty map means "no repository has a target", which during the initial
   * fetch is indistinguishable from "we have not asked yet" — and the canary
   * panel used that emptiness to tell people to scan a repository they had
   * already scanned.
   */
  const [targetLookup, setTargetLookup] = useState<{
    status: 'loading' | 'ready' | 'error';
    byRepoId: Record<string, string>;
  }>({ status: 'loading', byRepoId: {} });
  /** Shared with VerdictCardsSection — one `/api/targets` fetch for cards + lookup. */
  const [verdictCards, setVerdictCards] = useState<TargetCard[] | null>(null);
  const [verdictCardsError, setVerdictCardsError] = useState<string | null>(null);
  const [removingTargetId, setRemovingTargetId] = useState<string | null>(null);
  const [removingRepositoryId, setRemovingRepositoryId] = useState<string | null>(null);
  const [rescanningTargetId, setRescanningTargetId] = useState<string | null>(null);
  /** Bumps when a card Rescan targets an already-selected repo (selection alone would not re-fire). */
  const [scanKickToken, setScanKickToken] = useState(0);

  const handleRescanVerdict = async (card: TargetCard): Promise<void> => {
    if (isScanning || rescanningTargetId) return;

    if (card.kind === 'repo' && card.repositoryId) {
      const repo = repos.find((candidate) => candidate.id === card.repositoryId);
      if (!repo) {
        setToast({
          message: 'That repository is no longer connected. Reconnect it to scan again.',
          type: 'error',
        });
        return;
      }
      setRescanningTargetId(card.repositoryId);
      setToast({ message: `Scanning ${card.displayName}…`, type: 'info' });
      autoStartScanRef.current = true;
      handleSelectRepo(repo);
      setScanKickToken((token) => token + 1);
      // Show progress immediately — do not wait until the scan finishes.
      requestAnimationFrame(() => {
        scrollToRepoWorkspace();
      });
      return;
    }

    if (card.kind === 'url') {
      setRescanningTargetId(card.id);
      setVerdictCardsError(null);
      setToast({ message: `Re-probing ${card.displayName}…`, type: 'info' });
      try {
        await clientApi.reprobe(card.id);
        setVerdictRefreshKey((key) => key + 1);
        setToast({
          message: `Re-probed ${card.displayName}. Guardian verdict refreshed.`,
          type: 'success',
        });
      } catch (err: unknown) {
        setToast({
          message:
            err instanceof ClientApiError
              ? err.message
              : 'Could not re-probe that URL. Verify ownership and try again.',
          type: 'error',
        });
      } finally {
        setRescanningTargetId(null);
      }
    }
  };

  const handleRemoveUrlTarget = async (targetId: string): Promise<void> => {
    setRemovingTargetId(targetId);
    setVerdictCardsError(null);
    const previous = verdictCards;
    // Optimistic remove so the card disappears immediately.
    setVerdictCards((cards) => (cards ? cards.filter((card) => card.id !== targetId) : cards));
    try {
      await clientApi.deleteTarget(targetId);
      setVerdictRefreshKey((key) => key + 1);
    } catch (err: unknown) {
      setVerdictCards(previous);
      setVerdictCardsError(
        err instanceof ClientApiError ? err.message : 'Could not remove that URL app.',
      );
    } finally {
      setRemovingTargetId(null);
    }
  };

  const handleRemoveRepo = async (repositoryId: string): Promise<void> => {
    setRemovingRepositoryId(repositoryId);
    setVerdictCardsError(null);
    const previousCards = verdictCards;
    const previousRepos = repos;
    const removingSelected = selectedRepo?.id === repositoryId;
    setVerdictCards((cards) =>
      cards ? cards.filter((card) => card.repositoryId !== repositoryId) : cards,
    );
    setRepos((current) => current.filter((repo) => repo.id !== repositoryId));
    if (removingSelected) {
      const reset = createRepoSelectionReset();
      setSelectedRepo(null);
      setSelectedScan(reset.selectedScan);
      setFindings(reset.findings);
      setScans(reset.scans);
      setShareError(reset.shareError);
      setRepoDetailStatus(reset.repoDetailStatus);
      setLastScanScope(reset.lastScanScope);
      setLastScanFileCount(reset.lastScanFileCount);
      setScanError(null);
      setDeleteScanError(null);
      setScanLogs([]);
    }
    try {
      await clientApi.deleteRepository(repositoryId);
      setVerdictRefreshKey((key) => key + 1);
    } catch (err: unknown) {
      setVerdictCards(previousCards);
      setRepos(previousRepos);
      setVerdictCardsError(
        err instanceof ClientApiError ? err.message : 'Could not remove that repository.',
      );
    } finally {
      setRemovingRepositoryId(null);
    }
  };

  const wasScanningRef = useRef(false);
  // Set when a scan is kicked off from the tools column (Scan Public Repository),
  // where the user is scrolled away from the results canvas. On completion we
  // bring them to the TOP of the workspace so the verdict reads from the start.
  const pendingWorkspaceScrollRef = useRef(false);
  useEffect(() => {
    if (wasScanningRef.current && !isScanning) {
      setVerdictRefreshKey((key) => key + 1);
      // Keep the card CTA in "Scanning…" until the pipeline fully finishes.
      setRescanningTargetId(null);
      if (pendingWorkspaceScrollRef.current) {
        pendingWorkspaceScrollRef.current = false;
        scrollToRepoWorkspace();
      }
    }
    wasScanningRef.current = isScanning;
  }, [isScanning]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drop stale error before the targets refetch
    setVerdictCardsError(null);
    void clientApi
      .targets()
      .then(({ targets }) => {
        if (cancelled) return;
        // Sticky session capabilities (cli_only / invalid) win over a stale API
        // projection when persist failed or has not replicated yet.
        const localCapabilityByRepoId = new Map(
          repos.map((repo) => [repo.id, repo.scan_capability ?? 'browser'] as const),
        );
        const mergedTargets = targets.map((card) => {
          if (card.kind !== 'repo' || !card.repositoryId) return card;
          const localCapability = localCapabilityByRepoId.get(card.repositoryId);
          if (localCapability !== 'cli_only' && localCapability !== 'invalid') {
            return card;
          }
          if (card.scanCapability === localCapability) return card;
          return { ...card, scanCapability: localCapability };
        });
        setVerdictCards(mergedTargets);
        setTargetLookup({ status: 'ready', byRepoId: buildRepoTargetLookup(mergedTargets) });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Non-fatal, but not silent: without this the panel would sit on
        // "loading" forever and look broken rather than retryable.
        setVerdictCards([]);
        setVerdictCardsError(
          err instanceof ClientApiError ? err.message : 'Could not load your apps right now.',
        );
        setTargetLookup({ status: 'error', byRepoId: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [verdictRefreshKey, repos]);

  useEffect(() => {
    const pendingRepo = window.localStorage.getItem('last_scanned_public_repo');
    if (!pendingRepo) return;
    window.localStorage.removeItem('last_scanned_public_repo');

    void (async () => {
      try {
        const githubRepository = await githubApi.repository(pendingRepo);
        const newRepo = await clientApi.createRepository(pendingRepo, githubRepository.id);
        setRepos((current) =>
          dedupeRepositoriesByGithubId(
            current.some((repository) => repository.id === newRepo.id)
              ? current
              : [...current, newRepo],
          ),
        );
        handleSelectRepo(newRepo);
        autoStartScanRef.current = true;
        pendingWorkspaceScrollRef.current = true;
      } catch (error: unknown) {
        console.error('Failed to import pending repository:', error);
      }
    })();
  }, []);

  // Click outside to close the desktop profile dropdown (mobile uses useAccessibleMenu).
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent): void => {
      if (window.matchMedia(DASHBOARD_NAV_OVERLAY_MQ).matches) return;
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // Leave overlay mode when the viewport crosses 1100px so dashboard-menu-open
  // cannot stick with a hidden hamburger (same pattern as HomeHeader).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(DASHBOARD_NAV_OVERLAY_MQ);
    const onChange = (): void => {
      if (!media.matches) setIsProfileOpen(false);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Body scroll lock and layout toggling when mobile/profile menu is open
  useEffect(() => {
    if (isProfileOpen) {
      document.body.classList.add('dashboard-menu-open');
    } else {
      document.body.classList.remove('dashboard-menu-open');
    }
    return () => {
      document.body.classList.remove('dashboard-menu-open');
    };
  }, [isProfileOpen]);

  const selectedRepoId = selectedRepo?.id ?? null;

  useEffect(() => {
    return subscribeToUnauthorizedSession(() => {
      setUser(null);
      setSessionExpired(true);
    });
  }, []);

  // Load scans when the selected repo changes. No interval polling — that was a
  // launch P0 cost bug (~100+/session for one repoId). Refresh only on select,
  // tab focus, and after mutations (save/delete invalidate the query cache).
  useEffect(() => {
    if (!user || !selectedRepoId) {
      return;
    }
    // Belt-and-suspenders: any selectedRepoId change drops Instant Gate session
    // overrides so Ship Gate scope cannot leak from the previously viewed repo.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset session scan scope when the selected repo changes
    setLastScanScope(null);
    setLastScanFileCount(null);
    const repoId = selectedRepoId;
    let cancelled = false;
    let unauthorized = false;

    const applyScans = (repoScans: Scan[]): void => {
      if (cancelled) return;
      const visibleScans = selectLatestScanPerCommit(repoScans);
      const uniqueCount = countVisibleScanHistory(repoScans);
      setScans((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(repoScans)) {
          return prev;
        }
        return repoScans;
      });
      setScanCountsByRepoId((prev) =>
        prev[repoId] === uniqueCount ? prev : { ...prev, [repoId]: uniqueCount },
      );

      setSelectedScan((prev) => {
        // Keep an unsaved local selection alive, but only while it belongs to the
        // repo currently in view; otherwise fall back to the newest server scan.
        if (prev && isLocalScanId(prev.id)) {
          return prev.repository_id === repoId ? prev : (visibleScans[0] ?? null);
        }
        if (visibleScans.length === 0) {
          return prev?.repository_id === repoId ? prev : null;
        }
        if (!prev) return visibleScans[0];
        const stillVisible = visibleScans.some((s) => s.id === prev.id);
        return stillVisible ? prev : (visibleScans[0] ?? null);
      });

      setRepoDetailStatus((current) => {
        if (current !== 'loading') {
          return current;
        }
        const local = localScanRef.current;
        return resolveRepoDetailStatusAfterScans(
          visibleScans.length,
          Boolean(local && local.repository_id === repoId),
        );
      });
    };

    const fetchScans = async (force: boolean): Promise<void> => {
      if (unauthorized || cancelled) return;
      try {
        const { scans: repoScans } = await loadRepoScans(repoId, { force });
        applyScans(repoScans);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ClientApiError && e.status === 401) {
          unauthorized = true;
          notifyUnauthorizedSession();
          return;
        }
        console.error(e);
        setRepoDetailStatus((current) => (current === 'loading' ? 'empty' : current));
      }
    };

    void fetchScans(false);

    const refreshWhenVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      invalidateRepoScansCache(repoId);
      void fetchScans(true);
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [selectedRepoId, user]);

  // Stable key so a new array identity for the same repos does not re-prefetch.
  const repoIdsKey = useMemo(() => repos.map((repo) => repo.id).join(','), [repos]);

  // Prefetch scan counts for every connected repository so the sidebar can surface
  // history without requiring the user to open each repo first. Deduped via
  // loadRepoScans so Strict Mode + selected-repo load share one network trip.
  useEffect(() => {
    if (!repoIdsKey) return;
    const ids = repoIdsKey.split(',').filter(Boolean);
    let cancelled = false;

    void Promise.all(
      ids.map(async (repoId) => {
        try {
          const { scans: repoScans } = await loadRepoScans(repoId);
          return [repoId, countVisibleScanHistory(repoScans)] as const;
        } catch {
          return [repoId, 0] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setScanCountsByRepoId((prev) => {
        const next = { ...prev, ...Object.fromEntries(entries) };
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [repoIdsKey]);

  // Fetch findings when selected scan changes
  useEffect(() => {
    if (!selectedScan) {
      return;
    }
    // Skip the DB fetch when the in-session override already holds this scan's
    // findings. This covers unsaved local scans (scan-... id) and just-saved
    // scans whose full result — including findings beyond the persisted cap — is
    // kept in memory so it is not truncated mid-session.
    if (isLocalScanId(selectedScan.id) || localScan?.id === selectedScan.id) {
      // Intentional immediate status transition: this scan's findings are already
      // in memory, so we deliberately skip the DB fetch and mark the detail ready
      // now. Deriving this from render would mean rebuilding the component's
      // async status machine for no behavioral gain.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRepoDetailStatus(markRepoDetailReady);
      return;
    }

    let cancelled = false;

    const fetchFindings = async (): Promise<void> => {
      try {
        const { findings: scanFindings } = await clientApi.findings(selectedScan.id);
        if (cancelled) {
          return;
        }
        setFindings((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(scanFindings)) {
            return prev;
          }
          return scanFindings;
        });
        setRepoDetailStatus(markRepoDetailReady);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setRepoDetailStatus(markRepoDetailReady);
        }
      }
    };

    void fetchFindings();

    return () => {
      cancelled = true;
    };
  }, [selectedScan, localScan]);

  // Toast auto-close — scan errors persist until dismissed; other errors linger longer.
  useEffect(() => {
    if (!toast) return;
    const dismissMs = toast.autoDismissMs ?? DEFAULT_TOAST_DISMISS_MS[toast.type];
    if (dismissMs === null) return;
    const timer = setTimeout(() => setToast(null), dismissMs);
    return () => clearTimeout(timer);
  }, [toast]);

  // The unsaved local scan only applies to the repository it was produced for, so
  // switching repositories naturally hides it without any imperative reset.
  const localScanForRepo =
    localScan && selectedRepo && localScan.repository_id === selectedRepo.id ? localScan : null;

  // Merge the (optional) unsaved local scan in front of persisted scans so the UI
  // always reflects the most recent run, even when persistence failed.
  const displayedScans = useMemo<Scan[]>(() => {
    const merged = localScanForRepo
      ? [localScanForRepo, ...scans.filter((s) => s.id !== localScanForRepo.id)]
      : scans;
    return excludeTooLargeFailedScans(selectLatestScanPerCommit(merged));
  }, [localScanForRepo, scans]);

  const displayedFindings = useMemo(() => {
    if (!selectedScan) {
      return [];
    }
    if (localScanForRepo && selectedScan.id === localScanForRepo.id) {
      return localFindings;
    }
    return findingsMatchScan(findings, selectedScan.id) ? findings : [];
  }, [selectedScan, localScanForRepo, localFindings, findings]);

  const fixSummary = useMemo(
    () => (selectedScan ? summarizeScanFixes(displayedFindings, selectedScan.error_count) : null),
    [displayedFindings, selectedScan],
  );

  const shipGateReport = useMemo(() => {
    if (!selectedScan) return null;

    const { scanScope: resolvedScope, scannedFileCount: resolvedScanned } =
      resolveShipGateScanContext(selectedScan, {
        lastScanScope,
        lastScanFileCount,
      });

    const findingFiles = displayedFindings.map((finding) => finding.file_path);
    const scannedFileCount =
      resolvedScanned ??
      (displayedFindings.length === 0
        ? 0
        : Math.max(new Set(findingFiles.filter(Boolean)).size, 0));
    const cleanFileCount =
      typeof selectedScan.clean_file_count === 'number'
        ? selectedScan.clean_file_count
        : countCleanScannedFiles(scannedFileCount, findingFiles);

    // Prefer the persisted Ship Gate score when present so reload matches save.
    // Incomplete coverage is still capped so detail never outranks trend/cards.
    const report = buildShipGateFromScanFindings(displayedFindings, {
      scannedFileCount,
      cleanFileCount,
      scanScope: resolvedScope ?? undefined,
    });
    const shipScore = resolveDisplayedShipScore(selectedScan, displayedFindings);
    return { ...report, shipScore };
  }, [displayedFindings, selectedScan, lastScanFileCount, lastScanScope]);

  const selectedRepoScanCount = selectedRepo ? displayedScans.length : 0;

  const canJumpToScanResults =
    repoDetailStatus === 'ready' && selectedScan !== null && shipGateReport !== null;

  const selectedShareUrl = useMemo(() => {
    if (!selectedScan) return null;
    if (shareUrlsByScanId[selectedScan.id]) return shareUrlsByScanId[selectedScan.id];
    if (selectedScan.share_token) {
      return `${window.location.origin}/report/${selectedScan.share_token}`;
    }
    return null;
  }, [selectedScan, shareUrlsByScanId]);

  const selectedShareToken = useMemo(() => {
    if (!selectedScan) return null;
    if (selectedScan.share_token) return selectedScan.share_token;
    const shareUrl = shareUrlsByScanId[selectedScan.id];
    if (!shareUrl) return null;
    const match = shareUrl.match(/\/report\/([a-f0-9]{32})$/);
    return match?.[1] ?? null;
  }, [selectedScan, shareUrlsByScanId]);

  const selectedBadgeMarkdown = useMemo(() => {
    if (!selectedShareToken) return null;
    return `![Ship Score](${window.location.origin}/api/badge/${selectedShareToken})`;
  }, [selectedShareToken]);

  const handleShareScan = async (): Promise<void> => {
    if (!selectedScan || !org || !planAllowsShareableReports(org.billing_plan)) return;
    if (isLocalScanId(selectedScan.id)) {
      setShareError('Save the scan to your repository history before sharing.');
      return;
    }

    setSharingScanId(selectedScan.id);
    setShareError(null);
    try {
      const { url } = await clientApi.shareScan(selectedScan.id);
      setShareUrlsByScanId((current) => ({ ...current, [selectedScan.id]: url }));
      setToast({ message: 'Shareable Ship Gate report link created.', type: 'success' });
    } catch (error: unknown) {
      setShareError(error instanceof Error ? error.message : 'Could not create share link.');
    } finally {
      setSharingScanId(null);
    }
  };

  /**
   * Removes one scan from history. Local (unsaved) scans are dropped from state
   * only; persisted scans call DELETE /api/scans, which also re-syncs the repo
   * target so the verdict card never goes stale. Optimistic UI with rollback on
   * failure — same non-blocking error pattern as API-key revoke.
   */
  const handleDeleteScan = (scan: Scan): void => {
    const previousScans = scans;
    const previousSelected = selectedScan;
    const previousLocalScan = localScan;
    const previousLocalFindings = localFindings;
    const previousFindings = findings;
    const previousCount = scanCountsByRepoId[scan.repository_id];
    const repoId = scan.repository_id;
    const wasSelected = selectedScan?.id === scan.id;

    const remainingDisplayed = displayedScans.filter((item) => item.id !== scan.id);
    const nextSelected = wasSelected ? (remainingDisplayed[0] ?? null) : selectedScan;

    setDeleteScanError(null);

    // Local / unsaved scans never hit the API.
    if (isLocalScanId(scan.id)) {
      if (localScan?.id === scan.id) {
        setLocalScan(null);
        setLocalFindings([]);
      } else {
        setScans((current) => current.filter((item) => item.id !== scan.id));
      }
      setSelectedScan(nextSelected);
      if (wasSelected) {
        setFindings([]);
      }
      setScanCountsByRepoId((current) => ({
        ...current,
        [repoId]: remainingDisplayed.length,
      }));
      return;
    }

    // Optimistic remove for a persisted scan.
    setScans((current) => current.filter((item) => item.id !== scan.id));
    setSelectedScan(nextSelected);
    if (wasSelected) {
      setFindings([]);
    }
    setScanCountsByRepoId((current) => ({
      ...current,
      [repoId]: remainingDisplayed.length,
    }));

    void (async () => {
      try {
        await clientApi.deleteScan(scan.id);
        // Target was re-synced server-side — refresh verdict cards + scan list.
        setVerdictRefreshKey((key) => key + 1);
        try {
          invalidateRepoScansCache(repoId);
          const { scans: repoScans } = await loadRepoScans(repoId, { force: true });
          setScans(repoScans);
          setScanCountsByRepoId((current) => ({
            ...current,
            [repoId]: countVisibleScanHistory(repoScans),
          }));
          setSelectedScan((prev) => {
            if (!prev || prev.id === scan.id) {
              return repoScans[0] ?? null;
            }
            return repoScans.some((item) => item.id === prev.id) ? prev : (repoScans[0] ?? null);
          });
        } catch {
          // Delete already succeeded; a refresh failure is non-fatal.
        }
      } catch (error: unknown) {
        setScans(previousScans);
        setSelectedScan(previousSelected);
        setLocalScan(previousLocalScan);
        setLocalFindings(previousLocalFindings);
        setFindings(previousFindings);
        if (previousCount !== undefined) {
          setScanCountsByRepoId((current) => ({ ...current, [repoId]: previousCount }));
        }
        setDeleteScanError(error instanceof Error ? error.message : 'Could not delete the scan.');
      }
    })();
  };

  const markFindingsFixed = (findingIds: string[], prUrl: string): void => {
    const apply = (items: ScanFinding[]): ScanFinding[] =>
      items.map((finding) =>
        findingIds.includes(finding.id) ? { ...finding, fix_pr_url: prUrl } : finding,
      );
    setFindings(apply);
    setLocalFindings(apply);
  };

  // Best-effort jump to the freshly opened PR. Browsers may block window.open
  // after an async request (it is not inside the original click gesture), so the
  // persistent toast's "View pull request" link is the reliable path — this just
  // saves a click when the browser allows it.
  const openPrInNewTab = (prUrl: string): void => {
    try {
      window.open(prUrl, '_blank', 'noopener,noreferrer');
    } catch {
      // Ignore — the toast action link covers navigation.
    }
  };

  const announcePrCreated = (prUrl: string, message: string): void => {
    openPrInNewTab(prUrl);
    setToast({
      message,
      type: 'success',
      actionLabel: 'View pull request →',
      actionHref: prUrl,
      // Persist until dismissed so the user always has a reliable link to the PR.
      autoDismissMs: null,
    });
  };

  const isFindingFixable = (finding: ScanFinding): boolean =>
    !isLocalFindingId(finding.id) && isAutoFixableFinding(finding);

  const handleCreateFixPr = async (finding: ScanFinding): Promise<void> => {
    if (!selectedRepo || !selectedScan) return;
    setFixingFindingId(finding.id);
    setToast({ message: 'Creating fix branch and pull request...', type: 'info' });

    try {
      const { prUrl, findingIds } = await clientApi.createFix({
        repoId: selectedRepo.id,
        scanId: selectedScan.id,
        findingId: finding.id,
      });
      if (prUrl && findingIds?.length) {
        markFindingsFixed(findingIds, prUrl);
        announcePrCreated(prUrl, 'Pull request created on GitHub.');
      } else {
        throw new Error('Failed to retrieve the PR URL from the backend.');
      }
    } catch (error: unknown) {
      console.error('[Auto-Fix Error]', error);
      setToast({
        message: error instanceof Error ? error.message : 'Auto-fix failed.',
        type: 'error',
      });
    } finally {
      setFixingFindingId(null);
    }
  };

  const handleCreateBatchFixPr = async (): Promise<void> => {
    if (!selectedRepo || !selectedScan || !fixSummary || fixSummary.remainingCount === 0) return;
    setFixingFindingId('batch');
    setToast({
      message: `Creating one combined pull request for ${fixSummary.remainingCount} fixes...`,
      type: 'info',
    });

    try {
      const { prUrl, findingIds } = await clientApi.createFix({
        repoId: selectedRepo.id,
        scanId: selectedScan.id,
        batch: true,
      });
      if (prUrl && findingIds?.length) {
        markFindingsFixed(findingIds, prUrl);
        announcePrCreated(
          prUrl,
          `Combined pull request created on GitHub for ${findingIds.length} fixes.`,
        );
      } else {
        throw new Error('Failed to retrieve the PR URL from the backend.');
      }
    } catch (error: unknown) {
      console.error('[Auto-Fix Error]', error);
      setToast({
        message: error instanceof Error ? error.message : 'Batch auto-fix failed.',
        type: 'error',
      });
    } finally {
      setFixingFindingId(null);
    }
  };

  const handleCheckout = async (plan: 'monthly' | 'yearly'): Promise<void> => {
    if (billingAction) return;
    setBillingAction('checkout');
    try {
      const { url } = await clientApi.checkout(plan);
      window.location.assign(url);
    } catch (error: unknown) {
      if (error instanceof ClientApiError && error.code === 'already_subscribed') {
        setToast({
          message: error.message,
          type: 'info',
        });
        try {
          const { url } = await clientApi.portal();
          window.location.assign(url);
          return;
        } catch (portalError: unknown) {
          setToast({
            message:
              portalError instanceof ClientApiError
                ? portalError.message
                : 'Billing management is temporarily unavailable. Please try again.',
            type: 'error',
          });
          setBillingAction(null);
          return;
        }
      }
      setToast({
        message:
          error instanceof ClientApiError
            ? error.message
            : 'Checkout is temporarily unavailable. Please try again.',
        type: 'error',
      });
      setBillingAction(null);
    }
  };

  const handleManageBilling = async (): Promise<void> => {
    if (billingAction) return;
    setBillingAction('portal');
    try {
      const { url } = await clientApi.portal();
      window.location.assign(url);
    } catch (error: unknown) {
      setToast({
        message:
          error instanceof ClientApiError
            ? error.message
            : 'Billing management is temporarily unavailable. Please try again.',
        type: 'error',
      });
      setBillingAction(null);
    }
  };

  const handleAddPublicRepo = async (e?: React.FormEvent): Promise<void> => {
    if (e) e.preventDefault();
    const repoFullName = parsePublicRepoInput(publicRepoInput);
    if (!repoFullName || isAddingRepo) return;

    setPublicRepoConnectError(null);
    setIsAddingRepo(true);
    setToast({ message: `Fetching public repository "${repoFullName}"...`, type: 'info' });

    try {
      const githubRepository = await githubApi.repository(repoFullName);
      const newRepo = await clientApi.createRepository(repoFullName, githubRepository.id);

      const exists = repos.some((r) => r.id === newRepo.id);
      setRepos((prev) => dedupeRepositoriesByGithubId(exists ? prev : [...prev, newRepo]));

      publicConnectSessionRef.current = createPublicRepoConnectSession(newRepo.id);
      handleSelectRepo(newRepo);
      setPublicRepoInput('');
      setPublicRepoConnectError(null);
      autoStartScanRef.current = true;
      pendingWorkspaceScrollRef.current = true;
      setToast({
        message: `Repository "${repoFullName}" connected successfully!`,
        type: 'success',
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to connect public repository.';
      setPublicRepoConnectError(message);
      setToast({ message, type: 'error' });
    } finally {
      setIsAddingRepo(false);
    }
  };

  /**
   * Triggers a real scan using the browserScanner engine.
   * Fetches files from GitHub API and runs all scanner rules against them.
   */
  const triggerScan = async (branchOverride?: string): Promise<void> => {
    if (!selectedRepo || !org) return;

    setResultsView('repo');
    setIsScanning(true);
    setScanProgress(0);
    setScanError(null);
    setEmptyScanAltBranches([]);
    if (typeof branchOverride === 'string' && branchOverride.length > 0) {
      setScanBranch(branchOverride);
    }
    setScanLogs([
      '⚙ Initializing Assurly Scanner...',
      `📥 Fetching repository tree for "${selectedRepo.name}"...`,
    ]);
    scanControllerRef.current?.abort();
    const controller = new AbortController();
    scanControllerRef.current = controller;
    const { signal } = controller;

    const settleIfAborted = (): boolean => {
      if (!controller.signal.aborted) {
        return false;
      }
      if (scanControllerRef.current === controller && scanMountedRef.current) {
        setIsScanning(false);
        setScanProgress(0);
        setScanLogs([]);
        setToast({ message: 'Scan stopped.', type: 'info' });
      }
      return true;
    };

    const allFindings: WebFinding[] = [];

    const scanStartedAt = performance.now();
    let treeMs = 0;
    let fetchFilesMs = 0;
    let engineMs = 0;
    let persistMs = 0;

    try {
      // Never invent `${org}/${bare}` — bare names are permanently broken for
      // public-scan validation and produce dishonest "Request validation failed".
      const repoFullName = selectedRepo.name;
      if (!isGitHubRepositoryName(repoFullName)) {
        const message =
          'Repository name must be owner/repo (for example acme/saas). Remove this entry and reconnect with the full GitHub name.';
        setScanLogs((prev) => [...prev, `❌ ERROR: ${message}`]);
        setScanError(message);
        setIsScanning(false);
        setScanProgress(100);
        setToast({ message: `Scan failed: ${message}`, type: 'error', autoDismissMs: null });
        try {
          await clientApi.updateRepositoryScanCapability(selectedRepo.id, 'invalid');
          setRepos((current) =>
            current.map((repo) =>
              repo.id === selectedRepo.id ? { ...repo, scan_capability: 'invalid' } : repo,
            ),
          );
          setSelectedRepo((current) =>
            current && current.id === selectedRepo.id
              ? { ...current, scan_capability: 'invalid' }
              : current,
          );
          setVerdictRefreshKey((key) => key + 1);
        } catch (capabilityError) {
          console.error('Failed to mark repository invalid:', capabilityError);
          setRepos((current) =>
            current.map((repo) =>
              repo.id === selectedRepo.id ? { ...repo, scan_capability: 'invalid' } : repo,
            ),
          );
          setSelectedRepo((current) =>
            current && current.id === selectedRepo.id
              ? { ...current, scan_capability: 'invalid' }
              : current,
          );
          setVerdictRefreshKey((key) => key + 1);
        }
        return;
      }

      // Authenticated installations use the private proxy for repos the app owns.
      // Third-party public repos (e.g. yablko/PHPAuth) skip straight to public-scan
      // so we avoid a noisy 404 from the installation-scoped proxy.
      let usePrivateProxy =
        Boolean(org?.github_installation_id) && !preferPublicScanForRepository(repoFullName, repos);

      let defaultBranch = 'main';
      const requestedBranch =
        typeof branchOverride === 'string' && branchOverride.length > 0
          ? branchOverride
          : scanBranch;
      if (requestedBranch) {
        defaultBranch = requestedBranch;
      }

      // Pin the tree to the picker branch when one is selected; otherwise the
      // proxy resolves GitHub's default branch.
      const treeRequestUrl = (): string => {
        const branchParam = branchQueryParam(requestedBranch);
        return usePrivateProxy
          ? `/api/github/proxy?repoId=${selectedRepo.id}&type=tree${branchParam}`
          : `/api/github/public-scan?repo=${encodeURIComponent(repoFullName)}&type=tree${branchParam}`;
      };

      const fetchFileContent = async (filePath: string): Promise<Response> => {
        if (usePrivateProxy) {
          return fetch(
            `/api/github/proxy?repoId=${selectedRepo.id}&type=file&branch=${encodeURIComponent(
              defaultBranch,
            )}&path=${encodeURIComponent(filePath)}`,
            { signal },
          );
        }
        return fetch(
          `/api/github/public-scan?repo=${encodeURIComponent(repoFullName)}&branch=${encodeURIComponent(
            defaultBranch,
          )}&type=file&path=${encodeURIComponent(filePath)}`,
          { signal },
        );
      };

      // File contents are fetched once and memoised. Several scanner passes
      // below (SQL, Stripe, env, RSC/cold-start) inspect overlapping file sets,
      // and fetching each file serially per pass turned a large repository into
      // minutes of latency — every code file was even fetched twice. A single
      // bounded-concurrency prefetch keeps every unique file to one round trip
      // and lets the passes read from memory.
      const contentCache = new Map<string, string | null>();
      // Session cache: identical HEAD commit reuses prior file contents (skip GitHub
      // downloads) while still re-running the engine for fresh rules.
      const priorSession = scanSessionCacheRef.current.get(selectedRepo.id);

      const loadFileContent = async (filePath: string): Promise<string | null> => {
        const cached = contentCache.get(filePath);
        if (cached !== undefined) return cached;
        let text: string | null = null;
        try {
          const res = await fetchFileContent(filePath);
          text = res.ok ? await res.text() : null;
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          text = null;
        }
        contentCache.set(filePath, text);
        return text;
      };

      const prefetchContents = async (paths: string[]): Promise<void> => {
        const pending = paths.filter((path) => !contentCache.has(path));
        if (pending.length === 0) return;

        // One batch request pulls every file at once — the difference between a
        // fast scan and hundreds of serial per-file round trips (which trip rate
        // limits and take minutes). Both the private (installation) and public
        // proxies support the batch endpoint.
        const batch = usePrivateProxy
          ? {
              url: '/api/github/proxy',
              body: { repoId: selectedRepo.id, branch: defaultBranch, paths: pending },
            }
          : {
              url: '/api/github/public-scan',
              body: { repo: repoFullName, branch: defaultBranch, paths: pending },
            };
        try {
          const res = await fetch(batch.url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(batch.body),
            signal,
          });
          if (res.ok) {
            const data: unknown = await res.json();
            const files =
              (data as { files?: Array<{ path?: unknown; content?: unknown }> }).files ?? [];
            for (const entry of files) {
              if (typeof entry?.path === 'string') {
                contentCache.set(
                  entry.path,
                  typeof entry.content === 'string' ? entry.content : null,
                );
              }
            }
            // Mark any path the server omitted as absent so callers don't refetch.
            for (const path of pending) {
              if (!contentCache.has(path)) contentCache.set(path, null);
            }
            return;
          }
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          // Fall through to per-file fetching below.
        }

        // Batch failed (e.g. transient error): fall back to serial per-file
        // fetching, which respects the proxy rate limit and still completes.
        for (const path of pending) {
          if (controller.signal.aborted) break;
          await loadFileContent(path);
        }
      };

      const treeStartedAt = performance.now();
      let treeResponse = await fetch(treeRequestUrl(), { signal });

      // Graceful fallback: when a private installation has no access to the
      // repository (404/422) but it is a public "owner/repo", retry through the
      // unauthenticated public-scan proxy so public repositories still scan.
      if (
        !treeResponse.ok &&
        usePrivateProxy &&
        (treeResponse.status === 404 || treeResponse.status === 422) &&
        repoFullName.includes('/')
      ) {
        setScanLogs((prev) => [
          ...prev,
          'ℹ Installation cannot access this repository — retrying as a public scan...',
        ]);
        usePrivateProxy = false;
        treeResponse = await fetch(treeRequestUrl(), { signal });
      }

      if (!treeResponse.ok) {
        const proxyError = await readProxyError(treeResponse);
        const err = new Error(`Failed to fetch repository tree: ${proxyError.message}`) as Error & {
          code?: string;
          status?: number;
        };
        err.code = proxyError.code;
        err.status = treeResponse.status;
        throw err;
      }
      treeMs = Math.round(performance.now() - treeStartedAt);

      const treeData = await treeResponse.json();
      if (treeData.default_branch) {
        defaultBranch = treeData.default_branch;
      }
      const resolvedCommitSha: string | undefined =
        typeof treeData.commit_sha === 'string' && treeData.commit_sha.length > 0
          ? treeData.commit_sha
          : undefined;
      const tree: GitHubTreeNode[] = treeData.tree || [];

      if (
        priorSession &&
        resolvedCommitSha &&
        priorSession.commitSha === resolvedCommitSha &&
        priorSession.contents.size > 0
      ) {
        for (const [path, content] of priorSession.contents) {
          contentCache.set(path, content);
        }
        setScanLogs((prev) => [
          ...prev,
          `✓ Reusing ${priorSession.contents.size} cached file(s) for commit ${resolvedCommitSha.slice(0, 7)}.`,
        ]);
      }

      setScanProgress(15);
      setScanLogs((prev) => [
        ...prev,
        `✓ Found ${tree.length} files in repository.`,
        '🔍 Detecting stack and analyzing project structure...',
      ]);

      // Categorize files
      const sqlFiles: string[] = [];
      const envFiles: string[] = [];
      const codeFiles: string[] = [];
      const agentFiles: string[] = [];

      for (const node of tree) {
        if (node.type !== 'blob') continue;
        if (!isScannableFile(node.path)) continue;
        const pathLower = node.path.toLowerCase();

        if (isAgentStackFile(node.path)) {
          agentFiles.push(node.path);
        } else if (pathLower.endsWith('.sql')) {
          sqlFiles.push(node.path);
        } else if (
          pathLower.endsWith('.env.example') ||
          pathLower === '.env' ||
          pathLower.endsWith('.env.local')
        ) {
          envFiles.push(node.path);
        } else if (isAnalyzedCodeFile(node.path)) {
          codeFiles.push(node.path);
        }
      }

      const treePaths = tree.filter((node) => node.type === 'blob').map((node) => node.path);
      const packageJsonPaths = selectPackageManifestPaths(treePaths);
      const rankedCandidates = rankFilesByRelevance(
        instantGateSurfaceFiles([...new Set([...sqlFiles, ...codeFiles])], (path) => path),
        (path) => path,
      );
      const fileSelection = selectFiles(rankedCandidates, INSTANT_GATE_MAX_FILES);
      const coveragePaths = instantGateSurfaceFiles(
        treePaths.filter((path) => isScannableFile(path)),
        (path) => path,
      );
      const unanalyzedSummary = summarizeUnanalyzedSource(coveragePaths);
      const scanScope = buildScanScope(rankedCandidates, fileSelection.files, {
        treePaths,
        unanalyzed: unanalyzedLanguageCounts(unanalyzedSummary),
        limit: INSTANT_GATE_MAX_FILES,
      });
      setLastScanFileCount(fileSelection.files.length);
      setLastScanScope(scanScope);

      if (fileSelection.files.length === 0) {
        const message =
          'No scannable application files (JS/TS/SQL) were found. This may be a native, docs-only, or unsupported repository — use Manual Checker or `npx assurly scan` locally if relevant.';
        setScanLogs((prev) => [...prev, `❌ ERROR: ${message}`]);
        setScanError(message);
        setIsScanning(false);
        setScanProgress(100);
        setToast({
          message: `Scan failed: ${message}`,
          type: 'error',
          autoDismissMs: null,
        });
        try {
          await clientApi.saveScan({
            repoId: selectedRepo.id,
            commitSha: resolvedCommitSha ?? 'unknown',
            branch: defaultBranch,
            status: 'failed',
            errors: 0,
            warnings: 0,
            findings: [],
            scannedFileCount: 0,
            cleanFileCount: 0,
            verdict: 'failed',
            scanScope: { ...scanScope },
            failureReason: 'no_eligible_files',
          });
          invalidateRepoScansCache(selectedRepo.id);
        } catch (saveError) {
          console.error('Failed to persist empty-file scan failure:', saveError);
        }
        try {
          const branchesUrl = usePrivateProxy
            ? `/api/github/proxy?repoId=${selectedRepo.id}&type=branches`
            : `/api/github/public-scan?repo=${encodeURIComponent(repoFullName)}&type=branches`;
          const branchesResponse = await fetch(branchesUrl, { signal });
          if (branchesResponse.ok) {
            const parsed = parseGithubBranchList(await branchesResponse.json());
            setRepoBranches(parsed.branches);
            setEmptyScanAltBranches(suggestAlternateScanBranches(defaultBranch, parsed.branches));
          }
        } catch (branchError) {
          console.error('Failed to list branches after empty scan:', branchError);
        }
        return;
      }

      const selectedFiles = new Set(fileSelection.files);
      const incompleteFinding = incompleteScanFinding(fileSelection);
      if (incompleteFinding) allFindings.push(incompleteFinding);
      const coverageFinding = unanalyzedSourceFinding(unanalyzedSummary);
      if (coverageFinding) allFindings.push(coverageFinding);

      // Resolve every file this scan will read, then fetch them all in one
      // bounded-concurrency batch. Doing this up front (instead of serially
      // inside each pass) is the difference between seconds and minutes on a
      // large repository.
      const sqlToScan = sqlFiles.filter((path) => selectedFiles.has(path));
      const codeToScan = codeFiles.filter((path) => selectedFiles.has(path));
      const stripeToScan = codeToScan.filter(
        (p) => p.toLowerCase().includes('stripe') || p.toLowerCase().includes('webhook'),
      );
      const envExamplePaths = envFiles.filter((path) => path.endsWith('.env.example'));
      const workflowPaths = tree
        .filter(
          (node) =>
            node.type === 'blob' &&
            /^\.github\/workflows\/.*\.(ya?ml)$/i.test(node.path.replace(/\\/g, '/')),
        )
        .map((node) => node.path);

      const filesToFetch = [
        ...new Set([
          ...sqlToScan,
          ...codeToScan,
          ...envExamplePaths,
          ...workflowPaths,
          ...agentFiles,
          ...packageJsonPaths,
        ]),
      ];
      setScanLogs((prev) => [...prev, `📥 Fetching ${filesToFetch.length} file(s) in parallel...`]);
      const fetchFilesStartedAt = performance.now();
      await prefetchContents(filesToFetch);
      if (settleIfAborted()) {
        return;
      }
      fetchFilesMs = Math.round(performance.now() - fetchFilesStartedAt);
      if (resolvedCommitSha) {
        scanSessionCacheRef.current.set(selectedRepo.id, {
          commitSha: resolvedCommitSha,
          contents: new Map(contentCache),
        });
      }

      const manifests = packageJsonPaths.flatMap((manifestPath) => {
        const content = contentCache.get(manifestPath);
        return typeof content === 'string' ? [{ path: manifestPath, content }] : [];
      });
      const packageJsonText =
        manifests.length > 0 ? manifests.map((item) => item.content).join('\n') : null;
      const detectedStack = detectStackFromManifests({
        manifests,
        filePaths: treePaths,
      });
      const stackLog = describeDetectedStack(detectedStack);
      const generatorFingerprint = detectGeneratorFingerprint({
        filePaths: treePaths,
        packageJson: packageJsonText,
      });
      const unanalyzedLog = formatUnanalyzedLogLine(unanalyzedSummary);

      const engineStartedAt = performance.now();
      setScanProgress(45);
      setScanLogs((prev) => [
        ...prev,
        `✓ Framework: ${stackLog.framework}`,
        `✓ Supabase: ${stackLog.supabase}`,
        `✓ Stripe: ${stackLog.stripe}`,
        ...(unanalyzedLog ? [`⚠ ${unanalyzedLog}`] : []),
        '🛡 Running static analysis scanner rules...',
      ]);

      // Scan SQL Migrations in one batch so RLS correlation and the Supabase
      // stack signal apply across files, not per migration.
      const sqlSources: SourceInput[] = [];
      for (const sqlPath of sqlToScan) {
        if (controller.signal.aborted) break;
        const content = await loadFileContent(sqlPath);
        if (content === null) continue;
        sqlSources.push({ file: sqlPath, content });
      }
      if (sqlSources.length > 0) {
        const scan = scanSqlMigrations(sqlSources);
        allFindings.push(...scan.findings);
        for (const source of sqlSources) {
          const fileFindings = scan.findings.filter((finding) => finding.file === source.file);
          const errorCount = fileFindings.filter((finding) => finding.severity === 'error').length;
          const warningCount = fileFindings.filter(
            (finding) => finding.severity === 'warning',
          ).length;
          setScanLogs((prev) => [
            ...prev,
            `  ✓ Scanned ${source.file}: ${errorCount} errors, ${warningCount} warnings.`,
          ]);
        }
      }

      setScanProgress(50);

      // Scan Stripe Webhooks
      for (const webhookPath of stripeToScan) {
        if (controller.signal.aborted) break;
        const content = await loadFileContent(webhookPath);
        if (content === null) continue;
        const scan = scanStripeWebhook(content, webhookPath);
        allFindings.push(...scan.findings);
        setScanLogs((prev) => [...prev, `  ✓ Scanned ${webhookPath}: ${scan.errorCount} errors.`]);
      }

      setScanProgress(65);

      // Scan Environment Variables (per-app-root .env.example matching)
      if (envExamplePaths.length > 0) {
        setScanLogs((prev) => [...prev, '⚙ Reading env configuration files...']);
        const allExamples: Array<{ file: string; content: string }> = [];
        for (const examplePath of envExamplePaths) {
          const envContent = await loadFileContent(examplePath);
          if (envContent !== null) {
            allExamples.push({ file: examplePath, content: envContent });
          }
        }

        if (allExamples.length > 0) {
          const rootExample =
            allExamples.find((example) => example.file === '.env.example') ?? allExamples[0];

          for (const codePath of codeToScan) {
            const codeContent = await loadFileContent(codePath);
            if (codeContent === null) continue;
            const scan = scanEnvVariables(
              rootExample.content,
              codeContent,
              rootExample.file,
              codePath,
              { allExamples },
            );
            allFindings.push(
              ...scan.findings.filter((finding) => finding.ruleId === 'undocumented-env'),
            );
          }

          const secretScan = scanEnvVariables(
            rootExample.content,
            '',
            rootExample.file,
            'Repository Codebase',
            { allExamples },
          );
          allFindings.push(
            ...secretScan.findings.filter((finding) => finding.ruleId !== 'undocumented-env'),
          );

          setScanLogs((prev) => [
            ...prev,
            `  ✓ Checked env variables across ${envExamplePaths.length} example file(s).`,
          ]);
        }
      }

      setScanProgress(80);

      // Scan for RSC leaks and Cold Start issues
      const codeSources: SourceInput[] = [];
      for (const codePath of codeToScan) {
        if (controller.signal.aborted) break;
        const content = await loadFileContent(codePath);
        if (content === null) continue;
        codeSources.push({ file: codePath, content });

        allFindings.push(...scanEdgeRuntime(content, codePath).findings);

        // Phase 3: deeper-stack per-file scanners (edge runtime is already
        // handled above; maxDuration + auth boundaries + Stripe lifecycle).
        allFindings.push(...scanMaxDuration(content, codePath).findings);
        allFindings.push(...scanServerActionAuth(content, codePath).findings);
        allFindings.push(...scanRouteHandlerAuth(content, codePath).findings);
        allFindings.push(...scanServiceRoleBypass(content, codePath).findings);
        allFindings.push(...scanStripeMissingSubscriptionEvents(content, codePath).findings);

        // RSC data leak check
        const rscScan = scanRscDataLeaks(content, codePath);
        if (rscScan.findings.length > 0) {
          allFindings.push(...rscScan.findings);
        }
        allFindings.push(...scanSupabaseClientLeaks(content, codePath).findings);

        // Cold Start check for API routes
        if (codePath.includes('/api/')) {
          const csScan = scanColdStart(content, codePath);
          if (csScan.findings.length > 0) {
            allFindings.push(...csScan.findings);
          }
        }
      }

      if (!controller.signal.aborted) {
        allFindings.push(...scanStripeWebhookIdempotencyForProject(codeSources).findings);
      }

      // Agent stack — MCP configs and instruction files (advisory; never blocks).
      if (agentFiles.length > 0) {
        setScanLogs((prev) => [...prev, `🤖 Scanning ${agentFiles.length} agent-stack file(s)...`]);
        for (const agentPath of agentFiles) {
          if (controller.signal.aborted) break;
          const content = await loadFileContent(agentPath);
          if (content === null) continue;
          const agentScan = scanAgentStack(content, agentPath);
          allFindings.push(...agentScan.findings);
        }
      }

      // Dependency provenance — server proxy (never hit npm from the browser).
      // Degrade silently: a registry outage must not fail the rest of the scan.
      if (manifests.length > 0 && !controller.signal.aborted) {
        try {
          const declared = [
            ...new Set(
              manifests.flatMap((manifest) => {
                const parsedManifest = parsePackageJsonDependencies(manifest.content);
                return parsedManifest ? [...collectDependencyNames(parsedManifest)] : [];
              }),
            ),
          ];
          if (declared.length > 0) {
            setScanLogs((prev) => [
              ...prev,
              `📦 Checking dependency provenance (${declared.length} package(s))...`,
            ]);
            const depResult = await clientApi.dependencyProvenance(declared);
            if (!controller.signal.aborted) {
              for (const finding of depResult.findings) {
                allFindings.push({
                  ruleId: finding.ruleId,
                  severity: finding.severity,
                  confidence: finding.confidence,
                  file: finding.file,
                  line: finding.line,
                  message: finding.message,
                  suggestion: finding.suggestion,
                });
              }
            }
          }
        } catch {
          // Intentionally empty — provenance is best-effort on the dashboard path.
        }
      }

      // Check for missing GitHub Actions workflow with an Assurly scan step
      let hasScanWorkflow = false;
      for (const workflowPath of workflowPaths) {
        const workflowContent = await loadFileContent(workflowPath);
        if (
          workflowContent !== null &&
          /assurly|npm\s+run\s+scan(?::self)?|npx\s+assurly\s+scan/i.test(workflowContent)
        ) {
          hasScanWorkflow = true;
          break;
        }
      }

      if (!hasScanWorkflow) {
        allFindings.push({
          ruleId: 'github-actions-integration',
          severity: 'warning',
          file: 'Global Configs',
          message: githubActionsIntegrationMessage(workflowPaths.length),
          suggestion:
            'Run "npx assurly init" in your repository to automatically configure the CI/CD pipeline.',
        });
      }

      if (settleIfAborted()) {
        return;
      }

      engineMs = Math.round(performance.now() - engineStartedAt);
      setScanProgress(100);
      setScanLogs((prev) => [...prev, '🏁 Scan finished. Generating report.']);

      const errorCount = allFindings.filter((f) => f.severity === 'error').length;
      const warningCount = allFindings.filter((f) => f.severity === 'warning').length;
      const shipGate = buildShipGateFromWebFindings(allFindings, {
        scannedFileCount: fileSelection.files.length,
        cleanFileCount: countCleanScannedFiles(
          fileSelection.files.length,
          allFindings.map((finding) => finding.file),
          fileSelection.files,
        ),
        scanScope,
      });

      const deriveRuleId = (file: string | undefined): string => {
        if (file?.includes('.sql')) return 'rls-check';
        if (file?.includes('stripe')) return 'stripe-webhook';
        return 'general';
      };

      // Optimistic / fallback record used until the API confirms persistence.
      // Use the real HEAD commit SHA from GitHub; fall back to a deterministic
      // placeholder only when the API did not return one (e.g. anonymous rate-limit).
      const newScan: Scan = {
        id: `scan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        repository_id: selectedRepo.id,
        commit_sha: resolvedCommitSha ?? 'unknown',
        branch: defaultBranch,
        status: errorCount > 0 ? 'failed' : 'success',
        error_count: errorCount,
        warning_count: warningCount,
        created_at: new Date().toISOString(),
        ship_score: shipGate.shipScore,
        verdict: shipGate.status,
        scanned_file_count: fileSelection.files.length,
        clean_file_count: shipGate.cleanFileCount,
        scan_scope: { ...scanScope },
      };

      // The API rejects payloads with more than SAVE_FINDINGS_LIMIT findings and
      // requires the reported counts to match the findings exactly, so persist a
      // capped set and derive its counts from that same set. Prioritise error
      // findings when capping so a scan with more than SAVE_FINDINGS_LIMIT
      // findings never drops its errors in favour of warnings — otherwise the
      // persisted status/counts could understate a failure.
      const prioritizedFindings = [...allFindings].sort((a, b) => {
        if (a.severity === b.severity) return 0;
        return a.severity === 'error' ? -1 : 1;
      });

      // Convert WebFindings to ScanFindings for display. Built in the same
      // prioritised order as the persisted slice, so the first SAVE_FINDINGS_LIMIT
      // entries line up exactly with what is written to the database.
      const scanFindings: ScanFinding[] = prioritizedFindings.map((f, idx) => ({
        id: `find-${idx}-${Math.random().toString(36).substring(2, 7)}`,
        scan_id: newScan.id,
        rule_id: f.ruleId || deriveRuleId(f.file),
        severity: f.severity,
        file_path: f.file || 'unknown',
        line_number: f.line,
        message: f.message,
        suggestion: f.suggestion,
        created_at: newScan.created_at,
      }));

      const dbFindings = prioritizedFindings.slice(0, SAVE_FINDINGS_LIMIT).map((f) => ({
        rule_id: f.ruleId || deriveRuleId(f.file),
        severity: f.severity,
        confidence: f.confidence,
        file_path: f.file || 'unknown',
        line_number: f.line || 1,
        message: f.message,
        suggestion: f.suggestion || '',
      }));
      const persistedErrors = dbFindings.filter((f) => f.severity === 'error').length;
      const persistedWarnings = dbFindings.length - persistedErrors;

      void (async () => {
        try {
          if (controller.signal.aborted) {
            return;
          }
          const persistStartedAt = performance.now();
          const savedScan = await clientApi.saveScan({
            repoId: selectedRepo.id,
            commitSha: newScan.commit_sha,
            branch: defaultBranch,
            // Status reflects the full scan outcome, not just the persisted slice.
            status: errorCount > 0 ? 'failed' : 'success',
            errors: persistedErrors,
            warnings: persistedWarnings,
            findings: dbFindings,
            // Feed the target's current-verdict projection + corpus moat (Phase 1).
            generatorFingerprint,
            scannedFileCount: fileSelection.files.length,
            cleanFileCount: shipGate.cleanFileCount,
            shipScore: shipGate.shipScore,
            verdict: shipGate.status,
            scanScope: { ...scanScope },
          });
          persistMs = Math.round(performance.now() - persistStartedAt);
          if (process.env.NODE_ENV !== 'production') {
            console.info('[assurly:scan-timing]', {
              repo: selectedRepo.name,
              treeMs,
              fetchFilesMs,
              engineMs,
              persistMs,
              totalMs: Math.round(performance.now() - scanStartedAt),
              scannedFiles: fileSelection.files.length,
            });
          }

          // Keep the full result visible for the rest of the session without
          // sacrificing durability or auto-fix:
          //  - the persisted findings carry real database ids, so auto-fix keeps
          //    working for every saved finding,
          //  - findings beyond SAVE_FINDINGS_LIMIT are re-attached from memory so a
          //    large scan is not silently truncated until the next reload,
          //  - the session record reports the true totals so the detail header
          //    matches the completion toast (the persisted record stays capped and
          //    becomes the source of truth again after a reload).
          let sessionFindings = scanFindings;
          try {
            const { findings: persisted } = await clientApi.findings(savedScan.id);
            sessionFindings = [...persisted, ...scanFindings.slice(dbFindings.length)];
          } catch (fetchError) {
            // Non-fatal: fall back to the full in-memory set. Nothing is lost;
            // auto-fix for these may only become available after a reload.
            console.error('Failed to load persisted findings after save:', fetchError);
          }

          // Adopt the server identity (so list dedup and auto-fix target the
          // database scan) while overriding the counts with the true totals.
          const sessionScan: Scan = {
            ...savedScan,
            error_count: errorCount,
            warning_count: warningCount,
          };

          setIsScanning(false);
          invalidateRepoScansCache(selectedRepo.id);
          let nextScans: Scan[] = [];
          setScans((prev) => {
            nextScans = [savedScan, ...prev.filter((s) => s.id !== savedScan.id)];
            return nextScans;
          });
          setScanCountsByRepoId((counts) => ({
            ...counts,
            [selectedRepo.id]: countVisibleScanHistory(nextScans),
          }));
          setLocalScan(sessionScan);
          setLocalFindings(sessionFindings);
          setSelectedScan(sessionScan);
          setRepoDetailStatus('ready');
          const toastType =
            shipGate.status === 'blocked'
              ? 'error'
              : shipGate.status === 'ready'
                ? 'success'
                : 'info';
          setToast({
            message: `Scan completed & saved: ${shipGate.blockers.length} blockers, ${shipGate.reviews.length + shipGate.warnings.length} warnings to review (Ship Score ${shipGate.shipScore}/100).`,
            type: toastType,
          });
        } catch (e) {
          // Persistence failed (commonly a missing APP_URL / Supabase env var or an
          // origin mismatch on the CSRF check). Keep the result visible via the local
          // scan state — immune to a visibility refresh — and tell the user honestly
          // that it will not survive a reload, instead of showing "No scans found".
          console.error('Failed to save scan to DB:', e);
          setIsScanning(false);
          setLocalScan(newScan);
          setLocalFindings(scanFindings);
          setSelectedScan(newScan);
          setRepoDetailStatus('ready');
          const reason =
            e instanceof ClientApiError && e.message
              ? e.message
              : 'the results could not be saved to your account';
          setToast({
            message: `Scan completed: ${errorCount} errors, ${warningCount} warnings — but results could not be saved (${reason}) and will be lost on reload.`,
            type: 'error',
          });
        }
      })().catch((persistError: unknown) => {
        // Belt-and-suspenders: never let a ClientApiError become an unhandled
        // rejection that opens the Next.js issues overlay.
        console.error('Unhandled scan persist failure:', persistError);
        setIsScanning(false);
      });
    } catch (error: unknown) {
      if (isAbortError(error)) {
        settleIfAborted();
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'Failed to scan repository.';
      const errorCode =
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : undefined;
      const errorStatus =
        error instanceof Error && 'status' in error && typeof error.status === 'number'
          ? error.status
          : undefined;
      const tooLarge =
        errorStatus === 413 ||
        errorCode === 'repository_too_large' ||
        /too large for the in-browser scan/i.test(errorMessage);

      setScanLogs((prev) => [...prev, `❌ ERROR: ${errorMessage}`]);
      setScanError(errorMessage);
      setIsScanning(false);
      setToast({
        message: `Scan failed: ${errorMessage}`,
        type: 'error',
        autoDismissMs: null,
      });

      if (tooLarge && selectedRepo) {
        // Sticky optimistic capability so Unscanned / Scan now disappear even if
        // the PATCH fails (e.g. schema not migrated yet). Keep selectedRepo in
        // sync so the detail workspace swaps Instant Gate → Full Gate CTA.
        setRepos((current) =>
          current.map((repo) =>
            repo.id === selectedRepo.id ? { ...repo, scan_capability: 'cli_only' } : repo,
          ),
        );
        setSelectedRepo((current) =>
          current && current.id === selectedRepo.id
            ? { ...current, scan_capability: 'cli_only' }
            : current,
        );
        setVerdictRefreshKey((key) => key + 1);

        const persistCapability = async (): Promise<void> => {
          try {
            await clientApi.updateRepositoryScanCapability(selectedRepo.id, 'cli_only');
          } catch (firstError) {
            console.error('Failed to persist cli_only capability (retrying once):', firstError);
            await clientApi.updateRepositoryScanCapability(selectedRepo.id, 'cli_only');
          }
        };

        try {
          await persistCapability();
        } catch (capabilityError) {
          console.error('Failed to persist cli_only capability:', capabilityError);
          const reason =
            capabilityError instanceof ClientApiError && capabilityError.message
              ? capabilityError.message
              : 'capability could not be saved';
          setToast({
            message: `This repository needs a local Full Gate scan. We marked it CLI-only in this session, but could not save that setting (${reason}).`,
            type: 'error',
            autoDismissMs: null,
          });
        }

        setRepoDetailStatus((status) => (status === 'ready' ? status : 'empty'));
      }

      if (process.env.NODE_ENV !== 'production') {
        console.info('[assurly:scan-timing]', {
          repo: selectedRepo?.name,
          treeMs,
          fetchFilesMs,
          engineMs,
          persistMs,
          totalMs: Math.round(performance.now() - scanStartedAt),
          failed: true,
          errorCode,
        });
      }
    }
  };

  const stopScan = (): void => {
    scanControllerRef.current?.abort();
  };

  const startScan = useEffectEvent(() => void triggerScan());

  useEffect(() => {
    if (!autoStartScanRef.current || !selectedRepo || isScanning) return;
    autoStartScanRef.current = false;
    queueMicrotask(startScan);
  }, [isScanning, selectedRepo, scanKickToken]);

  /** Handles toast messages from the ManualChecker component */
  const handleCheckerToast = (message: string, type: 'success' | 'info'): void => {
    setToast({ message, type });
  };

  const scanWorkspaceElement = (
    <ScanWorkspace
      selectedRepo={selectedRepo}
      githubInstallationId={org?.github_installation_id}
      billingPlan={org?.billing_plan}
      selectedRepoScanCount={selectedRepoScanCount}
      canJumpToScanResults={canJumpToScanResults}
      onJumpToResults={() => {
        scrollToScanDetails();
      }}
      isScanning={isScanning}
      onRunScan={() => {
        void triggerScan();
      }}
      onStopScan={stopScan}
      scanError={scanError}
      onDismissScanError={() => {
        setScanError(null);
        setScanLogs([]);
        setEmptyScanAltBranches([]);
      }}
      scanProgress={scanProgress}
      scanLogs={scanLogs}
      scanBranch={scanBranch}
      repoBranches={repoBranches}
      onScanBranchChange={setScanBranch}
      alternateScanBranches={emptyScanAltBranches}
      onScanAlternateBranch={(branch) => {
        void triggerScan(branch);
      }}
      repoDetailStatus={repoDetailStatus}
      displayedScans={displayedScans}
      selectedScan={selectedScan}
      onSelectScan={(scan) => {
        setShareError(null);
        setDeleteScanError(null);
        setSelectedScan(scan);
      }}
      onDeleteScan={handleDeleteScan}
      deleteScanError={deleteScanError}
      shipGateReport={shipGateReport}
      fixSummary={fixSummary}
      displayedFindings={displayedFindings}
      findingsLimit={SAVE_FINDINGS_LIMIT}
      selectedShareUrl={selectedShareUrl}
      selectedBadgeMarkdown={selectedBadgeMarkdown}
      fetchTrend={clientApi.trend}
      initialTrendPoints={initialTrendPoints}
      onShare={
        org && planAllowsShareableReports(org.billing_plan) && !selectedShareUrl
          ? () => void handleShareScan()
          : undefined
      }
      isSharing={sharingScanId === selectedScan?.id}
      shareError={shareError}
      fixingFindingId={fixingFindingId}
      isFindingFixable={isFindingFixable}
      onCreateFixPr={(finding) => void handleCreateFixPr(finding)}
      onCreateBatchFixPr={() => void handleCreateBatchFixPr()}
    />
  );

  if (!user) {
    return <UnauthenticatedDashboard loginUrl={loginUrl} sessionExpired={sessionExpired} />;
  }

  const renderDashboardView = (): React.ReactElement => {
    switch (dashboardView) {
      case 'apps':
        return (
          <DashboardOverview
            header={
              <WorkspaceHeader
                orgName={org?.name}
                ownerLabel={user.name}
                billingPlan={org?.billing_plan}
              />
            }
            apps={
              <VerdictCardsSection
                onOpenRepo={handleOpenVerdict}
                onRemoveUrl={handleRemoveUrlTarget}
                onRemoveRepo={(repositoryId) => void handleRemoveRepo(repositoryId)}
                onRescan={(card) => void handleRescanVerdict(card)}
                removingTargetId={removingTargetId}
                removingRepositoryId={removingRepositoryId}
                rescanningTargetId={rescanningTargetId}
                rescanBlocked={isScanning || Boolean(rescanningTargetId)}
                cards={verdictCards}
                error={verdictCardsError}
              />
            }
            tools={
              <>
                <PublicRepoConnect
                  publicRepoInput={publicRepoInput}
                  isAddingRepo={isAddingRepo}
                  connectError={publicRepoConnectError}
                  onInputChange={(value) => {
                    setPublicRepoInput(value);
                    setPublicRepoConnectError(null);
                  }}
                  onSubmit={(event) => void handleAddPublicRepo(event)}
                />
                <DeployedUrlScanCard scan={urlScan} />
              </>
            }
            urlResults={
              resultsView === 'url' && urlScan.hasActivity ? (
                <DeployedUrlScanResults
                  scan={urlScan}
                  loginUrl={loginUrl}
                  onGuarded={() => setVerdictRefreshKey((key) => key + 1)}
                />
              ) : null
            }
          />
        );
      case 'app':
        return (
          <DashboardAppView
            repositories={repos}
            selectedRepoId={selectedRepo?.id ?? null}
            onBackToApps={() => navigateDashboard({ view: 'apps', repoId: null })}
            onSelectRepository={handleSelectRepo}
            workspace={scanWorkspaceElement}
            canary={
              selectedRepo ? (
                renderCanaryPanel(targetLookup, selectedRepo.id, 'alarm', {
                  hasGitHubInstallation: Boolean(org?.github_installation_id),
                })
              ) : (
                <CanaryTokensNotice ariaLabel="Silent alarm">
                  Select an app to add a silent alarm for it.
                </CanaryTokensNotice>
              )
            }
          />
        );
      case 'settings':
        return (
          <DashboardSettings
            repoList={
              <RepoListPanel
                repositories={repos}
                selectedRepoId={selectedRepo?.id ?? null}
                scanCountsByRepoId={scanCountsByRepoId}
                hasGitHubInstallation={Boolean(org?.github_installation_id)}
                onSelectRepository={handleSelectRepo}
              />
            }
            apiKeys={<ApiKeys />}
            canary={
              selectedRepo ? (
                renderCanaryPanel(targetLookup, selectedRepo.id, 'settings')
              ) : (
                <CanaryTokensNotice>
                  Select a connected repository to manage its canary tokens.
                </CanaryTokensNotice>
              )
            }
          />
        );
      case 'checker':
        return <ManualChecker onToast={handleCheckerToast} />;
      default: {
        const neverView: never = dashboardView;
        throw new Error(`Unhandled dashboard view: ${String(neverView)}`);
      }
    }
  };

  // AUTHORIZED DASHBOARD VIEW
  return (
    <div className="dashboard-page">
      {showSplash ? <DashboardSplash onDone={() => setShowSplash(false)} /> : null}
      {toast ? <DashboardToast toast={toast} onDismiss={() => setToast(null)} /> : null}

      <DashboardHeader
        user={user}
        org={org}
        currencySymbol={currencySymbol}
        billingEnabled={billingEnabled}
        isProfileOpen={isProfileOpen}
        billingAction={billingAction}
        profileRef={profileRef}
        profileMenuRef={profileMenuRef}
        onToggleProfile={(trigger) => {
          rememberProfileTrigger(trigger);
          setIsProfileOpen(!isProfileOpen);
        }}
        onManageBilling={() => {
          setIsProfileOpen(false);
          void handleManageBilling();
        }}
        onCheckout={(plan) => {
          setIsProfileOpen(false);
          void handleCheckout(plan);
        }}
      />

      <main className="dashboard-main">
        <div className="dashboard-main__inner">
          <DashboardNav
            active={navIdForView(dashboardView)}
            onNavigate={handleDashboardNavChange}
          />
          {renderDashboardView()}
        </div>
      </main>

      <SiteFooter variant="compact" />
    </div>
  );
}

export default function DashboardClient({
  initialSession,
  loginUrl,
  initialTrendPoints,
  billingEnabled,
}: DashboardContentProps): React.ReactElement {
  return (
    <Suspense fallback={<div className="dashboard-page__loading">Loading Dashboard...</div>}>
      <DashboardContent
        initialSession={initialSession}
        loginUrl={loginUrl}
        initialTrendPoints={initialTrendPoints}
        billingEnabled={billingEnabled}
      />
    </Suspense>
  );
}
