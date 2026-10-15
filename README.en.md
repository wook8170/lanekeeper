# wb — Agent Workbench

[한국어](README.md)

> Draft. Contents will change before 0.1.0.

wb is a Claude Code plugin that keeps the rules for running several subagent lanes at once in settings files and enforces them with hooks. It picks a model for each kind of task, limits how many lanes and heavy commands run at the same time, and stops a lane from committing to a protected branch or killing another task's server. When a lane finishes, a report file and a review checklist confirm the result.

## Background

Running several agent lanes in one repository produces the same incidents again and again. Heavy test suites run in parallel and time out, and the timeouts are reported as failures. A lane commits to another lane's branch or to the default branch. A pattern-based kill takes down another task's server. Rules written only as instructions are not always followed, so wb keeps them as settings and checks them with hooks.

Measurements of code-search tool usage shaped the design. Sessions that used index-based search first and sessions that used only text search answered correctly at the same rate. About one third of index tool calls failed, mostly because the working folder had not been indexed. Runs that blocked text search cost more than three times as much. wb therefore never blocks text search and queues unindexed paths for indexing instead.

## Install

```
claude plugin marketplace add <repository URL>
claude plugin install wb@wb-plugin
```

Then run `/wb:init` in the project folder. It asks three questions:

1. Project kind (`web-ui` · `service` · `library` · `other`)
2. Message language (`ko` · `en`)
3. Full verification command (may be empty)

It writes `.wb/config.json` and `~/.wb/personal.json` and excludes the brief folder `.wb/briefs/` from git. Existing files are never overwritten.

## Settings

Settings come in four layers.

| Layer | File | Tracked | Contents |
|---|---|---|---|
| default | plugin `defaults/*.json` | plugin repository | default for every key |
| project | `<repo>/.wb/config.json` | committed | project kind, branch rules, output locations, verification command, writing-style map |
| machine | `~/.wb/machine.json` | no | lane count, run slots, load threshold, protected ports, lane port range |
| personal | `~/.wb/routing.json`, `~/.wb/personal.json` | no | model routing and denied models, language, report detail, unattended resume |

The language and report detail chosen in the plugin settings screen (`/config`) sit between the machine layer and the personal files. Hook processes are the only place these values are visible.

Merge rules depend on the kind of key.

| Kind | Rule | Keys |
|---|---|---|
| ordinary value | the higher layer wins: personal > plugin option > machine > project > default | every key not listed below |
| protected list | union of all layers; no layer can remove an entry another layer added | `routing.denied`, `machine.ports.protected`, `project.git.protected_branches`, `project.protected_paths` |
| cap | the smallest value among the non-default layers; the default applies only when no other layer sets it | `machine.lanes.max`, `machine.slots.heavy.count`, `machine.slots.browser.count`, `machine.load.max` |

The default is left out of the cap rule so that a personal machine file can raise the cap above the default of three lanes. A project can only lower it further.

To see where a value comes from:

```
wb-config explain machine.lanes.max
wb-config validate
wb-config doctor
```

`explain` shows the merge rule, the layer that won and every layer that sets the key. `validate` checks each file and names the file and key of every error. Unknown keys are ignored with a warning.

Example files are in `examples/`.

## Model routing

`routing.json` gives each kind of task a chain of models and a floor. wb removes denied models and models that hit their usage limit from the chain, then uses the first remaining model if it is at or above the floor. If only models below the floor remain, wb does not dispatch, notifies you and waits. The plugin defaults deny no model. To stop using a model, add it to `denied` in your personal `routing.json`.

## Safety hooks

A `PreToolUse` hook judges Bash, Write, Edit, MultiEdit, NotebookEdit and Skill calls before they run. The answer is allow, ask or deny. A block message has three lines: why it was blocked, how to fix it, where to ask.

**Actor.** A hook input with `agent_id` comes from a subagent, i.e. a lane. Without it, a call is still a lane call when the target worktree is registered in the lane ledger (`<git-common-dir>/wb/lanes.json`). Everything else is the main session.

**git table.**

| Action | Lane · own branch | Lane · elsewhere | Main · integration/feature | Main · protected |
|---|---|---|---|---|
| commit · cherry-pick · revert · am | allow | deny | allow | deny; once with a `commit-main` grant |
| merge · rebase · pull | only taking in the integration branch | deny | allow (denied while the gate lock is held) | deny; `merge-main` grant plus gate stamp. Syncing with its own upstream is allowed |
| push | deny | deny | `git.feature_push` (ask · allow · deny) | deny; `push-main` grant plus gate stamp |
| force push · `--all` · `--mirror` | deny | deny | deny | deny |
| `gh pr merge` | deny | deny | a protected base needs a `merge-main` grant | same |
| checkout · switch to another branch | deny | deny | allow | allow |
| unnamed stash · `reset --hard` · `clean -f` · `branch -D` | ask | ask | ask | ask |
| deleting or force-moving a protected branch | deny | deny | deny | deny |

Commands are unpacked before judging: `;` `&&` `||` `|`, subshells, `$( )`, `sh -c`, `eval`, heredocs, wrappers such as `env`, `sudo`, `timeout` and `xargs`, shell and git aliases, `git -C`, `cd` and `GIT_DIR`. A command whose name or target folder is a variable is blocked.

**Owner grants.** Changes to a protected branch need the repository owner to type `/wb:approve merge-main` (or `push-main`, `commit-main`) in the prompt. A grant is valid once, for 15 minutes (`git.owner_grant_ttl_min`), for the commit recorded when it was typed. When the project has a gate command (`gate.command`), a gate pass stamp for the same commit is also required. Grants are written by a `UserPromptExpansion` hook. That event fires only when a person types a slash command, so subagent reports and messages from other sessions cannot create one. The model cannot invoke the skill or write the grant file.

