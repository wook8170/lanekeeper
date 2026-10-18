# Rules

wb keeps the 41 rules below with hooks and commands. For each rule this page says what it blocks, why, and how to fix the work when it blocks you.

A hook gives one of three verdicts. Block: the command does not run. Ask: the user is asked whether to go on. Note: the command runs and the hook says what to do next.

A block message has three lines: why it was blocked, how to fix it, and where to ask. To find the rule behind the code in a message (for example `safety.git.lane_commit`), run `wb-explain code <code>`. To see everything that is blocked right now, run `/wb:explain`.

The rules are grouped in the order a new user usually meets them: git and branches, file and command safety, processes and environment, models and briefs, sessions and handoff, quality and documents, and planned rules.

> This page is generated from `rules/catalog.json` with `wb-rules manual --write`. To change it, edit the catalog and generate it again.

## Rule list

| No. | Rule | id | Group |
|---|---|---|---|
| 1 | Lanes commit only to their own branch | `lane-own-branch` | Git and branches |
| 2 | No force push | `no-force-push` | Git and branches |
| 3 | Protected branches need the owner's grant | `protected-branch-owner-grant` | Git and branches |
| 4 | No merging while the gate runs | `gate-lock` | Git and branches |
| 5 | Destructive git commands need confirmation | `no-destructive-git` | Git and branches |
| 6 | Feature branch push follows the setting | `feature-push-ask` | Git and branches |
| 7 | Lanes do not merge pull requests | `no-lane-pr-merge` | Git and branches |
| 8 | Commands must be readable before they run | `resolvable-commands` | File and command safety |
| 9 | Recursive delete only inside the project | `rm-inside-project` | File and command safety |
| 10 | Agents do not edit protected paths or wb settings | `protected-paths` | File and command safety |
| 11 | Only a person can grant | `human-only-approve` | File and command safety |
| 12 | Blocked when the check cannot decide | `safety-fails-closed` | File and command safety |
| 13 | Stop processes by PID only | `no-pattern-kill` | Processes and environment |
| 14 | Lanes use their assigned ports | `lane-ports` | Processes and environment |
| 15 | Browsers run without a window | `headless-browser` | Processes and environment |
| 16 | Heavy runs go through a slot | `heavy-runs-in-slots` | Processes and environment |
| 17 | The model fits the task type | `model-routing` | Models and briefs |
| 18 | Review uses a different model | `implementer-verifier-differ` | Models and briefs |
| 19 | Lanes start from a brief | `brief-required` | Models and briefs |
| 20 | A cap on lanes at the same time | `lane-cap` | Models and briefs |
| 21 | Lanes follow the load tiers | `load-tiers` | Models and briefs |
| 22 | Lanes run only their own tests | `lane-test-scope` | Models and briefs |
| 23 | Report in a file and in the reply | `report-twice` | Models and briefs |
| 24 | Check the base commit | `base-commit` | Models and briefs |
| 25 | Hand over through progress.md | `progress-handoff` | Sessions and handoff |
| 26 | Commit the record after each wave | `wave-checkpoint` | Sessions and handoff |
| 27 | Act at each usage stage | `token-stages` | Sessions and handoff |
| 28 | Automatic resume uses the default permissions | `auto-retry-default-permission` | Sessions and handoff |
| 29 | Terse mode keeps the evidence | `terse-mode` | Sessions and handoff |
| 30 | Tests change with the feature | `tests-with-change` | Quality and documents |
| 31 | Test results saved as a workbook | `test-results-workbook` | Quality and documents |
| 32 | Required checks pass before ship verification | `ship-precheck` | Quality and documents |
| 33 | Reserve numbers first | `number-reservation` | Quality and documents |
| 34 | Remove finished lane worktrees | `worktree-cleanup` | Quality and documents |
| 35 | Owner decisions are written down | `owner-decisions-recorded` | Quality and documents |
| 36 | Writing style per file kind | `style-per-file` | Quality and documents |
| 37 | Mockup before a screen structure change | `mockup-first` | Quality and documents |
| 38 | Finished work is reported as an artifact | `report-artifact` | Quality and documents |
| 39 | Code flow through the code index | `codegraph-first` | Quality and documents |
| 40 | No repeat calls on paths without an index | `codegraph-index-first` | Quality and documents |
| 41 | Screen words follow the glossary | `glossary-terms` | Planned |

