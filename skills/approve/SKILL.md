---
name: approve
description: Owner-only, one-use permission to merge, push or commit on a protected branch (main). Only works when a person types /lanekeeper:approve in the prompt.
argument-hint: "merge-main|push-main|commit-main [branch-or-commit] | status | revoke"
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
