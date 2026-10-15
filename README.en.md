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