## Git and branches

Which branches lanes and the main session may commit to, merge into and push. The safety hook judges every `git` command before it runs.

### 1. Lanes commit only to their own branch (`lane-own-branch`)

- Rule: A lane commits only to its own lane branch. It does not push, switch branches or merge into the integration branch.
- Why: When several lanes commit to one branch, they overwrite each other's changes. Nobody can tell which lane changed what.
- If blocked: Go back to your lane branch and commit there. If you need the latest integration work, merge the integration branch into your branch. The controller lands your work on the integration branch.
- Message codes: `safety.git.lane_*`
- Enforced in: `hooks/scripts/safety/git-guard.mjs`

### 2. No force push (`no-force-push`)

- Rule: Force pushes and whole-repository pushes (--all, --mirror) are not allowed for anyone.
- Why: A force push erases other people's commits. A whole-repository push also sends the protected branches.
- If blocked: Push one named branch with a normal push. If history must be rewritten, ask the repository owner.
- Message codes: `safety.git.force_push`, `safety.git.push_all`
- Enforced in: `hooks/scripts/safety/git-guard.mjs`

### 3. Protected branches need the owner's grant (`protected-branch-owner-grant`)

- Rule: Landing work on a protected branch such as main needs the owner's grant. A grant can be used once, within a time limit, and only for the commit named when it was given.
- Why: Every piece of work builds on the protected branches. If an agent lands work by itself, unreviewed changes become the base for everyone.
- If blocked: The owner types `/wb:approve merge-main` (or another action) in the prompt. If a gate command is set, the gate must pass on the same commit first. If the grant has expired, type it again.
- Message codes: `safety.git.main_merge`, `safety.git.branch_protected`, `safety.grant.*`, `safety.stamp.*`, `safety.approve.*`
- Enforced in: `hooks/scripts/safety/git-guard.mjs`, `skills/approve/SKILL.md`, `hooks/scripts/safety/approve.mjs`

### 4. No merging while the gate runs (`gate-lock`)

- Rule: Nothing is merged while the gate is running.
- Why: If the code changes during a gate run, nobody can tell which commit the result belongs to.
- If blocked: Try again after the gate finishes. If the gate has stopped and only its lock is left, ask the owner to clear it with `wb-reap --gate-lock`.
- Message codes: `safety.git.gate_locked`
- Enforced in: `hooks/scripts/safety/git-guard.mjs`, `bin/wb-test-report`

### 5. Destructive git commands need confirmation (`no-destructive-git`)

- Rule: Git commands that delete uncommitted changes or unmerged commits (reset --hard, clean -f, branch -D, an unnamed stash) do not run without confirmation.
- Why: Deleted changes cannot be recovered. An unnamed stash shares one list with other sessions, so it can take or drop someone else's changes.
- If blocked: Keep the changes in a temporary commit first. If they really must go, check the target and approve the prompt. If you need a stash, give it a unique name.
- Message codes: `safety.git.reset_hard`, `safety.git.clean`, `safety.git.branch_delete`, `safety.git.ref`, `safety.git.stash`
- Enforced in: `hooks/scripts/safety/git-guard.mjs`

### 6. Feature branch push follows the setting (`feature-push-ask`)

- Rule: Pushing a feature branch asks for confirmation or is blocked, as the project setting says.
- Why: A branch on the remote is visible to other people. The project decides whether agents may push.
- If blocked: Approve the prompt when it asks. When it is blocked, ask the owner to push or change `project.git.feature_push`.
- Message codes: `safety.git.push_feature`, `safety.git.push_feature_denied`
- Related settings: `project.git.feature_push`
- Enforced in: `hooks/scripts/safety/git-guard.mjs`

### 7. Lanes do not merge pull requests (`no-lane-pr-merge`)

