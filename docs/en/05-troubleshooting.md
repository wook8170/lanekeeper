# Troubleshooting

This page lists causes and fixes for when a Lanekeeper hook blocks your work or a command ends differently than expected. The start of the real output is given like a heading so you can search by message.

## 1. Check these first

When you do not know why something is blocked, run these three commands in order.

```
lanekeeper-explain                     what is blocked or waiting now
lanekeeper-explain code <message code> the rule behind a block message and how to recover
lanekeeper-config doctor               settings errors and where the main values come from
```

Inside Claude Code, `/lanekeeper:explain` and `/lanekeeper:doctor` do the same. A block message has three lines: why it was blocked, how to fix it, where to ask. Follow the second line first. Each rule is explained in [Rules](04-rules.md).

## 2. Fixes by message

### When sending a subagent

| Message | Cause | Fix |
|---|---|---|
| `No model given. Routing for task … picks …` | The Agent call has no `model` | Pass the model named in the message |
| `Model … is below the floor … of task …` | A model below the minimum grade was chosen | Use the model named in the message. If the task type is wrong, fix `type=` in the brief marker |
| `Model … is on the denied list (routing.denied)` | A model you denied in personal settings | Use the next model in the fallback order. To lift the denial, remove it from `denied` in `~/.lanekeeper/routing.json` |
| `Model … is out of quota` · `Waiting until the reset at …` | Every model at or above the minimum grade is out of quota | Send again after the reset. Do not go below the minimum grade |
| `No brief marker (<!-- lanekeeper-brief v1 type=… lane=… -->)` | The first line of the prompt has no marker | Make the brief from a template in `templates/briefs/`. Naming the brief file in the prompt also works |
| `The brief still has an unfilled placeholder {{…}}` | A template placeholder was not filled | Fill it with `lanekeeper-style brief … --var name=value` and check with `lanekeeper-check brief <file>` |
| `The brief is missing: …` | A required section (goal, scope, forbidden, test rules, report location, commit rules) or the headless, no-full-suite or base-commit statement is missing | Make the brief again from a template |
| `… lanes are live, the cap is …` | The live lane cap (default 3) is reached | Remove finished lanes with `lanekeeper-worktree remove <lane>`. If the machine allows, raise `lanes.max` in `~/.lanekeeper/machine.json` |

### git commands

| Message | Cause | Fix |
|---|---|---|
| `A lane may only commit on its own lane branch (…)` | A lane tried to commit on another branch | Go to your lane worktree and commit there |
| `Lanes may not push.` | A lane tried to push | Commit only and report. The main session decides about pushing |
| `Force pushes (--force, --force-with-lease, +refspec) are not allowed for anyone.` | Force push | Integrate the remote and push normally. Ask the owner if history must be rewritten |
| `This action (…) on the protected branch … needs an owner grant, and there is none.` | Merge, push or commit on a protected branch | The owner types `/lanekeeper:approve merge-main` (or `push-main`, `commit-main`). When a push is blocked, the branch name in the message is the branch checked out now, not the target |
| `There is no gate pass stamp for commit …` | In a project with `project.gate.command`, the gate has not passed on the commit being applied | In the folder that has that commit checked out (usually the integration branch), pass `lanekeeper-test-report gate-pass` or `lanekeeper-test-report run` to the end. No stamp is written while there are uncommitted changes |
| `The gate pass stamp belongs to another commit (…)` | Changes other than result files were committed after the stamp | Run the gate again on the current commit |
| `A verification gate is running` | `lanekeeper-test-report run` holds the gate lock | Run again when it ends. If a crash left the lock, the owner types `/lanekeeper:approve clear-gate-lock` in the prompt once the lock is older than `machine.slots.stale_after_min`, or allows the dialog that `lanekeeper-reap --gate-lock` raises in the main session |
| `A subagent asked for an owner decision` | A lane ran `lanekeeper-quality accept` or `lanekeeper-reap --gate-lock` | Report the request to the main session. The main session runs the same command alone, or the owner types the slash command |
| `A dialog can only be raised for the plain command` | The command was chained, or has a path, an environment prefix or added options | Run the command by itself, with the reason as quoted plain text |
| `What the dialog showed has changed` | A newer result or a changed lock appeared after the dialog was raised | Run the command again and read the new dialog |
| `Feature branch pushes need confirmation` | `project.git.feature_push` is `ask` (default) | Approve in the confirmation prompt. To always allow, set it to `allow` |
| `` `git reset --hard` discards uncommitted changes for good `` | A command that throws away changes | Check what would be lost with `git status`, leave a WIP commit if needed, then approve |

