/**
 * Default org name written at first sign-in: "{owner}'s Workspace".
 */
export function buildDefaultWorkspaceName(ownerLabel: string): string {
  const trimmed = ownerLabel.trim();
  if (!trimmed) return 'My Workspace';
  return `${trimmed.slice(0, 80)}'s Workspace`;
}

/**
 * Names created by older auth fallbacks before we preferred the GitHub login.
 * These are safe to replace in the UI when a real owner label is available.
 */
export function isPlaceholderWorkspaceName(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return true;
  return (
    /^GitHub User's Workspace$/i.test(trimmed) ||
    /^Developer's Workspace$/i.test(trimmed) ||
    /^My Workspace$/i.test(trimmed)
  );
}

function isPlaceholderOwnerLabel(ownerLabel: string | null | undefined): boolean {
  const trimmed = ownerLabel?.trim() ?? '';
  if (!trimmed) return true;
  return /^GitHub User$/i.test(trimmed) || /^Developer$/i.test(trimmed);
}

/**
 * Prefer the stored org name unless it is a known placeholder from pre-username
 * signups — then derive "{login}'s Workspace" for display.
 */
export function resolveWorkspaceDisplayName(
  orgName: string | null | undefined,
  ownerLabel?: string | null,
): string {
  const trimmed = orgName?.trim() ?? '';
  if (!isPlaceholderWorkspaceName(trimmed)) {
    return trimmed;
  }
  if (!isPlaceholderOwnerLabel(ownerLabel)) {
    return buildDefaultWorkspaceName(ownerLabel!);
  }
  return trimmed || 'My Workspace';
}