- Rule: A lane does not merge pull requests.
- Why: The controller merges after the review is done.
- If blocked: Leave the merge to the controller and put the PR number and state in your report.
- Message codes: `safety.gh.*`
- Enforced in: `hooks/scripts/safety/pretool.mjs`

## File and command safety

Blocks deletions that cannot be undone and commands that cannot be judged. Risky commands stay blocked even when the settings are broken.

### 8. Commands must be readable before they run (`resolvable-commands`)

- Rule: A command whose name or target is built from a variable or a command substitution is blocked.
- Why: When the target is known only at run time, the other safety rules cannot check the command.
- If blocked: Write the real value instead of the variable and run it again. If the value is long, print it first, check it, then use it as is.
- Message codes: `safety.shell.unresolved`, `safety.git.unresolved`, `safety.kill.unresolved`
- Enforced in: `hooks/scripts/safety/shell.mjs`, `hooks/scripts/safety/git-guard.mjs`, `hooks/scripts/safety/kill-guard.mjs`

### 9. Recursive delete only inside the project (`rm-inside-project`)

- Rule: Recursive deletion (`rm -r`) is used only on checked paths inside the project folder.
- Why: Deleting the home folder, a system folder or the git folder cannot be undone. A path built from a variable deletes the whole parent folder when the variable is empty.
- If blocked: Write the real path and run the command again. Ask the owner about paths outside the project.
- Message codes: `safety.rm.*`
- Enforced in: `hooks/scripts/safety/destructive.mjs`

### 10. Agents do not edit protected paths or wb settings (`protected-paths`)

- Rule: Agents do not write protected paths, wb state files or wb settings files.
- Why: If an agent could edit the grant file or the settings, it could switch the safety rules off by itself.
- If blocked: Change state files only with the `wb-*` commands. Settings are changed by the owner or with the owner's approval.
- Message codes: `safety.paths.*`
- Related settings: `project.protected_paths`
- Enforced in: `hooks/scripts/safety/paths.mjs`

### 11. Only a person can grant (`human-only-approve`)

- Rule: `/wb:approve` works only when a person types it in the prompt.
- Why: If an agent could create its own grant, the owner's grant would mean nothing.
- If blocked: Tell the owner which action needs a grant and ask them to type it.
- Message codes: `safety.approve.*`
- Enforced in: `hooks/scripts/safety/approve.mjs`, `skills/approve/SKILL.md`

### 12. Blocked when the check cannot decide (`safety-fails-closed`)

- Rule: When a safety check cannot decide, or a settings file has an error, the call is blocked.
- Why: Letting an unchecked command through switches the safety rules off exactly when they are needed.
- If blocked: Run `/wb:doctor` to find the file and key with the error and fix it. Then check again with `wb-config validate`.
- Message codes: `safety.config.*`, `safety.internal`
- Enforced in: `hooks/scripts/safety/pretool.mjs`, `hooks/scripts/safety/context.mjs`

## Processes and environment

Keeps lanes that share one machine away from each other's processes, ports and screen.

### 13. Stop processes by PID only (`no-pattern-kill`)

- Rule: Processes are not stopped by name or pattern. A lane stops only the processes it started, by PID. A process that holds a protected port is never stopped.
- Why: A pattern also stops servers that other jobs started. When the owner's server goes down, the owner's work stops too.
- If blocked: Find the PID with `lsof -i :<port>` or your own run record and stop only that process. Ask the owner about anything on a protected port.
- Message codes: `safety.kill.pattern`, `safety.kill.protected_port`
- Enforced in: `hooks/scripts/safety/kill-guard.mjs`

### 14. Lanes use their assigned ports (`lane-ports`)

- Rule: A lane uses only the ports assigned to it. Ports come from `wb-port`.
- Why: When two lanes use one port, one server does not start. A lane may also check another lane's server and take it for its own.
- If blocked: Lease ports with `wb-port lease --lane <lane>` and start the server on them. On a clash, see who holds the port with `wb-port list`.
- Enforced in: `bin/wb-port`, `lib/ports.mjs`