### Processes, deletion, browsers, paths

| Message | Cause | Fix |
|---|---|---|
| `Killing by name or pattern (…) can take down other sessions' or the owner's servers.` | `pkill`, `killall`, `kill $(pgrep …)` | Find the PID of the process you started and use `kill <PID>` |
| Stopping a process on a protected port is blocked | The target of `kill <PID>` uses a `machine.ports.protected` port | Ask the owner |
| `Removing … wipes the home folder, a system folder or the whole project.` | Deleting home, root, the project root or `.git` | Name the exact subfolder to remove |
| `A browser that opens a window (…) steals focus from the person using the machine.` · `… opens a browser window.` | A browser that is not headless, `open` | Add `--headless=new` or use Playwright's default (headless), and share the result file |
| `… is a Lanekeeper state file (owner grant, gate stamp, lane ledger)` | Claude tried to write a Lanekeeper state file | Grants come only from `/lanekeeper:approve`; the ledger changes only through `lanekeeper-waves` |
| `… is a protected path (…)` | Writing to `project.protected_paths` | Ask the owner |
| `Lanekeeper settings have an error, so safety checks cannot run` | A settings file has a format error | Fix the file and key named in the message and check with `lanekeeper-config validate`. Until then git changes, killing processes, deletion and browser runs are blocked |
| Blocked because the command target is unknown before it runs | The command name or target folder is a variable | Write out the real value |

### Mockups, handoff, reports

| Message | Cause | Fix |
|---|---|---|
| `… changes the UI structure (elements or selectors) and no mockup decision is recorded` | A structure change to screen files in scope | Show the mockups, create the question with `lanekeeper-decide new … --kind mockup --scope …` and record it with `lanekeeper-decide answer`. A pending decision does not unblock |
| `[Lanekeeper handoff] Work newer than progress.md was detected (a commit or a changed file)` | A handoff is needed before the turn ends | Append finished content to the archive, rewrite `progress.md` and commit both. For a trivial change, state the reason in one line and finish |
| `The finished work was not published as an artifact.` | `/lanekeeper:report` ran but no artifact was published | Build the HTML with `lanekeeper-art report` and publish it as an artifact. To turn this check off, set `personal.report.artifact_check` to `false` |
| `The newest verification workbook has problems` | The result workbook is missing or not committed | Check with `lanekeeper-check test-results` and make it again with `/lanekeeper:test-report` |

### Review

| Message | Cause | Fix |
|---|---|---|
| `8. Test results — The report has no test result (passed count)` | The passed count could not be read from the report | Write the passed count, as in `tests: 12 passed / 0 failed` or `passed: 12` |
| `8. Test results — The report shows … failing tests` | The report has a count of tests failing now. A record of the failure before the fix, such as `failed before the fix: 1`, is not counted | Fix the failing tests, then update the result line |
| `6. Captures checked — UI change without captures` | Screen files changed and there are no captures | Put the before and after capture paths in the lane report. The main session opens them and then passes `--captures-seen` |
| `7. Served code marker — Web UI change without a URL (--serve-url) and a marker (--marker) to check` | A web screen change without a serving check | Restart the server and pass `--serve-url http://127.0.0.1:<port>/… --marker <text only this change adds>`. Only addresses on this machine are allowed |
| `5. Brief scope` fails | Files outside the brief's owned files changed | Revert the out-of-scope changes or fix the brief and send again |

### Running commands

