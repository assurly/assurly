import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseStoredPreference,
  resolveTheme,
  THEME_BOOTSTRAP_CSP_HASH,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
} from './theme';

describe('theme', () => {
  it('resolves explicit light and dark regardless of the OS', () => {
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
  });

  it('follows the OS when preference is system', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });

  it('falls back to system for missing or invalid stored values', () => {
    expect(parseStoredPreference(null)).toBe('system');
    expect(parseStoredPreference('')).toBe('system');
    expect(parseStoredPreference('sepia')).toBe('system');
    expect(parseStoredPreference('light')).toBe('light');
    expect(parseStoredPreference('dark')).toBe('dark');
    expect(parseStoredPreference('system')).toBe('system');
  });

  it('keeps the bootstrap script aligned with the storage key', () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('data-theme');
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('prefers-color-scheme');
  });

  it('keeps the CSP hash locked to the bootstrap script', () => {
    const digest = createHash('sha256').update(THEME_BOOTSTRAP_SCRIPT, 'utf8').digest('base64');
    expect(THEME_BOOTSTRAP_CSP_HASH).toBe(`sha256-${digest}`);
  });

  it('does not put a nonce on the blocking bootstrap script', () => {
    const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
    expect(layout).toContain('THEME_BOOTSTRAP_SCRIPT');
    expect(layout).not.toMatch(/<script nonce=/);
  });
});
