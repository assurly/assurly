import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { scanProjectDirectory } from './scanProject';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BROKEN_PROJECT = path.join(REPO_ROOT, 'test-projects/broken-project');
const CLEAN_PROJECT = path.join(REPO_ROOT, 'test-projects/clean-project');

describe('scanProjectDirectory', () => {
  it('reports NOT READY TO SHIP for broken-project fixtures', async () => {
    const result = await scanProjectDirectory(BROKEN_PROJECT);
    expect(result.report.headline).toBe('NOT READY TO SHIP');
    expect(result.report.status).toBe('blocked');
    expect(result.report.blockers.length).toBeGreaterThan(0);
  });

  it('reports no blockers for clean-project fixtures', async () => {
    const result = await scanProjectDirectory(CLEAN_PROJECT);
    expect(result.report.blockers).toHaveLength(0);
    expect(result.report.status).not.toBe('blocked');
    expect(result.report.headline).not.toBe('NOT READY TO SHIP');
  });
});
