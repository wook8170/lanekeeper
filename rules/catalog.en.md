# Rule catalog

The rules the plugin keeps, each with its reason, where it is enforced and what to do when blocked. A lane is a piece of work one subagent carries out on its own, with its own branch and its own folder (worktree). A wave is a set of lanes that run together and are merged at once. The controller is the main session that reviews lane results and merges them into the integration branch. The owner is the person who manages the repository, and the gate is the full verification command run before merging. This file is generated with `wb-rules render --write`; do not edit it by hand.

## Git and branches

### Lanes commit only to their own branch (`lane-own-branch`)

A lane commits only to its own lane branch. It does not push, switch branches or merge into the integration branch.

- Why: When several lanes commit to one branch, they overwrite each other's changes. Nobody can tell which lane changed what.
- Enforced in: `hooks/scripts/safety/git-guard.mjs`
- If blocked: Go back to your lane branch and commit there. If you need the latest integration work, merge the integration branch into your branch. The controller lands your work on the integration branch.

### No force push (`no-force-push`)

Force pushes and whole-repository pushes (--all, --mirror) are not allowed for anyone.

- Why: A force push erases other people's commits. A whole-repository push also sends the protected branches.
- Enforced in: `hooks/scripts/safety/git-guard.mjs`
- If blocked: Push one named branch with a normal push. If history must be rewritten, ask the repository owner.

### Protected branches need the owner's grant (`protected-branch-owner-grant`)

Landing work on a protected branch such as main needs the owner's grant. A grant can be used once, within a time limit, and only for the commit named when it was given.

- Why: Every piece of work builds on the protected branches. If an agent lands work by itself, unreviewed changes become the base for everyone.
- Enforced in: `hooks/scripts/safety/git-guard.mjs`, `skills/approve/SKILL.md`, `hooks/scripts/safety/approve.mjs`
- If blocked: The owner types `/wb:approve merge-main` (or another action) in the prompt. If a gate command is set, the gate must pass on the same commit first. If the grant has expired, type it again.

### No merging while the gate runs (`gate-lock`)

Nothing is merged while the gate is running.

- Why: If the code changes during a gate run, nobody can tell which commit the result belongs to.
- Enforced in: `hooks/scripts/safety/git-guard.mjs`, `bin/wb-test-report`
- If blocked: Try again after the gate finishes. If the gate has stopped and only its lock is left, ask the owner to clear it with `wb-reap --gate-lock`.

### Destructive git commands need confirmation (`no-destructive-git`)

Git commands that delete uncommitted changes or unmerged commits (reset --hard, clean -f, branch -D, an unnamed stash) do not run without confirmation.

- Why: Deleted changes cannot be recovered. An unnamed stash shares one list with other sessions, so it can take or drop someone else's changes.
- Enforced in: `hooks/scripts/safety/git-guard.mjs`
- If blocked: Keep the changes in a temporary commit first. If they really must go, check the target and approve the prompt. If you need a stash, give it a unique name.

### Feature branch push follows the setting (`feature-push-ask`)

Pushing a feature branch asks for confirmation or is blocked, as the project setting says.

- Why: A branch on the remote is visible to other people. The project decides whether agents may push.
- Enforced in: `hooks/scripts/safety/git-guard.mjs`, setting `project.git.feature_push`
- If blocked: Approve the prompt when it asks. When it is blocked, ask the owner to push or change `project.git.feature_push`.

### Lanes do not merge pull requests (`no-lane-pr-merge`)

A lane does not merge pull requests.

- Why: The controller merges after the review is done.
- Enforced in: `hooks/scripts/safety/pretool.mjs`
- If blocked: Leave the merge to the controller and put the PR number and state in your report.

## Processes and environment

### Stop processes by PID only (`no-pattern-kill`)

Processes are not stopped by name or pattern. A lane stops only the processes it started, by PID. A process that holds a protected port is never stopped.

