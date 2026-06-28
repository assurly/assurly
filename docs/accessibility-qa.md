# Accessibility and Responsive QA

Last verified: 2026-06-21

## Automated coverage

`npm run test:e2e -w apps/web` runs the Chromium checks in
`apps/web/tests/e2e/accessibility.spec.ts`.

The suite verifies every public page (`/`, `/dashboard`, `/privacy`, and `/terms`) at 320, 390,
768, 1024, and 1440 px. Each of the 20 route/viewport combinations must have:

- no horizontal document overflow;
- exactly one `main` landmark and one `h1`;
- no visible, unnamed form controls;
- no visible application touch target below 44 × 44 px.

Additional tests cover the single-column mobile pricing/checkout presentation, WCAG A/AA axe
rules, focus trapping and restoration in the mobile menu, Escape handling, and reduced-motion
emulation.

## Manual browser verification

The same route/viewport matrix was checked against a production Next.js build. The accessibility
tree exposed named headings, landmarks, form controls, slider values, billing groups, and menu
state. Keyboard verification confirmed that focus enters the mobile menu, wraps from the first to
last item, closes with Escape, and returns to the opening button.

Automated checks complement, but do not replace, testing with users of assistive technology.
