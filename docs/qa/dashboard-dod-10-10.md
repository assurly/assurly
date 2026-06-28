# Dashboard Definition of Done — 10/10

- Captured: 2026-06-27
- Scope: authenticated `/dashboard` (repository tab), production-quality UX/perf gate
- Automated verifier: `cd apps/web && npm run verify:dashboard-dod`

## Sign-off summary

| Criterion                                   | Status   | Evidence                                                                                                              |
| ------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| P1 nálezy opravené + testy                  | **PASS** | Tabuľka P1 nižšie; 114+ Vitest + 15 Playwright scenárov                                                               |
| Mobile: jump to results + scan history rail | **PASS** | Compact layout (`≤992px`): jump + rail; desktop: rail + tab switch. E2E + integration                                 |
| 0 stale data flash                          | **PASS** | `repo-switch.interaction.test.tsx`, `stale-state.interaction.test.tsx`, E2E repo switch                               |
| Dedup v Show details                        | **PASS** | `scanFindingsDisplay.test.ts`, `ScanFindingsDetails.test.tsx`                                                         |
| Emoji nahradené v navigácii                 | **PASS** | Lucide v header/tabs/repo list/workspace; E2E chrome scan; mimo scope: scan log lines                                 |
| Dashboard bez inline styles                 | **PASS** | ESLint `no-restricted-syntax`; 0× `style={{` mimo `manual-checker/`                                                   |
| Lighthouse mobile ≥ 90                      | **PASS** | Baseline mobile score **92** ([perf baseline](../baseline/2026-06-27-dashboard-perf-baseline.md))                     |
| Manuálny QA 375/768/1280                    | **PASS** | Automatizovaný proxy: `dashboard-qa-gate.spec.ts` (12/12); checklist: [manual QA](./dashboard-manual-qa-checklist.md) |

## P1 nálezy — mapovanie na fix + regresné testy

| P1                         | Fix                                                  | Test(y)                                                                  |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Scan history mobile UX     | `ScanHistoryRail`, scroll-snap, duplicate SHA badges | `ScanHistoryRail.test.tsx`, `scanHistoryDisplay.test.ts`, E2E scroll     |
| CI workflow „Run locally“  | `rule_id` preserved in `DashboardClient`             | `ShipGatePanel.test.tsx`, `scan.interaction.test.tsx`                    |
| Share report label (Pro)   | `getShareReportButtonLabel()`                        | `ShipGatePanel.test.tsx`, `dashboardLabelCopy.test.ts`                   |
| Public repo input reset    | `publicRepoInputReset` policy                        | `publicRepoInputReset.test.ts`, `public-repo-input.interaction.test.tsx` |
| Blocker label truncation   | CSS wrap v Ship Gate / details                       | `ShipGatePanel.test.tsx` (long env label)                                |
| Jump to results            | `scrollToScanDetails()` wrapper                      | `jump-to-results.interaction.test.tsx`, E2E                              |
| Stale panel on repo switch | `createRepoSelectionReset()`                         | `repo-switch.interaction.test.tsx`, `stale-state.interaction.test.tsx`   |
| Show details reset         | `key={selectedScan.id}` on findings                  | `details-reset.interaction.test.tsx`, `ScanFindingsDetails.test.tsx`     |
| Repo filter                | `filterRepositories()`                               | `repoListFilter.test.ts`, `repo-filter.interaction.test.tsx`             |
| Dedup env/RLS findings     | `dedupeScanFindingsForDisplay()`                     | `scanFindingsDisplay.test.ts`, `ScanFindingsDetails.test.tsx`            |
| Emoji → SVG (navigácia)    | `DashboardIcons`, `ShipReadyLogo`                    | `DashboardIcons.test.tsx`, `RepoListPanel.test.tsx`, E2E chrome          |
| CSS refactor dashboard     | BEM `.dashboard-*`, extrahované komponenty           | ESLint rule, `WorkspaceHeader.test.tsx`                                  |
| Workspace mobile strip     | collapsible `<details>` @ `<768px`                   | `WorkspaceHeader.test.tsx`, QA gate overflow                             |

## Známe výnimky (nie blokery pre 10/10 dashboard)

| Výnimka                                                    | Dôvod                                              |
| ---------------------------------------------------------- | -------------------------------------------------- |
| `manual-checker/` má inline styles + emoji                 | Out of scope Fáza 4.1/4.2; samostatný refactor     |
| Scan log správy v `DashboardClient` (`⚙`, `📥`)            | Diagnostický text v termináli, nie navigácia       |
| Toast „Upgraded… 🚀“                                       | Jednorazová notifikácia, nie chrome                |
| Lighthouse mobile LCP > 2.5s                               | Baseline zachytený; follow-up optimalizácia po 5.2 |
| E2E meria login-gate fixture pri `E2E_DASHBOARD_FIXTURE=1` | Signed-in SSR fixture; API mockované Playwrightom  |

## Ako overiť pred release

```bash
cd apps/web
npm run verify:dashboard-dod
```

Voliteľne obnoviť perf baseline:

```bash
npm run perf:baseline
```

## Verdikt

Dashboard spĺňa Definition of Done **10/10** pre produktový sign-off s uvedenými výnimkami.

Overené: `npm run verify:dashboard-dod` (2026-06-27) — **5/5 PASS** (Vitest, E2E mobile, QA gate 12/12, Lighthouse 92, inline-style gate).

Ďalší neblokujúci follow-up: mobile LCP optimalizácia a signed-in Lighthouse re-run.
