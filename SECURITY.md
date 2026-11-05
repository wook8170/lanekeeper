<!-- LANG-SWITCH -->
**English** · [한국어](SECURITY.ko.md)

# Security policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Write to `wook81701@gmail.com` instead. You get an acknowledgement within 7 days of receipt; the fix schedule is set once the impact is known. The latest 0.x release is supported.

## What Lanekeeper protects against

The Lanekeeper safety hooks stop an agent from running dangerous commands by mistake. They are not a security boundary against a malicious program on the same machine.

- The safety hooks judge Bash command strings and the target paths of Write and Edit. They do not judge commands inside script files, git or kill calls made from python or node, `find -delete`, or bulk reverts such as `git checkout -- .`.
- An owner grant (`/lanekeeper:approve`) is created only when a person types it in the prompt. The grant file is `<git common dir>/lanekeeper/owner-grant.json`; it can be used once, within a time limit (15 minutes by default), and only for the commit it names. Another process on the same machine writing this file directly is not prevented. An agent's Write or Edit of the path, and Bash commands that mention it, are blocked, but a script that assembles the path is not.
- The safety hook (`safety/pretool`), the dispatch guard and the ship gate hook carry `"onFailure": "block"`. When such a hook does not run (node missing), times out (20 seconds) or exits abnormally, Claude Code 2.1.295 or later blocks the tool call. Older versions do not know the field and treat it as a non-blocking error; the safety hooks do not act in that case. `/lanekeeper:doctor` checks that node is installed.
- The safety hooks (`safety/pretool`, `safety/approve`) run in every repository. The other workflow hooks act only in a repository with `.lanekeeper/config.json` (every repository with `LANEKEEPER_ACTIVE=1`).

## When a hook fails

Safety hooks block when they cannot decide; every other hook lets the work continue on an error. `tests/l14-security.test.mjs` feeds every hook broken input and a broken settings file to confirm this.

| Hook | Event | On an error or a settings error |
|---|---|---|
| `safety/pretool` | PreToolUse (Bash, Write, Edit, MultiEdit, NotebookEdit, Skill) | Denies the tool call. A broken settings file blocks every command it would judge |
| `safety/approve` | UserPromptExpansion (`/lanekeeper:approve`) | Blocks the prompt without creating a grant |
| `dispatch/dispatch-guard` | PreToolUse (Agent, Task) | Lets the call through with a note |
| `slots/slot-guard`, `mockup/mockup-first`, `codegraph/nudge`, `codegraph/deadpath` | PreToolUse | Lets the call through |
| `handoff/session-start`, `auto-retry/session-start`, `terse/session-start`, `worktree/session-sync`, `codegraph/session-start` | SessionStart | Adds nothing |
| `token-guard/check`, `codegraph/record` | UserPromptSubmit, PostToolUse | Does nothing |
| `handoff/stop-guard`, `auto-retry/detect`, `report/artifact-check` | Stop, StopFailure | Does not keep the session from ending |
| `checkpoint/checkpoint`, `ledger/subagent` | SubagentStart, SubagentStop, StopFailure, PreCompact | Skips the commit or the record |

## External commands

Hooks and `lanekeeper-*` commands run external programs with an argument list, not through a shell. The programs are `git`, `gh` (PR target lookup), `lsof`, `ps`, `codegraph`, `sqlite3`, `nice`, `osascript` and `notify-send` (notifications), `launchctl`, `systemd-run` and `systemctl` (scheduled resume), `claude` (automatic resume), `python3` (workbooks) and `cwebp` (image conversion).

Only four places run a command through a shell (`sh -c`). Each runs a command written by the user or the project settings, with the same rights as running it by hand. When you open someone else's repository, read the commands in `.lanekeeper/config.json` and `.lanekeeper/verify.config.json` first.

| Place | Command it runs |
|---|---|
| `bin/lanekeeper-slot` | The command the user wraps with `lanekeeper-slot -- <command>` |
| `lib/review.mjs` | `project.review.guards` |
| `lib/worktree.mjs` | `project.worktree.setup` |
| `templates/test-results/project/run-gate.mjs` | Gate steps in `.lanekeeper/verify.config.json` |

