# Project Requirements: ShipReady (Senior Specifications)

This document defines the development, quality, and design standards for the ShipReady project. All files, code, and documentation must meet the criteria of a **top senior developer / architect** to ensure the project is ready for professional audits and a successful exit.

---

## 1. Code Quality & Architecture

- **Modularity & Clarity:** The codebase must not contain monolithic, bloated files. Logic must be strictly separated (Separation of Concerns).
- **Minimal Overhead:** Avoid unnecessary abstraction layers or redundant files. Every file must have a single, clear responsibility (Single Responsibility Principle).
- **Type Safety:** Strict TypeScript settings (`strict: true` in `tsconfig.json`). No `any` types allowed without a critical and documented reason. Explicitly define return types for functions and interfaces.
- **Code Documentation:**
  - All code comments must be written **exclusively in English**.
  - Comment only complex business logic or non-trivial AST (Abstract Syntax Tree) transformations. Avoid commenting self-documenting code.
- **Senior Directory Structure:** Use a clean monorepo structure utilizing npm workspaces. Keep libraries (CLI, shared rules) strictly separate from client platforms (Next.js web, VS Code extension).

---

## 2. Security Standard

- **100% Local Execution:** The CLI tool must never upload any of the user's source code to external servers for scanning. Static analysis must run entirely locally on the user's machine to protect their intellectual property (IP).
- **API Protection & Rate Limiting:** All Next.js API endpoints must be rate-limited and validated using the `zod` schema validation library.
- **Session Security (Auth):** Use industry-standard libraries for authentication (e.g., Clerk or Supabase Auth) utilizing secure, HttpOnly cookies.

---

## 3. Testing Strategy

- **Automated Testing (Vitest):** Every static analysis rule in the CLI must have an associated unit test verifying correct detection (covering both false positives and false negatives).
- **End-to-End Testing (Playwright):** Critical user paths on the web application (e.g., Stripe checkout flows, dashboard access) must be covered by E2E tests.
- **Audit-Ready Coverage:** Tests must achieve a minimum of 80% code coverage and be executable with a single command in the CI/CD pipeline.

---

## 4. UI/UX & Performance

- **Modern & Clean Aesthetics:** No generic AI-generated templates (avoid excessive neon gradients, overused glassmorphism, or default web typography). Use a highly refined, custom, and minimalist design system.
- **Typography & Contrast:** Utilize modern fonts (such as _Geist_ or _Inter_) with precise typographic hierarchy and high contrast for excellent readability.
- **100% Responsiveness:** The application must scale flawlessly across desktop monitors, laptops, tablets, and mobile devices (in both portrait and landscape modes).
- **Snappiness (Performance):** The web app must achieve a score of **95+ in Google Lighthouse** (LCP, INP, CLS). Provide instant feedback states and optimize assets (local fonts, WebP/AVIF formats).

---

## 5. Senior Architect Enhancements

The following tools and processes are implemented to ensure top senior-grade execution:

### A. Strict Git Hygiene

- **Husky & lint-staged:** Automatically format code (Prettier) and run linting (ESLint) before every git commit.
- **Conventional Commits:** Commit messages must follow the Conventional Commits specification (e.g., `feat(cli): add supabase rls rule`). This shows a professional, readable development history during acquisition audits.

### B. Architecture Decision Records (ADRs)

- Key architectural decisions (e.g., choosing `ts-morph` over raw Babel parsers) must be documented in a markdown-based ADR log. This allows auditors to quickly grasp the system design without reading the entire codebase.

### C. Performance Budgets

- **Bundle Size Monitoring:** Continuous monitoring of Next.js production builds to prevent importing bloated third-party dependencies.
- **Lighthouse CI:** Automatic accessibility (A11y) and performance checks executed during CI.
