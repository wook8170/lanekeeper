---
name: auto-retry
description: Manage the automatic resume after a usage limit (status, on, off, cancel, permission mode, models recorded as out of quota). Use when the user asks about retry after a limit, auto resume, or when a limit stopped the work.
argument-hint: "status | on | off | cancel <id|all> | mode <mode> | limits"
---

# Lanekeeper auto-retry

When a usage limit ends a turn, a hook records the affected model in `limits.json` and schedules a one-shot job (macOS launchd, Linux systemd user timer, otherwise a background waiter) for two minutes after the reset time. The job resumes the session headless with `claude --resume <id> -p ...`. No model takes part in detection or scheduling, because no model can run during a limit.

Run the matching command and report the output briefly in the user's language:

- `status` (default): `lanekeeper-retry status`
- `on` / `off`: `lanekeeper-retry on` / `lanekeeper-retry off`
- `cancel <session id prefix | all>`: `lanekeeper-retry cancel <arg>`
- `mode <mode>`: `lanekeeper-retry mode <default|acceptEdits|plan|bypassPermissions>`
- `limits`: `lanekeeper-retry limits` (add `--clear` to forget the records)

Rules:

- The resumed session uses `personal.auto_retry.permission_mode`, default `default`. In that mode tools that need approval are refused in the unattended run, so the resumed work may stop at the first such tool and wait for the user.
- Never set `bypassPermissions` on your own initiative. If the user asks for it, show them the warning that `lanekeeper-retry mode bypassPermissions` prints and run it with `--i-understand` only when the user confirms in their own message.
- To continue a resumed session in chat, give the user the `claude --resume <id>` line from `lanekeeper-retry status`.
- Logs and state live in the Lanekeeper data folder under `auto-retry/`.
