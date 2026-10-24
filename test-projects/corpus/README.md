# Precision corpus

Frozen projects with a known, hand-checked answer in `<case>.expected.json`, kept
beside the project so the scan never reads its own answer. `packages/cli/src/corpus.test.ts`
scans each one with the Full Gate engine (the one behind `npx assurly scan` and the
scan Assurly runs after every push) and fails CI when the result differs:

- **false positive:** an issue the case does not list;
- **missed defect:** a listed issue the scan no longer reports;
- **verdict drift:** a different status, headline, Ship Score or partial-coverage flag;
- **coverage or advisory drift:** a different set of "not checked" or "good to know" notes.

The comparison is exact, down to file and line, so a rule change cannot trade a
missed defect for a quieter report (or the reverse) without someone editing the
case's `.expected.json` in the same diff.

`apps/web/src/utils/corpusParity.test.ts` holds the web app to the same answers:
it scans each case through `dashboardScanEngine` (the Instant Gate behind the
dashboard and the landing page's free scan), with files read from disk as the
GitHub tree would list them, and through Manual Checker's uploaded-folder scan.
Rule ids and messages must match the CLI's exactly, so a new rule has to be wired
into every engine or one of the gates fails.

## Cases

| Case | What it pins |
| --- | --- |
| `live-target-blocked` | The live harness `tibco87/assurly-live-target`: three real defects, blocked. |
| `secured-saas-ready` | Next.js + Supabase + Stripe done right. Any issue here is a false positive. |
| `next-config-env-review` | `next.config` env keys need no docs (vercel/chatbot); a real undocumented variable does. |
| `go-backend-monorepo` | Payment and auth code in Go beside `apps/` must stop "ready" (Attesta). |
| `supabase-stripe-blocked` | Blockers point at the line that causes them; a secured table beside an open one is not blamed. |

## Adding a case

1. Create `test-projects/corpus/<case>/` with the smallest project that shows the
   behaviour. Distil real repositories; never copy private source verbatim.
2. Write `test-projects/corpus/<case>.expected.json`:

   ```json
   {
     "description": "What the project is and why the answer is what it is.",
     "origin": "Where it comes from (repo@commit, or 'written for the corpus').",
     "verdict": { "status": "review", "headline": "REVIEW RECOMMENDED", "shipScore": 96, "partialCoverage": false },
     "issues": [{ "ruleId": "undocumented-env", "severity": "warning", "file": "app/api/chat/route.ts", "line": 14 }],
     "knownFalsePositives": [],
     "coverage": [],
     "advisories": []
   }
   ```

   `issues` holds real defects only: check each one by reading the code, not by
   copying what the scanner printed. Leave out `file` or `line` when the finding
   has none.
3. When the scanner is wrong and the fix has to wait, list the finding under
   `knownFalsePositives`. It still has to match exactly, and the test fails once
   the finding disappears, so the entry is removed in the commit that fixes it.
4. Run `npm test -w packages/cli`.

Assurly skips `test-projects/` when it scans a repository, so these deliberate
defects never reach the self-scan or a dashboard scan of this repository.
