import { describe, expect, it } from 'vitest';
import { UrlSafetyError } from '../urlSafety';
import {
  assertSupabaseManagementApiUrl,
  buildProdWatchLogsUrl,
  PROD_WATCH_LOGS_SQL,
} from './fetchLogs';

describe('Prod Watch fetch security', () => {
  it('builds URLs only against the hardcoded Management API host', () => {
    const url = buildProdWatchLogsUrl('abcdefghijklmnopqr', Date.parse('2026-07-26T12:00:00Z'));
    expect(url.startsWith('https://api.supabase.com/v1/projects/abcdefghijklmnopqr/')).toBe(true);
    expect(url).toContain('sql=');
    expect(PROD_WATCH_LOGS_SQL).toContain("source = 'edge_logs'");
    expect(PROD_WATCH_LOGS_SQL).not.toMatch(/ip|user_agent|event_message/i);
  });

  it('rejects customer-controlled hosts', () => {
    expect(() => assertSupabaseManagementApiUrl('https://evil.example/v1/projects/x/analytics')).toThrow(
      UrlSafetyError,
    );
    expect(() =>
      assertSupabaseManagementApiUrl('https://api.supabase.com.evil.example/v1/projects/x'),
    ).toThrow(UrlSafetyError);
  });

  it('allows only the Management API path prefix on the allowlisted host', () => {
    expect(() =>
      assertSupabaseManagementApiUrl('https://api.supabase.com/v1/projects/abc/analytics/endpoints/logs'),
    ).not.toThrow();
    expect(() => assertSupabaseManagementApiUrl('https://api.supabase.com/v1/oauth/token')).toThrow(
      UrlSafetyError,
    );
  });
});
