'use client';

import React, { useState, useEffect, useEffectEvent, useRef, Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { User, Organization, Repository, Scan, ScanFinding } from '../../../utils/dbAdapter';
import {
  scanSqlMigration,
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
  scanStripeWebhookIdempotency,
  scanSupabaseDeepPolicies,
  incompleteScanFinding,
  selectFiles,
  buildScanScope,
  isScannableFile,
  rankFilesByRelevance,
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
  type GitHubRepository,
  type SessionResult,
} from '../../../utils/clientApi';
import { useAccessibleMenu } from '../../../hooks/useAccessibleMenu';
import { dedupeRepositoriesByGithubId } from '../../../utils/repositories';
import { isAutoFixableFinding } from '../../../utils/githubAutoFix';
import { summarizeScanFixes } from '../../../utils/fixSummary';
import { preferPublicScanForRepository, sanitizeGitHubOwner } from '../../../utils/scanProxy';
import { buildShipGateFromScanFindings } from '../../../utils/shipGate';
import { RepoListPanel } from './RepoListPanel';
import { VerdictCardsSection } from './VerdictCardsSection';
import { WorkspaceHeader } from './WorkspaceHeader';
import { DashboardTabs } from './DashboardTabs';
import { PublicRepoConnect } from './PublicRepoConnect';
import { DeployedUrlScan } from './DeployedUrlScan';
import { ScanWorkspace } from './ScanWorkspace';
import { DashboardToast } from './DashboardToast';
import { DashboardHeader } from './DashboardHeader';
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
  shouldClearPublicRepoInputOnTabChange,
  type DashboardMainTab,
  type PublicRepoConnectSession,
} from './publicRepoInputReset';
import { scrollToScanDetails } from '../../../utils/scrollToScanDetails';

type DashboardTab = DashboardMainTab;

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

/**
 * Client-generated (not yet persisted) scans use a `scan-...` id, whereas scans
 * returned by the API use a database UUID. Telling them apart lets the background
 * polling reconcile server state without erasing a freshly computed local scan.
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
 * Extracts a human-readable reason from a failed proxy/public-scan response.
 * Both endpoints return a structured `{ error: { message } }` body; fall back to
 * the status text so the scanner always surfaces an actionable reason instead of
 * an empty "No scans found" state.
 */
async function readProxyErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.clone().json()) as { error?: { message?: unknown } };
    const message = data?.error?.message;
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // Non-JSON body – fall through to a generic, still-actionable description.
  }
  return response.statusText || `Request failed with status ${response.status}.`;
}

interface GitHubTreeNode {
  path: string;
  type: string;
}

interface DashboardContentProps {
  initialSession: SessionResult;
  loginUrl?: string;
}