| Symptom | Cause | Fix |
|---|---|---|
| `The brief file … does not exist` | The brief file given to `lanekeeper-check brief` does not exist | Check the path. init does not create `.lanekeeper/briefs/`, so create it with `mkdir -p .lanekeeper/briefs` |
| `lanekeeper-worktree remove` says `Processes are running inside …, so it was not removed (PID …)` | A server or watcher started in that folder is still alive | Stop the listed PIDs one by one with `kill <PID>` and run it again |
| `lanekeeper-worktree remove` says `… uncommitted change(s)` | Uncommitted changes | Commit them, or add `--force` only when you are sure they can go |
| `lanekeeper-worktree create` says `… live lanes reach the limit of …` | Lane cap | Remove finished lanes |
| `lanekeeper-integrate` exit code 3 | A gate or another integration holds the lock | Run again when it ends |
| `lanekeeper-integrate` exit code 2 | The tree is not clean, a merge is in progress or the branch does not exist | Check with `git status` |
| `lanekeeper-slot` keeps printing `Waiting: load is high` | The 1-minute load is at or above `machine.load.max` | Wait for other heavy runs to end. With `--timeout <seconds>` it gives up after that time with exit code 75 |
| A dispatch is blocked with `at or above the hold-new-lanes threshold` | The 1-minute load is at or above `machine.load.tiers.hold_new_lanes` | Look at the load and orphan processes with `lanekeeper-slot check`. Dispatch again when running lanes finish and the load drops |
| A dispatch is blocked with `at or above the light-only threshold` | The 1-minute load is at or above `machine.load.tiers.light_only` and the task type's weight is not `light` | Start light lanes such as design, review and docs first, and dispatch heavy lanes once the load drops. A task type's weight is `routing.tasks.<type>.weight` |
| A lane commit asks with `allows lane commits only on instruction` | `project.lanes.commit` is `on-instruction` and the brief does not allow commits | Report without committing. When a commit is needed, the main session adds `commit=allowed` to the brief marker and dispatches again |
| A database command is blocked with `This command writes to protected data` | The target is a file, port or container in `project.protected_data` | Switch to the lane's own test database (assigned port, own container or test file). Write a read-only query directly after `-c` or `-e` |
| A verifier lane's heavy run is blocked with `at or above the stop-heavy threshold` | The 1-minute load is at or above `machine.load.tiers.stop_heavy` and the lane is a verifier | Run it again when the load drops. List orphan processes with `lanekeeper-slot reap --orphans`, and after checking stop exactly those PIDs with `--kill` |
| `lanekeeper-test-report` says `Python is installed but the openpyxl module is missing` | The Python module is missing | On Debian/Ubuntu run `sudo apt install python3-openpyxl`. Where pip into the system Python is blocked (Homebrew, Debian 12+, Ubuntu 24.04) run `python3 -m venv ~/.lanekeeper/venv`, then `~/.lanekeeper/venv/bin/pip install openpyxl`, and set `LANEKEEPER_PYTHON=$HOME/.lanekeeper/venv/bin/python3`. Elsewhere `python3 -m pip install openpyxl` is enough. Without it the gate pass stamp is still written when the tests pass (only the workbook is missing) |
| `package.json has no script "gate"` | The `gate.script` name in `.lanekeeper/verify.config.json` is not in the `scripts` of `package.json` | Add that script or change `gate.script` to an existing name. Or list the commands in `gate.steps`, for example `[{ "name": "test", "cmd": "npm test" }]` |
| `lanekeeper-worktree create` says `This repository has no commits yet` | A new repository with no commit | Make a first commit, then run again |
| `lanekeeper-number reserve` says the number series is not declared | `.lanekeeper/config.json` has no `numbers` series | Declare the series as in the `project.numbers` example of [Configuration](03-configuration.md) |
| A codegraph call is blocked with `… has no codegraph index` | This session already got a "no index" response for that path | Go on with grep and Read until the index exists. Check with `lanekeeper-index status` |
| `lanekeeper-config: command not found` in an ordinary terminal | The `lanekeeper-*` commands are only on the `PATH` of the Bash commands Claude runs in a session | Ask Claude to run the command, or type the matching `/lanekeeper:*` command in the prompt. Do not add the plugin's `bin` folder to your `PATH`: its install path has the version in it and changes with every update |