- Why: A pattern also stops servers that other jobs started. When the owner's server goes down, the owner's work stops too.
- Enforced in: `hooks/scripts/safety/kill-guard.mjs`
- If blocked: Find the PID with `lsof -i :<port>` or your own run record and stop only that process. Ask the owner about anything on a protected port.

### Lanes use their assigned ports (`lane-ports`)

A lane uses only the ports assigned to it. Ports come from `wb-port`.

- Why: When two lanes use one port, one server does not start. A lane may also check another lane's server and take it for its own.
- Enforced in: `bin/wb-port`, `lib/ports.mjs`
- If blocked: Lease ports with `wb-port lease --lane <lane>` and start the server on them. On a clash, see who holds the port with `wb-port list`.

### Browsers run without a window (`headless-browser`)

Browsers run only in headless mode, with no window.

- Why: A window takes the input focus from the screen the user is working on and interrupts their work.
- Enforced in: `hooks/scripts/safety/browser-guard.mjs`
- If blocked: Add `--headless=new` to the command or use a headless tool. Open a window only when the owner asks for it.

### Heavy runs go through a slot (`heavy-runs-in-slots`)

Full test runs, full builds, package installs and browser runs are wrapped in `wb-slot`.

- Why: When heavy runs overlap across lanes, the machine slows down. Tests then fail on time-outs even when nothing is broken.
- Enforced in: `hooks/scripts/slots/slot-guard.mjs`, `bin/wb-slot`, setting `machine.slots`
- If blocked: Run the same command as `wb-slot -- <command>`. When no slot is free, it waits its turn.

## File and command safety

### Commands must be readable before they run (`resolvable-commands`)

A command whose name or target is built from a variable or a command substitution is blocked.

- Why: When the target is known only at run time, the other safety rules cannot check the command.
- Enforced in: `hooks/scripts/safety/shell.mjs`, `hooks/scripts/safety/git-guard.mjs`, `hooks/scripts/safety/kill-guard.mjs`
- If blocked: Write the real value instead of the variable and run it again. If the value is long, print it first, check it, then use it as is.

### Recursive delete only inside the project (`rm-inside-project`)

Recursive deletion (`rm -r`) is used only on checked paths inside the project folder.

- Why: Deleting the home folder, a system folder or the git folder cannot be undone. A path built from a variable deletes the whole parent folder when the variable is empty.
- Enforced in: `hooks/scripts/safety/destructive.mjs`
- If blocked: Write the real path and run the command again. Ask the owner about paths outside the project.

### Agents do not edit protected paths or wb settings (`protected-paths`)

Agents do not write protected paths, wb state files or wb settings files.

- Why: If an agent could edit the grant file or the settings, it could switch the safety rules off by itself.
- Enforced in: `hooks/scripts/safety/paths.mjs`, setting `project.protected_paths`
- If blocked: Change state files only with the `wb-*` commands. Settings are changed by the owner or with the owner's approval.

### Only a person can grant (`human-only-approve`)

`/wb:approve` works only when a person types it in the prompt.

- Why: If an agent could create its own grant, the owner's grant would mean nothing.
- Enforced in: `hooks/scripts/safety/approve.mjs`, `skills/approve/SKILL.md`
- If blocked: Tell the owner which action needs a grant and ask them to type it.

### Blocked when the check cannot decide (`safety-fails-closed`)

When a safety check cannot decide, or a settings file has an error, the call is blocked.

- Why: Letting an unchecked command through switches the safety rules off exactly when they are needed.
- Enforced in: `hooks/scripts/safety/pretool.mjs`, `hooks/scripts/safety/context.mjs`
- If blocked: Run `/wb:doctor` to find the file and key with the error and fix it. Then check again with `wb-config validate`.

## Models and briefs

### The model fits the task type (`model-routing`)

A subagent runs on the model set for its task type. Denied models, models outside the fallback order and models below the minimum level are not used.

