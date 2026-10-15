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

Then run `/wb:init` in the project folder. It asks four questions:

1. Project kind (`web-ui` · `service` · `library` · `other`)
2. Message language (`ko` · `en`)
3. Full verification command (may be empty)
4. Whether wb also manages the worktrees Claude Code creates (default no; see "Claude Code worktree hooks (opt-in)" below)

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

Tasks with `differ_from: implementer` (adversarial review) drop the implementer's model from the chain. If no other model at or above the floor is left, the same model runs in a fresh context and the lane report has to say so.

`wb-route` previews the result.

```
wb-route tasks                                  chain and floor per task type
wb-route resolve review                         model to use (agent_param); exit 3 while waiting
wb-route explain adversarial --implementer opus step-by-step trace
wb-route check review --model sonnet            judge a model choice (exit 1 when blocked)
```

### Dispatch checks and briefs

When a subagent is dispatched (Agent tool), a hook checks:

| Condition | Result |
|---|---|
| No brief marker, missing sections or statements, unfilled `{{…}}` | Block (`project.dispatch.brief: warn` only advises) |
| No `model` | Block, names the routed model |
| Denied or out-of-quota model | Block, names the next model in the chain |
| Model below the declared task's floor or outside its chain | Block |
| In the chain but not the first choice | Advice |
| Every model at or above the floor is out of quota | Block, notify, wait until the reset, suggest `/model` |
| New lane while `machine.lanes.max` lanes are live | Block |

The first line of a brief is the marker `<!-- wb-brief v1 type=<task> lane=<lane> template=<template> -->`. Required sections are goal, scope, do-not, test rules, report location and commit rules; the text must also state headless browsers, no full test suite, and the worktree base commit hash. Seven templates (impl, fix, mockup, research, review, docs, test) are in `templates/briefs/ko` and `templates/briefs/en`. Check a brief with `wb-check brief <file>`. When a brief names a common brief file, that file is read and judged together with it.

Agents listed in `project.dispatch.exempt_agents` (default: `fork`, `claude-code-guide`, `statusline-setup`) skip the brief check. The denied-model check still applies.

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

## Session helper hooks

| Feature | Behavior | Setting keys | Manage |
|---|---|---|---|
| Handoff | At a new session and `/clear`, injects the newest section of `progress.md`. If a commit or file change is newer than the file, blocks the end of the turn once and asks for an update. The same session is not blocked again for 20 minutes | `personal.handoff.{enabled, file, throttle_min}` | |
| Automatic resume | When a usage limit ends a turn, resumes the same session headless two minutes after the reset time. Scheduling uses launchd on macOS, a systemd user timer on Linux and a background waiter elsewhere. The model that hit the limit is recorded in `limits.json` | `personal.auto_retry.{enabled, permission_mode, bypass_ack}`, `routing.limits_state` | `wb-retry`, `/wb:auto-retry` |
| Token guard | Converts local token usage of the recent window (default 5 hours) to a percentage of a budget and adds an instruction only when the stage rises. 90%: smaller work units. 95%: handoff after every wave. 99%: last handoff, notification, then wait | `personal.token_guard.{enabled, stages, budget, window_hours}` | `wb-token`, `/wb:token-guard` |
| Terse mode | In a repository where it is on, injects rules that shorten output and tool calls at session start | `personal.terse`, repository switch | `wb-terse`, `/wb:terse` |
| Checkpoint | On a limit, a subagent stop or a context compaction, commits changes to tracked files on a lane branch as a `wip(wb)` commit. Untracked files and secret-like files (`.env*`, `*.pem`, `*.key`, `id_*`, `*credentials*`, `*.p12`) are not committed; they are reported in `.git/wb/checkpoint.json` and a notification. If a project hook (pre-commit) fails, the checkpoint is skipped and the reason recorded. Protected and non-lane branches are left alone and nothing is pushed | `personal.checkpoint.enabled` | |

The permission mode of the automatic resume defaults to `default`. In that mode tools that need approval are refused in the unattended run, so the resumed work can stop at that point. `bypassPermissions` is enabled only by `wb-retry mode bypassPermissions --i-understand` after reading the risk; without the recorded acknowledgement (`bypass_ack`) the resume uses `default`.

The token guard budget defaults to 0 (not calibrated) and the guard stays silent in that state. Run `wb-token calibrate` when the app shows that the limit is reached; the usage at that moment is recorded as the budget. Only Claude Code use on this machine is counted and the percentage is an estimate.

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

**Ports.** Protected ports (`machine.ports.protected`) and the lane port range (`machine.ports.lane_range`) are numbers that live only in machine settings. Docs and briefs use names and ask `wb-port get <name> [--lane <id>]`. A lane leases one band (one port per `per_lane` name). Bands start at 41000, 20 ports apart, which keeps clear of macOS AirPlay on 7000. Bands holding a protected port, a port another process already listens on, or another lane's lease are skipped. The lease ledger is `<git-common-dir>/wb/ports.json`.

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

**Claude Code worktree hooks (opt-in).** Once a WorktreeCreate hook is registered it replaces Claude Code's own worktree creation entirely (`claude --worktree`, `EnterWorktree`, subagents with `isolation: "worktree"`, background sessions); a registered hook cannot hand the work back to the default. So wb does not list these hooks in its plugin `hooks.json`, and they are off by default. Answer yes to "Should wb manage lane worktrees?" in `/wb:init`, or set `"worktree": { "hook": true }` in `.wb/config.json`, and wb registers WorktreeCreate and WorktreeRemove hooks in the main checkout's `.claude/settings.local.json` (this machine only, kept out of git). The plugin's install path changes with each update, so a session-start hook re-points the registration to the current plugin every time and removes it when the setting is turned off. If another tool already has a WorktreeCreate hook there, wb does not add its own and says so. Check with `wb-worktree hooks status`; apply now with `wb-worktree hooks sync`.

