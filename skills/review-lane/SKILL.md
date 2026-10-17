---
name: review-lane
description: Review a lane's result against the nine review items (HEAD, report, guards, failure before the fix, brief scope, captures, served code, test results, terms) and send a return brief to the lane when an item fails. Use when the user runs /wb:review-lane, when a lane reports back, or when the lane board shows a lane waiting for review.
---

# wb review-lane

The checks are mechanical and run with `wb-check lane`. The report file in the scratch folder is the source of truth; the lane's returned message is compared against it.

## Steps

1. Find the lane: `wb-waves board` (lanes in `review`). Note the wave, the lane id, the lane worktree, the lane report path (`paths.lane_reports`) and the brief (`paths.briefs`).
2. Route the review with `wb-route resolve review --implementer <lane model>`. The review floor is opus; when the only model left is the implementer's, review in a fresh context and say so in the result.
3. If the lane changed UI, open every capture listed in the report with the Read tool before step 4. Only then pass `--captures-seen`. For a web UI, restart the affected server first and pick a URL of served code plus a marker string the change adds (a class name, a text, a test id).
4. Run from the integration worktree:

   ```
   wb-check lane <lane> --report <report.md> --return <returned-message.txt> --brief <brief.md> \
     --lane-dir <lane worktree> [--head <sha>] [--capture <png>]... [--captures-seen] \
     [--serve-url <url> --marker <text>] [--stage lane|integration|final] --wave <wave> --record
   ```

   Without `--head` the HEAD named in the report is used. `--stage integration` or `final` replaces item 8 with the committed result workbook check (`wb-check test-results`).
5. Exit 0: the lane is marked done in the ledger. Go on with `/wb:integrate`.
6. Exit 1: a return brief was written to `.wb/briefs/<lane>-return-<n>.md` and the ledger counts one return. Show the user the failed items and ask whether to send the brief back. If yes, dispatch it to the same lane (same `lane=` marker) with the routed model.

## The nine items

| # | Item | Fails when |
|---|---|---|
| 1 | Reported HEAD | missing, unknown, or the integration HEAD is not its ancestor |
| 2 | Report file | missing, no HEAD / tests / remaining items, or HEAD or pass count differs from the returned message |
| 3 | Project guards | a command in `project.review.guards` exits non-zero (none configured = skip) |
| 4 | Failure before the fix | code changed and the report does not record the failing run before the fix |
| 5 | Brief scope | a changed file is outside the brief's owned files or on its forbidden list (no list = skip) |
| 6 | Captures | UI change without captures, a capture file is missing, or the main session has not opened them |
| 7 | Served code marker | web UI change without `--serve-url`/`--marker`, or the served code lacks the marker |
| 8 | Test results | lane: no passed count or failures in the report; integration/final: no committed workbook for this HEAD |
| 9 | Terms | `wb-check terms` grew over its baseline or a new term is not queued for `/wb:decide` (no glossary or no check = skip) |

A UI change is a changed file matching `project.mockup.ui_globs`, or, without globs, a `.tsx/.jsx/.vue/.svelte/.html/.css` file in a `web-ui` project.

## Do not

- Do not mark captures as seen without opening them.
- Do not edit the lane's code to make an item pass. Send the return brief.
- Do not loosen `project.review.guards` to get a pass.
