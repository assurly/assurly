# Dashboard production performance baseline

- Generated: 2026-06-27T11:20:43.848Z
- Target: `http://127.0.0.1:3000/dashboard`
- Thresholds: LCP < 2500 ms, CLS < 0.1, INP < 200 ms (lab INP when available)

## How to reproduce

```bash
cd apps/web
npm run perf:baseline
```

The script runs `next build`, starts `next start` on `127.0.0.1:3000`, then audits `/dashboard` with Lighthouse mobile (375px) and desktop profiles. Reports land in `apps/web/.perf-baseline/` and this file is refreshed automatically.

## Summary

| Profile | Performance | LCP     | CLS | INP       | Gate |
| ------- | ----------- | ------- | --- | --------- | ---- |
| Mobile  | 92          | 3353 ms | 0   | n/a (lab) | FAIL |
| Desktop | 100         | 679 ms  | 0   | n/a (lab) | PASS |

## Interpretation

- **Performance score ≥ 90 (mobile)** is the product DoD target from Fáza 5.3; raw Core Web Vitals thresholds below are the engineering gate for this baseline script.
- **INP** is often unavailable in lab mode; TBT is included below as a proxy until field INP or user-flow Lighthouse runs are added.

## Findings

### Mobile

- Final URL: `http://127.0.0.1:3000/dashboard`
- LCP element: “Secure your code before it reaches production.”
- LCP selector: `main.unauth-grid > section.unauth-left > div > h1`
- Top opportunities:
  - Eliminate render-blocking resources: Est savings of 330 ms (~332 ms)
  - Reduce unused JavaScript: Est savings of 166 KiB (~750 ms)
  - Reduce unused CSS: Est savings of 16 KiB (~30 ms)

### Desktop

- Final URL: `http://127.0.0.1:3000/dashboard`
- LCP element: “Secure your code before it reaches production.”
- LCP selector: `main.unauth-grid > section.unauth-left > div > h1`
- Top opportunities:
  - Eliminate render-blocking resources: Est savings of 110 ms (~108 ms)
  - Reduce unused JavaScript: Est savings of 165 KiB (~120 ms)
  - Reduce unused CSS: Est savings of 16 KiB (~0 ms)

## Notes

- Audits run against `npm run build` + `npm run start` (production bundle), not `next dev`.
- `/dashboard` is measured on the unauthenticated gate view during local baseline runs (`PERF_BASELINE=1` bypasses the auth redirect on localhost only). Re-run with a real session cookie to capture the signed-in dashboard.
- INP is only reported when Lighthouse exposes an lab INP audit; otherwise use TBT + manual interaction QA.

## Artifacts

- Mobile: `.perf-baseline/dashboard-mobile.json`, `.perf-baseline/dashboard-mobile.html`
- Desktop: `.perf-baseline/dashboard-desktop.json`, `.perf-baseline/dashboard-desktop.html`

## Raw metrics

### Mobile

- FCP: 1068 ms
- TBT: 76 ms

### Desktop

- FCP: 296 ms
- TBT: 0 ms