A new shell call site makes the allow-list test in `tests/l14-security.test.mjs` fail. Adding one needs a security review and an update of that list.

## Input checks

| Input | Check |
|---|---|
| Artifact slug (`lanekeeper-art --slug`) | Letters, digits, Hangul, `.`, `_`, `-` only; no `..` |
| Lane id (`lanekeeper-check lane`, return briefs) | ASCII letters, digits, `.`, `_`, `-`, up to 64 characters |
| Decision name (`lanekeeper-decide`) | Letters, digits, Hangul, `_`, `-`, up to 61 characters |
| Session id (when used in a file name) | Characters other than ASCII letters, digits, `_` and `-` become `_` |
| Serving check address (`lanekeeper-check lane --serve-url`) | `localhost`, `127.0.0.0/8` and `[::1]` only |
| Index copy path (`sqlite3 .backup`) | A quote or control character switches to a plain file copy |

## Network

Hooks and commands send no data off the machine. Metrics and records stay in local files. There are two exceptions.

- Before judging `gh pr merge`, the safety hook runs `gh pr view` to learn the target branch (8-second limit). `gh` queries with the GitHub account it is set up with. If the lookup fails, the merge is blocked.
- The serving check of the lane review reads one local development server address. Addresses outside the machine are refused.

## Files read and written

| Feature | Reads | Writes |
|---|---|---|
| Token guard | The official usage entry (`cachedUsageUtilization`) and the account ID (`oauthAccount.accountUuid`) of `~/.claude.json`; no other entry and no credentials are read. Token usage fields and usage-limit rejections of conversation logs under `~/.claude/projects` changed in the recent window. With neither an official value nor a budget (`token_guard.budget`) the hook reads no conversation logs. Running `lanekeeper-token status` or `lanekeeper-token calibrate` by hand reads them to show the usage, with or without a budget | Totals in `${CLAUDE_PLUGIN_DATA}/token-guard/`, a record of official and manual usage (`official-history.jsonl`: time, account ID, percentages, reset times), per-account calibration ratios (`calib-<account>.json`) |
| Automatic resume | The tail of the current session log (limit text, model name) | Schedule state in `${CLAUDE_PLUGIN_DATA}`, and the output log of the resumed session (readable by the user only) |
| Lane ledger | Model names and token usage in subagent logs | Per-lane counts, models, tokens and brief hashes in `<git common dir>/lanekeeper/` |
| Report check | Tool call names in the current session log | One block marker per session |
| codegraph record | Success or failure of codegraph responses | Category and time in `.lanekeeper/metrics/codegraph.jsonl` |
| Checkpoint | git status | A temporary commit on the lane branch. Only tracked files go in; `.env*`, `*.pem`, `*.key`, `id_*`, `*credentials*` and `*.p12` are left out and reported |

Conversation text is not stored. Secrets and environment variables are not written to logs (`tests/l14-security.test.mjs` checks for code that prints the environment).

## Permissions of an unattended resume

Automatic resume is off until the user runs `lanekeeper-retry on`, because it registers a launchd agent or a systemd user timer. It runs in the default permission mode (`default`). `bypassPermissions` is used only after the risk was accepted with `lanekeeper-retry mode bypassPermissions --i-understand`; without that record the resume falls back to `default`. No credentials are stored.

## Licenses of companion tools

Lanekeeper bundles none of these tools; it only explains how to install them.

| Tool | Used for | License |
|---|---|---|
| codegraph (`@colbymchenry/codegraph`) | Code index | MIT (per the npm package metadata) |
| openpyxl | Test result workbooks | MIT |
| Pillow | PNG to WebP (optional) | MIT-CMU |
| cwebp (libwebp) | PNG to WebP (optional) | BSD-3-Clause |
| Playwright | Screen tests (installed by the project) | Apache-2.0 |

codegraph is installed by `/lanekeeper:init` only when the user agrees.

## Checks before publishing

- Secrets: `gitleaks git .` and `gitleaks dir .`
- Internal information: the repository check in `npm test` (private IPs, mail addresses, home folders, project-specific strings). The list of customer names is not kept in the public repository; the maintainer runs that check on their own machine.
