'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';

export interface OwnershipVerifyProps {
  targetId: string;
  identifier: string;
  /** Invoked after ownership is proven so the caller can re-run the full probe. */
  onVerified: () => void;
}

type ChallengeMethod = 'meta_tag' | 'dns_txt' | 'file';

interface Challenge {
  token: string;
  metaTag: string;
  metaName: string;
  dnsRecord: string;
  filePath: string;
}

interface IssueResponse {
  verified: boolean;
  identifier: string;
  challenge: Challenge;
}

interface VerifyResponse {
  verified: boolean;
  method: ChallengeMethod;
}

const METHOD_LABELS: Record<ChallengeMethod, string> = {
  meta_tag: 'Meta tag',
  dns_txt: 'DNS record',
  file: 'Well-known file',
};

const METHOD_ORDER: ChallengeMethod[] = ['meta_tag', 'dns_txt', 'file'];

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: { message?: unknown } };
    const message = data.error?.message;
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // fall through
  }
  return response.statusText || `Request failed with status ${response.status}.`;
}

/**
 * The 60-second "prove this is your app" flow. Ownership is enforced server-side;
 * this surface only helps the owner place the challenge and trigger the check.
 */
export function OwnershipVerify({
  targetId,
  identifier,
  onVerified,
}: OwnershipVerifyProps): ReactElement {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [method, setMethod] = useState<ChallengeMethod>('meta_tag');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadChallenge = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      const response = await fetch(`/api/targets/${targetId}/verify-ownership`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = (await response.json()) as IssueResponse;
      setChallenge(data.challenge);
      if (data.verified) onVerified();
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Could not load the verification token.',
      );
    }
  }, [targetId, onVerified]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadChallenge();
  }, [loadChallenge]);

  const currentValue = ((): string => {
    if (!challenge) return '';
    if (method === 'meta_tag') return challenge.metaTag;
    if (method === 'dns_txt') return challenge.dnsRecord;
    return challenge.token;
  })();

  const handleCopy = async (): Promise<void> => {
    if (!currentValue) return;
    try {
      await navigator.clipboard.writeText(currentValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable; the value is visible for manual copy.
    }
  };

  const handleVerify = async (): Promise<void> => {
    if (isVerifying) return;
    setIsVerifying(true);
    setNotFound(false);
    setLoadError(null);
    try {
      const response = await fetch(`/api/targets/${targetId}/verify-ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = (await response.json()) as VerifyResponse;
      if (data.verified) {
        onVerified();
        return;
      }
      setNotFound(true);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Verification failed. Please try again.',
      );
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <section className="ownership-verify" aria-label="Verify ownership">
      <h4 className="ownership-verify__title">Verify to run the full data-exfiltration test</h4>
      <p className="ownership-verify__copy">
        This was a safe, passive preview of <strong>{identifier}</strong>. Prove you own this app to
        unlock the active probe (live database read-access test). It takes about a minute.
      </p>

      <div className="ownership-verify__methods" role="tablist" aria-label="Verification method">
        {METHOD_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={method === option}
            className={`ownership-verify__method${method === option ? ' ownership-verify__method--active' : ''}`}
            onClick={() => {
              setMethod(option);
              setNotFound(false);
            }}
          >
            {METHOD_LABELS[option]}
          </button>
        ))}
      </div>

      {challenge ? (
        <div className="ownership-verify__instructions">
          {method === 'meta_tag' ? (
            <p className="ownership-verify__step">
              Add this tag inside the <code>&lt;head&gt;</code> of your site, then deploy:
            </p>
          ) : null}
          {method === 'dns_txt' ? (
            <p className="ownership-verify__step">
              Add this TXT record at your domain&apos;s DNS root, then wait for it to propagate:
            </p>
          ) : null}
          {method === 'file' ? (
            <p className="ownership-verify__step">
              Host a file at <code>{challenge.filePath}</code> containing exactly this token:
            </p>
          ) : null}

          <div className="ownership-verify__value">
            <code>{currentValue}</code>
            <button
              type="button"
              className="ownership-verify__copy-btn"
              onClick={() => void handleCopy()}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <button
            type="button"
            className="ownership-verify__submit"
            onClick={() => void handleVerify()}
            disabled={isVerifying}
            aria-busy={isVerifying}
          >
            {isVerifying ? 'Checking…' : 'Verify now'}
          </button>

          {notFound ? (
            <p className="ownership-verify__hint">
              We couldn&apos;t find the {METHOD_LABELS[method].toLowerCase()} yet. Make sure
              it&apos;s live (deploy / DNS propagation can take a few minutes), then try again.
            </p>
          ) : null}
        </div>
      ) : loadError ? null : (
        <p className="ownership-verify__hint">Loading your verification token…</p>
      )}

      {loadError ? <p className="ownership-verify__error">{loadError}</p> : null}
    </section>
  );
}