When on, the wb hook keeps Claude Code's location (`.claude/worktrees/<name>`) and branch name (`worktree-<name>`), bases the worktree on the integration HEAD when there is exactly one integration branch, and also leases ports, copies `.worktreeinclude` files and runs the setup command. These worktrees are not added to the lane registry. If no heavy slot comes free within 2 minutes the setup command is skipped; run `wb-worktree setup <name>` later. Claude Code's own extras (branching from the remote default branch, filter-driver neutralisation, the stale worktree sweep) do not apply in this mode.

**Cleanup.** `wb-reap` reclaims finished slot leases and lists port leases and lane entries whose folder is gone (`--apply` clears them). An old `gate.lock` is only reported, and removed with `--gate-lock`. It never stops processes.

## Lane ledger, progress board and resume

Wave and lane progress is recorded under `<git common dir>/wb/`, shared by every worktree. Only `wb-waves` writes it.

- `waves.json`: lane state per wave (pending, running, review, blocked, failed, done), model, task type, brief path, runs and returns, to-dos, checks, token totals, history.
- `dispatch.json`: dispatches that passed the guard and the agents running now.
- `metrics/lanes.jsonl`: one line per start, stop, status change and return, with task, routed model, actual model, classification source, brief file hashes and tokens.
- `lanes.json`: the lane worktree registry (L4); an agent start writes its `agent_id`.

The dispatch guard remembers every allowed call. SubagentStart pairs the agent with the oldest pending call of the same agent type, sets the lane to running and counts the run. SubagentStop adds the transcript usage and sets the lane to review. A new agent on a lane in review counts as one return. A brief marker without `lane=` is logged in metrics only. Pending calls expire after 10 minutes.

Commands: `wb-waves init-wave | lane | status | todo | verify | note | return | board | metrics | statusline | resume`, `wb-number reserve | release | list | check`, `wb-cases init | add | retire | set | list | check`, `wb-defects add | resolve | list | check`. Skills: `/wb:lanes`, `/wb:pickup`, `/wb:resume`. The resume report lists the newest progress.md section, git status, worktrees, the last five commits and lane verdicts, and reports stale items first (outdated progress.md, running lanes idle longer than `project.waves.stale_min`, missing or unregistered worktrees, uncommitted lane changes, orphan dispatches, agents without a stop record). It never deletes anything.

Number series (`numbers` in `.wb/config.json`: `dir`, `pattern`, `width`, `start`) give parallel lanes unique numbers for migrations or decision records. The next number is above the files in the folder (working tree and main checkout) and above live reservations. Test cases (`<module>.cases.json`) and `defect-register.json` live in `paths.e2e_ledger`; case ids are never reused, a `fixme` case must point to an open defect, defects are never deleted.

## Test result workbook

The result of an integration or final verification is saved as an Excel workbook (xlsx) plus a summary json. The generator needs Python 3.8+ and openpyxl (`python3 -m pip install openpyxl`). Without them `wb-test-report` prints the install commands and skips only the workbook (exit 0, or 3 with `--require`). Check with `wb-test-report env`.

| Where | What |
|---|---|
| `templates/test-results/core/` | result model, adapters (vitest, jest, Playwright, pytest), ledger comparison, sheet layout. It reads result files only and knows no project names or paths |
| `templates/test-results/project/` | `verify-all.mjs` (gate, then each test stage, then the workbook; keeps going after a failure), `run-gate.mjs` (records the gate step by step), `verify.config.json` (the stage list per stack) |

```
wb-test-report init                  create .wb/verify.config.json (edit gate and stages for the project)
wb-test-report run [--name N] [--only a,b] [--skip a,b] [--ledger-priority P0] [--no-slot]
wb-test-report build --input vitest:unit:app=out.json[,log=out.log] [--gate-json gate.json] [--rerun playwright=again.json]
wb-test-report latest | summary [--json]
wb-check test-results [--json] [--require-pass]
```

Each stage names an `adapter` (vitest, jest, playwright, pytest), a `kind` (unit, integration, e2e, uistab), a `cmd` (`{file}` is where the structured output goes) and a `slot` (`heavy`, `heavy,browser`, `none`). Heavy stages run inside `wb-slot`. A run that only left logs is read with `build --input adapter:kind:name=log=<log>`.

Sheets: summary, unit, integration DB, e2e, e2e detail, UI stability, gate steps, failures, flaky, ledger comparison, coverage, mutation. Sheet names are Korean and fixed. A sheet without data is not created (summary, failures and flaky always exist). A test that passes on a retry inside the run, or in a separate rerun (`--rerun`), counts as flaky. The ledger comparison matches `*.cases.json` in `paths.e2e_ledger` with the case ids in test titles (`PAY-001`, and the short form `PAY-002 · 003`). Mismatches are: an active case that failed, was flaky, was skipped or did not run (`--ledger-priority`), a `fixme` case that passes, and ids that are unknown or retired. With a ledger, 0 mismatches is a ship condition.

The workbook goes to `paths.test_results` (default `docs/test-results/<date>/<name>-<HHMM>.xlsx`, with a `.json` of the same name) and is committed. Raw logs go to `paths.test_runs_raw` and are not committed. A broad `.gitignore` pattern such as `test-results/` also hides `docs/test-results/`; `/wb:init` suggests the exception line and `wb-check test-results` reports the files as not committed. `/wb:report` attaches `file` and `json` from `wb-check test-results --json` and quotes the figures of `wb-test-report summary --json`.

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