**Other blocks.**
- Kills: name-based kills (`pkill`, `killall`, `kill $(pgrep ...)`) are blocked. `kill <PID>`, `lsof -ti :port | xargs kill` and `fuser -k` are blocked when the target listens on a protected port (`machine.ports.protected`).
- Deletes: `rm -r` of `/`, the home folder, system folders, the project root or `.git` is blocked. Outside the project it asks; inside the project and temp folders it passes.
- Browsers: Chrome without headless mode, `--headed`, `PWDEBUG`, `playwright codegen` / `--ui`, and `open` with a browser or URL are blocked.
- Paths: writes to `project.protected_paths` are blocked, and so are writes to wb state files (grant, gate stamp, lane ledger). Editing a wb settings file asks first.

**Fail-closed.** With a settings error, git changes, kills, deletes and browser runs are blocked and the message points at the faulty file and key. An internal hook error also blocks.

**Protected lists only grow.** `protected_branches`, `protected_paths`, `ports.protected` and `denied` are the union of every layer. No layer can remove an entry another layer added.

## Run slots, ports and lane worktrees

**Run slots.** Heavy runs (full test suites, builds, installs, e2e, indexing) and headless browsers are counted across the machine: 2 heavy and 2 browser slots by default. This count is separate from the lane limit (`machine.lanes.max`, default 3).

```
wb-slot --kind heavy -- pnpm -r test
wb-slot --kind heavy,browser -- npx playwright test
wb-slot status        # slots in use and the 1-minute load
wb-slot reap          # reclaim finished leases
```

- The command waits while no slot is free or while the 1-minute load is at or above `machine.load.max` (default: logical cores × 2). With `--timeout <sec>` it gives up after that long without running (exit code 75).
- A lease is renewed while the command runs. When its process is gone, or it has not been renewed for `machine.slots.stale_after_min` (default 90), the next caller reclaims it.
- Runs that need both kinds (e2e) take both slots together; if only one is free it is given back and the run waits.
- Commands run in a slot get `WB_SLOT_HELD`, so a nested `wb-slot` of the same kind does not wait for itself.

Heavy commands are recognised by the pattern groups in `defaults/heavy-patterns.json`. `machine.slots.heavy.patterns` and `machine.slots.browser.patterns` pick the groups, and a project can add regular expressions under `slots.heavy` and `slots.browser` in `.wb/config.json`. Single-file test runs (`vitest run a.test.ts`) are not matched. When the Bash tool runs such a command outside a slot, `machine.slots.guard` decides:

| Value | Behaviour |
|---|---|
| `warn` (default) | the command runs; Claude is told the wrapped command |
| `deny` | the command is blocked with the wrapped command as the fix |

**Ports.** Protected ports (`machine.ports.protected`) and the lane port range (`machine.ports.lane_range`) are numbers that live only in machine settings. Docs and briefs use names and ask `wb-port get <name> [--lane <id>]`. A lane leases one band (one port per `per_lane` name). Bands holding a protected port, a port another process already listens on, or another lane's lease are skipped. The lease ledger is `<git-common-dir>/wb/ports.json`.

**Lane worktrees.**

```
wb-worktree create l3            # from the integration HEAD, with a port lease and a lane entry
wb-worktree list
wb-worktree remove l3 [--force] [--delete-branch]
```

- The base is the integration branch HEAD. The integration branch is `--integration`, else the lane registry's `integration`, else the one local branch matching `project.git.integration_branch_pattern`. Without one, the current HEAD is used.
- The branch name replaces the last part of the integration branch with the lane id (`wb/mvp/int` → `wb/mvp/l3`). The path is `project.git.worktree_root` (default `{repo}/../wt-{task}`).
- Git-ignored files listed in `.worktreeinclude` (such as `.env`) are copied.
- `project.worktree.setup` (for example `pnpm install --frozen-lockfile`) runs in the new worktree inside a heavy slot, with `WB_LANE` and `WB_PORT_<NAME>` set.
- No worktree is created once live lanes reach `machine.lanes.max`.
- Removal stops while any process runs inside the path and lists the PIDs; stop them one by one with `kill <PID>` and run again. Uncommitted changes need `--force`. The main checkout and folders that are not worktrees are never removed. `--delete-branch` deletes the branch only when its commits are on another local branch too.

**Claude Code worktree hooks.** wb registers WorktreeCreate and WorktreeRemove hooks. With them Claude Code uses the hook instead of its own worktree creation (`claude --worktree`, subagents with `isolation: "worktree"`, and so on). The wb hook keeps Claude Code's location (`.claude/worktrees/<name>`) and branch name (`worktree-<name>`), bases the worktree on the integration HEAD when there is exactly one integration branch, and also leases ports, copies `.worktreeinclude` files and runs the setup command. These worktrees are not added to the lane registry. If no heavy slot comes free within 2 minutes the setup command is skipped; run `wb-worktree setup <name>` later.

**Cleanup.** `wb-reap` reclaims finished slot leases and lists port leases and lane entries whose folder is gone (`--apply` clears them). An old `gate.lock` is only reported, and removed with `--gate-lock`. It never stops processes.

## Security and limits

- Hooks and tools send nothing over the network, except that the safety hook runs `gh pr view` to find a pull request's base branch before `gh pr merge`.
- The owner grant file cannot stop another process on the same machine from writing it directly. It is a guard against mistakes.
- The safety hook judges the command text. Commands inside script files, git or kill calls made from another language (python, node), and settings edited through Bash are outside its reach.
- If `gh pr view` cannot tell the base branch, `gh pr merge` is blocked.

## Development

```
npm test          # node:test unit tests
npm run validate  # claude plugin validate --strict
```

## License

MIT
