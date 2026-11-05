---
name: lanes
description: Show the progress board of waves and lanes (status, model, runs and returns, to-dos, tokens, idle time) and record lane progress. Use when the user runs /lanekeeper:lanes, asks which lanes are running, or when a controller creates a wave or lane.
---

# Lanekeeper lanes

The lane ledger is `<git-common-dir>/lanekeeper/waves.json`; every worktree sees the same file. The shared state is written by `lanekeeper-waves` only. Do not edit the JSON by hand.

## Show the board

1. Run `lanekeeper-waves board`. Show the table to the user as it is.
2. Columns: status, model, task, runs/returns, to-dos done/total, checks pass/fail, tokens, idle time. `*` after the status means an agent is running now.
3. For token and model totals per lane run `lanekeeper-waves metrics`.
4. A lane in `review` has a finished agent and waits for the controller. A lane in `running` with a growing idle time and no `*` has probably stopped: tell the user and suggest `/lanekeeper:resume`.
5. Run `lanekeeper-slot check` and show its lines below the board: the 1-minute load, the tier (normal · light tasks only · new lanes held · heavy runs stopped), the thresholds (`machine.load.tiers`), the lanes with their role, slot use and orphan process candidates.
   - Tier "new lanes held": do not dispatch a new lane; messages to existing lanes are fine.
   - Tier "heavy runs stopped": verifier lanes' heavy runs are refused; executors wait for a slot.
   - Orphan candidates: suggest `lanekeeper-slot reap --orphans` to review them and, after the user agrees, `lanekeeper-slot reap --orphans --kill` (it stops exactly the listed PIDs, never by pattern).

## Create and update (controller)

```
lanekeeper-waves init-wave <wave> --title "<title>" --base-ref <ref>
lanekeeper-waves lane <wave> <lane> --task <type> --model <model> --brief <file> --todo "<item>" --todo "<item>"
lanekeeper-waves status <wave> <lane> pending|running|review|blocked|failed|done --note "<why>"
lanekeeper-waves return <wave> <lane> --reason "<what to fix>"
```

- `<lane>` is the same id as the lane worktree (`lanekeeper-worktree create <id>`) and the `lane=` attribute of the brief marker. The SubagentStart hook uses it to bind the agent to the lane, record the model and brief hashes, and count runs, returns and tokens.
- Mark a verifier lane with `lanekeeper-worktree create <id> --role verifier` or `role=verifier` in its brief marker, so a high load stops its heavy runs first.
- `return` is for a reviewer who sends a lane back. It counts one return and sets the lane to `pending`.
- An executor records its own progress with `lanekeeper-waves todo <wave> <lane> done <id>`, `lanekeeper-waves verify <wave> <lane> <name> pass|fail|skip` and `lanekeeper-waves note`. Add this rule to the brief.

## Status line

`settings.json` of the plugin sets `subagentStatusLine` to `"${CLAUDE_PLUGIN_ROOT}"/bin/lanekeeper-waves statusline`, one line such as `lanekeeper 2/3 running · l5:running l6:review`.
