import { describe, expect, it } from 'vitest';
import {
  describeDetectedStack,
  detectStackFromManifests,
  selectPackageManifestPaths,
} from './stackDetect';

describe('selectPackageManifestPaths', () => {
  it('skips node_modules, prefers shallower manifests, and caps the list', () => {
    const paths = [
      'apps/web/package.json',
      'package.json',
      'node_modules/next/package.json',
      'web/package.json',
      'packages/a/package.json',
    ];
    expect(selectPackageManifestPaths(paths, 3)).toEqual([
      'package.json',
      'web/package.json',
      'apps/web/package.json',
    ]);
  });
});

describe('detectStackFromManifests', () => {
  it('reads a nested web/package.json the way Attesta is laid out', () => {
    const stack = detectStackFromManifests({
      manifests: [
        {
          path: 'web/package.json',
          content: JSON.stringify({
            dependencies: {
              next: '16.0.0',
              stripe: '^17.0.0',
              '@supabase/supabase-js': '^2.0.0',
            },
          }),
        },
      ],
      filePaths: [
        'web/package.json',
        'web/src/app/page.tsx',
        'internal/handler/http/stripe_handler.go',
      ],
    });

    expect(stack).toEqual({
      framework: 'nextjs',
      database: 'supabase',
      payments: 'stripe',
      deployment: 'vercel',
    });
    expect(describeDetectedStack(stack)).toEqual({
      framework: 'Next.js',
      supabase: 'Detected',
      stripe: 'Detected',
    });
  });

  it('merges workspace member manifests when the root is a bare pointer', () => {
    const stack = detectStackFromManifests({
      manifests: [
        { path: 'package.json', content: JSON.stringify({ workspaces: ['apps/*'] }) },
        {
          path: 'apps/web/package.json',
          content: JSON.stringify({ dependencies: { next: '16.2.9', stripe: '^22.0.0' } }),
        },
      ],
      filePaths: ['package.json', 'apps/web/package.json', 'apps/web/vercel.json'],
    });

    expect(stack.framework).toBe('nextjs');
    expect(stack.payments).toBe('stripe');
    expect(stack.deployment).toBe('vercel');
  });

  it('skips malformed manifests instead of wiping the rest of the workspace', () => {
    const stack = detectStackFromManifests({
      manifests: [
        { path: 'apps/broken/package.json', content: '{ not json' },
        {
          path: 'apps/web/package.json',
          content: JSON.stringify({ dependencies: { next: '16.2.9' } }),
        },
      ],
    });
    expect(stack.framework).toBe('nextjs');
  });

  it('returns unknown defaults when there are no usable manifests', () => {
    expect(detectStackFromManifests({ manifests: [] })).toEqual({
      framework: 'unknown',
      database: 'none',
      payments: 'none',
      deployment: 'unknown',
    });
    expect(describeDetectedStack(detectStackFromManifests({ manifests: [] }))).toEqual({
      framework: 'Unknown',
      supabase: 'Not Detected',
      stripe: 'Not Detected',
    });
  });
});
