---
name: integrate
description: Merge reviewed lane branches into the integration branch with a trial merge, conflict classes (code, ledger, registration, generated), rule-based resolution, regeneration, a reserved number check and guards; a code conflict aborts and sends a return brief to the lane. Use when the user runs /lanekeeper:integrate or after /lanekeeper:review-lane passes.
---

# Lanekeeper integrate

Run in the integration worktree, one lane branch at a time, in the order the lanes passed review. The tool never resolves a code conflict and never commits a merge whose guards fail.

## Steps

1. Preconditions: the lane passed `/lanekeeper:review-lane`, the integration worktree is clean, no gate is running (`<git common dir>/lanekeeper/gate.lock`).
2. Trial run first when the lane is large: `lanekeeper-integrate <lane-branch> --dry-run`.
3. `lanekeeper-integrate <lane-branch> --lane <lane> --wave <wave> --trailer "<commit trailer>"`.
   - Exit 0: merged and committed. Exit 1: aborted, a return brief was written. Exit 2: not started (dirty tree, merge in progress, unknown branch). Exit 3: a gate or another integration holds the lock; wait and run again.
4. On a code conflict the brief asks the lane to merge the current integration HEAD into its branch, resolve the conflict there and hand back a fast-forwardable HEAD. This rule has no exception while the integration worktree serves a running app.
5. After every lane of the wave is merged: run the full verification once (`/lanekeeper:test-report`, name `integration`), restart the servers the change affects (`machine.servers`), then remove the finished lane worktrees with `lanekeeper-worktree remove` (it stops processes started inside them by PID first).

## Conflict classes

`project.integrate.rules` maps globs to a class; the first match wins and anything unmatched is code.

| Class | Resolution |
|---|---|
| ledger | JSON rows keyed by `id` are united; on a shared id the integration side wins; retired ids stay retired |
| union | JSON registration files (hooks.json and the like): objects merged, lists united, integration side wins on a scalar |
| generated | integration side taken, then `project.integrate.regenerate` commands run (a rule with `glob` runs only when a matching file came in) |
| code | abort, tree restored, return brief |

After resolution: reserved number series (`project.numbers`) are checked for a number used twice, then `project.integrate.guards` run on the merged tree. Any failure aborts the merge and writes a return brief.

## Do not

- Do not resolve code conflicts by hand in the integration worktree.
- Do not merge to the protected main branch. When the wave is verified, stop at "ready to merge" and wait for the owner's order (`/lanekeeper:approve`).
- Do not push.
