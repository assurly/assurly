/**
 * AI-builder fingerprinting.
 *
 * Assurly's long-term moat is a corpus of *how apps built by a given AI builder
 * characteristically fail*. That only works if every scan records which builder
 * produced the app. This module infers that from cheap, already-available
 * signals — repository file paths, `package.json`, and (for URL scans) the live
 * page/bundle text — without any extra fetches.
 *
 * The detector is intentionally conservative: it returns `'unknown'` unless a
 * signal is characteristic enough to defend. False "unknown" is fine (the corpus
 * just lacks that row); a wrong attribution would poison the dataset.
 */

export type GeneratorFingerprint = 'lovable' | 'v0' | 'bolt' | 'cursor' | 'replit' | 'unknown';

/** The non-`unknown` fingerprints, in the priority order they are evaluated. */
export const KNOWN_GENERATOR_FINGERPRINTS: readonly Exclude<GeneratorFingerprint, 'unknown'>[] = [
  'lovable',
  'bolt',
  'replit',
  'cursor',
  'v0',
];

export interface FingerprintSignals {
  /** Every file path in the repository tree (matching is case-insensitive). */
  filePaths?: readonly string[];
  /** Raw `package.json` text, if available. */
  packageJson?: string | null;
  /**
   * HTML and/or JS bundle text captured from a live URL scan, if available.
   * Only a bounded prefix is inspected, so passing a large bundle is safe.
   */
  pageText?: string | null;
}

interface GeneratorMatcher {
  fingerprint: Exclude<GeneratorFingerprint, 'unknown'>;
  /** A characteristic file path fragment (normalised, lowercased). */
  filePathIncludes?: readonly string[];
  /** A characteristic substring in `package.json` (lowercased). */
  packageJsonIncludes?: readonly string[];
  /** A characteristic substring in the live page/bundle text (lowercased). */
  pageTextIncludes?: readonly string[];
}

// Only bytes near the top of a bundle are worth scanning for provenance markers;
// builder signatures (script tags, generated-by banners) live in the head/preamble.
const MAX_PAGE_TEXT_SCAN = 200_000;

// Ordered by specificity: the first builder with a matching signal wins. Lovable
// is first because its `gpteng.co` runtime script and `lovable-tagger` dep are
// unambiguous; v0 is last because its signals (v0.dev references) are the weakest
// and most easily present incidentally.
const MATCHERS: readonly GeneratorMatcher[] = [
  {
    fingerprint: 'lovable',
    filePathIncludes: ['.lovable', 'lovable.config'],
    // `lovable-tagger` is Lovable's own build plugin; `gpteng.co` is the runtime
    // script every Lovable-published app injects.
    packageJsonIncludes: ['lovable-tagger', 'lovable.dev', '"lovable"'],
    pageTextIncludes: ['gpteng.co', 'lovable.app', 'lovable.dev'],
  },
  {
    fingerprint: 'bolt',
    filePathIncludes: ['.bolt/'],
    packageJsonIncludes: ['bolt.new'],
    pageTextIncludes: ['bolt.new'],
  },
  {
    fingerprint: 'replit',
    filePathIncludes: ['.replit', 'replit.nix'],
    packageJsonIncludes: ['@replit/'],
    pageTextIncludes: ['replit.dev', 'repl.co'],
  },
  {
    fingerprint: 'cursor',
    filePathIncludes: ['.cursor/', '.cursorrules'],
  },
  {
    fingerprint: 'v0',
    // v0 leaves few repo markers; rely on explicit provenance references.
    packageJsonIncludes: ['v0.dev'],
    pageTextIncludes: ['v0.dev', 'built with v0'],
  },
];

function anyIncludes(haystack: string, needles: readonly string[] | undefined): boolean {
  if (!needles) return false;
  return needles.some((needle) => haystack.includes(needle));
}

function matches(matcher: GeneratorMatcher, normalized: NormalizedSignals): boolean {
  if (matcher.filePathIncludes && normalized.filePaths.length > 0) {
    if (
      normalized.filePaths.some((path) =>
        matcher.filePathIncludes!.some((fragment) => path.includes(fragment)),
      )
    ) {
      return true;
    }
  }
  if (anyIncludes(normalized.packageJson, matcher.packageJsonIncludes)) return true;
  if (anyIncludes(normalized.pageText, matcher.pageTextIncludes)) return true;
  return false;
}

interface NormalizedSignals {
  filePaths: string[];
  packageJson: string;
  pageText: string;
}

function normalize(signals: FingerprintSignals): NormalizedSignals {
  return {
    filePaths: (signals.filePaths ?? []).map((path) => path.replace(/\\/g, '/').toLowerCase()),
    packageJson: (signals.packageJson ?? '').toLowerCase(),
    pageText: (signals.pageText ?? '').slice(0, MAX_PAGE_TEXT_SCAN).toLowerCase(),
  };
}

/**
 * Infers which AI builder produced an app from cheap, already-available signals.
 * Returns `'unknown'` when no signal is characteristic enough to attribute.
 */
export function detectGeneratorFingerprint(signals: FingerprintSignals): GeneratorFingerprint {
  const normalized = normalize(signals);
  for (const matcher of MATCHERS) {
    if (matches(matcher, normalized)) return matcher.fingerprint;
  }
  return 'unknown';
}
