---
name: resume
description: Resume interrupted wave work. Builds a report from progress.md, git status, worktree list, recent commits and the lane ledger, lists what is stale, and re-dispatches stopped lanes. Use when the user runs /wb:resume, after a usage limit or crash, or when lanes show as stopped.
---

# wb resume

1. Run `wb-waves resume` and show the whole report. Sections: latest handoff, git state, lanes with a verdict, stale items, next steps.
2. **Report stale items first**, before any new work: progress.md older than the last work, lanes marked running with no activity, missing or unregistered worktrees, uncommitted changes in a lane worktree, dispatches that never started an agent, agents with no stop record. Wait for the user's answer when an item needs a decision (delete a worktree, discard changes).
3. Lane verdicts:
   - `done`, `agent running`, `recently active`: leave alone.
   - `waiting for review`: review it (`/wb:review-lane`); do not start it again.
   - `stopped without finishing`, `not started`, `failed`, `blocked`: dispatch again. Get the text with `wb-waves resume --prompt <wave>/<lane>` (brief path, worktree, last commit, open to-dos) and send it through the Agent tool with the model the routing check allows (`wb-route`). A stopped lane resumes in its own worktree; never create a second one.
4. Before a lane is dispatched again, run `wb-waves status <wave> <lane> pending`. The SubagentStart hook sets it to `running` and counts the run.
5. Do not delete worktrees, branches or ledger entries in this skill. Report them and let the user decide.

`wb-waves resume --stale-min <n>` changes the idle limit (default `project.waves.stale_min`, 20). `--json` gives the same report as data.
