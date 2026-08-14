'use client';

import { useState, useSyncExternalStore, type ReactElement } from 'react';
import type { TargetCard } from '../../../utils/clientApi';
import { consequenceForGroupKey } from '../../../utils/consequenceMap';
import { canRescanVerdictCard, isScanStale, rescanActionLabel } from './staleScan';
import { formatVerdictCardLabel } from './verdictCardLabel';
import {
  coverageLabelForCard,
  fullGateCliCommand,
  shouldShowGuardianChip,
  type AppsDensity,
} from './verdictCardsView';

interface VerdictCardProps {
  card: TargetCard;
  onOpen: (card: TargetCard) => void;
  /** Optional remove control (URL apps only). Receives the trigger for focus return. */
  onRemove?: (trigger: HTMLButtonElement) => void;
  removing?: boolean;
  /** Start a fresh check for a stale / never-scanned app. */
  onRescan?: (card: TargetCard) => void;
  rescanning?: boolean;
  /** True while any scan/reprobe is running — blocks other Rescan CTAs. */
  rescanBlocked?: boolean;
  /** Comfortable cards vs dense list rows. */
  density?: AppsDensity;
}

type VerdictKey = TargetCard['verdict'];

const VERDICT_META: Record<VerdictKey, { label: string; emoji: string; className: string }> = {
  blocked: { label: 'Not ready to ship', emoji: '🚫', className: 'verdict-card--blocked' },
  review: { label: 'Review recommended', emoji: '⚠️', className: 'verdict-card--review' },
  ready: { label: 'Ready to ship', emoji: '✅', className: 'verdict-card--ready' },
  unknown: { label: 'Not scanned yet', emoji: '○', className: 'verdict-card--unknown' },
};

function capabilityPresentation(card: TargetCard): {
  label: string;
  emoji: string;
  issueText: string;
} | null {
  if (card.kind !== 'repo') return null;
  if (card.scanCapability === 'cli_only') {
    return {
      label: 'Use CLI',
      emoji: '⌘',
      issueText:
        'Too large for in-browser Instant Gate. Run Full Gate locally, then submit the verdict (no source upload).',
    };
  }
  if (card.scanCapability === 'invalid') {
    return {
      label: 'Needs attention',
      emoji: '!',
      issueText: 'Repository name must be owner/repo. Remove this entry and reconnect.',
    };
  }
  return null;
}

const FINGERPRINT_LABEL: Record<string, string> = {
  lovable: 'Lovable',
  v0: 'v0',
  bolt: 'Bolt',
  cursor: 'Cursor',
  replit: 'Replit',
};

