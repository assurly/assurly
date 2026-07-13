import { describe, expect, it } from 'vitest';
import { detectGeneratorFingerprint, KNOWN_GENERATOR_FINGERPRINTS } from './generatorFingerprint';

describe('detectGeneratorFingerprint', () => {
  it('returns "unknown" when there are no signals', () => {
    expect(detectGeneratorFingerprint({})).toBe('unknown');
    expect(detectGeneratorFingerprint({ filePaths: [], packageJson: '', pageText: '' })).toBe(
      'unknown',
    );
  });

  it('returns "unknown" for a plain Next.js app with no builder markers', () => {
    expect(
      detectGeneratorFingerprint({
        filePaths: ['package.json', 'app/page.tsx', 'next.config.js'],
        packageJson: JSON.stringify({ dependencies: { next: '16.0.0', react: '19.0.0' } }),
      }),
    ).toBe('unknown');
  });

  describe('Lovable', () => {
    it('detects the lovable-tagger build plugin in package.json', () => {
      expect(
        detectGeneratorFingerprint({
          packageJson: JSON.stringify({ devDependencies: { 'lovable-tagger': '^1.0.0' } }),
        }),
      ).toBe('lovable');
    });

    it('detects the gpteng.co runtime script in live page text', () => {
      expect(
        detectGeneratorFingerprint({
          pageText: '<script type="module" src="https://cdn.gpteng.co/gptengineer.js"></script>',
        }),
      ).toBe('lovable');
    });

    it('detects a .lovable config file path', () => {
      expect(detectGeneratorFingerprint({ filePaths: ['.lovable', 'src/App.tsx'] })).toBe(
        'lovable',
      );
    });
  });

  describe('other builders', () => {
    it('detects Bolt from a .bolt/ directory', () => {
      expect(detectGeneratorFingerprint({ filePaths: ['.bolt/config.json'] })).toBe('bolt');
    });

    it('detects Replit from .replit / replit.nix', () => {
      expect(detectGeneratorFingerprint({ filePaths: ['.replit'] })).toBe('replit');
      expect(detectGeneratorFingerprint({ filePaths: ['replit.nix'] })).toBe('replit');
    });

    it('detects Cursor from .cursor/ or .cursorrules', () => {
      expect(detectGeneratorFingerprint({ filePaths: ['.cursorrules'] })).toBe('cursor');
      expect(detectGeneratorFingerprint({ filePaths: ['.cursor/rules/foo.mdc'] })).toBe('cursor');
    });

    it('detects v0 from an explicit v0.dev provenance reference', () => {
      expect(detectGeneratorFingerprint({ pageText: 'Built with v0.dev' })).toBe('v0');
    });
  });

  it('is case-insensitive and tolerant of Windows path separators', () => {
    expect(detectGeneratorFingerprint({ filePaths: ['.BOLT\\config.json'] })).toBe('bolt');
    expect(
      detectGeneratorFingerprint({ packageJson: '{"devDependencies":{"Lovable-Tagger":"1"}}' }),
    ).toBe('lovable');
  });

  it('prefers the most specific builder when several weak signals overlap', () => {
    // A Lovable app opened in Cursor: both markers present. Lovable (the actual
    // builder that produced the code) must win over the editor marker.
    expect(
      detectGeneratorFingerprint({
        filePaths: ['.cursor/rules/x.mdc', '.lovable'],
        packageJson: JSON.stringify({ devDependencies: { 'lovable-tagger': '1' } }),
      }),
    ).toBe('lovable');
  });

  it('does not misattribute an incidental substring outside a real marker', () => {
    // The word "cursor" appears (CSS cursor property) but no .cursor marker.
    expect(
      detectGeneratorFingerprint({
        filePaths: ['src/styles.css', 'app/page.tsx'],
        pageText: 'button { cursor: pointer; }',
      }),
    ).toBe('unknown');
  });

  it('only scans a bounded prefix of very large bundle text', () => {
    const marker = 'gpteng.co';
    const hugePrefix = 'x'.repeat(500_000);
    // Marker sits far past the scan window → not detected (bounded, no huge work).
    expect(detectGeneratorFingerprint({ pageText: hugePrefix + marker })).toBe('unknown');
    // Marker within the window → detected.
    expect(detectGeneratorFingerprint({ pageText: marker + hugePrefix })).toBe('lovable');
  });

  it('exposes the known fingerprints in a stable, deduplicated set', () => {
    expect(new Set(KNOWN_GENERATOR_FINGERPRINTS).size).toBe(KNOWN_GENERATOR_FINGERPRINTS.length);
    expect(KNOWN_GENERATOR_FINGERPRINTS).not.toContain('unknown');
  });
});