- Why: Tasks need different levels of judgement. Design or review on a lower-level model misses defects that cost more to fix later.
- Enforced in: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-route`, setting `routing`
- If blocked: Run again with the model that `wb-route resolve <task type>` names. If the usage limit leaves no allowed model, do not go below the minimum level; wait until the limit resets.

### Review uses a different model (`implementer-verifier-differ`)

Review and adversarial checks run on a model different from the one that implemented the work. If no other model is available, run the same model in a fresh conversation and say so in the report.

- Why: A model that re-checks its own output tends to repeat the same mistake.
- Enforced in: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-route`
- If blocked: See which model is allowed with `wb-route explain <task type> --implementer <model>` and run that model.

### Lanes start from a brief (`brief-required`)

A lane starts from a written brief. The brief has the marker and the required sections: goal, scope, do-not, tests, report and commit.

- Why: Spoken instructions lose the scope and the prohibitions. The lane then edits other lanes' files or leaves no report.
- Enforced in: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-check`, `templates/briefs/ko/impl.md`, setting `dispatch.brief`
- If blocked: See what is missing with `wb-check brief <file>`. Fill it in from the forms in `templates/briefs/` and start again.

### A cap on lanes at the same time (`lane-cap`)

The number of lanes running at the same time stays within the cap (3 by default).

- Why: Too many lanes raise the machine load, and tests fail on time-outs. The controller's review also falls behind.
- Enforced in: `hooks/scripts/dispatch/dispatch-guard.mjs`, `bin/wb-worktree`, setting `machine.lanes.max`
- If blocked: Land finished lanes and clean up their worktrees before opening a new one. See the running lanes with `/wb:lanes`.

### Lanes run only their own tests (`lane-test-scope`)

A lane runs only the test files it wrote or changed. The controller runs the full suite and the all-package checks once.

- Why: When every lane runs the full suite, the load stacks up and tests time out. Time also goes into producing the same result several times.
- Enforced in: `templates/briefs/ko/impl.md`, `hooks/scripts/dispatch/dispatch-guard.mjs`, `hooks/scripts/slots/slot-guard.mjs`
- If blocked: Run only those files, as the brief's test rules say. If you think the full suite is needed, write it in the report for the controller.

### Report in a file and in the reply (`report-twice`)

A lane writes its report to a file and returns the same content in its final reply. It leaves an interim note after each large item.

- Why: The results must survive an empty reply or an interrupted run.
- Enforced in: `templates/briefs/ko/impl.md`, `hooks/scripts/dispatch/dispatch-guard.mjs`
- If blocked: Write what you have so far to the report path in the brief and add a summary to the reply.

### Check the base commit (`base-commit`)

At the start, a lane checks that the current commit of its worktree is the base commit in the brief. If not, it reports before working.

- Why: Working from an old base fixes problems that are already fixed, or makes merge conflicts larger.
- Enforced in: `templates/briefs/ko/impl.md`, `hooks/scripts/dispatch/dispatch-guard.mjs`
- If blocked: Compare `git log -1` with the brief. If they differ, merge the integration branch first or tell the controller.

## Sessions and handoff

### Hand over through progress.md (`progress-handoff`)

When a session starts, read `progress.md` from start to end. Rewrite the file whole at the end of each unit of work. It holds only the current state (300 lines or fewer by default). Finished content is appended to `docs/progress-archive/progress-<YYYY-MM>.md`.

- Why: A new session that does not know the earlier conversation picks up from `progress.md` alone. If the file is out of date, finished work is done again or work in progress is missed. If old records pile up, the file grows until a new session reads only the beginning and misses the current state.
- Enforced in: `hooks/scripts/handoff/session-start.mjs`, `hooks/scripts/handoff/stop-guard.mjs`, `skills/pickup/SKILL.md`, `bin/wb-waves`, setting `personal.handoff`
- If blocked: Append the finished content to the archive (`wb-waves handoff archive "<summary>"` appends the whole current file). Then write goals and owner decisions, branches and servers, in progress, next steps, waiting for answers, system notes and resume commands into `progress.md` anew, and commit both files together. If the file has already grown too long, move it whole with `wb-waves handoff migrate` and then write it anew.

### Commit the record after each wave (`wave-checkpoint`)

When a wave ends, commit the progress record and tell the user to clear the conversation with `/clear`.

- Why: A long conversation hits the usage limit and the session stops. A record written early lets a new session continue from any point.
- Enforced in: `hooks/scripts/checkpoint/checkpoint.mjs`, `skills/resume/SKILL.md`
- If blocked: Build the resume report with `/wb:resume` and clear the stale items first.

### Act at each usage stage (`token-stages`)

When usage reaches 90%, 95% and 99%, follow the stage instructions. Usage is the higher of the official five-hour and seven-day figures, with an estimate of the local use since they were fetched. At 90%, make the units of work smaller. At 95%, write a handoff after every wave. At 99%, write the last handoff and wait.

- Why: Stopping suddenly at the limit loses work that was not recorded.
- Enforced in: `hooks/scripts/token-guard/check.mjs`, `skills/token-guard/SKILL.md`, setting `personal.token_guard`
- If blocked: When the notice appears, finish the current step and update `progress.md`. Change the thresholds with `/wb:token-guard`.

### Automatic resume uses the default permissions (`auto-retry-default-permission`)

A session stopped by a usage limit is resumed automatically only in the default permission mode.

- Why: If a session nobody is watching skips the permission prompts, risky actions can run without a check.
- Enforced in: `hooks/scripts/auto-retry/detect.mjs`, `skills/auto-retry/SKILL.md`, setting `personal.auto_retry.permission_mode`
- If blocked: See the schedule with `/wb:auto-retry status`. Raising the mode needs the user to go through the risk confirmation themselves.

### Terse mode keeps the evidence (`terse-mode`)

Terse mode reduces output and tool calls. It does not reduce verification evidence or the final report.

- Why: Terse mode is for saving tokens. It does not allow reporting results that were not checked.
- Enforced in: `hooks/scripts/terse/session-start.mjs`, `skills/terse/SKILL.md`, `rules/terse.ko.md`
- If blocked: Turn it off with `/wb:terse off`.

## Quality and documents

### Tests change with the feature (`tests-with-change`)

When a feature is added, changed or removed, its tests are updated in the same change. A defect that cannot be fixed now is marked pending and recorded, without lowering the test.

- Why: A change without tests, a test that still checks a removed feature and an expectation that differs from the behavior all cause trouble in the next change.
- Enforced in: `templates/briefs/ko/impl.md`, `bin/wb-defects`, `bin/wb-cases`
- If blocked: Update the tests as the brief's test rules say. Record a defect you cannot fix with `wb-defects add`.

### Test results saved as a workbook (`test-results-workbook`)

Test results are saved as a workbook and committed. A report cannot be closed without it.

- Why: "It passed" alone cannot show later what was checked and how many cases ran.
- Enforced in: `bin/wb-test-report`, `bin/wb-check`, `skills/test-report/SKILL.md`
- If blocked: Create the workbook with `/wb:test-report` and check it with `wb-check test-results`.

### Reserve numbers first (`number-reservation`)

Numbered files (database migration scripts, decision records and so on) get their number reserved before they are created.

- Why: If parallel lanes use the same number, the merge conflicts and the numbers must be reassigned.
- Enforced in: `bin/wb-number`, `lib/numbers.mjs`, setting `project.numbers`
- If blocked: Take a number with `wb-number reserve <series> --lane <lane>`. If two files already clash, renumber the one created later.

### Remove finished lane worktrees (`worktree-cleanup`)

A finished lane worktree is merged into its target branch and then removed. Before removal, the processes started in it are stopped by PID.

- Why: Processes left in an old worktree keep using the CPU. If work continues in a leftover folder, the handoff record splits in two.
- Enforced in: `bin/wb-worktree`, `bin/wb-reap`, `skills/resume/SKILL.md`
- If blocked: See what to clean up with `wb-reap` and remove the worktree with `wb-worktree remove <lane>`.

### Owner decisions are written down (`owner-decisions-recorded`)

What the owner decides is kept as a decision record (`docs/decisions/`).

- Why: A decision made only in conversation is unknown to the next session, so the same question is asked again.
- Enforced in: `skills/decide/SKILL.md`, `bin/wb-decide`, setting `project.paths.decisions`
- If blocked: Use `/wb:decide` to put the question, get the answer and write the record.

### Writing style per file kind (`style-per-file`)

Documents and screen text use the style set for each file kind (`style.map`).

- Why: Without separate styles for screen text and reports, the text in one product reads inconsistently.
- Enforced in: `skills/writing-style/SKILL.md`, `bin/wb-style`, `templates/briefs/ko/docs.md`, setting `project.style.map`
- If blocked: See the style of a file with `wb-style of <file>` and fix the text by the rules from `wb-style rules <style>`.

### Mockup before a screen structure change (`mockup-first`)

A change to the structure of a screen shows a mockup and gets a decision before it is implemented.

- Why: If the structure is rejected after implementation, the work starts over.
- Enforced in: `hooks/scripts/mockup/mockup-first.mjs`, `bin/wb-decide`, setting `project.mockup`
- If blocked: Show the mockup as an artifact. Create a decision record with `wb-decide new <name> --kind mockup --scope <paths>`, record the choice with `wb-decide answer` and commit it. The record scope must include the files you change.

### Finished work is reported as an artifact (`report-artifact`)

A report made with `/wb:report` publishes its result as an artifact. A project that keeps test result workbooks also has its newest workbook checked.

- Why: A report given only in words cannot be checked from elsewhere, and its evidence such as captures and figures is not kept.
- Enforced in: `hooks/scripts/report/artifact-check.mjs`, `bin/wb-art`, `skills/report/SKILL.md`, setting `personal.report.artifact_check`
- If blocked: Publish the report with the artifact tool. If artifacts are not available, build an HTML file with the images inside using `wb-art report`. To turn this check off, set `personal.report.artifact_check` to `false`.

### Code flow through the code index (`codegraph-first`)

Flow, callers and the impact of a change are checked with the code index (codegraph). Exact line numbers and strings are checked with text search.

- Why: Following callers one text search at a time multiplies the searches. The index lacks line numbers and some call links, so text search is never blocked.
- Enforced in: `hooks/scripts/codegraph/nudge.mjs`, `hooks/scripts/codegraph/session-start.mjs`, setting `project.codegraph.nudge`
- If blocked: When the note appears, ask the same question once with `codegraph_callers` or `codegraph_explore`. To turn the note off, set `project.codegraph.nudge` to `off`.

### No repeat calls on paths without an index (`codegraph-index-first`)

codegraph is not called again for a path that has no index. Every new worktree is queued for indexing when it is created.

- Why: Most index tool errors came from new worktrees that had no index yet. Calling the same path again only added cost.
- Enforced in: `hooks/scripts/codegraph/deadpath.mjs`, `hooks/scripts/codegraph/record.mjs`, `bin/wb-index`, setting `project.codegraph.auto_index`
- If blocked: Continue with grep and Read. See the indexing progress with `wb-index status`; once the index exists, calls work again in the same session. Queue a path yourself with `wb-index add <path>`.

## Planned

### Screen words follow the glossary (`glossary-terms`)

Words in screen text follow the project glossary.

- Why: Calling one thing by different names on different screens confuses users.
- Enforced in: not built yet (planned for a later release)
- If blocked: Until the glossary check is added, follow the haeyo rules in `style.map` and the words already used on screen.
