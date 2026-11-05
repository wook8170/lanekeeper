---
name: resume
description: Resume interrupted wave work. Builds a report from progress.md, git status, worktree list, recent commits and the lane ledger, lists what is stale, and re-dispatches stopped lanes. Use when the user runs /lanekeeper:resume, after a usage limit or crash, or when lanes show as stopped.
---

# Lanekeeper resume

1. Run `lanekeeper-waves resume` and show the whole report. Sections: current state (the whole `progress.md`; only the newest section when the file is an oversized accumulated one), the archive location, git state, lanes with a verdict, stale items, next steps. Past history is in `docs/progress-archive/`; search it with `grep -n '<keyword>' docs/progress-archive/*.md` only when a lane needs an earlier decision.
2. **Report stale items first**, before any new work: progress.md older than the last work, progress.md over the line target (`lanekeeper-waves handoff migrate` moves an accumulated file to the archive), lanes marked running with no activity, missing or unregistered worktrees, uncommitted changes in a lane worktree, dispatches that never started an agent, agents with no stop record. Wait for the user's answer when an item needs a decision (delete a worktree, discard changes).
3. Lane verdicts:
   - `done`, `agent running`, `recently active`: leave alone.
   - `waiting for review`: review it (`/lanekeeper:review-lane`); do not start it again.
   - `stopped without finishing`, `not started`, `failed`, `blocked`: dispatch again. Get the text with `lanekeeper-waves resume --prompt <wave>/<lane>` (brief path, worktree, last commit, open to-dos) and send it through the Agent tool with the model the routing check allows (`lanekeeper-route`). A stopped lane resumes in its own worktree; never create a second one.
4. Before a lane is dispatched again, run `lanekeeper-waves status <wave> <lane> pending`. The SubagentStart hook sets it to `running` and counts the run.
5. Do not delete worktrees, branches or ledger entries in this skill. Report them and let the user decide.

`lanekeeper-waves resume --stale-min <n>` changes the idle limit (default `project.waves.stale_min`, 20). `--json` gives the same report as data.