### 15. Browsers run without a window (`headless-browser`)

- Rule: Browsers run only in headless mode, with no window.
- Why: A window takes the input focus from the screen the user is working on and interrupts their work.
- If blocked: Add `--headless=new` to the command or use a headless tool. Open a window only when the owner asks for it.
- Message codes: `safety.browser.*`
- Enforced in: `hooks/scripts/safety/browser-guard.mjs`

### 16. Heavy runs go through a slot (`heavy-runs-in-slots`)

- Rule: Full test runs, full builds, package installs and browser runs are wrapped in `wb-slot`.
- Why: When heavy runs overlap across lanes, the machine slows down. Tests then fail on time-outs even when nothing is broken.
- If blocked: Run the same command as `wb-slot -- <command>`. When no slot is free, it waits its turn.
- Message codes: `safety.slot.*`
- Related settings: `machine.slots`
- Enforced in: `hooks/scripts/slots/slot-guard.mjs`, `bin/wb-slot`

## Models and briefs

Checks the model and the brief when a subagent is sent. The dispatch hook judges every Agent tool call before it runs.

### 17. The model fits the task type (`model-routing`)

- Rule: A subagent runs on the model set for its task type. Denied models, models outside the fallback order and models below the minimum level are not used.
- Why: Tasks need different levels of judgement. Design or review on a lower-level model misses defects that cost more to fix later.
- If blocked: Run again with the model that `wb-route resolve <task type>` names. If the usage limit leaves no allowed model, do not go below the minimum level; wait until the limit resets.
- Message codes: `dispatch.model_*`, `dispatch.below_floor`, `dispatch.off_chain`, `dispatch.no_model`, `dispatch.type_*`, `dispatch.wait`
- Related settings: `routing`
- Enforced in: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-route`

### 18. Review uses a different model (`implementer-verifier-differ`)

- Rule: Review and adversarial checks run on a model different from the one that implemented the work. If no other model is available, run the same model in a fresh conversation and say so in the report.
- Why: A model that re-checks its own output tends to repeat the same mistake.
- If blocked: See which model is allowed with `wb-route explain <task type> --implementer <model>` and run that model.
- Message codes: `dispatch.differ_violation`, `dispatch.same_model`
- Enforced in: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-route`

### 19. Lanes start from a brief (`brief-required`)

- Rule: A lane starts from a written brief. The brief has the marker and the required sections: goal, scope, do-not, tests, report and commit.
- Why: Spoken instructions lose the scope and the prohibitions. The lane then edits other lanes' files or leaves no report.
- If blocked: See what is missing with `wb-check brief <file>`. Fill it in from the forms in `templates/briefs/` and start again.
- Message codes: `dispatch.brief_*`
- Related settings: `dispatch.brief`
- Enforced in: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-check`, `templates/briefs/ko/impl.md`

### 20. A cap on lanes at the same time (`lane-cap`)

- Rule: The number of lanes running at the same time stays within the cap (3 by default).
- Why: Too many lanes raise the machine load, and tests fail on time-outs. The controller's review also falls behind.
- If blocked: Land finished lanes and clean up their worktrees before opening a new one. See the running lanes with `/wb:lanes`.
- Message codes: `dispatch.lanes_full`, `wt.lanes_full`
- Related settings: `machine.lanes.max`
- Enforced in: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-worktree`

### 21. Lanes follow the load tiers (`load-tiers`)

- Rule: At or above the hold-new-lanes threshold of the 1-minute load, no new lane starts. At or above the stop-heavy threshold, heavy runs of verifier lanes stop first. Runs that already hold a slot are not stopped.
- Why: Starting more lanes on a loaded machine makes every lane's tests time out. Verification can wait for the executors without changing its result.
- If blocked: Check the load and orphan processes with `wb-slot check`. List processes left in deleted lane folders with `wb-slot reap --orphans`, and after checking stop exactly those PIDs with `--kill`. Dispatch again once the load drops.
- Message codes: `dispatch.load_hold`, `safety.slot.load_stop_heavy`
- Related settings: `machine.load.tiers`
- Enforced in: `hooks/scripts/dispatch/dispatch-guard.mjs`, `hooks/scripts/slots/slot-guard.mjs`, `hooks/scripts/load/check.mjs`, `bin/wb-slot`

