---
name: quality-unit
description: Run the project's unit test suites (category unit in project.quality.suites) through the run slots and archive the result as a common head JSON and a workbook under <results>/<version>/<date>/, then update the results index. Use when the user runs /wb:quality-unit, asks to run the unit tests with recorded results, or when /wb:ship-verify needs a fresh unit result.
---

# wb quality-unit

Unit tests are usually vitest, jest or pytest. The parser (`vitest`, `jest`, `pytest`, `vitest-log` for a monorepo log with one `Tests` line per package) turns the output into counts; `todo` counts as fixme.

## Steps

1. `wb-quality list` shows the configured suites. The suites of this skill are the ones with category `unit`. None configured: show the user the `quality.suites` example in the plugin's `examples/quality-config.json` and stop.
2. Commit or set aside your changes first. A run on a tree with uncommitted changes is recorded as stale and the ship precheck will not use it.
3. Run `wb-quality run --category unit` (or `wb-quality run <kind>` for one suite). Each suite runs its configured command through `wb-slot` (heavy suites wait for a free slot and for the load to drop). The common head JSON and the workbook go to `<results>/<version>/<date>/<kind>-<HHMM>.{json,xlsx}`, the log stays in the raw folder (not committed), and the index (`index.json`, `INDEX.md`) is rebuilt.
4. Quote the `[quality] … passed|failed · total … · passed … · failed … · skipped … · fixme …` line. Do not recount.
5. Failed: read `failures` in the JSON and the log in `raw.log`, fix the cause in the code, then run the suite again. Repeat until it passes. Implementation fixes go to a lane with a brief (the dispatch guard checks it); the lane runs only the tests it touched, and this skill runs the suite again after merging the fix.
6. Commit the JSON, the workbook, `index.json` and `INDEX.md`.

## Do not

- Do not weaken a test, add `skip`/`fixme`, lower a threshold or shorten the command to get a pass. The ship precheck compares every result with the previous passed one and blocks fewer tests, more skipped or fixme tests and loosened thresholds.
- Do not write test data into the owner's production database. Use the fixed test database the suite is configured for.
- Do not start a browser with a window. Browser suites run headless.
