import { describe, expect, it } from 'vitest';
import {
  buildDefaultWorkspaceName,
  isPlaceholderWorkspaceName,
  resolveWorkspaceDisplayName,
} from './workspaceName';

describe('workspaceName', () => {
  it('builds the default "{owner}\'s Workspace" label', () => {
    expect(buildDefaultWorkspaceName('tiborkutiksson')).toBe("tiborkutiksson's Workspace");
    expect(buildDefaultWorkspaceName('  acme  ')).toBe("acme's Workspace");
  });

  it('detects pre-username placeholder org names', () => {
    expect(isPlaceholderWorkspaceName("Developer's Workspace")).toBe(true);
    expect(isPlaceholderWorkspaceName("GitHub User's Workspace")).toBe(true);
    expect(isPlaceholderWorkspaceName('My Workspace')).toBe(true);
    expect(isPlaceholderWorkspaceName("acme's Workspace")).toBe(false);
  });

  it('replaces placeholder org names when a real owner label is available', () => {
    expect(resolveWorkspaceDisplayName("Developer's Workspace", 'tiborkutiksson')).toBe(
      "tiborkutiksson's Workspace",
    );
    expect(resolveWorkspaceDisplayName("GitHub User's Workspace", 'tibco87')).toBe(
      "tibco87's Workspace",
    );
  });

  it('keeps custom org names and avoids replacing with placeholder owners', () => {
    expect(resolveWorkspaceDisplayName('Acme Agency', 'tiborkutiksson')).toBe('Acme Agency');
    expect(resolveWorkspaceDisplayName("Developer's Workspace", 'GitHub User')).toBe(
      "Developer's Workspace",
    );
    expect(resolveWorkspaceDisplayName(null, null)).toBe('My Workspace');
  });
});