### 22. Lanes run only their own tests (`lane-test-scope`)

- Rule: A lane runs only the test files it wrote or changed. The controller runs the full suite and the all-package checks once.
- Why: When every lane runs the full suite, the load stacks up and tests time out. Time also goes into producing the same result several times.
- If blocked: Run only those files, as the brief's test rules say. If you think the full suite is needed, write it in the report for the controller.
- Message codes: `dispatch.brief_incomplete`, `safety.slot.*`
- Enforced in: `templates/briefs/ko/impl.md`, `hooks/scripts/dispatch/dispatch-guard.mjs`, `hooks/scripts/slots/slot-guard.mjs`

### 23. Report in a file and in the reply (`report-twice`)

- Rule: A lane writes its report to a file and returns the same content in its final reply. It leaves an interim note after each large item.
- Why: The results must survive an empty reply or an interrupted run.
- If blocked: Write what you have so far to the report path in the brief and add a summary to the reply.
- Message codes: `dispatch.brief_incomplete`
- Enforced in: `templates/briefs/ko/impl.md`, `hooks/scripts/dispatch/dispatch-guard.mjs`

### 24. Check the base commit (`base-commit`)

- Rule: At the start, a lane checks that the current commit of its worktree is the base commit in the brief. If not, it reports before working.
- Why: Working from an old base fixes problems that are already fixed, or makes merge conflicts larger.
- If blocked: Compare `git log -1` with the brief. If they differ, merge the integration branch first or tell the controller.
- Message codes: `dispatch.brief_incomplete`
- Enforced in: `templates/briefs/ko/impl.md`, `hooks/scripts/dispatch/dispatch-guard.mjs`

## Sessions and handoff

Lets work continue after a session ends or a usage limit stops it.

### 25. Hand over through progress.md (`progress-handoff`)

- Rule: When a session starts, read `progress.md` from start to end. Rewrite the file whole at the end of each unit of work. It holds only the current state (300 lines or fewer by default). Finished content is appended to `docs/progress-archive/progress-<YYYY-MM>.md`.
- Why: A new session that does not know the earlier conversation picks up from `progress.md` alone. If the file is out of date, finished work is done again or work in progress is missed. If old records pile up, the file grows until a new session reads only the beginning and misses the current state.
- If blocked: Append the finished content to the archive (`wb-waves handoff archive "<summary>"` appends the whole current file). Then write goals and owner decisions, branches and servers, in progress, next steps, waiting for answers, system notes and resume commands into `progress.md` anew, and commit both files together. If the file has already grown too long, move it whole with `wb-waves handoff migrate` and then write it anew.
- Related settings: `personal.handoff`
- Enforced in: `hooks/scripts/handoff/session-start.mjs`, `hooks/scripts/handoff/stop-guard.mjs`, `skills/pickup/SKILL.md`, `bin/wb-waves`

### 26. Commit the record after each wave (`wave-checkpoint`)

- Rule: When a wave ends, commit the progress record and tell the user to clear the conversation with `/clear`.
- Why: A long conversation hits the usage limit and the session stops. A record written early lets a new session continue from any point.
- If blocked: Build the resume report with `/wb:resume` and clear the stale items first.
- Enforced in: `hooks/scripts/checkpoint/checkpoint.mjs`, `skills/resume/SKILL.md`

### 27. Act at each usage stage (`token-stages`)

- Rule: When usage reaches 90%, 95% and 99%, follow the stage instructions. Usage is the higher of the official five-hour and seven-day figures, with an estimate of the local use since they were fetched. At 90%, make the units of work smaller. At 95%, write a handoff after every wave. At 99%, write the last handoff and wait.
- Why: Stopping suddenly at the limit loses work that was not recorded.
- If blocked: When the notice appears, finish the current step and update `progress.md`. Change the thresholds with `/wb:token-guard`.
- Related settings: `personal.token_guard`
- Enforced in: `hooks/scripts/token-guard/check.mjs`, `skills/token-guard/SKILL.md`