## 3. Frequently asked questions

**Can I turn the hooks off for a while?**
The safety hooks have no bypass variable. If a rule does not fit the project, change its setting. For example, the feature branch push confirmation is `project.git.feature_push`, the mockup decision requirement is `project.mockup.decision_required`, and the slot hint is `machine.slots.guard`. Protected lists (protected branches, protected ports, protected paths, denied models) cannot lose an entry another layer added.

**How do I see where a setting value comes from?**
`lanekeeper-config explain <key>` shows the merge rule, the applied layer and every layer that sets the key.

**I want more than 3 lanes.**
Put `"lanes": { "max": 6 }` in `~/.lanekeeper/machine.json`. If the project settings set a smaller value, the smaller value applies. Keep memory and load in mind.

**How do I stop using a particular model?**
Add the model name to `denied` in `~/.lanekeeper/routing.json`. It is removed from every fallback order.

**Can Claude run `/lanekeeper:approve` for me?**
No. The skill creates a grant only when a person types it in the prompt. Subagent reports and messages from other sessions never create one. The same holds for `accept-quality`, `retry-bypass` and `clear-gate-lock`. The main session's agent can raise a dialog with `lanekeeper-quality accept` or `lanekeeper-reap --gate-lock`, and a person answers that dialog.

**Do I need codegraph?**
No. Without it the related hooks and commands do nothing. With it, every new worktree gets its index through the queue.

**Which time zone does the time in the result file name use?**
The start time of the run in this machine's time zone (system setting, `TZ` environment variable). There is no setting key for the time zone. The raw log folder name uses the same local time.

**After committing the results I get `The run commit … differs from the current HEAD …`.**
A commit after the run changed files outside the results folder. When only result files were committed, the check passes with `Only result files changed` instead of this warning. Code changed, so run again.

**There is no `progress.md` and the handoff hook says nothing.**
The handoff hooks work only in a repository that has `progress.md`. Create it once yourself.

**The token guard percentage differs from `/usage` in the app.**
Check the fetch time of the official value in `lanekeeper-token status`. If it is old, the use since then is an estimate from local tokens and can differ from the app by a few points. Adding the app's values with `lanekeeper-token calibrate --five <n> --seven <n>` aligns it from that moment. A line saying the official cache belongs to another account means Claude Code has not fetched the usage again since the account switch; opening `/usage` once at the prompt stores a new value.

**`lanekeeper-token status` shows the five-hour part as "no such window in the official value; left out".**
The newest official value has `five_hour: null`, so the guard decides by the seven-day figure alone. This is not an error. It is read as having no five-hour limit, based on the response shape observed so far; no policy document confirms it. If a five-hour rejection appears in the conversation logs afterwards, the five-hour figure returns as 100%.

**An automatically resumed session stops halfway.**
In the default permission mode (`default`), tools that need approval are refused in an unattended run. Open the session with the `claude --resume <id>` line from `lanekeeper-retry status` and continue.

## 4. Known limitations

| Item | Effect | What you can do now |
|---|---|---|
| UI stability check and term check | Not part of this release. Their settings keys (`project.ui_stability.*`, `project.glossary.terms_scan` and `copy_globs`) are reserved | They come in a later release |
| Dialog for owner decisions | It does not prove that a person allowed it, and a declined dialog is not recorded. An agent that starts a nested interactive session and answers its dialog, or that forges the ticket file in a form the hook cannot recognise, is not stopped. Interactive `bypassPermissions` and Remote Control were not checked | Use `/lanekeeper:approve`. The hook cannot see managed settings or `--allowedTools`, so do not list these commands there |
| Reach of the safety hooks | Commands inside script files, and git or kill calls from python or node, are not judged | Do not wrap risky work in scripts |
