---
name: approve
description: Owner-only decisions. One-use permission to merge, push or commit on a protected branch (main), or to merge one pull request of any repository, accepting a weakened test result, allowing bypassPermissions for the automatic resume, and clearing an old gate lock. This command only works when a person types /lanekeeper:approve in the prompt. All but bypassPermissions can also be confirmed in a dialog raised from the main session.
argument-hint: "merge-pr [pr] [--repo owner/name] | merge-main [branch-or-commit] [--to branch] | push-main [branch-or-commit] [--to branch] [--remote name] | commit-main [branch-or-commit] | accept-quality <kind> --reason <why> | retry-bypass | clear-gate-lock | status | revoke"
disable-model-invocation: true
---

# Lanekeeper approve

A hook has already handled this command before you saw it. Its result is in the context, starting with `[lanekeeper]`.

1. Report that result to the user in one or two sentences, in the user's language: the action, the branch or commit, the short commit id and the expiry time. If the hook refused the command, quote its reason.
2. Do not run the merge, push or commit now unless the user asked for it in the same message. The grant stays valid for one use until it expires.
3. Do not create, edit or delete the grant file yourself. The safety hook blocks it. A grant comes only from a person typing `/lanekeeper:approve`, or from the dialog in the last section.

What the grant covers:

- It is valid once, for the stated time (default 15 minutes, `project.git.owner_grant_ttl_min`), and only for the exact commit recorded when it was given. If the branch moves afterwards, the grant no longer matches.
- `merge-main` and `push-main` work only on the destination branch: `--to <branch>`, or by default the protected branch checked out now, or else the first protected branch in the settings. For `push-main`, the named target is used when it is a protected branch. `push-main` also works only for one remote address: `--remote <name>`, or by default the default remote of that branch.
- `merge-pr` covers one `gh pr merge` of that PR, in any folder: the repository, the PR, its head commit and its base branch all have to match what `gh pr view` says at the merge. It is stored outside the repository. It is spent only on the line `gh pr merge <number> --repo <host/owner/name> --match-head-commit <head> [--squash|--merge|--rebase|-d]`, with nothing before or after it. The grant output and the refusal message give that line. A `merge-main` grant does not apply to `gh pr merge`.
- `commit-main` covers one new commit of what is staged when the grant is given, so stage first. It is refused if the staged content changes, for `git commit -a`, `git commit <path>`, `--amend`, `cherry-pick`, `revert` and `am`, and if a command that can change the staged content is on the same line. Run `git commit` alone.
- One grant covers one change. A line with two or more changes to protected branches, or one inside a loop, is refused. A function called twice and a push with `--tags` or `--follow-tags` count as two.
- A push with `remote.<name>.push` on the line or in the repository is refused, because that setting changes the destination of a refspec without `:`. Writing it with `git config` raises a confirmation.
- `merge-main` and `push-main` also need a gate pass stamp for the same commit when the project defines a gate command (`project.gate.command`).
- Force pushes are never allowed, with or without a grant.
- `/lanekeeper:approve status` shows the current grant; `/lanekeeper:approve revoke` deletes it.

These three take effect as soon as they are typed. The hook has already done the work, so run nothing for them, and they leave any active grant as it is:

- `accept-quality <kind> --reason <why>` accepts the weakened result of that kind on the commit of its newest result. It writes `accepted.json` in the results folder. Tell the user that this file still has to be committed.
- `retry-bypass` lets the automatic resume use `bypassPermissions`. Repeat the risk in your report: the resumed session runs any tool without asking, unattended. `lanekeeper-retry mode default` turns it off.
- `clear-gate-lock` removes `gate.lock` when it is older than `machine.slots.stale_after_min`. A newer lock is refused, because a gate may still be running.

In the main checkout of a repository with no ref under `refs/`, `commit-main` on a protected branch grants the first commit. That grant stops working once the repository has a commit. An orphan branch or a linked worktree cannot get it.

Grants, `accept-quality` and `clear-gate-lock` have a second route that does not pass through this command: `lanekeeper-grant merge-main|push-main|commit-main [branch-or-commit] [--to branch] [--remote name]`, `lanekeeper-quality accept <kind> --reason "why"` or `lanekeeper-reap --gate-lock`, run alone on one line, raises a dialog for a person to answer. For a blocked `gh pr merge`, that is `lanekeeper-grant merge-pr <number> --repo <owner/name>`, which the refusal message spells out. This works only in the main session, and for grants only in `default` and `acceptEdits`. Before asking a person to type a slash command, run the matching command to raise the dialog first. After `lanekeeper-grant` is allowed, run the merge, push or commit it was for. For a PR, that is the exact line its output gives. `retry-bypass` has no such route, because it turns permission checks off.