### 28. Automatic resume uses the default permissions (`auto-retry-default-permission`)

- Rule: A session stopped by a usage limit is resumed automatically only in the default permission mode.
- Why: If a session nobody is watching skips the permission prompts, risky actions can run without a check.
- If blocked: See the schedule with `/wb:auto-retry status`. Raising the mode needs the user to go through the risk confirmation themselves.
- Related settings: `personal.auto_retry.permission_mode`
- Enforced in: `hooks/scripts/auto-retry/detect.mjs`, `skills/auto-retry/SKILL.md`

### 29. Terse mode keeps the evidence (`terse-mode`)

- Rule: Terse mode reduces output and tool calls. It does not reduce verification evidence or the final report.
- Why: Terse mode is for saving tokens. It does not allow reporting results that were not checked.
- If blocked: Turn it off with `/wb:terse off`.
- Enforced in: `hooks/scripts/terse/session-start.mjs`, `skills/terse/SKILL.md`, `rules/terse.ko.md`

## Quality and documents

Keeps reviews, reports and documents to the same standard. Most of these are guided by commands and skills; a few are blocked by hooks.

### 30. Tests change with the feature (`tests-with-change`)

- Rule: When a feature is added, changed or removed, its tests are updated in the same change. A defect that cannot be fixed now is marked pending and recorded, without lowering the test.
- Why: A change without tests, a test that still checks a removed feature and an expectation that differs from the behavior all cause trouble in the next change.
- If blocked: Update the tests as the brief's test rules say. Record a defect you cannot fix with `wb-defects add`.
- Enforced in: `templates/briefs/ko/impl.md`, `bin/wb-defects`, `bin/wb-cases`

### 31. Test results saved as a workbook (`test-results-workbook`)

- Rule: Test results are saved as a workbook and committed. A report cannot be closed without it.
- Why: "It passed" alone cannot show later what was checked and how many cases ran.
- If blocked: Create the workbook with `/wb:test-report` and check it with `wb-check test-results`.
- Enforced in: `bin/wb-test-report`, `bin/wb-check`, `skills/test-report/SKILL.md`

### 32. Required checks pass before ship verification (`ship-precheck`)

- Rule: Ship verification starts only after every required verification (unit, integration, gate, e2e, UI stability, usability and so on) passed on the current commit. A missing result, a result of another commit or a failed one is run again until it passes. A result with fewer tests, more skipped or fixme tests, or a looser threshold than the previous passed result does not count as a pass.
- Why: A ship decision has to rest on the real test results of that commit. An old result, or a pass obtained by removing tests, is no ground for the decision.
- If blocked: Run `/wb:ship-verify`. `wb-quality precheck --run` runs every missing, stale or failed verification. Fix the cause of a failure and run it again. When a weakening is intended, the repository owner accepts it with `wb-quality accept` in their own terminal.
- Message codes: `dispatch.ship_precheck`
- Enforced in: `hooks/scripts/quality/ship-gate.mjs`, `bin/wb-quality`, `skills/ship-verify/SKILL.md`

### 33. Reserve numbers first (`number-reservation`)

- Rule: Numbered files (database migration scripts, decision records and so on) get their number reserved before they are created.
- Why: If parallel lanes use the same number, the merge conflicts and the numbers must be reassigned.
- If blocked: Take a number with `wb-number reserve <series> --lane <lane>`. If two files already clash, renumber the one created later.
- Related settings: `project.numbers`
- Enforced in: `bin/wb-number`, `lib/numbers.mjs`

### 34. Remove finished lane worktrees (`worktree-cleanup`)

- Rule: A finished lane worktree is merged into its target branch and then removed. Before removal, the processes started in it are stopped by PID.
- Why: Processes left in an old worktree keep using the CPU. If work continues in a leftover folder, the handoff record splits in two.
- If blocked: See what to clean up with `wb-reap` and remove the worktree with `wb-worktree remove <lane>`.
- Enforced in: `bin/wb-worktree`, `bin/wb-reap`, `skills/resume/SKILL.md`

