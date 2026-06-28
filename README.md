# ShipReady Monorepo

ShipReady is a professional production-readiness verifier designed to scan B2B SaaS applications for configuration, security, and integration errors, especially those introduced by AI code generators.

## Structure

This project is organized as a monorepo utilizing npm workspaces:

- `packages/cli`: The core local static analysis CLI tool (`npx shipready`).
- `packages/vscode-extension`: The VS Code editor integration and dashboard.
- `apps/web`: The Next.js landing page, documentation, and web audit portal.

## Getting Started

1. Install dependencies from the root directory:
   ```bash
   npm install
   ```
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and configure Supabase,
   Stripe, and the GitHub App. Provider redirects always use `APP_URL`; Stripe and
   GitHub webhook endpoints reject requests when their signing secrets are absent.
   For local GitHub OAuth, add
   `http://localhost:3000/api/auth/callback` to the Supabase Auth redirect allow
   list. Open the app at `http://localhost:3000` so the OAuth PKCE cookie and
   callback share the same browser origin.
3. Build the CLI package:
   ```bash
   npm run build:cli
   ```
4. Run the Next.js web application locally:
   ```bash
   npm run dev:web
   ```

## Development and Guidelines

Please refer to [requirements.md](./requirements.md) for strict senior coding guidelines, security specifications, and testing strategies.
