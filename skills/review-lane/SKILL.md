---
name: review-lane
description: Review a lane's result against the nine review items (HEAD, report, guards, failure before the fix, brief scope, captures, served code, test results, terms) plus the code standards items the checks cannot see when the project names a standards document and the readable code items (a fresh-eyes check with a few tasks, pieces cut in statement order, shared bundles, too many inputs), and send a return brief to the lane when an item fails. Use when the user runs /lanekeeper:review-lane, when a lane reports back, or when the lane board shows a lane waiting for review.
---

# Lanekeeper review-lane

The checks are mechanical and run with `lanekeeper-check lane`. The report file in the scratch folder is the source of truth; the lane's returned message is compared against it.

## Steps

1. Find the lane: `lanekeeper-waves board` (lanes in `review`). Note the wave, the lane id, the lane worktree, the lane report path (`paths.lane_reports`) and the brief (`paths.briefs`).
2. Route the review with `lanekeeper-route resolve review --implementer <lane model>`. The review floor is opus; when the only model left is the implementer's, review in a fresh context and say so in the result.
3. If the lane changed UI, open every capture listed in the report with the Read tool before step 4. Only then pass `--captures-seen`. For a web UI, restart the affected server first and pick a URL of served code plus a marker string the change adds (a class name, a text, a test id).
4. Run from the integration worktree:

   ```
   lanekeeper-check lane <lane> --report <report.md> --return <returned-message.txt> --brief <brief.md> \
     --lane-dir <lane worktree> [--head <sha>] [--capture <png>]... [--captures-seen] \
     [--serve-url <url> --marker <text>] [--stage lane|integration|final] --wave <wave> --record
   ```

   Without `--head` the HEAD named in the report is used. `--stage integration` or `final` replaces item 8 with the committed result workbook check (`lanekeeper-check test-results`).
5. Exit 0: the lane is marked done in the ledger. Go on with `/lanekeeper:integrate`.
6. Exit 1: a return brief was written to `.lanekeeper/briefs/<lane>-return-<n>.md` and the ledger counts one return. Show the user the failed items and ask whether to send the brief back. If yes, dispatch it to the same lane (same `lane=` marker) with the routed model.

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
| 9 | Terms | `lanekeeper-check terms` grew over its baseline or a new term is not queued for `/lanekeeper:decide` (no glossary or no check = skip) |

A UI change is a changed file matching `project.mockup.ui_globs`, or, without globs, a `.tsx/.jsx/.vue/.svelte/.html/.css` file in a `web-ui` project.

## Code standards (items the checks cannot see)

When `project.code_standards.doc` is set (`lanekeeper-config get project.code_standards`), read that section and check these items by hand for a lane that wrote, split or moved code. Rules are in `/lanekeeper:code-standards`. Check them before step 4 and run `lanekeeper-check lane` without `--record` while any item fails.

A failed item is a finding of the return brief. If `lanekeeper-check lane` also failed, add the item to the brief it wrote. If it passed, write the brief from `templates/review/<lang>/return.md` with the item as the finding, record it with `lanekeeper-waves return <wave> <lane> --reason "<item>"`, and send it back as in step 6.

| Item | Fails when |
|---|---|
| Characterization tests first | a split or move has no commit, before the split, that adds tests pinning the old behavior (`git log --stat` on the lane branch) |
| No `-u` after a move | a snapshot or golden file changed in a commit after the split, or the report shows a test run with `-u` / `--update` |
| Behavior kept | screen text, response bodies, status codes, test handles (`data-testid`, accessible names), the order of events and registrations, or log formats differ in the diff of a split or move |
| No re-export files | a file at an old path only re-exports the moved code (outside the public entry points the document lists) |
| Protected paths | a file outside `project.code_standards.protected_paths` imports a protected module named in the document |
| No allowance for new code | a new file or a new function is over the document's limits, or an existing large function grew instead of having the change moved out |

Read the lane's diff for these (`git diff <base>...<lane HEAD>`); do not trust the report alone. With no `doc`, skip this section and say so in the result.

## Readable code (fresh-eyes check)

Unless `project.code_standards.readability.enabled` is false (`lanekeeper-config get project.code_standards.readability`), check these items by hand for a lane that added, changed or split code. Rules are in `/lanekeeper:code-standards` under "Readable code"; a project document in `readability.doc` wins where it is more specific. A failed item is a finding of the return brief, sent the same way as the code standards items above.

| Item | Fails when |
|---|---|
| Fresh-eyes check | the report has no tasks, or fewer than 1 or more than `review_tasks` (default 3) tasks a first-time reader might get (for example "change the message shown when a drop on a locked shelf is refused"). Try each task yourself on the lane HEAD: it fails when finding the place to change takes more than 3 files or 300 lines, or the same rule must be changed in two places |
| Pieces cut in statement order | a new function, hook, component or file is named after its position or order (`part2`, `step3`, `createX2`, `helpers2`, `rest`) instead of what it does, or its body is a run of statements moved out of one function |
| Shared bundle | pieces pass one object of many values between them (`ctx`, `deps`, `c`, `state`) instead of the inputs each needs |
| Too many inputs | a function takes more than `max_params` (default 7) parameters, or one input object with more than `max_params` fields; a screen component (a React function component, Vue `defineProps`) takes more than `max_props` (default 12) props |
| Decision mixed with action | a handler both decides (allowed, rejected, what to change) and changes state, instead of asking a pure rule function and acting on its result; or the same clean-up repeats before every `return` |
| One rule, two copies | the same rule is written in two places (two frameworks, server and screen) instead of one pure function in a shared module |
| Comments and README | a comment holds history (version numbers, tickets, task numbers, design line numbers), a new file has no three-line header, or a new or changed domain folder has no README that matches the flow |

**Separate context for large changes.** When `fresh_eyes_review` is true (the default) and the lane is large (a split, a move or a refactoring, or a diff of more than 10 files or 500 changed lines), do not judge the fresh-eyes check in this session alone. Dispatch the agent `lanekeeper:design-adversary` at stage implementation, routed with `lanekeeper-route resolve adversarial`. Give it the lane diff, the tasks, the readable code rules as the invariants and a result folder in the scratch area. Every high finding goes into the return brief. With `fresh_eyes_review: false` the review in this session is enough.

## Do not

- Do not mark captures as seen without opening them.
- Do not edit the lane's code to make an item pass. Send the return brief.
- Do not loosen `project.review.guards` to get a pass.
