---
name: test-report
description: Run the project's verification (gate, unit, integration, e2e) and save the results as an Excel workbook with a summary json under docs/test-results/. Use when the user runs /wb:test-report, asks for test results as Excel, or when an integration or final verification needs evidence.
---

# wb test-report

Results come from vitest, jest, Playwright and pytest. The workbook has a fixed sheet layout; a sheet without data is not created.

## Steps

1. `wb-test-report env`. Without Python 3.8+ and openpyxl it prints the install commands and exits 3. Show them to the user and stop. Do not install anything yourself.
2. First time in a project: `wb-test-report init` writes `.wb/verify.config.json`. Edit `gate` (a package.json script that chains commands with `&&`, or an explicit `steps` list) and `stages` (one entry per tool: `adapter` vitest|jest|playwright|pytest, `kind` unit|integration|e2e|uistab, `cmd` with `{file}` for the structured output path, `slot` heavy|`heavy,browser`|none). Commit the file.
3. Run `wb-test-report run --name <name>` (names: `integration`, `final`, a lane id). Every stage runs even when an earlier one fails. Heavy stages run through `wb-slot`. Add `--only a,b` or `--skip a,b` for a partial run, `--ledger-priority P0` to flag active P0 cases missing from the run.
4. The workbook and its summary json are written to `paths.test_results` (default `docs/test-results/<date>/<name>-<HHMM>.xlsx` and `.json`). Raw logs stay in `paths.test_runs_raw` (not committed). Commit the xlsx and the json. A full run (no `--only`/`--skip`) that passes on a clean tree also writes the gate pass stamp that protected merges need; committing only the result files afterwards keeps it valid.
5. A project that sets only `project.gate.command` (no `.wb/verify.config.json`): `wb-test-report gate-pass` runs that command and writes the stamp when it passes.
6. `wb-check test-results` confirms the newest workbook exists, is committed and, when a case ledger exists, matches the run.
7. Results from logs only: `wb-test-report build --name <name> --input vitest:unit:app=<json>[,log=<log>] --gate-json <gate.json>` (adapters vitest, jest, playwright, pytest; `--rerun playwright=<json>` marks tests that failed and then passed).

## Reading the workbook

Sheets: 요약 · 단위 · 통합 DB · e2e · e2e 상세 · UI 안정성 · gate 단계 · 실패 목록 · 간헐 실패 · 원장 대조 · 커버리지 · 변이. Flaky means passed after a retry inside the run or in a separate rerun. A ledger mismatch is an active case that failed, was skipped or did not run, a fixme case that passes, or a test that names an unknown or retired case id. Mismatches must be 0 for a ship decision.

## Contract with /wb:report

- Evidence: `wb-check test-results --json` returns `{ ok, file, json, items[] }`. Attach `file` (the xlsx path) and `json` to the report.
- Numbers for the chat: `wb-test-report summary --json` returns verdict, commit, counts per kind (unit, integration, e2e), gate steps, failures, flaky tests and ledger mismatches. Quote these figures; do not recount.
- A failed verdict is reported as failed, never rounded up. A `head_differs` warning means the run is not for the current HEAD; say so.

## Do not

- Do not write results into the owner's production data. Use a fixed test database for integration stages.
- Do not weaken a test to get a green workbook. Record an open defect with `wb-defects add` and mark the case `fixme` with `wb-cases set`.
