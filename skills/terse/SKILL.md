---
name: terse
description: Turn terse mode (fewer output tokens and tool calls, code index first) on or off for this repository, or show its state. Use when the user asks for terse mode, to save tokens, or to shorten output.
argument-hint: "on | off | status"
---

# Lanekeeper terse mode

The switch is per repository (shared by its worktrees) and survives `/clear` and new sessions. The rules are injected at session start.

- `status` (default): `lanekeeper-terse status`
- `on`: run `lanekeeper-terse on`, then read `${CLAUDE_PLUGIN_ROOT}/rules/terse.en.md` (or `terse.ko.md` for Korean) and follow it from now on, because the hook injects it only at the next session start.
- `off`: run `lanekeeper-terse off`. Return to normal output.

Report the result in one line. Do not repeat the rules. `personal.terse: true` in `~/.lanekeeper/personal.json` turns the mode on for every repository that has no switch of its own.
