import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthenticationError, COOKIE_NAME, requireUser, type AuthContext } from './auth';
import { AuthorizationError } from './authorization';
import { ConfigurationError, getApplicationUrl, isTrustedDevOrigin } from './env';
import { GitHubApiError, GitHubWriteAccessError } from './githubApp';
import { enforceIpRateLimit, enforceUserRateLimit, type RateLimitPolicy } from './rateLimit';

export const emptyObjectSchema = z.object({}).strict();
export const emptyBodySchema = z.undefined();
export const RATE_LIMITS = {
  read: { limit: 120, windowSeconds: 60 },
  write: { limit: 30, windowSeconds: 60 },
  sensitive: { limit: 10, windowSeconds: 60 },
  expensive: { limit: 5, windowSeconds: 60 },
  public: { limit: 60, windowSeconds: 60 },
  contact: { limit: 5, windowSeconds: 600 },
  webhook: { limit: 300, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export type AuthMode = 'none' | 'optional' | 'required';
export type BodyMode = 'none' | 'json' | 'raw';

export interface SecureRouteConfig<Query, Body, Params = Record<string, never>> {
  routeId: string;
  auth: AuthMode;
  query: z.ZodType<Query>;
  body: z.ZodType<Body>;
  params: z.ZodType<Params>;
  bodyMode: BodyMode;
  maxBodyBytes: number;
  rateLimit: RateLimitPolicy;
  csrf?: boolean;
}

export interface SecureRouteContext<Query, Body, Params = Record<string, never>> {
  request: Request;
  requestId: string;
  query: Query;
  body: Body;
  params: Params;
  auth: AuthContext | null;
}

export type SecuredRouteHandler<
  Query = unknown,
  Body = unknown,
  Params = Record<string, never>,
> = ((request: Request, routeContext?: { params?: Promise<unknown> }) => Promise<Response>) & {
  readonly security: Readonly<SecureRouteConfig<Query, Body, Params>>;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class RequestValidationError extends ApiError {
  constructor() {
    super(400, 'invalid_request', 'Request validation failed.');
    this.name = 'RequestValidationError';
  }
}

function requestId(request: Request): string {
  const supplied = request.headers.get('x-request-id');
  return supplied && /^[A-Za-z0-9_-]{8,80}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function queryInput(url: URL): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams) {
    const current = result[key];
    result[key] =
      current === undefined
        ? value
        : Array.isArray(current)
          ? [...current, value]
          : [current, value];
  }
  return result;
}

async function readBody(request: Request, mode: BodyMode, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(413, 'payload_too_large', 'Request payload is too large.');
  }
  if (mode === 'none') {
    if (declaredLength > 0)
      throw new ApiError(400, 'invalid_request', 'Request body is not allowed.');
    return undefined;
  }
  if (
    mode === 'json' &&
    !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')
  ) {
    throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new ApiError(413, 'payload_too_large', 'Request payload is too large.');
  }
  const text = new TextDecoder().decode(buffer);
  if (mode === 'raw') return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

function usesSessionCookie(request: Request): boolean {
  return (
    !request.headers.get('authorization') &&
    request.headers
      .get('cookie')
      ?.split(';')
      .some((item) => item.trim().startsWith(`${COOKIE_NAME}=`)) === true
  );
}

function enforceTrustedOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const allowed =
    origin !== null &&
    (origin === getApplicationUrl() ||
      (process.env.NODE_ENV !== 'production' && isTrustedDevOrigin(origin)));
  if (!allowed) {
    throw new ApiError(403, 'invalid_origin', 'Request origin is not allowed.');
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'same-site'].includes(fetchSite)) {
    throw new ApiError(403, 'invalid_origin', 'Cross-site request is not allowed.');
  }
}

function safeError(
  id: string,
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, requestId: id } },
    { status, headers: { 'X-Request-ID': id, ...headers } },
  );
}

