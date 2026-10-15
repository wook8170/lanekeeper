---
name: token-guard
description: Show or manage the token guard (recent-window usage against a calibrated budget, with staged instructions at 90/95/99 percent). Use when the user asks how much quota is left, about token guard, or to calibrate, turn on or off.
argument-hint: "status | on | off | calibrate [<weighted tokens>]"
---

# wb token guard

A hook adds up the weighted tokens of the recent window (default 5 hours) from the local session transcripts and compares them with `personal.token_guard.budget`. It speaks only when the stage rises: at the first stage it asks for shorter waves, at the middle stage for a handoff after every wave, at the last stage for a final handoff, a desktop notification and a wait. Stages are `personal.token_guard.stages` (default 90, 95, 99).

- `status` (default): `wb-token status`
- `on` / `off`: `wb-token on` / `wb-token off`
- `calibrate [<n>]`: `wb-token calibrate [<n>]` sets the budget. Without a number it uses the current weighted usage, so run it when the app shows that the limit is reached.

Notes for the user: the figure counts only Claude Code use on this machine, and the percentage is an estimate that depends on the calibrated budget. Budget 0 (the default) means not calibrated and the guard stays silent. The exact value is shown by `/usage`.
