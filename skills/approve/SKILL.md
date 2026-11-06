---
name: approve
description: Owner-only decisions. One-use permission to merge, push or commit on a protected branch (main), accepting a weakened test result, allowing bypassPermissions for the automatic resume, and clearing an old gate lock. Only works when a person types /lanekeeper:approve in the prompt.
argument-hint: "merge-main|push-main|commit-main [branch-or-commit] | accept-quality <kind> --reason <why> | retry-bypass | clear-gate-lock | status | revoke"
disable-model-invocation: true
---

# Lanekeeper approve

A hook has already handled this command before you saw it. Its result is in the context, starting with `[lanekeeper]`.

1. Report that result to the user in one or two sentences, in the user's language: the action, the branch or commit, the short commit id and the expiry time. If the hook refused the command, quote its reason.
2. Do not run the merge, push or commit now unless the user asked for it in the same message. The grant stays valid for one use until it expires.
3. Do not create, edit or delete the grant file yourself. The safety hook blocks it, and only a person typing `/lanekeeper:approve` can create a grant.

What the grant covers:

- It is valid once, for the stated time (default 15 minutes, `project.git.owner_grant_ttl_min`), and only for the exact commit recorded when it was typed. If the branch moves afterwards, the grant no longer matches.
- `merge-main` and `push-main` also need a gate pass stamp for the same commit when the project defines a gate command (`project.gate.command`).
- Force pushes are never allowed, with or without a grant.
- `/lanekeeper:approve status` shows the current grant; `/lanekeeper:approve revoke` deletes it.

These three take effect as soon as they are typed. The hook has already done the work, so run nothing for them, and they leave any active grant as it is:

- `accept-quality <kind> --reason <why>` accepts the weakened result of that kind on the commit of its newest result. It writes `accepted.json` in the results folder. Tell the user that this file still has to be committed.
- `retry-bypass` lets the automatic resume use `bypassPermissions`. Repeat the risk in your report: the resumed session runs any tool without asking, unattended. `lanekeeper-retry mode default` turns it off.
- `clear-gate-lock` removes `gate.lock` when it is older than `machine.slots.stale_after_min`. A newer lock is refused, because a gate may still be running.

`accept-quality` and `clear-gate-lock` have a second route that does not pass through this command: `lanekeeper-quality accept <kind> --reason "why"` or `lanekeeper-reap --gate-lock`, run alone on one line in the main session, raises a dialog for a person to answer. `retry-bypass` has no such route.