function DashboardContent({
  initialSession,
  loginUrl = '/api/auth/login',
}: DashboardContentProps): React.ReactElement {
  const searchParams = useSearchParams();

  const [user] = useState<User | null>(initialSession.user);
  const [org] = useState<Organization | null>(initialSession.organization);
  const [repos, setRepos] = useState<Repository[]>(() =>
    dedupeRepositoriesByGithubId(initialSession.repositories),
  );
  const [activeTab, setActiveTab] = useState<DashboardTab>('repositories');
  const [publicRepoInput, setPublicRepoInput] = useState('');
  const [isAddingRepo, setIsAddingRepo] = useState(false);
  const autoStartScanRef = useRef(false);

  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(
    initialSession.repositories[0] ?? null,
  );
  const [scans, setScans] = useState<Scan[]>([]);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const [findings, setFindings] = useState<ScanFinding[]>([]);
  const [repoDetailStatus, setRepoDetailStatus] = useState<RepoDetailStatus>('loading');
  // A scan that finished locally but could not be persisted (e.g. backend
  // misconfiguration). Kept in dedicated state so the 5s polling never wipes it.
  const [localScan, setLocalScan] = useState<Scan | null>(null);
  const [localFindings, setLocalFindings] = useState<ScanFinding[]>([]);
  const [currency] = useState<'USD' | 'EUR'>('USD');
  const currencySymbol = currency === 'USD' ? '$' : '€';
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const { menuRef: profileMenuRef, rememberTrigger: rememberProfileTrigger } =
    useAccessibleMenu<HTMLDivElement>({
      open: isProfileOpen,
      onClose: () => setIsProfileOpen(false),
      trapAt: '(max-width: 768px)',
    });

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  /** Last scan failure for the current repository — shown in-panel until cleared or retried. */
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanCountsByRepoId, setScanCountsByRepoId] = useState<Record<string, number>>({});
  const [shareUrlsByScanId, setShareUrlsByScanId] = useState<Record<string, string>>({});
  const [sharingScanId, setSharingScanId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [lastScanFileCount, setLastScanFileCount] = useState<number | null>(null);
  const [lastScanScope, setLastScanScope] = useState<ScanScope | null>(null);
  const scanAbortRef = useRef<boolean>(false);
  const initialToast = useMemo<ToastNotification | null>(() => {
    const success = searchParams.get('success');
    const cancel = searchParams.get('cancel');
    if (success === 'stripe_upgrade')
      return { message: 'Success! Upgraded to Assurly Pro Plan. 🚀', type: 'success' };
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

  const [isFetchingPublicRepos, setIsFetchingPublicRepos] = useState(false);
  const [discoveredPublicRepos, setDiscoveredPublicRepos] = useState<GitHubRepository[]>([]);
  const publicConnectSessionRef = useRef<PublicRepoConnectSession>(
    INITIAL_PUBLIC_REPO_CONNECT_SESSION,
  );

  const clearPublicRepoConnectUi = (): void => {
    setPublicRepoInput('');
    setDiscoveredPublicRepos([]);
  };

  const handleDashboardTabChange = (nextTab: DashboardTab): void => {
    if (shouldClearPublicRepoInputOnTabChange(activeTab, nextTab)) {
      clearPublicRepoConnectUi();
      publicConnectSessionRef.current = INITIAL_PUBLIC_REPO_CONNECT_SESSION;
    }
    setActiveTab(nextTab);
  };

  const handleSelectRepo = (repo: Repository): void => {
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

    const reset = createRepoSelectionReset();
    setSelectedRepo(repo);
    setSelectedScan(reset.selectedScan);
    setFindings(reset.findings);
    setScans(reset.scans);
    setShareError(reset.shareError);
    setRepoDetailStatus(reset.repoDetailStatus);
    setScanError(null);
    setScanLogs([]);
  };

  // Opening a verdict card drops the user into the existing repo detail/scan flow.
  const handleOpenVerdict = (repositoryId: string): void => {
    const repo = repos.find((candidate) => candidate.id === repositoryId);
    if (!repo) return;
    handleSelectRepo(repo);
    scrollToScanDetails();
  };

  // Verdict cards re-fetch whenever a scan finishes (the target was refreshed
  // server-side during save), so the dashboard verdict reflects the new result.
  const [verdictRefreshKey, setVerdictRefreshKey] = useState(0);
  const wasScanningRef = useRef(false);
  useEffect(() => {
    if (wasScanningRef.current && !isScanning) {
      setVerdictRefreshKey((key) => key + 1);
    }
    wasScanningRef.current = isScanning;
  }, [isScanning]);

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
      } catch (error: unknown) {
        console.error('Failed to import pending repository:', error);
      }
    })();
  }, []);

  // Click outside to close the desktop profile dropdown (mobile uses useAccessibleMenu).
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent): void => {
      if (window.matchMedia('(max-width: 768px)').matches) return;
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

  // Fetch scans when selected repo changes and poll periodically
  useEffect(() => {
    if (!selectedRepo) {
      return;
    }
    const repoId = selectedRepo.id;
    let interval: ReturnType<typeof setInterval> | undefined;
    let sessionExpired = false;

    const stopPolling = (): void => {
      if (interval !== undefined) clearInterval(interval);
      interval = undefined;
    };

    const fetchScans = async (): Promise<void> => {
      if (sessionExpired) return;
      try {
        const { scans: repoScans } = await clientApi.scans(repoId);

        setScans((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(repoScans)) {
            return prev;
          }
          return repoScans;
        });
        setScanCountsByRepoId((prev) =>
          prev[repoId] === repoScans.length ? prev : { ...prev, [repoId]: repoScans.length },
        );

        setSelectedScan((prev) => {
          // Keep an unsaved local selection alive, but only while it belongs to the
          // repo currently in view; otherwise fall back to the newest server scan.
          if (prev && isLocalScanId(prev.id)) {
            return prev.repository_id === repoId ? prev : (repoScans[0] ?? null);
          }
          if (repoScans.length === 0) {
            return prev?.repository_id === repoId ? prev : null;
          }
          if (!prev) return repoScans[0];
          const stillExists = repoScans.some((s) => s.id === prev.id);
          return stillExists ? prev : repoScans[0];
        });

        setRepoDetailStatus((current) => {
          if (current !== 'loading') {
            return current;
          }
          return resolveRepoDetailStatusAfterScans(
            repoScans.length,
            Boolean(localScan && localScan.repository_id === repoId),
          );
        });
      } catch (e) {
        // Polling cannot recover a dead session — it would just retry every 5s
        // forever. Stop, and tell the user the one thing that fixes it.
        if (e instanceof ClientApiError && e.status === 401) {
          sessionExpired = true;
          stopPolling();
          setScanError('Your session expired. Sign in again to continue.');
          setRepoDetailStatus((current) => (current === 'loading' ? 'empty' : current));
          return;
        }
        console.error(e);
        setRepoDetailStatus((current) => (current === 'loading' ? 'empty' : current));
      }
    };

    fetchScans();

    interval = setInterval(() => {
      // Don't poll /api/scans while the tab is in the background — a hidden or
      // forgotten dashboard tab should not keep hitting the database every 5s.
      // Returning to the tab triggers an immediate refresh via the listener below.
      if (document.visibilityState === 'hidden') return;
      fetchScans();
    }, 5000);

    const refreshWhenVisible = (): void => {
      if (document.visibilityState === 'visible') void fetchScans();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [selectedRepo, localScan]);

  // Prefetch scan counts for every connected repository so the sidebar can surface
  // history without requiring the user to open each repo first.
  useEffect(() => {
    if (repos.length === 0) return;

    let cancelled = false;
    void Promise.all(
      repos.map(async (repo) => {
        try {
          const { scans: repoScans } = await clientApi.scans(repo.id);
          return [repo.id, repoScans.length] as const;
        } catch {
          return [repo.id, 0] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setScanCountsByRepoId(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [repos]);

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
  const displayedScans = useMemo<Scan[]>(
    () =>
      localScanForRepo
        ? [localScanForRepo, ...scans.filter((s) => s.id !== localScanForRepo.id)]
        : scans,
    [localScanForRepo, scans],
  );

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
    if (displayedFindings.length === 0) {
      return buildShipGateFromScanFindings([], { scannedFileCount: 1, cleanFileCount: 1 });
    }

    const affectedPaths = new Set(displayedFindings.map((finding) => finding.file_path));
    const scannedFileCount = lastScanFileCount ?? Math.max(affectedPaths.size, 1);
    return buildShipGateFromScanFindings(displayedFindings, {
      scannedFileCount,
      cleanFileCount: Math.max(0, scannedFileCount - affectedPaths.size),
      scanScope: lastScanScope ?? undefined,
    });
  }, [displayedFindings, selectedScan, lastScanFileCount, lastScanScope]);

  const selectedRepoScanCount = useMemo(() => {
    if (!selectedRepo) {
      return 0;
    }
    return Math.max(scanCountsByRepoId[selectedRepo.id] ?? 0, displayedScans.length);
  }, [selectedRepo, scanCountsByRepoId, displayedScans.length]);

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
    if (!selectedScan || org?.billing_plan !== 'pro') return;
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

  const handleAddPublicRepo = async (
    e?: React.FormEvent,
    forcedRepoName?: string,
  ): Promise<void> => {
    if (e) e.preventDefault();
    const inputVal = forcedRepoName || publicRepoInput;
    if (!inputVal.trim() || isAddingRepo || isFetchingPublicRepos) return;

    let repoName = inputVal.trim();
    if (repoName.includes('github.com/')) {
      repoName = repoName.split('github.com/')[1];
    }
    repoName = repoName.replace(/\/$/, '');

    const containsSlash = repoName.includes('/');
    if (!containsSlash) {
      const owner = sanitizeGitHubOwner(repoName);
      if (!owner) {
        setToast({ message: 'Enter a valid GitHub username or organization.', type: 'error' });
        return;
      }
      setDiscoveredPublicRepos([]);
      setIsFetchingPublicRepos(true);
      setToast({ message: `Fetching repositories for "${owner}"...`, type: 'info' });

      try {
        const repositories = await githubApi.repositories(owner);
        if (repositories.length === 0) {
          throw new Error('No public repositories found for this user/organization.');
        }
        setDiscoveredPublicRepos(repositories);
        setToast(null);
      } catch (error: unknown) {
        setToast({
          message: error instanceof Error ? error.message : 'Failed to fetch repositories.',
          type: 'error',
        });
      } finally {
        setIsFetchingPublicRepos(false);
      }
      return;
    }

    const parts = repoName.split('/');
    const owner = parts[parts.length - 2];
    const repo = parts[parts.length - 1];
    const repoFullName = `${owner}/${repo}`;

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
      autoStartScanRef.current = true;
      setToast({
        message: `Repository "${repoFullName}" connected successfully!`,
        type: 'success',
      });
    } catch (error: unknown) {
      setToast({
        message: error instanceof Error ? error.message : 'Failed to connect public repository.',
        type: 'error',
      });
    } finally {
      setIsAddingRepo(false);
    }
  };

  /**
   * Triggers a real scan using the browserScanner engine.
   * Fetches files from GitHub API and runs all scanner rules against them.
   */
  const triggerScan = async (): Promise<void> => {
    if (!selectedRepo || !org) return;

    setIsScanning(true);
    setScanProgress(0);
    setScanError(null);
    setScanLogs([
      '⚙ Initializing Assurly Scanner...',
      `📥 Fetching repository tree for "${selectedRepo.name}"...`,
    ]);
    scanAbortRef.current = false;

    const allFindings: WebFinding[] = [];

    try {
      // Resolve the canonical "owner/repo" used by the public-scan proxy and the
      // scan logs. Repositories connected via the GitHub App may be stored as a
      // bare name, so prefix the workspace owner when no slash is present.
      let repoFullName = selectedRepo.name;
      if (!repoFullName.includes('/')) {
        repoFullName = `${org.name}/${selectedRepo.name}`;
      }

      // Authenticated installations use the private proxy for repos the app owns.
      // Third-party public repos (e.g. yablko/PHPAuth) skip straight to public-scan
      // so we avoid a noisy 404 from the installation-scoped proxy.
      let usePrivateProxy =
        Boolean(org?.github_installation_id) && !preferPublicScanForRepository(repoFullName, repos);

      let defaultBranch = 'main';

      // Do not specify a branch for the tree request; let the proxy resolve the
      // default branch dynamically (it may differ from "main").
      const treeRequestUrl = (): string =>
        usePrivateProxy
          ? `/api/github/proxy?repoId=${selectedRepo.id}&type=tree`
          : `/api/github/public-scan?repo=${encodeURIComponent(repoFullName)}&type=tree`;

      const fetchFileContent = async (filePath: string): Promise<Response> => {
        if (usePrivateProxy) {
          return fetch(
            `/api/github/proxy?repoId=${selectedRepo.id}&type=file&branch=${encodeURIComponent(
              defaultBranch,
            )}&path=${encodeURIComponent(filePath)}`,
          );
        }
        return fetch(
          `/api/github/public-scan?repo=${encodeURIComponent(repoFullName)}&branch=${encodeURIComponent(
            defaultBranch,
          )}&type=file&path=${encodeURIComponent(filePath)}`,
        );
      };

      // File contents are fetched once and memoised. Several scanner passes
      // below (SQL, Stripe, env, RSC/cold-start) inspect overlapping file sets,
      // and fetching each file serially per pass turned a large repository into
      // minutes of latency — every code file was even fetched twice. A single
      // bounded-concurrency prefetch keeps every unique file to one round trip
      // and lets the passes read from memory.
      const contentCache = new Map<string, string | null>();

      const loadFileContent = async (filePath: string): Promise<string | null> => {
        const cached = contentCache.get(filePath);
        if (cached !== undefined) return cached;
        let text: string | null = null;
        try {
          const res = await fetchFileContent(filePath);
          text = res.ok ? await res.text() : null;
        } catch {
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
        } catch {
          // Fall through to per-file fetching below.
        }

        // Batch failed (e.g. transient error): fall back to serial per-file
        // fetching, which respects the proxy rate limit and still completes.
        for (const path of pending) {
          if (scanAbortRef.current) break;
          await loadFileContent(path);
        }
      };

      let treeResponse = await fetch(treeRequestUrl());

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
        treeResponse = await fetch(treeRequestUrl());
      }

      if (!treeResponse.ok) {
        throw new Error(
          `Failed to fetch repository tree: ${await readProxyErrorMessage(treeResponse)}`,
        );
      }

      const treeData = await treeResponse.json();
      if (treeData.default_branch) {
        defaultBranch = treeData.default_branch;
      }
      const resolvedCommitSha: string | undefined =
        typeof treeData.commit_sha === 'string' && treeData.commit_sha.length > 0
          ? treeData.commit_sha
          : undefined;
      const tree: GitHubTreeNode[] = treeData.tree || [];

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

      for (const node of tree) {
        if (node.type !== 'blob') continue;
        if (!isScannableFile(node.path)) continue;
        const pathLower = node.path.toLowerCase();

        if (pathLower.endsWith('.sql')) {
          sqlFiles.push(node.path);
        } else if (
          pathLower.endsWith('.env.example') ||
          pathLower === '.env' ||
          pathLower.endsWith('.env.local')
        ) {
          envFiles.push(node.path);
        } else if (/\.(js|ts|jsx|tsx)$/.test(pathLower)) {
          codeFiles.push(node.path);
        }
      }

      const rankedCandidates = rankFilesByRelevance(
        [...new Set([...sqlFiles, ...codeFiles])],
        (path) => path,
      );
      const fileSelection = selectFiles(rankedCandidates, 250);
      setLastScanFileCount(fileSelection.files.length);
      setLastScanScope(
        buildScanScope([...new Set([...sqlFiles, ...codeFiles])], fileSelection.files),
      );
      const selectedFiles = new Set(fileSelection.files);
      const incompleteFinding = incompleteScanFinding(fileSelection);
      if (incompleteFinding) allFindings.push(incompleteFinding);

      // Detect stack from package.json
      const hasPackageJson = tree.some((node) => node.path === 'package.json');
      let detectedFramework = 'Unknown';
      let hasSupabase = false;
      let hasStripe = false;
      let packageJsonText: string | null = null;

      if (hasPackageJson) {
        try {
          const pkgRes = await fetchFileContent('package.json');
          if (pkgRes.ok) {
            packageJsonText = await pkgRes.text();
            const pkgData = JSON.parse(packageJsonText);
            const allDeps = {
              ...(pkgData.dependencies || {}),
              ...(pkgData.devDependencies || {}),
            };
            if (allDeps['next']) detectedFramework = 'Next.js';
            if (allDeps['@supabase/supabase-js'] || allDeps['@supabase/ssr']) hasSupabase = true;
            if (allDeps['stripe'] || allDeps['@stripe/stripe-js']) hasStripe = true;
          }
        } catch {
          // Ignore package.json read failures
        }
      }

      // Which AI builder produced this app — recorded on the target to seed the
      // corpus moat (Phase 1). Derived from the repo tree + package.json.
      const generatorFingerprint = detectGeneratorFingerprint({
        filePaths: tree.map((node) => node.path),
        packageJson: packageJsonText,
      });

      setScanProgress(30);
      setScanLogs((prev) => [
        ...prev,
        `✓ Framework: ${detectedFramework}`,
        `✓ Supabase: ${hasSupabase ? 'Detected' : 'Not Detected'}`,
        `✓ Stripe: ${hasStripe ? 'Detected' : 'Not Detected'}`,
        '🛡 Running static analysis scanner rules...',
      ]);

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
        ...new Set([...sqlToScan, ...codeToScan, ...envExamplePaths, ...workflowPaths]),
      ];
      setScanLogs((prev) => [...prev, `📥 Fetching ${filesToFetch.length} file(s) in parallel...`]);
      await prefetchContents(filesToFetch);
      setScanProgress(45);

      // Scan SQL Migrations
      for (const sqlPath of sqlToScan) {
        if (scanAbortRef.current) break;
        const content = await loadFileContent(sqlPath);
        if (content === null) continue;
        const scan = scanSqlMigration(content, sqlPath);
        allFindings.push(...scan.findings);
        // Phase 3: deeper Supabase policy quality (permissive RLS, public
        // storage defaults, auth-linked tables without RLS).
        allFindings.push(...scanSupabaseDeepPolicies([{ file: sqlPath, content }]).findings);
        setScanLogs((prev) => [
          ...prev,
          `  ✓ Scanned ${sqlPath}: ${scan.errorCount} errors, ${scan.warningCount} warnings.`,
        ]);
      }

      setScanProgress(50);

      // Scan Stripe Webhooks
      for (const webhookPath of stripeToScan) {
        if (scanAbortRef.current) break;
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
      for (const codePath of codeToScan) {
        if (scanAbortRef.current) break;
        const content = await loadFileContent(codePath);
        if (content === null) continue;

        allFindings.push(...scanEdgeRuntime(content, codePath).findings);

        // Phase 3: deeper-stack per-file scanners (edge runtime is already
        // handled above; maxDuration + auth boundaries + Stripe lifecycle).
        allFindings.push(...scanMaxDuration(content, codePath).findings);
        allFindings.push(...scanServerActionAuth(content, codePath).findings);
        allFindings.push(...scanRouteHandlerAuth(content, codePath).findings);
        allFindings.push(...scanServiceRoleBypass(content, codePath).findings);
        allFindings.push(...scanStripeWebhookIdempotency(content, codePath).findings);
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
          message: 'GitHub Actions workflow for Assurly is missing.',
          suggestion:
            'Run "npx assurly init" in your repository to automatically configure the CI/CD pipeline.',
        });
      }

      setScanProgress(100);
      setScanLogs((prev) => [...prev, '🏁 Scan finished. Generating report.']);

      const errorCount = allFindings.filter((f) => f.severity === 'error').length;
      const warningCount = allFindings.filter((f) => f.severity === 'warning').length;

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

      (async () => {
        try {
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
          });

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

          // Adopt the server identity (so polling dedup and auto-fix target the
          // database scan) while overriding the counts with the true totals.
          const sessionScan: Scan = {
            ...savedScan,
            error_count: errorCount,
            warning_count: warningCount,
          };

          setIsScanning(false);
          setScans((prev) => [savedScan, ...prev.filter((s) => s.id !== savedScan.id)]);
          setScanCountsByRepoId((prev) => ({
            ...prev,
            [selectedRepo.id]: (prev[selectedRepo.id] ?? 0) + 1,
          }));
          setLocalScan(sessionScan);
          setLocalFindings(sessionFindings);
          setSelectedScan(sessionScan);
          setRepoDetailStatus('ready');
          setToast({
            message: `Scan completed & saved: ${errorCount} errors, ${warningCount} warnings found.`,
            type: errorCount > 0 ? 'error' : 'success',
          });
        } catch (e) {
          // Persistence failed (commonly a missing APP_URL / Supabase env var or an
          // origin mismatch on the CSRF check). Keep the result visible via the local
          // scan state — immune to the polling refresh — and tell the user honestly
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
      })();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to scan repository.';
      setScanLogs((prev) => [...prev, `❌ ERROR: ${errorMessage}`]);
      setScanError(errorMessage);
      setIsScanning(false);
      setToast({
        message: `Scan failed: ${errorMessage}`,
        type: 'error',
        autoDismissMs: null,
      });
    }
  };

  const startScan = useEffectEvent(() => void triggerScan());

  useEffect(() => {
    if (!autoStartScanRef.current || !selectedRepo || isScanning) return;
    autoStartScanRef.current = false;
    queueMicrotask(startScan);
  }, [isScanning, selectedRepo]);

  /** Handles toast messages from the ManualChecker component */
  const handleCheckerToast = (message: string, type: 'success' | 'info'): void => {
    setToast({ message, type });
  };

  if (!user) return <UnauthenticatedDashboard loginUrl={loginUrl} />;

  // AUTHORIZED DASHBOARD VIEW
  return (
    <div className="dashboard-page">
      {toast ? <DashboardToast toast={toast} onDismiss={() => setToast(null)} /> : null}

      <DashboardHeader
        user={user}
        org={org}
        currencySymbol={currencySymbol}
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
        <WorkspaceHeader orgName={org?.name} billingPlan={org?.billing_plan} />
        <DashboardTabs activeTab={activeTab} onTabChange={handleDashboardTabChange} />

        {activeTab === 'repositories' ? (
          <>
            <VerdictCardsSection onOpenRepo={handleOpenVerdict} refreshKey={verdictRefreshKey} />
            <div className="dashboard-grid">
              <div className="dashboard-repo-column">
                <RepoListPanel
                  repositories={repos}
                  selectedRepoId={selectedRepo?.id ?? null}
                  scanCountsByRepoId={scanCountsByRepoId}
                  hasGitHubInstallation={Boolean(org?.github_installation_id)}
                  onSelectRepository={handleSelectRepo}
                />

                <PublicRepoConnect
                  publicRepoInput={publicRepoInput}
                  isAddingRepo={isAddingRepo}
                  isFetchingPublicRepos={isFetchingPublicRepos}
                  discoveredPublicRepos={discoveredPublicRepos}
                  onInputChange={setPublicRepoInput}
                  onSubmit={(event) => void handleAddPublicRepo(event)}
                  onClearDiscovered={() => setDiscoveredPublicRepos([])}
                  onSelectDiscoveredRepo={(fullName) => {
                    setPublicRepoInput(fullName);
                    setDiscoveredPublicRepos([]);
                    void handleAddPublicRepo(undefined, fullName);
                  }}
                />

                <DeployedUrlScan loginUrl={loginUrl} />
              </div>

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
                onRunScan={triggerScan}
                scanError={scanError}
                onDismissScanError={() => {
                  setScanError(null);
                  setScanLogs([]);
                }}
                scanProgress={scanProgress}
                scanLogs={scanLogs}
                repoDetailStatus={repoDetailStatus}
                displayedScans={displayedScans}
                selectedScan={selectedScan}
                onSelectScan={(scan) => {
                  setShareError(null);
                  setSelectedScan(scan);
                }}
                shipGateReport={shipGateReport}
                fixSummary={fixSummary}
                displayedFindings={displayedFindings}
                findingsLimit={SAVE_FINDINGS_LIMIT}
                selectedShareUrl={selectedShareUrl}
                selectedBadgeMarkdown={selectedBadgeMarkdown}
                fetchTrend={clientApi.trend}
                onShare={
                  org?.billing_plan === 'pro' && !selectedShareUrl
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
            </div>
          </>
        ) : (
          <ManualChecker onToast={handleCheckerToast} />
        )}
      </main>
    </div>
  );
}

export default function DashboardClient({
  initialSession,
  loginUrl,
}: DashboardContentProps): React.ReactElement {
  return (
    <Suspense fallback={<div className="dashboard-page__loading">Loading Dashboard...</div>}>
      <DashboardContent initialSession={initialSession} loginUrl={loginUrl} />
    </Suspense>
  );
}