/** Compact "checked 2h ago" freshness, or a dash when never scanned. */
export function formatCheckedAt(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'Never scanned';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never scanned';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'Checked just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Checked ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Checked ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Checked ${days}d ago`;
}

/** Absolute en-US stamp used during SSR/hydration before the relative phrase mounts. */
function formatCheckedAtAbsolute(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const subscribeNoop = (): (() => void) => () => {};
const getClientMounted = (): boolean => true;
const getServerMounted = (): boolean => false;

/**
 * Relative "Checked 5m ago" depends on Date.now(), so server and client can
 * disagree near a minute boundary. Render an absolute stamp until the client
 * snapshot is live, then swap to the relative phrase (option a — avoids
 * suppressHydrationWarning). useSyncExternalStore keeps SSR/hydration aligned
 * without a mount-time setState.
 */
function CheckedAtFreshness({ iso, stale }: { iso: string | null; stale: boolean }): ReactElement {
  const mounted = useSyncExternalStore(subscribeNoop, getClientMounted, getServerMounted);
  const className = stale
    ? 'verdict-card__freshness verdict-card__freshness--stale'
    : 'verdict-card__freshness';

  if (!iso || Number.isNaN(new Date(iso).getTime())) {
    return <span className={className}>Never scanned</span>;
  }

  const label = mounted ? formatCheckedAt(iso) : formatCheckedAtAbsolute(iso);
  return <span className={className}>{label}</span>;
}

export function VerdictCard({
  card,
  onOpen,
  onRemove,
  removing = false,
  onRescan,
  rescanning = false,
  rescanBlocked = false,
  density = 'comfortable',
}: VerdictCardProps): ReactElement {
  const [copiedCli, setCopiedCli] = useState(false);
  const capability = capabilityPresentation(card);
  const meta = VERDICT_META[card.verdict];
  const verdictLabel = capability?.label ?? meta.label;
  const verdictEmoji = capability?.emoji ?? meta.emoji;
  const label = formatVerdictCardLabel(card.displayName, card.kind);
  const fingerprintLabel = card.generatorFingerprint
    ? FINGERPRINT_LABEL[card.generatorFingerprint]
    : undefined;
  const coverageLabel = coverageLabelForCard(card);
  const showCliCopy = card.kind === 'repo' && card.scanCapability === 'cli_only';
  const cliCommand = fullGateCliCommand(card.displayName);
  // cli_only repos must stay openable — users need the detail workspace (Full Gate
  // copy + history). Only block open when there is no linked repository row.
  const openable = card.kind === 'repo' && Boolean(card.repositoryId);
  const stale = isScanStale(card.lastCheckedAt);
  const showRescan = Boolean(onRescan) && stale && canRescanVerdictCard(card);
  const rescanLabel = rescanActionLabel(card.lastCheckedAt);
  const compact = density === 'compact';
  const showGuardian = shouldShowGuardianChip(card);
  const chips = (
    <>
      {coverageLabel ? (
        <span className="verdict-card__chip" title="Scan coverage">
          {coverageLabel}
        </span>
      ) : null}
      {fingerprintLabel ? (
        <span className="verdict-card__chip" title="Detected AI builder">
          {fingerprintLabel}
        </span>
      ) : null}
      {card.kind === 'url' && !card.ownershipVerified ? (
        <span
          className="verdict-card__chip verdict-card__chip--pending"
          title="Prove ownership to unlock Continuous Guardian"
        >
          Pending verify
        </span>
      ) : null}
      {showGuardian ? (
        <span
          className="verdict-card__chip verdict-card__chip--guardian"
          title="Continuous Guardian watching this URL"
        >
          Guardian
        </span>
      ) : null}
    </>
  );

  const issueText = capability
    ? capability.issueText
    : card.topIssue
      ? (consequenceForGroupKey(card.topIssue.key)?.consequence ?? card.topIssue.sampleMessage)
      : card.verdict === 'ready'
        ? 'No blockers — safe to deploy.'
        : 'Run a scan to get a verdict.';
  const issueLine =
    card.topIssue && !capability ? (
      <span className="verdict-card__issue" title={issueText}>
        {issueText}
      </span>
    ) : card.verdict === 'ready' && !capability ? (
      <span className="verdict-card__issue verdict-card__issue--clean" title={issueText}>
        {issueText}
      </span>
    ) : (
      <span className="verdict-card__issue verdict-card__issue--muted" title={issueText}>
        {issueText}
      </span>
    );

  // Compact rows keep blockers actionable; repeated "safe to deploy" on ready
  // apps is the main source of warning fatigue in a long list.
  const showIssue =
    !compact || card.verdict === 'blocked' || card.verdict === 'review' || capability !== null;

  return (
    <div
      className={`verdict-card ${meta.className}${stale ? ' verdict-card--stale' : ''}${
        compact ? ' verdict-card--compact' : ''
      }`}
    >
      <button
        type="button"
        className="verdict-card__open"
        onClick={() => onOpen(card)}
        aria-label={`${label.full}: ${verdictLabel}`}
        title={label.full}
        disabled={!openable && card.kind === 'repo'}
      >
        <span className="verdict-card__status" aria-hidden="true">
          {verdictEmoji}
        </span>

        <span className="verdict-card__body">
          <span className="verdict-card__title-row">
            <span className="verdict-card__name-block">
              <span className="verdict-card__name">{label.primary}</span>
              {label.secondary && !compact ? (
                <span className="verdict-card__name-secondary">{label.secondary}</span>
              ) : null}
            </span>
            <span className="verdict-card__chips">{chips}</span>
          </span>
          {!compact ? <span className="verdict-card__verdict">{verdictLabel}</span> : null}
          {showIssue ? issueLine : null}
          {card.scoreDropped ? (
            <span className="verdict-card__regression" role="status">
              Score dropped since last check
            </span>
          ) : null}
        </span>

        <span className="verdict-card__meta">
          <span className="verdict-card__score">
            {card.shipScore === null ? '—' : `${card.shipScore}`}
            <span className="verdict-card__score-max">/100</span>
          </span>
          <CheckedAtFreshness iso={card.lastCheckedAt} stale={stale} />
        </span>
      </button>

      {showRescan || onRemove || showCliCopy ? (
        <div className="verdict-card__actions">
          {showCliCopy ? (
            <button
              type="button"
              className="verdict-card__rescan"
              onClick={(event) => {
                event.stopPropagation();
                void navigator.clipboard.writeText(cliCommand).then(() => {
                  setCopiedCli(true);
                  window.setTimeout(() => setCopiedCli(false), 2000);
                });
              }}
              aria-label={`Copy Full Gate command for ${label.full}`}
              title={cliCommand}
            >
              {copiedCli ? 'Copied' : 'Copy CLI command'}
            </button>
          ) : null}
          {showRescan && onRescan ? (
            <button
              type="button"
              className="verdict-card__rescan"
              onClick={(event) => {
                event.stopPropagation();
                onRescan(card);
              }}
              disabled={rescanning || rescanBlocked}
              aria-busy={rescanning}
              aria-label={`${rescanning ? 'Scanning' : rescanLabel} ${label.full}`}
            >
              {rescanning ? 'Scanning…' : rescanLabel}
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              className="verdict-card__remove"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(event.currentTarget);
              }}
              disabled={removing}
              aria-label={`Remove ${card.displayName} from Your apps`}
            >
              {removing ? 'Removing…' : 'Remove'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
