/**
 * Client-side shape check for the "Scan a Deployed URL" inputs so the button
 * reflects what the API will accept and the user gets immediate feedback —
 * NOT a security boundary. The server's `assertScannableUrl` (private-IP/SSRF
 * checks) remains the authority; it cannot run in the browser because it imports
 * `node:net`.
 *
 * Shared by the landing page (HomeClient) and the dashboard (DeployedUrlScan) so
 * both scanners validate identically.
 */
export function isLikelyScannableUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname.includes('.')
  );
}
