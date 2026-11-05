---
name: token-guard
description: Show or manage the token guard (official five-hour and seven-day usage from Claude Code, plus an estimate of local use since it was fetched, with staged instructions at 90/95/99 percent). Use when the user asks how much quota is left, about token guard, or to calibrate, turn on or off.
argument-hint: "status | on | off | calibrate --five <n> [--seven <n>] [--at HH:MM] | calibrate --check | calibrate [<weighted tokens>]"
---

# Lanekeeper token guard

A hook works out the usage percentage and speaks only when the stage rises: at the first stage it asks for shorter waves, at the middle stage for a handoff after every wave, at the last stage for a final handoff, a desktop notification and a wait. Stages are `personal.token_guard.stages` (default 90, 95, 99).

How the percentage is found:

1. Official value: Claude Code caches the five-hour and seven-day usage, their reset times and the account in `~/.claude.json` (`cachedUsageUtilization`). Only that entry and the account ID are read.
2. Estimate: when the latest point is older than `personal.token_guard.fresh_min` (default 10 minutes), the weighted local tokens since then are converted with a per-account ratio and added. The five-hour window starts five hours before its reset time; after a reset only the use since the reset counts.
3. The higher of the five-hour and seven-day figures decides the stage.
4. Calibration is automatic: every new official value is recorded, and the ratio comes from two points of the same window (or the latest point against the use since its window started). A usage-limit rejection in the logs is a 100% point. After an account switch, nothing of the previous account is used.
5. Fallback: without an official value, the local use of the last `window_hours` hours against `personal.token_guard.budget` (or the 100% derived from the account's ratio). With neither, the guard stays silent.

Commands:

- `status` (default): `lanekeeper-token status` shows the official value (fetch time, fresh or not, last 8 characters of the account, reset times), the estimate now with what was added, and where the ratio comes from.
- `on` / `off`: `lanekeeper-token on` / `lanekeeper-token off`
- `calibrate --five <n> [--seven <n>] [--at HH:MM]`: adds the percentages the user reads in `/usage` as a calibration point (`--at` = when they were read; default now). Use it when the user tells you the app's numbers.
- `calibrate --check`: lists the calibration points of the same window and the rate between them.
- `calibrate [<n>]`: sets the fallback budget. Without a number it uses the current weighted usage of the window.

Notes for the user: `source` (`auto`, `official`, `local`) chooses what is used. Local use covers only Claude Code on this machine, so the estimated part can differ from the app by a few points; the exact value is shown by `/usage`.