function normalizeError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof ApiError) return error;
  if (error instanceof AuthenticationError) {
    return { status: 401, code: 'unauthorized', message: 'Authentication is required.' };
  }
  if (error instanceof AuthorizationError) {
    return { status: 404, code: 'not_found', message: 'Resource not found.' };
  }
  if (error instanceof ConfigurationError) {
    return {
      status: 503,
      code: 'service_unavailable',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Service is unavailable.',
    };
  }
  if (error instanceof GitHubApiError) {
    if (error.status === 404 || error.status === 422) {
      return {
        status: 404,
        code: 'repository_unavailable',
        message:
          'This repository is not accessible to the Assurly GitHub App installation. Re-install the app or grant it access to this repository, then try again.',
      };
    }
    if (error.status === 401) {
      return {
        status: 503,
        code: 'github_not_configured',
        message: 'GitHub integration is unavailable.',
      };
    }
    if (error.status === 503) {
      return {
        status: 503,
        code: 'github_not_configured',
        message: 'GitHub integration is unavailable.',
      };
    }
    return {
      status: 502,
      code: 'github_unavailable',
      message: 'GitHub is temporarily unavailable.',
    };
  }
  if (error instanceof GitHubWriteAccessError) {
    return {
      status: 403,
      code: 'github_write_permission_required',
      message: error.message,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 502,
      code: 'invalid_upstream_response',
      message: 'Upstream response is invalid.',
    };
  }
  return { status: 500, code: 'internal_error', message: 'Internal server error.' };
}

function logRequest(details: Record<string, unknown>): void {
  console.info(JSON.stringify({ service: 'assurly-api', ...details }));
}

export function secureRoute<Query, Body, Params = Record<string, never>>(
  config: SecureRouteConfig<Query, Body, Params>,
  handler: (context: SecureRouteContext<Query, Body, Params>) => Promise<Response>,
): SecuredRouteHandler<Query, Body, Params> {
  const secured = async (
    request: Request,
    routeContext?: { params?: Promise<unknown> },
  ): Promise<Response> => {
    const id = requestId(request);
    const startedAt = Date.now();
    let auth: AuthContext | null = null;
    try {
      let parsedQuery: Query;
      let parsedBody: Body;
      let parsedParams: Params;
      try {
        parsedQuery = config.query.parse(queryInput(new URL(request.url)));
        parsedParams = config.params.parse((await routeContext?.params) || {});
        parsedBody = config.body.parse(
          await readBody(request, config.bodyMode, config.maxBodyBytes),
        );
      } catch (error) {
        if (error instanceof z.ZodError) throw new RequestValidationError();
        throw error;
      }

      const ipRateLimit = await enforceIpRateLimit(request, config.routeId, config.rateLimit);
      if (!ipRateLimit.allowed) {
        throw new ApiError(429, 'rate_limited', 'Too many requests.');
      }

      if (config.auth !== 'none') {
        try {
          auth = await requireUser(request);
        } catch (error) {
          if (config.auth === 'required') throw error;
          if (!(error instanceof AuthenticationError)) throw error;
        }
      }
      if (config.csrf && usesSessionCookie(request)) enforceTrustedOrigin(request);

      const userRateLimit = auth
        ? await enforceUserRateLimit(config.routeId, config.rateLimit, auth)
        : null;
      if (userRateLimit && !userRateLimit.allowed) {
        throw new ApiError(429, 'rate_limited', 'Too many requests.');
      }
      const remaining = userRateLimit
        ? Math.min(ipRateLimit.remaining, userRateLimit.remaining)
        : ipRateLimit.remaining;

      const response = await handler({
        request,
        requestId: id,
        query: parsedQuery,
        body: parsedBody,
        params: parsedParams,
        auth,
      });
      response.headers.set('X-Request-ID', id);
      response.headers.set('X-RateLimit-Remaining', String(remaining));
      logRequest({
        requestId: id,
        route: config.routeId,
        method: request.method,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      const normalized = normalizeError(error);
      const retryHeaders = normalized.status === 429 ? { 'Retry-After': '60' } : undefined;
      logRequest({
        requestId: id,
        route: config.routeId,
        method: request.method,
        status: normalized.status,
        durationMs: Date.now() - startedAt,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      return safeError(id, normalized.status, normalized.code, normalized.message, retryHeaders);
    }
  };
  return Object.assign(secured, { security: Object.freeze({ ...config }) });
}

export function requireRouteUser(context: AuthContext | null): AuthContext {
  if (!context) throw new AuthenticationError();
  return context;
}

export function assertTrustedRedirect(value: string, allowedOrigins: string[]): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(502, 'invalid_upstream_response', 'Upstream redirect URL is invalid.');
  }
  if (url.protocol !== 'https:' || !allowedOrigins.includes(url.origin)) {
    throw new ApiError(502, 'invalid_upstream_response', 'Upstream redirect URL is not trusted.');
  }
  return url.toString();
}
