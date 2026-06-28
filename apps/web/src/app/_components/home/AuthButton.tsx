'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface AuthButtonProps {
  authenticated: boolean;
  variant: 'primary' | 'secondary';
  labels: { signIn: string; dashboard: string };
  loginUrl: string;
  onNavigate: () => void;
}

/**
 * Renders a single <a> element regardless of auth state to guarantee
 * a consistent component tree during SSR and client hydration.
 *
 * Using <Link> for authenticated users and <a> for anonymous users would
 * produce structurally different React trees (LinkStatusContext.Provider
 * wrapper vs. bare element), causing hydration mismatches.
 */
export function AuthButton({
  authenticated,
  variant,
  labels,
  loginUrl,
  onNavigate,
}: AuthButtonProps): React.ReactElement {
  const router = useRouter();

  const href = authenticated ? '/dashboard' : loginUrl;
  const label = authenticated ? labels.dashboard : labels.signIn;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>): void => {
      onNavigate();
      if (authenticated) {
        // Preserve native browser behaviour for modified clicks (open in new
        // tab/window) and non-primary buttons. Only intercept a plain left
        // click for client-side navigation.
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        ) {
          return;
        }
        e.preventDefault();
        router.push('/dashboard');
      }
      // For the login URL, allow the natural full-page navigation to proceed.
    },
    [authenticated, onNavigate, router],
  );

  return (
    <a href={href} className={`btn btn-${variant}`} onClick={handleClick}>
      {label}
    </a>
  );
}
