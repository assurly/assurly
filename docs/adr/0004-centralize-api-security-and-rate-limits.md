# ADR 0004: Centralize API security and database-backed rate limits

- Status: Accepted
- Date: 2026-06-20

## Context

ShipReady runs Next.js Route Handlers on horizontally scaled serverless instances. Per-process counters are therefore neither consistent nor reliable for production rate limiting. Repeated route-local parsing and error handling also made it possible for security behavior to drift between endpoints.

## Decision

All Route Handlers use one `secureRoute` boundary that validates path parameters, query values, and request bodies with Zod before business logic executes. The boundary also applies payload limits, authentication policy, cookie-origin CSRF checks, request IDs, structured logs, safe errors, and route-specific rate policies.

Production rate counters are stored in a private Supabase schema and consumed through a service-role-only atomic RPC. IP and user identities are HMAC-pseudonymized before persistence. The implementation trusts Vercel's overwritten `x-forwarded-for` header; self-hosted deployments must provide an equivalent trusted reverse proxy. Missing production secrets or rate-limit storage fail closed.

Provider webhooks remain session-independent. They use raw bounded bodies, provider signatures, IP rate limits, and their existing idempotency ledgers.

## Consequences

- Security behavior is testable as one contract across every API handler.
- Rate limits are consistent across regions and function instances.
- No raw IP address or user identifier is stored in the limiter table.
- Every production request incurs one IP counter RPC and authenticated requests incur one additional user counter RPC.
- Fixed windows may reject a short burst at a window boundary; this is accepted for the current traffic profile.
