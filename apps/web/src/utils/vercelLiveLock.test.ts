import { describe, expect, it } from 'vitest';
import {
  ignoredBuildStepUpdate,
  PRODUCTION_IGNORE_BUILD_STEP,
  projectForOrigin,
  promoteRequest,
} from './vercelLiveLock';

describe('vercel Live Lock helpers', () => {
  it('links only the project whose origin matches the guarded URL', () => {
    const match = projectForOrigin(
      [
        {
          id: 'prj_other',
          name: 'other',
          origins: ['https://other.example'],
          ignoredBuildStep: null,
        },
        {
          id: 'prj_owned',
          name: 'app',
          origins: ['https://app.example.com'],
          ignoredBuildStep: null,
        },
      ],
      'https://app.example.com',
    );
    expect(match?.id).toBe('prj_owned');
    expect(projectForOrigin([], 'https://app.example.com')).toBeNull();
  });

  it('does not replace a custom ignored-build command', () => {
    expect(ignoredBuildStepUpdate(null)).toBe('set');
    expect(ignoredBuildStepUpdate(PRODUCTION_IGNORE_BUILD_STEP)).toBe('already');
    expect(ignoredBuildStepUpdate('exit 1')).toBe('conflict');
  });

  it('promotes by creating a production deployment from the preview', () => {
    expect(promoteRequest('app', 'dpl_1')).toEqual({
      path: '/v13/deployments',
      body: {
        deploymentId: 'dpl_1',
        name: 'app',
        target: 'production',
        meta: { action: 'promote' },
      },
    });
  });
});