### 35. Owner decisions are written down (`owner-decisions-recorded`)

- Rule: What the owner decides is kept as a decision record (`docs/decisions/`).
- Why: A decision made only in conversation is unknown to the next session, so the same question is asked again.
- If blocked: Use `/wb:decide` to put the question, get the answer and write the record.
- Related settings: `project.paths.decisions`
- Enforced in: `skills/decide/SKILL.md`, `bin/wb-decide`

### 36. Writing style per file kind (`style-per-file`)

- Rule: Documents and screen text use the style set for each file kind (`style.map`).
- Why: Without separate styles for screen text and reports, the text in one product reads inconsistently.
- If blocked: See the style of a file with `wb-style of <file>` and fix the text by the rules from `wb-style rules <style>`.
- Related settings: `project.style.map`
- Enforced in: `skills/writing-style/SKILL.md`, `bin/wb-style`, `templates/briefs/ko/docs.md`

### 37. Mockup before a screen structure change (`mockup-first`)

- Rule: A change to the structure of a screen shows a mockup and gets a decision before it is implemented.
- Why: If the structure is rejected after implementation, the work starts over.
- If blocked: Show the mockup as an artifact. Create a decision record with `wb-decide new <name> --kind mockup --scope <paths>`, record the choice with `wb-decide answer` and commit it. The record scope must include the files you change.
- Message codes: `mockup.*`
- Related settings: `project.mockup`
- Enforced in: `hooks/scripts/mockup/mockup-first.mjs`, `bin/wb-decide`

### 38. Finished work is reported as an artifact (`report-artifact`)

- Rule: A report made with `/wb:report` publishes its result as an artifact. A project that keeps test result workbooks also has its newest workbook checked.
- Why: A report given only in words cannot be checked from elsewhere, and its evidence such as captures and figures is not kept.
- If blocked: Publish the report with the artifact tool. If artifacts are not available, build an HTML file with the images inside using `wb-art report`. To turn this check off, set `personal.report.artifact_check` to `false`.
- Message codes: `artifact.*`
- Related settings: `personal.report.artifact_check`
- Enforced in: `hooks/scripts/report/artifact-check.mjs`, `bin/wb-art`, `skills/report/SKILL.md`

### 39. Code flow through the code index (`codegraph-first`)

- Rule: Flow, callers and the impact of a change are checked with the code index (codegraph). Exact line numbers and strings are checked with text search.
- Why: Following callers one text search at a time multiplies the searches. The index lacks line numbers and some call links, so text search is never blocked.
- If blocked: When the note appears, ask the same question once with `codegraph_callers` or `codegraph_explore`. To turn the note off, set `project.codegraph.nudge` to `off`.
- Related settings: `project.codegraph.nudge`
- Enforced in: `hooks/scripts/codegraph/nudge.mjs`, `hooks/scripts/codegraph/session-start.mjs`

### 40. No repeat calls on paths without an index (`codegraph-index-first`)

- Rule: codegraph is not called again for a path that has no index. Every new worktree is queued for indexing when it is created.
- Why: Most index tool errors came from new worktrees that had no index yet. Calling the same path again only added cost.
- If blocked: Continue with grep and Read. See the indexing progress with `wb-index status`; once the index exists, calls work again in the same session. Queue a path yourself with `wb-index add <path>`.
- Message codes: `safety.codegraph.*`
- Related settings: `project.codegraph.auto_index`
- Enforced in: `hooks/scripts/codegraph/deadpath.mjs`, `hooks/scripts/codegraph/record.mjs`, `bin/wb-index`

## Planned

Rules in the catalog with nothing that enforces them yet.

### 41. Screen words follow the glossary (`glossary-terms`)

- Rule: Words in screen text follow the project glossary.
- Why: Calling one thing by different names on different screens confuses users.
- If blocked: Until the glossary check is added, follow the haeyo rules in `style.map` and the words already used on screen.
- Enforced in: not built yet (planned for a later release)
