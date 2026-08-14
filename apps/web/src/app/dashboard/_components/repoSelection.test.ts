import { describe, expect, it } from 'vitest';
import {
  createRepoSelectionReset,
  findingsMatchScan,
  markRepoDetailReady,
  resolveRepoDetailStatusAfterScans,
} from './repoSelection';
import type { ScanFinding } from '../../../utils/dbAdapter';

describe('repoSelection', () => {
  it('creates a full reset payload when switching repositories', () => {
    expect(createRepoSelectionReset()).toEqual({
      selectedScan: null,
      findings: [],
      scans: [],
      shareError: null,
      repoDetailStatus: 'loading',
      lastScanScope: null,
      lastScanFileCount: null,
    });
  });

  it('resolves empty status when a repo has no scans', () => {
    expect(resolveRepoDetailStatusAfterScans(0, false)).toBe('empty');
    expect(resolveRepoDetailStatusAfterScans(0, true)).toBe('loading');
    expect(resolveRepoDetailStatusAfterScans(3, false)).toBe('loading');
  });

  it('marks repo detail status as ready without downgrading an already-ready state', () => {
    expect(markRepoDetailReady('loading')).toBe('ready');
    expect(markRepoDetailReady('empty')).toBe('ready');
    expect(markRepoDetailReady('ready')).toBe('ready');
  });

  it('only accepts findings that belong to the selected scan', () => {
    const findings: ScanFinding[] = [
      {
        id: 'f-1',
        scan_id: 'scan-a',
        rule_id: 'rls',
        severity: 'error',
        file_path: 'schema.sql',
        message: 'Missing RLS',
        created_at: '2026-06-26T09:52:00Z',
      },
    ];

    expect(findingsMatchScan(findings, 'scan-a')).toBe(true);
    expect(findingsMatchScan(findings, 'scan-b')).toBe(false);
    expect(findingsMatchScan([], 'scan-a')).toBe(true);
    expect(findingsMatchScan(findings, undefined)).toBe(false);
  });
});
