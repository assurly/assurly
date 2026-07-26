'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  scanSqlMigration,
  scanStripeWebhook,
  scanSupabaseClientLeaks,
  scanEnvVariables,
  scanRscDataLeaks,
  scanColdStart,
  scanEdgeRuntime,
  scanAgentStack,
  incompleteScanFinding,
  isAgentStackFile,
  selectFiles,
  type WebFinding,
} from '../../../utils/browserScanner';
import { clientApi, githubApi, type GitHubRepository } from '../../../utils/clientApi';
import { sanitizeGitHubOwner } from '../../../utils/scanProxy';
import { isLikelyScannableUrl } from '../../../utils/urlValidation';
import {
  CONTACT_SUBJECTS,
  DEFAULT_CONTACT_SUBJECT,
  type ContactSubject,
} from '../../../utils/contactSubjects';
import { ShipGatePanel } from '../ship-gate/ShipGatePanel';
import { buildShipGateFromWebFindings, type ShipGateReport } from '../../../utils/shipGate';
import { ProofEvidence, type ProofEvidenceItem } from '../../dashboard/_components/ProofEvidence';
import { SiteFooter } from '../SiteFooter';
import { AuthButton } from './AuthButton';
import { CurrencyToggle } from './CurrencyToggle';
import { HomeHeader } from './HomeHeader';
import {
  HomeCheckIcon,
  HomeClockIcon,
  HomeCopyIcon,
  HomeCreditCardIcon,
  HomeDatabaseZapIcon,
  HomeFeatherIcon,
  HomeFolderIcon,
  HomeLayersIcon,
  HomeLightbulbIcon,
  HomeLockIcon,
  HomeMailIcon,
  HomeMonitorCheckIcon,
  HomeSearchIcon,
  HomeShieldCheckIcon,
  HomeStarIcon,
  HomeTimerIcon,
  HomeWrenchIcon,
  HomeXIcon,
} from './HomeIcons';
import { ProofPoints } from './ProofPoints';

interface HomeClientProps {
  initialAuthenticated: boolean;
  loginUrl?: string;
  /** Preselected contact subject, resolved server-side from `?subject=`. */
  initialContactSubject?: ContactSubject;
}

async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as {
      error?: string | { message?: string };
    };
    if (typeof data.error === 'string' && data.error.length > 0) {
      return data.error;
    }
    if (data.error && typeof data.error === 'object' && data.error.message) {
      return data.error.message;
    }
  } catch {
    // Keep the fallback when the body is not JSON.
  }
  return fallback;
}

function isRateLimitMessage(message: string): boolean {
  return message.toLowerCase().includes('rate limit');
}

export default function HomeClient({
  initialAuthenticated,
  loginUrl = '/api/auth/login',
  initialContactSubject = DEFAULT_CONTACT_SUBJECT,
}: HomeClientProps): React.ReactElement {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isAuthenticated = initialAuthenticated;
  const [copied, setCopied] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  // Contact form state
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactSubject, setContactSubject] = useState<ContactSubject>(initialContactSubject);
  const [contactMessage, setContactMessage] = useState('');
  const [isSubmittingContact, setIsSubmittingContact] = useState(false);
  const [contactFeedback, setContactFeedback] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const contactTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (contactTimeoutRef.current) {
        clearTimeout(contactTimeoutRef.current);
      }
    };
  }, []);

  /**
   * Re-apply hash scrolling after mount.
   *
   * The browser resolves `#contact` before this client page has rendered its
   * sections, so a direct load of `/#contact` — the link the Privacy Policy uses
   * for data-subject requests — silently lands at the top of the page instead of
   * the form. Scrolling again once the sections exist fixes every cross-page
   * anchor (`#features`, `#pricing`, `#contact`), not just this one.
   */
  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    if (!targetId) return;

    let cancelled = false;
    // Instant, not smooth: this is a deep link, so the visitor should arrive at the
    // section the way native hash navigation would. A smooth animation across
    // several thousand pixels is also easily interrupted by layout shifts below.
    const jumpToTarget = () => {
      if (cancelled) return;
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'auto', block: 'start' });
    };

    // First pass after paint; a second pass once late content (images, deferred
    // sections) has settled, so the target does not drift out from under us.
    const frame = requestAnimationFrame(jumpToTarget);
    const settle = setTimeout(jumpToTarget, 400);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, []);

  // Interactive Public Scanner State
  const [repoInput, setRepoInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanFinished, setScanFinished] = useState(false);
  const [scanResults, setScanResults] = useState<{
    errorCount: number;
    warningCount: number;
    score: number;
    repoName: string;
    shipGate: ShipGateReport;
  } | null>(null);

  const [urlInput, setUrlInput] = useState('');
  const [isUrlScanning, setIsUrlScanning] = useState(false);
  const [urlScanError, setUrlScanError] = useState<string | null>(null);
  const [urlScanFinished, setUrlScanFinished] = useState(false);
  const [urlScanResults, setUrlScanResults] = useState<{
    targetUrl: string;
    errorCount: number;
    warningCount: number;
    shipGate: ShipGateReport;
    evidence: ProofEvidenceItem[];
  } | null>(null);

  const [isFetchingRepos, setIsFetchingRepos] = useState(false);
  const [publicReposList, setPublicReposList] = useState<GitHubRepository[]>([]);
  const [ownerSearched, setOwnerSearched] = useState('');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [hoursSaved, setHoursSaved] = useState<number>(8);
  const [hourlyRate, setHourlyRate] = useState<number>(60);
  const [currency, setCurrency] = useState<'USD' | 'EUR'>('USD');

  const currencySymbol = currency === 'USD' ? '$' : '€';

  // `guard*` keys are the Pro (per-app) subscription price — the ROI calculator
  // below reads them. The OEM/platform tier is usage/seat based and quoted via
  // sales, so it has no fixed number here.
  const prices = {
    USD: {
      free: 0,
      guardMonthly: 19,
      guardYearly: 149,
      guardMonthlyEquiv: 12.4,
    },
    EUR: {
      free: 0,
      guardMonthly: 17,
      guardYearly: 130,
      guardMonthlyEquiv: 10.8,
    },
  }[currency];

  const renderCurrencyToggle = (): React.ReactElement => (
    <CurrencyToggle currency={currency} onChange={setCurrency} />
  );

  /**
   * Computes an inline background style for a range slider that renders a
   * two-tone gradient fill tracking the current thumb position.
   *
   * WebKit browsers (Chrome, Safari, Edge) use the element's own background as
   * the track visual when appearance is stripped. Firefox handles the fill via
   * ::-moz-range-progress automatically — the inline style has no effect there.
   */
  const computeSliderBackground = (
    value: number,
    min: number,
    max: number,
  ): React.CSSProperties => {
    const pct = Math.round(((value - min) / (max - min)) * 100);
    return {
      background: `linear-gradient(to right, var(--accent-color) ${pct}%, var(--color-border) ${pct}%) center / 100% 6px no-repeat`,
    };
  };

  const handleUnlockReport = (): void => {
    if (!repoInput.trim()) return;
    let repoName = repoInput.trim();
    if (repoName.includes('github.com/')) {
      repoName = repoName.split('github.com/')[1];
    }
    repoName = repoName.replace(/\/$/, '');
    localStorage.setItem('last_scanned_public_repo', repoName);
    window.location.href = '/api/auth/login';
  };

  const handleUnlockUrlReport = (): void => {
    if (!urlInput.trim()) return;
    localStorage.setItem('last_scanned_deployed_url', urlInput.trim());
    window.location.href = '/api/auth/login';
  };

  const handleStartUrlScan = async (): Promise<void> => {
    const trimmed = urlInput.trim();
    if (!isLikelyScannableUrl(trimmed) || isUrlScanning) return;

    setIsUrlScanning(true);
    setUrlScanFinished(false);
    setUrlScanError(null);
    setUrlScanResults(null);

    try {
      const response = await fetch('/api/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });

      if (!response.ok) {
        let message = 'URL scan failed. Please verify the URL and try again.';
        try {
          const data = (await response.json()) as { error?: { message?: string } };
          if (data.error?.message) message = data.error.message;
        } catch {
          // Keep the default message.
        }
        throw new Error(message);
      }

      const data = (await response.json()) as {
        report: ShipGateReport;
        findings: Array<{ severity: 'error' | 'warning' }>;
        evidence?: ProofEvidenceItem[];
      };

      const errorCount = data.findings.filter((finding) => finding.severity === 'error').length;
      const warningCount = data.findings.filter((finding) => finding.severity === 'warning').length;

      setUrlScanResults({
        targetUrl: trimmed,
        errorCount,
        warningCount,
        shipGate: data.report,
        evidence: data.evidence ?? [],
      });
      setUrlScanFinished(true);
    } catch (error: unknown) {
      setUrlScanError(error instanceof Error ? error.message : 'URL scan failed.');
    } finally {
      setIsUrlScanning(false);
    }
  };

  const handleStartScan = async (forcedRepoName?: string): Promise<void> => {
    const inputVal = forcedRepoName || repoInput;
    if (!inputVal.trim()) return;

    let repoName = inputVal.trim();
    if (repoName.includes('github.com/')) {
      repoName = repoName.split('github.com/')[1];
    }
    repoName = repoName.replace(/\/$/, '');

    // Check if it's only a username/organization
    const containsSlash = repoName.includes('/');
    if (!containsSlash) {
      // Clear previous scan results/errors
      setScanResults(null);
      setScanFinished(false);
      setScanError(null);
      setScanLogs([]);
      setPublicReposList([]);
      setIsFetchingRepos(true);
      const owner = sanitizeGitHubOwner(repoName);
      if (!owner) {
        setScanError('Enter a valid GitHub username or organization.');
        setIsFetchingRepos(false);
        return;
      }
      setOwnerSearched(owner);

      try {
        const repositories = await githubApi.repositories(owner);
        if (repositories.length === 0) {
          throw new Error('No public repositories found for this user/organization.');
        }
        setPublicReposList(repositories);
      } catch (error: unknown) {
        setScanError(error instanceof Error ? error.message : 'Failed to fetch repositories.');
      } finally {
        setIsFetchingRepos(false);
      }
      return;
    }

    const parts = repoName.split('/');
    const owner = parts[parts.length - 2];
    const repo = parts[parts.length - 1];
    const repoFullName = `${owner}/${repo}`;

    setIsScanning(true);
    setScanFinished(false);
    setScanError(null);
    setScanProgress(0);
    setScanLogs([
      'Initializing Assurly Scanner...',
      `Fetching repository tree for "${repoFullName}"...`,
    ]);

    const allFindings: { severity: 'error' | 'warning'; file: string; message: string }[] = [];

    try {
      // Fetch Git Tree from our server-side proxy which resolves default branch and handles auth
      const treeResponse = await fetch(
        `/api/github/public-scan?repo=${encodeURIComponent(repoFullName)}&type=tree`,
      );

      if (!treeResponse.ok) {
        if (treeResponse.status === 429) {
          throw new Error(
            await readApiErrorMessage(
              treeResponse,
              'GitHub API rate limit exceeded. Sign in with GitHub to scan more repositories.',
            ),
          );
        }
        if (treeResponse.status === 404) {
          throw new Error(
            'Repository not found. Please verify it is a PUBLIC repository and formatted as "owner/repo".',
          );
        }
        if (treeResponse.status === 403) {
          const message = await readApiErrorMessage(
            treeResponse,
            'This repository is private. Assurly can only scan public repositories.',
          );
          throw new Error(message);
        }
        throw new Error(
          await readApiErrorMessage(
            treeResponse,
            'GitHub is temporarily unavailable. Please try again later.',
          ),
        );
      }

      const treeData = await treeResponse.json();
      const defaultBranch = treeData.default_branch || 'main';
      const tree: { path: string; type: string }[] = treeData.tree || [];

      setScanProgress(15);
      setScanLogs((prev) => [
        ...prev,
        `Found ${tree.length} files in repository.`,
        'Detecting stack and analyzing project structure...',
      ]);

      const fetchFileContent = async (filePath: string): Promise<Response> => {
        const response = await fetch(
          `/api/github/public-scan?repo=${encodeURIComponent(repoFullName)}&branch=${encodeURIComponent(
            defaultBranch,
          )}&type=file&path=${encodeURIComponent(filePath)}`,
        );
        if (response.status === 429) {
          throw new Error(
            await readApiErrorMessage(
              response,
              'GitHub API rate limit exceeded. Sign in with GitHub to scan more repositories.',
            ),
          );
        }
        return response;
      };

      const sqlFiles: string[] = [];
      const envFiles: string[] = [];
      const codeFiles: string[] = [];
      const agentFiles: string[] = [];

      for (const node of tree) {
        if (node.type !== 'blob') continue;
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
        } else if (/\.(js|ts|jsx|tsx)$/.test(pathLower)) {
          if (
            !node.path.includes('node_modules') &&
            !node.path.includes('.next') &&
            !node.path.startsWith('dist/') &&
            !node.path.startsWith('build/')
          ) {
            codeFiles.push(node.path);
          }
        }
      }

      const fileSelection = selectFiles([...new Set([...sqlFiles, ...codeFiles])], 100);
      const selectedFiles = new Set(fileSelection.files);
      const incompleteFinding = incompleteScanFinding(fileSelection);
      if (incompleteFinding) {
        allFindings.push({
          severity: incompleteFinding.severity,
          file: 'Repository scan',
          message: incompleteFinding.message,
        });
      }

      const hasPackageJson = tree.some((node) => node.path === 'package.json');
      let detectedFramework = 'Unknown';
      let hasSupabase = false;
      let hasStripe = false;

      if (hasPackageJson) {
        try {
          const pkgRes = await fetchFileContent('package.json');
          if (pkgRes.ok) {
            const pkgData = (await pkgRes.ok) ? await pkgRes.json() : {};
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

      setScanProgress(30);
      setScanLogs((prev) => [
        ...prev,
        `Framework: ${detectedFramework}`,
        `Supabase: ${hasSupabase ? 'Detected' : 'Not Detected'}`,
        `Stripe: ${hasStripe ? 'Detected' : 'Not Detected'}`,
        'Running Ship Gate checks...',
      ]);

      const sqlToScan = sqlFiles.filter((path) => selectedFiles.has(path));
      for (const sqlPath of sqlToScan) {
        setScanLogs((prev) => [...prev, `Reading ${sqlPath}...`]);
        try {
          const res = await fetchFileContent(sqlPath);
          if (res.ok) {
            const content = await res.text();
            const scan = scanSqlMigration(content, sqlPath);
            allFindings.push(
              ...scan.findings.map((f) => ({
                severity: f.severity as 'error' | 'warning',
                file: sqlPath,
                message: f.message,
              })),
            );
            setScanLogs((prev) => [
              ...prev,
              `  Scanned ${sqlPath}: ${scan.errorCount} errors, ${scan.warningCount} warnings.`,
            ]);
          }
        } catch {
          // Continue scanning other files
        }
      }

      setScanProgress(55);

      const stripeToScan = codeFiles
        .filter((p) => p.toLowerCase().includes('stripe') || p.toLowerCase().includes('webhook'))
        .filter((path) => selectedFiles.has(path));
      for (const webhookPath of stripeToScan) {
        setScanLogs((prev) => [...prev, `Reading ${webhookPath}...`]);
        try {
          const res = await fetchFileContent(webhookPath);
          if (res.ok) {
            const content = await res.text();
            const scan = scanStripeWebhook(content, webhookPath);
            allFindings.push(
              ...scan.findings.map((f) => ({
                severity: f.severity as 'error' | 'warning',
                file: webhookPath,
                message: f.message,
              })),
            );
            setScanLogs((prev) => [
              ...prev,
              `  Scanned ${webhookPath}: ${scan.errorCount} errors.`,
            ]);
          }
        } catch {
          // Continue scanning
        }
      }

      setScanProgress(70);

      const envExamplePath = envFiles.find((p) => p.endsWith('.env.example')) || envFiles[0];
      if (envExamplePath) {
        setScanLogs((prev) => [...prev, `Reading env configuration from ${envExamplePath}...`]);
        try {
          const envRes = await fetchFileContent(envExamplePath);
          if (envRes.ok) {
            const envContent = await envRes.text();
            let concatenatedCode = '';
            const codeToScan = codeFiles.filter((path) => selectedFiles.has(path));
            for (const codePath of codeToScan) {
              try {
                const codeRes = await fetchFileContent(codePath);
                if (codeRes.ok) {
                  concatenatedCode += `\n// --- File: ${codePath} ---\n` + (await codeRes.text());
                }
              } catch {
                // Skip unreadable files
              }
            }

            const scan = scanEnvVariables(
              envContent,
              concatenatedCode,
              envExamplePath,
              'Repository Codebase',
            );
            allFindings.push(
              ...scan.findings.map((f) => ({
                severity: f.severity as 'error' | 'warning',
                file: envExamplePath,
                message: f.message,
              })),
            );
            setScanLogs((prev) => [...prev, `  Checked env variables: ${scan.errorCount} errors.`]);
          }
        } catch {
          // Continue scanning
        }
      }

      setScanProgress(85);

      for (const codePath of codeFiles.filter((path) => selectedFiles.has(path))) {
        try {
          const res = await fetchFileContent(codePath);
          if (res.ok) {
            const content = await res.text();

            const edgeScan = scanEdgeRuntime(content, codePath);
            allFindings.push(
              ...edgeScan.findings.map((finding) => ({
                severity: finding.severity,
                file: codePath,
                message: finding.message,
              })),
            );

            const rscScan = scanRscDataLeaks(content, codePath);
            if (rscScan.findings.length > 0) {
              allFindings.push(
                ...rscScan.findings.map((f) => ({
                  severity: f.severity as 'error' | 'warning',
                  file: codePath,
                  message: f.message,
                })),
              );
            }

            const supabaseScan = scanSupabaseClientLeaks(content, codePath);
            allFindings.push(
              ...supabaseScan.findings.map((finding) => ({
                severity: finding.severity,
                file: codePath,
                message: finding.message,
              })),
            );

            if (codePath.includes('/api/')) {
              const csScan = scanColdStart(content, codePath);
              if (csScan.findings.length > 0) {
                allFindings.push(
                  ...csScan.findings.map((f) => ({
                    severity: f.severity as 'error' | 'warning',
                    file: codePath,
                    message: f.message,
                  })),
                );
              }
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      for (const agentPath of agentFiles) {
        try {
          const res = await fetchFileContent(agentPath);
          if (!res.ok) continue;
          const content = await res.text();
          const agentScan = scanAgentStack(content, agentPath);
          allFindings.push(
            ...agentScan.findings.map((finding: WebFinding) => ({
              severity: finding.severity,
              file: agentPath,
              message: finding.message,
            })),
          );
        } catch {
          // Skip unreadable agent-stack files
        }
      }

      const hasCiWorkflow = tree.some((node) => {
        const pathLower = node.path.toLowerCase();
        return (
          pathLower === '.github/workflows/assurly.yml' ||
          pathLower === '.github/workflows/assurly.yaml'
        );
      });

      if (!hasCiWorkflow) {
        allFindings.push({
          severity: 'warning',
          file: 'Global Configs',
          message: 'GitHub Actions workflow for Assurly is missing.',
        });
      }

      setScanProgress(100);
      setScanLogs((prev) => [...prev, 'Scan finished. Generating report.']);

      const errorCount = allFindings.filter((f) => f.severity === 'error').length;
      const warningCount = allFindings.filter((f) => f.severity === 'warning').length;
      const affectedPaths = new Set(allFindings.map((finding) => finding.file).filter(Boolean));
      const shipGate = buildShipGateFromWebFindings(
        allFindings.map((finding) => ({
          severity: finding.severity,
          message: finding.message,
          file: finding.file,
          ruleId: 'general',
        })),
        {
          scannedFileCount: selectedFiles.size,
          cleanFileCount: Math.max(0, selectedFiles.size - affectedPaths.size),
        },
      );

      setTimeout(() => {
        setScanResults({
          errorCount,
          warningCount,
          score: shipGate.shipScore,
          repoName: repoFullName,
          shipGate,
        });
        setIsScanning(false);
        setScanFinished(true);
      }, 600);
    } catch (error: unknown) {
      setScanError(
        error instanceof Error ? error.message : 'An unexpected error occurred during the scan.',
      );
      setIsScanning(false);
    }
  };

  // Toast auto-close
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Body scroll lock when mobile menu is open
  useEffect(() => {
    if (isMenuOpen) {
      document.body.classList.add('menu-open');
    } else {
      document.body.classList.remove('menu-open');
    }
    return () => {
      document.body.classList.remove('menu-open');
    };
  }, [isMenuOpen]);

  const handleCopyCommand = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText('npx assurly scan');
      setCopied(true);
      setToast({ message: 'Command copied to clipboard!', type: 'success' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
    }
  };

  const handleContactSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (contactTimeoutRef.current) {
      clearTimeout(contactTimeoutRef.current);
    }
    setIsSubmittingContact(true);
    setContactFeedback(null);

    try {
      await clientApi.contact({
        name: contactName,
        email: contactEmail,
        subject: contactSubject,
        message: contactMessage,
      });
      setContactFeedback({ success: true, message: 'Message sent successfully.' });
      setContactName('');
      setContactEmail('');
      setContactSubject('technical');
      setContactMessage('');
      contactTimeoutRef.current = setTimeout(() => setContactFeedback(null), 4000);
    } catch {
      setContactFeedback({
        success: false,
        message: 'An error occurred. Please try again later.',
      });
    } finally {
      setIsSubmittingContact(false);
    }
  };

  /** Renders the primary auth CTA button based on session state */
  const renderAuthButton = (
    variant: 'primary' | 'secondary',
    labels: { signIn: string; dashboard: string },
  ): React.ReactElement => {
    return (
      <AuthButton
        authenticated={isAuthenticated}
        variant={variant}
        labels={labels}
        loginUrl={loginUrl}
        onNavigate={() => setIsMenuOpen(false)}
      />
    );
  };

  const isDeployedUrlValid = isLikelyScannableUrl(urlInput);
  const showDeployedUrlHint = urlInput.trim().length > 0 && !isDeployedUrlValid;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Toast Notification */}
      {toast && (
        <div className="toast-notification">
          <span className="toast-icon">
            <HomeCheckIcon />
          </span>
          <span className="toast-message">{toast.message}</span>
        </div>
      )}

      <HomeHeader
        authenticated={isAuthenticated}
        loginUrl={loginUrl}
        menuOpen={isMenuOpen}
        onMenuChange={setIsMenuOpen}
      />

      {/* Main Content */}
      <main className="container">
        {/* Hero Section */}
        <section className="hero">
          <h1>
            Before you ship your AI-built SaaS, Assurly tells you in 60 seconds what will break in
            production — and what you can safely ignore.
          </h1>
          <p className="hero-subtitle">
            Scan your live URL or public repo, get a trusted Ship Score, fix blockers with one-click
            PRs or AI prompts, and keep monitoring on every deploy — without uploading your source
            code to a third party.
          </p>
          <div className="hero-ctas">
            {renderAuthButton('primary', {
              signIn: 'Sign In with GitHub',
              dashboard: 'Go to Dashboard',
            })}
            <code
              className={`btn btn-secondary ${copied ? 'copied' : ''}`}
              onClick={handleCopyCommand}
              title="Copy to clipboard"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCopyCommand();
                }
              }}
              aria-label="Copy npx assurly scan command to clipboard"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                cursor: 'pointer',
                userSelect: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'var(--transition-smooth)',
              }}
            >
              {copied ? (
                <>
                  Copied! <HomeCheckIcon className="home-icon--sm" />
                </>
              ) : (
                <>
                  npx assurly scan
                  <HomeCopyIcon className="home-icon--sm" style={{ opacity: 0.6 }} />
                </>
              )}
            </code>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="features">
          <h2>How It Works</h2>
          <p
            style={{
              textAlign: 'center',
              marginBottom: '32px',
              fontSize: '0.95rem',
              color: 'var(--text-secondary)',
              maxWidth: '720px',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            From a deployed URL to a fix you can ship — four steps, under a minute for the first
            scan.
          </p>
          <div className="features-grid">
            <div className="feature-card">
              <span className="feature-step-numeral" aria-hidden="true">
                1
              </span>
              <h3>URL Scan</h3>
              <p>
                Paste your live app URL. Assurly probes Supabase RLS exposure, secrets in the
                production bundle, and security headers — no repository required.
              </p>
            </div>
            <div className="feature-card">
              <span className="feature-step-numeral" aria-hidden="true">
                2
              </span>
              <h3>Ship Score</h3>
              <p>
                One trusted verdict: blockers you must fix, warnings you can review, and noise you
                can safely ignore — tuned for high-confidence production risks.
              </p>
            </div>
            <div className="feature-card">
              <span className="feature-step-numeral" aria-hidden="true">
                3
              </span>
              <h3>One-Click Fix</h3>
              <p>
                Open an auto-fix pull request for common misconfigurations, or copy an AI fix prompt
                straight into Cursor or Claude Code.
              </p>
            </div>
            <div className="feature-card">
              <span className="feature-step-numeral" aria-hidden="true">
                4
              </span>
              <h3>Continuous Monitoring</h3>
              <p>
                Connect GitHub to scan every deploy, catch regressions early, and keep your Ship
                Score badge current.
              </p>
            </div>
          </div>
        </section>

        <section className="interactive-scanner-section">
          <div className="scanner-box">
            <h2 style={{ textAlign: 'center', marginBottom: '8px', fontSize: '1.4rem' }}>
              Scan a Deployed URL
            </h2>
            <p
              style={{
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '0.9rem',
                marginBottom: '24px',
              }}
            >
              Paste your live app URL to probe Supabase RLS, production bundle secrets, and security
              headers — no repository required.
            </p>

            <div className="scanner-input-container">
              <div className="scanner-input-wrapper">
                <label className="visually-hidden" htmlFor="deployed-url">
                  Deployed application URL
                </label>
                <input
                  id="deployed-url"
                  type="url"
                  placeholder="https://myapp.lovable.app"
                  className="scanner-input"
                  style={{ paddingLeft: '16px' }}
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  disabled={isUrlScanning}
                  aria-invalid={showDeployedUrlHint}
                  aria-describedby={showDeployedUrlHint ? 'deployed-url-hint' : undefined}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleStartUrlScan();
                  }}
                />
              </div>
              <button
                className="scanner-btn"
                onClick={() => void handleStartUrlScan()}
                disabled={isUrlScanning || !isDeployedUrlValid}
              >
                {isUrlScanning ? 'Scanning...' : 'Scan URL'}
              </button>
            </div>

            {showDeployedUrlHint && (
              <p
                id="deployed-url-hint"
                style={{
                  color: 'var(--color-text-muted)',
                  fontSize: '0.85rem',
                  marginTop: '10px',
                  textAlign: 'center',
                }}
              >
                Enter a full URL including https:// — for example https://myapp.lovable.app
              </p>
            )}

            {urlScanError && (
              <div
                style={{
                  color: 'var(--color-error)',
                  fontSize: '0.9rem',
                  marginTop: '10px',
                  textAlign: 'center',
                  fontWeight: 'bold',
                }}
              >
                <div className="scanner-error-row">
                  <HomeXIcon />
                  <span>{urlScanError}</span>
                </div>
              </div>
            )}

            {urlScanFinished && urlScanResults && (
              <div>
                <ProofEvidence evidence={urlScanResults.evidence} />
                <div className="scanner-results-card scanner-results-card--ship-gate">
                  <div className="scanner-results-info">
                    <h4>Ship Gate for {urlScanResults.targetUrl}</h4>
                    <p>
                      Runtime verdict — {urlScanResults.errorCount} blocker
                      {urlScanResults.errorCount === 1 ? '' : 's'}, {urlScanResults.warningCount}{' '}
                      warning
                      {urlScanResults.warningCount === 1 ? '' : 's'}.
                    </p>
                  </div>
                  <ShipGatePanel
                    report={urlScanResults.shipGate}
                    compact
                    redactFindings={!isAuthenticated}
                  />
                </div>

                {!isAuthenticated ? (
                  <div className="conversion-wall-box">
                    <h4>
                      <HomeLockIcon className="home-icon--inline" />
                      Full Runtime Findings are Locked
                    </h4>
                    <p>
                      Sign in to unlock the complete findings list, exact probe details, and
                      remediation guidance for your deployed app.
                    </p>
                    <button className="btn btn-primary" onClick={handleUnlockUrlReport}>
                      Sign In with GitHub to Unlock Report
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>

        {/* Interactive Public Repository Scanner Widget */}
        <section className="interactive-scanner-section">
          <div className="scanner-box">
            <h2 style={{ textAlign: 'center', marginBottom: '8px', fontSize: '1.4rem' }}>
              Scan a Public Repository Instantly
            </h2>
            <p
              style={{
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '0.9rem',
                marginBottom: '24px',
              }}
            >
              Enter a public GitHub repository path to inspect configuration flaws in real-time. No
              registration required.
            </p>

            <div className="scanner-input-container">
              <div className="scanner-input-wrapper">
                <span className="scanner-input-prefix">github.com/</span>
                <label className="visually-hidden" htmlFor="public-repository">
                  Public GitHub repository
                </label>
                <input
                  id="public-repository"
                  type="text"
                  placeholder="e.g. vercel/next.js, facebook/react"
                  className="scanner-input"
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  disabled={isScanning || isFetchingRepos}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleStartScan();
                  }}
                />
              </div>
              <button
                className="scanner-btn"
                onClick={() => handleStartScan()}
                disabled={isScanning || isFetchingRepos || !repoInput.trim()}
              >
                {isScanning ? 'Scanning...' : isFetchingRepos ? 'Fetching...' : 'Scan Repository'}
              </button>
            </div>

            {isFetchingRepos && (
              <div
                style={{ textAlign: 'center', margin: '20px 0', color: 'var(--text-secondary)' }}
              >
                <div className="pulse-loader" style={{ margin: '0 auto 10px auto' }}></div>
                <span className="inline-status-row">
                  <HomeSearchIcon className="home-icon--sm" />
                  <span>
                    Fetching public repositories for <strong>{ownerSearched}</strong>...
                  </span>
                </span>
              </div>
            )}

            {!isFetchingRepos && publicReposList.length > 0 && (
              <div className="repo-selector-container">
                <div className="repo-selector-header">
                  <span>
                    Public repositories for <strong>{ownerSearched}</strong> (
                    {publicReposList.length}):
                  </span>
                  <button
                    onClick={() => setPublicReposList([])}
                    className="repo-selector-clear-btn"
                  >
                    Clear
                  </button>
                </div>
                <div className="repo-selector-grid">
                  {publicReposList.map((repo) => (
                    <div
                      key={repo.full_name}
                      className="repo-selector-card"
                      onClick={() => {
                        setRepoInput(repo.full_name);
                        setPublicReposList([]);
                        handleStartScan(repo.full_name);
                      }}
                    >
                      <div className="repo-selector-title">
                        <span className="repo-selector-name">
                          <HomeFolderIcon />
                          {repo.name}
                        </span>
                        <div className="repo-selector-meta">
                          {repo.language && <span className="repo-tag-lang">{repo.language}</span>}
                          <span className="repo-tag-stars">
                            <HomeStarIcon />
                            {repo.stargazers_count}
                          </span>
                        </div>
                      </div>
                      {repo.description && (
                        <div className="repo-selector-desc">{repo.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {scanError && (
              <div
                style={{
                  color: 'var(--color-error)',
                  fontSize: '0.9rem',
                  marginTop: '10px',
                  textAlign: 'center',
                  fontWeight: 'bold',
                }}
              >
                <div className="scanner-error-row">
                  <HomeXIcon />
                  <span>{scanError}</span>
                </div>
                {isRateLimitMessage(scanError) && !isAuthenticated ? (
                  <div style={{ marginTop: '12px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        window.location.href = loginUrl;
                      }}
                    >
                      Sign In with GitHub for Higher Limits
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            {isScanning && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '8px',
                  }}
                >
                  <span>Analyzing files...</span>
                  <span>{scanProgress}%</span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '6px',
                    backgroundColor: 'var(--border-color)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${scanProgress}%`,
                      height: '100%',
                      backgroundColor: 'var(--accent-color)',
                      transition: 'width 0.3s ease',
                    }}
                  ></div>
                </div>
              </div>
            )}

            {(isScanning || scanLogs.length > 0) && (
              <div className="scanner-terminal-box">
                {scanLogs.map((log, idx) => (
                  <div key={idx} className="scanner-terminal-log">
                    {log}
                  </div>
                ))}
              </div>
            )}

            {scanFinished && scanResults && (
              <div>
                <div className="scanner-results-card scanner-results-card--ship-gate">
                  <div className="scanner-results-info">
                    <h4>Ship Gate for {scanResults.repoName}</h4>
                    <p>
                      One verdict for production readiness — blockers must be fixed before shipping.
                    </p>
                  </div>
                  <ShipGatePanel report={scanResults.shipGate} compact />
                </div>

                <div className="conversion-wall-box">
                  <h4>
                    <HomeLockIcon className="home-icon--inline" />
                    Detailed Security Report is Locked
                  </h4>
                  <p>
                    Connect your GitHub account to unlock the full list of findings, see the exact
                    file lines, and automatically fix these configuration errors.
                  </p>
                  <button className="btn btn-primary" onClick={handleUnlockReport}>
                    Sign In with GitHub to Unlock Report
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Static Demo Preview */}
        <section id="demo" className="demo-preview">
          <h2 style={{ textAlign: 'center', marginBottom: '8px' }}>See It in Action</h2>
          <p
            style={{
              textAlign: 'center',
              marginBottom: '32px',
              fontSize: '0.95rem',
              color: 'var(--text-secondary)',
            }}
          >
            Assurly catches critical security misconfigurations that ship undetected to production.
          </p>

          <div className="demo-terminal">
            <div className="terminal-header">
              <div className="terminal-dot red"></div>
              <div className="terminal-dot yellow"></div>
              <div className="terminal-dot green"></div>
              <span
                style={{
                  marginLeft: '12px',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                }}
              >
                terminal — assurly scan
              </span>
            </div>

            <div
              className="demo-terminal-body"
              role="region"
              aria-label="Example Assurly diagnostic output"
              tabIndex={0}
            >
              <div className="log-line" style={{ color: 'var(--text-muted)' }}>
                <span>$ npx assurly scan --path ./my-saas-app</span>
              </div>
              <div className="log-line">
                <span className="log-badge ok">OK</span>
                <span className="log-message" style={{ color: 'var(--color-success)' }}>
                  Static Analysis Engine initialized.
                </span>
              </div>
              <div className="log-line">
                <span className="log-badge ok">OK</span>
                <span className="log-message" style={{ color: 'var(--color-success)' }}>
                  Detected stack: Next.js + Supabase + Stripe + Vercel
                </span>
              </div>

              <div className="demo-log-heading">
                <HomeSearchIcon />
                Scanning schema.sql...
              </div>
              <div className="log-line" style={{ paddingLeft: '8px' }}>
                <span className="log-badge error">ERROR</span>
                <span className="log-message">
                  [Line 3] Supabase table &apos;profiles&apos; is created but Row-Level Security
                  (RLS) is not enabled.
                </span>
              </div>
              <div className="log-suggestion demo-log-suggestion" style={{ paddingLeft: '8px' }}>
                <HomeLightbulbIcon />
                <span>Add: ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;</span>
              </div>

              <div className="demo-log-heading">
                <HomeSearchIcon />
                Scanning app/api/stripe/webhook/route.ts...
              </div>
              <div className="log-line" style={{ paddingLeft: '8px' }}>
                <span className="log-badge error">ERROR</span>
                <span className="log-message">
                  Stripe webhook endpoint lacks signature verification.
                </span>
              </div>
              <div className="log-suggestion demo-log-suggestion" style={{ paddingLeft: '8px' }}>
                <HomeLightbulbIcon />
                <span>Use: stripe.webhooks.constructEvent(body, sig, secret)</span>
              </div>

              <div className="demo-log-error">
                <HomeXIcon />
                <span>2 errors found. Fix before deploying to production.</span>
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: '32px' }}>
            {renderAuthButton('primary', {
              signIn: 'Try it free — Sign in with GitHub',
              dashboard: 'Go to Dashboard',
            })}
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="features">
          <h2>Why Assurly?</h2>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">
                <HomeMonitorCheckIcon />
              </div>
              <h3>Local-First Scanning</h3>
              <p>
                Manual web checks run in your browser and CLI scans run on your machine. GitHub web
                integrations securely proxy selected repository content without retaining complete
                source files.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <HomeFeatherIcon />
              </div>
              <h3>Zero-Bundle Overhead</h3>
              <p>
                Assurly runs as a development-only tool. It adds exactly 0kb to your final
                production bundle size.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <HomeLayersIcon />
              </div>
              <h3>Indie-Stack Native</h3>
              <p>
                Deep out-of-the-box rule configurations for Next.js, Supabase Row-Level Security,
                Stripe webhooks, and Vercel.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <HomeWrenchIcon />
              </div>
              <h3>Auto-Fix Engine</h3>
              <p>
                Quickly repair common misconfigured variables or missing database scripts with
                deterministic CLI fix actions.
              </p>
            </div>
          </div>
        </section>

        {/* Conversion Bridge CTA */}
        <section className="conversion-banner">
          <h2>Scan your repository in 60 seconds</h2>
          <p>
            Connect your GitHub repositories to automatically detect security flaws, missing RLS
            policies, and unverified webhook endpoints on every push.
          </p>
          {renderAuthButton('primary', {
            signIn: 'Connect your repo — Sign in with GitHub',
            dashboard: 'Go to Dashboard',
          })}
        </section>

        {/* The Real Cost of AI Code Vulnerabilities (FOMO / Risks Section) */}
        <section className="fomo-section">
          <h2>The Real Cost of AI Code Vulnerabilities</h2>
          <p className="fomo-subtitle">
            AI code assistants write fast code, but miss critical production security. What could a
            single slip-up cost you?
          </p>
          <div className="fomo-grid">
            <div className="fomo-card">
              <span className="fomo-badge-danger">Severe Risk</span>
              <div className="feature-icon">
                <HomeDatabaseZapIcon />
              </div>
              <h3>Missing Supabase RLS</h3>
              <p className="fomo-description">
                <strong>Cost: €20,000+ GDPR fine & reputation ruin.</strong> Leaving a profiles or
                users table readable without Row-Level Security allows competitors to scrape your
                entire customer database in seconds.
              </p>
            </div>
            <div className="fomo-card">
              <span className="fomo-badge-danger">Financial Loss</span>
              <div className="feature-icon">
                <HomeCreditCardIcon />
              </div>
              <h3>Webhook Spoofing</h3>
              <p className="fomo-description">
                <strong>
                  Cost: {currencySymbol}100 - {currencySymbol}10,000+ in api usage & unpaid
                  features.
                </strong>{' '}
                A Stripe webhook endpoint lacking signature verification allows attackers to spoof
                events and gain premium access without paying.
              </p>
            </div>
            <div className="fomo-card">
              <span className="fomo-badge-danger">User Dropoff</span>
              <div className="feature-icon">
                <HomeTimerIcon />
              </div>
              <h3>RSC Leaks & Cold Starts</h3>
              <p className="fomo-description">
                <strong>Cost: 15% - 30% checkout conversion loss.</strong> Importing server-side
                database libraries inside client files increases serverless bundle sizes, causing
                massive loading delays and user bounce rates.
              </p>
            </div>
          </div>
        </section>

        {/* Interactive ROI Calculator Section */}
        <section className="roi-calculator-section">
          <h2>Calculate Your Savings</h2>
          <p className="roi-calculator-subtitle">
            See how much time and money you save by validating your AI code deployments
            automatically.
          </p>
          <div className="roi-calculator-controls">{renderCurrencyToggle()}</div>
          <div className="roi-calculator-grid">
            <div className="roi-inputs">
              <div className="roi-input-group">
                <div className="roi-input-header">
                  <label className="roi-input-label" htmlFor="manual-review-hours">
                    Manual Review Time (hours/month)
                  </label>
                  <output className="roi-input-val" htmlFor="manual-review-hours">
                    {hoursSaved} hrs
                  </output>
                </div>
                <input
                  id="manual-review-hours"
                  type="range"
                  min="1"
                  max="40"
                  value={hoursSaved}
                  onChange={(e) => setHoursSaved(parseInt(e.target.value, 10))}
                  className="roi-slider"
                  style={computeSliderBackground(hoursSaved, 1, 40)}
                />
              </div>
              <div className="roi-input-group">
                <div className="roi-input-header">
                  <label className="roi-input-label" htmlFor="developer-hourly-rate">
                    Developer Hourly Rate ({currencySymbol})
                  </label>
                  <output className="roi-input-val" htmlFor="developer-hourly-rate">
                    {currencySymbol}
                    {hourlyRate}/hr
                  </output>
                </div>
                <input
                  id="developer-hourly-rate"
                  type="range"
                  min="20"
                  max="150"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(parseInt(e.target.value, 10))}
                  className="roi-slider"
                  style={computeSliderBackground(hourlyRate, 20, 150)}
                />
              </div>
            </div>

            <div className="roi-results-card">
              <div>
                <span className="roi-results-header">Your Est. Monthly Savings</span>
                <div className="roi-savings-amount">
                  {hoursSaved * hourlyRate -
                    (billingPeriod === 'yearly' ? prices.guardMonthlyEquiv : prices.guardMonthly) >
                  0
                    ? `${currencySymbol}${(hoursSaved * hourlyRate - (billingPeriod === 'yearly' ? prices.guardMonthlyEquiv : prices.guardMonthly)).toFixed(0)}`
                    : `${currencySymbol}0`}
                </div>
                <span
                  style={{ fontSize: '0.85rem', color: 'var(--color-accent)', fontWeight: 600 }}
                >
                  ROI:{' '}
                  {hoursSaved * hourlyRate -
                    (billingPeriod === 'yearly' ? prices.guardMonthlyEquiv : prices.guardMonthly) >
                  0
                    ? `${(((hoursSaved * hourlyRate) / (billingPeriod === 'yearly' ? prices.guardMonthlyEquiv : prices.guardMonthly)) * 100).toFixed(0)}%`
                    : '0%'}
                </span>
              </div>
              <div className="roi-breakdown">
                <div className="roi-breakdown-row">
                  <span>Manual Audit Cost</span>
                  <span>
                    {currencySymbol}
                    {hoursSaved * hourlyRate}/mo
                  </span>
                </div>
                <div className="roi-breakdown-row">
                  <span>Assurly Cost</span>
                  <span>
                    {currencySymbol}
                    {billingPeriod === 'yearly'
                      ? prices.guardMonthlyEquiv.toFixed(2)
                      : prices.guardMonthly}
                    /mo
                  </span>
                </div>
                <div className="roi-breakdown-row highlight">
                  <span>Net Monthly Savings</span>
                  <span>
                    {hoursSaved * hourlyRate -
                      (billingPeriod === 'yearly'
                        ? prices.guardMonthlyEquiv
                        : prices.guardMonthly) >
                    0
                      ? `${currencySymbol}${(hoursSaved * hourlyRate - (billingPeriod === 'yearly' ? prices.guardMonthlyEquiv : prices.guardMonthly)).toFixed(0)}`
                      : `${currencySymbol}0`}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="pricing-section">
          <h2>Simple, Transparent Pricing</h2>
          <p className="pricing-subtitle">
            Start free with the live proof-probe and one guarded app. Upgrade for a continuous
            guardian on every deploy — or embed the verdict in your own platform.
          </p>

          <div className="pricing-controls-container">
            <div className="billing-toggle-container" role="group" aria-label="Billing period">
              <button
                className={`billing-toggle-btn ${billingPeriod === 'monthly' ? 'active' : ''}`}
                aria-pressed={billingPeriod === 'monthly'}
                onClick={() => setBillingPeriod('monthly')}
              >
                Billed Monthly
              </button>
              <button
                className={`billing-toggle-btn ${billingPeriod === 'yearly' ? 'active' : ''}`}
                aria-pressed={billingPeriod === 'yearly'}
                onClick={() => setBillingPeriod('yearly')}
              >
                Billed Annually
                <span className="discount-badge">Save ~35%</span>
              </button>
            </div>

            {renderCurrencyToggle()}
          </div>

          <div className="pricing-grid">
            <div className="pricing-card">
              <div className="pricing-card-header">
                <h3>Free</h3>
                <div className="pricing-price">
                  <span className="pricing-amount">
                    {currencySymbol}
                    {prices.free}
                  </span>
                  <span className="pricing-period">/ forever</span>
                </div>
              </div>
              <ul className="pricing-features">
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>Live proof-probe: paste a URL, see what leaks</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>One guarded app</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>MCP server access for AI agents</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>CLI scanner (unlimited local scans)</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>Community support</span>
                </li>
              </ul>
              {renderAuthButton('secondary', {
                signIn: 'Get Started Free',
                dashboard: 'Go to Dashboard',
              })}
            </div>

            <div className="pricing-card featured">
              <div className="pricing-badge">Most Popular</div>
              <div className="pricing-card-header">
                <h3>Pro</h3>
                <div className="pricing-price">
                  <span className="pricing-amount">
                    {currencySymbol}
                    {billingPeriod === 'yearly' ? prices.guardYearly : prices.guardMonthly}
                  </span>
                  <span className="pricing-period">
                    {billingPeriod === 'yearly' ? '/ year' : '/ month'}
                  </span>
                </div>
              </div>
              <ul className="pricing-features">
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>Everything in Free, unlimited guarded apps</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>Continuous Guardian on every deploy</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>AI deep review (Layer 2 reasoning)</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>Verified Ship Score badge + trust page</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>Auto-fix pull requests &amp; regression alerts</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>Private repository scanning</span>
                </li>
              </ul>
              {renderAuthButton('primary', {
                signIn: 'Start Pro Trial',
                dashboard: 'Go to Dashboard',
              })}
            </div>

            <div className="pricing-card">
              <div className="pricing-card-header">
                <h3>OEM / Platform</h3>
                <div className="pricing-price">
                  <span className="pricing-amount">Custom</span>
                  <span className="pricing-period">usage / seat</span>
                </div>
              </div>
              <ul className="pricing-features">
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>Everything in Pro</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>Keyed verdict API for your users</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>
                    <code>assurly_verdict</code> MCP ship-gate
                  </span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>White-label “security-checked” widget</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>Higher programmatic rate limits</span>
                </li>
                <li>
                  <HomeCheckIcon className="pricing-feature-icon" />
                  <span>Volume pricing &amp; priority support</span>
                </li>
              </ul>
              <a className="btn btn-secondary" href="#contact">
                Contact Sales
              </a>
            </div>
          </div>
        </section>

        {/* Social Proof */}
        <ProofPoints />

        {/* Support & Contact Section */}
        <section id="contact" className="contact-section">
          <div className="section-header">
            <h2>Support &amp; Contact</h2>
            <p>
              Have questions, found a bug, or need help with your Assurly integration? Drop us a
              line.
            </p>
          </div>

          <div className="contact-grid">
            <div className="contact-info">
              <div className="info-card">
                <h3>Developer Support</h3>
                <p>
                  Get direct technical assistance for integrating Assurly with your CI/CD pipelines,
                  custom configurations, or custom rules.
                </p>

                <div className="info-links">
                  <div className="info-item">
                    <span className="info-icon">
                      <HomeMailIcon />
                    </span>
                    <div>
                      <strong>Email Us</strong>
                      <p>support@assurly.dev</p>
                    </div>
                  </div>
                  <div className="info-item">
                    <span className="info-icon">
                      <HomeClockIcon />
                    </span>
                    <div>
                      <strong>Response Time</strong>
                      <p>Usually within 24 hours</p>
                    </div>
                  </div>
                  <div className="info-item">
                    <span className="info-icon">
                      <HomeShieldCheckIcon />
                    </span>
                    <div>
                      <strong>Privacy Assurance</strong>
                      <p>
                        Local file scans stay in your browser. GitHub-connected scans pass code
                        through Assurly servers transiently; source code is not retained.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="contact-form-container">
              <form onSubmit={handleContactSubmit} className="contact-form">
                <div className="form-group">
                  <label htmlFor="contact-name">Name</label>
                  <input
                    id="contact-name"
                    type="text"
                    required
                    placeholder="Jane Doe"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="contact-email">Email Address</label>
                  <input
                    id="contact-email"
                    type="email"
                    required
                    placeholder="jane@example.com"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="contact-subject">Subject</label>
                  <select
                    id="contact-subject"
                    value={contactSubject}
                    onChange={(e) => setContactSubject(e.target.value as ContactSubject)}
                  >
                    {CONTACT_SUBJECTS.map((subject) => (
                      <option key={subject.value} value={subject.value}>
                        {subject.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="contact-message">Message</label>
                  <textarea
                    id="contact-message"
                    required
                    rows={5}
                    placeholder="Tell us what you need help with..."
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary contact-submit-btn"
                  disabled={isSubmittingContact}
                >
                  {isSubmittingContact ? 'Sending Message...' : 'Send Message'}
                </button>

                {contactFeedback && (
                  <div
                    className={`feedback-message ${contactFeedback.success ? 'success' : 'error'}`}
                  >
                    {contactFeedback.success ? <HomeCheckIcon /> : <HomeXIcon />}{' '}
                    {contactFeedback.message}
                  </div>
                )}
              </form>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter variant="full" />
    </div>
  );
}
