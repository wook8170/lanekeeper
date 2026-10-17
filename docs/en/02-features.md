# Features

wb works in three ways. Hooks judge automatically before and after Claude Code runs a tool. The `wb-*` commands are run by you or by Claude. Skills (`/wb:<name>`) are task guides that make Claude run commands in a set order.

This page explains when and how to use each feature, and ends with the 17 skills one by one. Default values and meanings of settings keys are in [Configuration](03-configuration.md); the reason and recovery of each rule are in [Rules](04-rules.md).

## 1. Features at a glance

| Feature | How it works | Commands and skills |
|---|---|---|
| Model routing and dispatch check | A hook checks the model and the brief when a subagent is sent | `wb-route`, `wb-check brief` |
| Safety hooks | git, killing processes, deletion, browsers and path writes are judged before they run | `/wb:approve` |
| Run slots, ports and lane worktrees | Limits heavy runs, lends ports per lane, creates lane folders | `wb-slot`, `wb-port`, `wb-worktree`, `wb-reap` |
| Lane ledger, board and resume | Records wave and lane state, resumes stopped lanes | `wb-waves`, `/wb:lanes`, `/wb:resume`, `/wb:pickup` |
| Progress record | Keeps `progress.md` as the current state, finished content goes to the archive | `wb-waves handoff` |
| Test result workbook and case ledger | Saves integration results as xlsx, manages test cases and defects | `wb-test-report`, `wb-cases`, `wb-defects`, `/wb:test-report` |
| Review, integrate and report | Nine-item review, rule-based merge, artifact report | `wb-check lane`, `wb-integrate`, `wb-art`, `/wb:review-lane`, `/wb:integrate`, `/wb:report` |
| Mockup first | Blocks screen structure changes until a decision is recorded | `wb-decide`, `/wb:decide` |
| Beginner layer | Guides a one-line request, explains blocks, sets the writing voice | `/wb:work`, `/wb:explain`, `/wb:writing-style` |
| Code index | codegraph index queue and usage hints | `wb-index` |
| Session helpers | Token guard, automatic resume, terse mode, checkpoints | `wb-token`, `wb-retry`, `wb-terse`, `/wb:token-guard`, `/wb:auto-retry`, `/wb:terse` |
| Settings check | Settings errors and where each value comes from | `wb-config`, `/wb:init`, `/wb:doctor` |

## 2. Model routing and the dispatch check

`routing.json` gives each task type an order of models (the fallback order) and a minimum grade. Models you denied and models out of quota are removed from the order; the first model left is used if it is at or above the minimum grade. When only models below the minimum are left, nothing is sent and the work waits for the reset time.

There are 10 default task types.

| Task type | Use | Fallback order | Minimum grade |
|---|---|---|---|
| `design` | Design, analysis, planning | fable → opus | opus |
| `review` | Review and verdicts | fable → opus | opus |
| `security` | Security review | opus | opus |
| `adversarial` | Review from the opposing side. The implementing model is left out | opus → fable | opus |
| `impl-multi` | Implementation across several files | opus → sonnet | sonnet |
| `impl-spec` | Implementation with a fixed spec | sonnet → opus | sonnet |
| `mockup` | Mockups | opus → sonnet | sonnet |
| `defect-history` | Defect history analysis | sonnet → opus | sonnet |
| `mechanical` | Mechanical edits | haiku → sonnet | haiku |
| `research` | Read-only research | haiku → sonnet | haiku |

Commands that preview the result:

```
wb-route tasks                                  fallback order and minimum grade per task type
wb-route resolve impl-multi                     the model to use; exit code 3 means wait
wb-route explain review --implementer opus      step-by-step trace
wb-route check review --model sonnet            judge a model choice; exit code 1 means blocked
```

```
Task review · chain fable > opus · floor opus
  1 denied: -
  2 out of quota: -
  3 implementer excluded: -
  4 below floor: -
Result: fable (model: "fable")
```

**Dispatch check.** When Claude sends a subagent with the Agent tool, a hook checks the brief marker on the first line (`<!-- wb-brief v1 type=<task type> lane=<lane> template=<template> -->`), the required sections (goal, scope, forbidden, test rules, report location, commit rules), unfilled `{{…}}` placeholders, the `model` value, denied and out-of-quota models, the minimum grade, and the number of live lanes. Any mismatch blocks the call and shows the routing result. The `fork`, `claude-code-guide` and `statusline-setup` agents skip the brief check (`project.dispatch.exempt_agents`).

**Brief templates.** `templates/briefs/ko` and `templates/briefs/en` hold seven templates (impl, fix, mockup, research, review, docs, test). Fill one with `wb-style brief <template> --owned <file,…> --var name=value` and check it with `wb-check brief <file>`.

## 3. Safety hooks

Bash, Write, Edit, MultiEdit, NotebookEdit and Skill calls are judged before they run. The verdict is allow, ask or block. A call is treated as coming from a lane when the hook input marks a subagent or the target worktree is in the lane registry; otherwise it comes from the main session.

| Target | Main verdicts |
|---|---|
| git | Lanes commit only to their own branch. Push, merge and branch switches are blocked for lanes. Commits, merges and pushes on a protected branch need an owner grant. Nobody can force push. `reset --hard`, `clean -f`, `branch -D` and unnamed stash ask first |
| Killing processes | Killing by name, such as `pkill` and `killall`, is blocked. `kill <PID>` is blocked when the target uses a protected port |
| Deletion | `rm -r` of the home folder, system folders, the project root or `.git` is blocked. Outside the project it asks first |
| Browsers | Chrome with a window, `--headed`, `playwright codegen` and `open` on a browser are blocked |
| Paths | Writes to `project.protected_paths` and to wb state files are blocked. Edits to wb settings files ask first |

Commands are unpacked before judging: `;` `&&` `|`, subshells, `sh -c`, `eval`, aliases, `git -C` and `cd`. A command whose target cannot be known before it runs (for example a command name held in a variable) is blocked. While a settings file has an error, every risky command is blocked.

Examples (main session, on the integration branch):

```
$ pkill -f vite
[wb] Blocked: Killing by name or pattern (`pkill`) can take down other sessions' or the owner's servers.
How to fix: Find the PID of the process you started and use `kill <PID>`.
Where to ask: Run `/wb:doctor` or read the "Safety hooks" section of the README. Only the repository owner can change these rules.

$ git push origin wb/search/int
[wb] Needs your confirmation: Feature branch pushes need confirmation (setting `project.git.feature_push: ask`).

$ git reset --hard HEAD~1
[wb] Needs your confirmation: `git reset --hard` discards uncommitted changes for good (current `wb/search/int`).
```

**Owner grant.** Changes to a protected branch are granted only when the owner types `/wb:approve merge-main` (or `push-main`, `commit-main`) in the prompt. A grant is valid once, for 15 minutes, and only for the commit current when it was typed. Claude cannot call this skill or write the grant file.

**Outside the check.** The safety hooks judge command strings. Commands inside script files, and git calls made from python or node, are not judged.

## 4. Run slots, ports and lane worktrees

**Run slots.** Heavy runs (full test suites, builds, installs, e2e, indexing) and headless browsers are counted across the whole machine. The defaults are 2 heavy slots and 2 browser slots. A run waits when no slot is free or when the 1-minute load is at or above the threshold (default: logical cores × 2).

```
wb-slot --kind heavy -- pnpm -r test
wb-slot --kind heavy,browser -- npx playwright test
wb-slot status
wb-slot reap
```

```
1-minute load 3.78 / threshold 20
heavy: 0/2 in use
browser: 0/2 in use
```

When Claude runs a heavy command without a slot, the default (`machine.slots.guard: warn`) lets it run and shows the wrapped command. With `deny` the run is blocked. A single-file test run (`vitest run a.test.ts`) is not treated as heavy.

```
[wb] `npx playwright test` is a heavy run and should go through a slot (browser,heavy). Run it again wrapped like this: `wb-slot --kind browser,heavy -- sh -c 'npx playwright test'`
```

**Ports.** Protected port numbers and the lane port range live only in the machine settings (`~/.wb/machine.json`). Documents and briefs use names and get the number with `wb-port get <name> [--lane <lane>]`. The lane range starts at 41000 with 20 ports per lane, and lends named ports (web, web2, api, db, aux).

```
wb-port list
```

```
0 protected port(s)
Lane range: base 41000, step 20, names web,web2,api,db,aux, up to 9 lanes
0 lease(s)
```

**Lane worktrees.** `wb-worktree create <lane>` creates the lane branch and folder from the integration HEAD, leases ports and registers the lane. It copies the git-ignored files listed in `.worktreeinclude` (such as `.env`) and runs the setup command of `project.worktree.setup` inside a slot. It refuses when the live lanes reach the cap (default 3).

```
wb-worktree create l1
wb-worktree list
wb-worktree remove l1 [--force] [--delete-branch]
```

If a process still runs inside the folder, remove refuses and lists the PIDs. Stop them one by one with `kill <PID>` and run it again.

**Claude Code worktree hook (optional).** Answer yes in `/wb:init` or set `project.worktree.hook` to `true`, and the worktrees Claude Code creates (`claude --worktree`, subagents with `isolation: "worktree"`, and so on) follow the wb way. The hook is registered in this machine's `.claude/settings.local.json` and replaces Claude Code's own worktree creation entirely. Check it with `wb-worktree hooks status` and apply it now with `wb-worktree hooks sync`.

**Cleanup.** `wb-reap` reclaims finished slot leases and lists port leases and registry entries of lanes whose folder is gone. `--apply` removes them. It never kills processes.

## 5. Lane ledger, board and resume

Wave and lane state is kept in `<git common dir>/wb/waves.json`, which every worktree sees. Write it only through `wb-waves`. Do not edit the JSON by hand.

```
wb-waves init-wave w1 --title "List search box"
wb-waves lane w1 l1 --task impl-multi --model opus --brief .wb/briefs/l1.md --todo "Add the search box"
wb-waves board
wb-waves metrics
```

Hooks record passed dispatches, subagent starts and subagent stops in the ledger. The `lane=` value of the brief marker names the lane. When a lane ends, its status becomes "review"; a return from review adds one to the return count.

A lane is pending, running, review, blocked, failed or done. `*` on the board means an agent is running now. The plugin shows one line such as `wb 1/3 running · l1:running` in the subagent status line.

**Resume.** After a session ends or a limit stops it, `/wb:resume` builds the `wb-waves resume` report: `progress.md`, git state, the worktree list, recent commits, lane verdicts and stale items in one place. A stopped lane is sent again to the same worktree with the text from `wb-waves resume --prompt w1/l1`.

## 6. Progress record (progress.md) and archive

`progress.md` holds only the state that is current now. The target is 300 lines or fewer. The top line gives the archive location and how to search it, followed by the sections goals and owner decisions, branches and servers, in progress (table), next, waiting for answers, system notes and resume commands.

| When | What the hooks do |
|---|---|
| Session start, `/clear` | Put the whole `progress.md` and how to search the archive into the conversation |
| End of a turn | If there are commits or changed files newer than the last update, block once and ask for a handoff. The same session is not blocked again for 20 minutes |
| Over the line target | Mention it at session start, end and in the resume report, and point to `wb-waves handoff migrate` |

Finished content (completed waves, answered questions) is appended as a dated section to the end of `docs/progress-archive/progress-<YYYY-MM>.md`. History is never deleted; find what you need with `grep -n '<keyword>' docs/progress-archive/*.md`.

```
wb-waves handoff check                      line count and archive files; exit code 1 over the target
wb-waves handoff archive "<summary>"        append the whole progress.md to this month's archive
wb-waves handoff migrate                    move an accumulated file over the target to the archive and start a fresh one
```

In a repository without `progress.md` the handoff hooks do nothing. Create the file once yourself.

## 7. Test result workbook and case ledger

Integration and final verification results are kept as an Excel workbook (xlsx) with a summary json. Python 3.8 or later with openpyxl is needed. Without them the install commands are shown and only the workbook is skipped.

```
wb-test-report env                          check the environment
wb-test-report init                         write .wb/verify.config.json
wb-test-report run --name integration       gate → each stage → workbook (gate pass stamp on a full pass)
wb-test-report gate-pass                    run project.gate.command, gate pass stamp when it passes
wb-test-report summary [--json]             figures of the newest result
wb-check test-results                       the newest result exists and is committed
```

Each stage names its result format (`adapter`: vitest · jest · playwright · pytest), kind (`kind`: unit · integration · e2e · uistab), command (`cmd`; the result file goes to `{file}`) and slot (`slot`: heavy · `heavy,browser` · none). Every stage runs even when an earlier one fails. While it runs, the gate lock (`<git common dir>/wb/gate.lock`) makes merges wait.

The sheets are 요약 (summary), 단위 (unit), 통합 DB (integration DB), e2e, e2e 상세 (e2e detail), UI 안정성 (UI stability), gate 단계 (gate steps), 실패 목록 (failures), 간헐 실패 (flaky), 원장 대조 (ledger comparison), 커버리지 (coverage) and 변이 (mutation). A sheet without data is not created. The file goes to `docs/test-results/<date>/<name>-<HHMM>.xlsx` and is committed.

**Case ledger and defect register.** `docs/e2e/<module>.cases.json` and `defect-register.json` are managed with `wb-cases` and `wb-defects`. Case ids are never reused. A defect that cannot be fixed now is registered as a defect and the case is marked `fixme`; the test is not weakened.

```
wb-cases init search --prefix SRCH
wb-cases add search --title "Type a search term" --expected "Only matching items are shown" --priority P1
wb-defects add --title "The list disappears on an empty search term" --severity high --case SRCH-001
wb-cases set search SRCH-001 --status fixme --defect D-001
wb-cases check
```

With a ledger, the ledger comparison sheet lists mismatches between the ledger and the run. Mismatches must be 0 before a ship decision.

## 8. Review, integrate and report

When lanes finish, the main session goes through review → integrate → report. Commands make the verdicts; people decide only whether to send a return and whether to stop at "ready to merge".

**Review (`wb-check lane`).** The lane report file is read as the source of truth and compared with the returned message.

| # | Item | Fails when |
|---|---|---|
| 1 | Reported HEAD | missing, unknown, or the integration HEAD is not its ancestor |
| 2 | Report file | missing, no HEAD / tests / remaining items, or HEAD or pass count differs from the returned message |
| 3 | Project guards | a command in `project.review.guards` fails. Skipped when none is set |
| 4 | Failure before the fix | code changed and the report does not record the failing run before the fix |
| 5 | Brief scope | a changed file is outside the brief's owned files or on its forbidden list |
| 6 | Captures | screen change without captures, a capture file is missing, or the main session has not opened them |
| 7 | Served code marker | web screen change and the served code lacks the change's marker. Only addresses on this machine are checked |
| 8 | Test results | lane: no passed count or failures in the report; integration/final: no committed workbook for this HEAD |
| 9 | Terms | the term check grew over its baseline. Skipped without a glossary |

When an item fails, a return brief is written to `.wb/briefs/<lane>-return-<n>.md`.

**Integrate (`wb-integrate`).** In the folder where the integration branch is checked out, each lane branch is trial-merged one at a time and conflicts are classified.

| Class | Handling |
|---|---|
| Ledger (`*.cases.json`, `defect-register.json`) | Union by `id`; on a shared id the integration side wins |
| Registration (`hooks/hooks.json`) | Objects merged, lists united |
| Generated (`*.xlsx`, lock files) | Integration side taken, then the `project.integrate.regenerate` commands run |
| Code (any other file) | The merge is aborted and the lane gets a return brief asking it to merge the latest integration HEAD |

Exit codes: 0 merged, 1 aborted (return brief written), 2 not started (tree not clean and so on), 3 a gate is running.

**Report (`wb-art`).** Captures worth seeing again go to `docs/reports/artifacts/<topic>/` with `wb-art keep` and are committed. Throw-away captures go to the scratch folder with `wb-art temp`. `wb-art report` builds one HTML file with images embedded as data URIs. PNGs over 300KB are shrunk to WebP.

```
wb-art env
Converter: cwebp. PNGs over 300KB become WebP at quality 80
```

If a session that ran `/wb:report` tries to end without an artifact, a Stop hook blocks it once.

## 9. Mockup first

When screen files are named (`project.mockup.ui_globs`), writes that change the screen structure in that scope are blocked until a decision is recorded. With an empty list (the default) the check is off.

- Counted as a structure change: a new screen file, an edit that changes the markup elements, adding or removing a stylesheet selector
- Let through: edits that change only text, attributes or CSS property values
- Unblocked by: a record in `docs/decisions/` with `status=decided kind=mockup` whose `scope` covers the file

The order is: show the current screen and the options as an artifact, create the question with `wb-decide new … --kind mockup --scope …`, record the choice with `wb-decide answer`, and commit. To turn it off, set `project.mockup.decision_required` to `false`.

## 10. Beginner layer

This layer lets a user who does not know the lane flow start from a one-line request and read right away why something is blocked.

- `/wb:work` sorts the request into a kind (bug, feature, screen, documents, research, large design) and shows the steps and the model of each. `wb-work progress` shows where the flow stands as a seven-stage bar (`[■■■□□□□] 3/7 Building · 1 running`).
- `/wb:explain` explains in plain words what is blocked or waiting now. The code in a block message leads to its rule with `wb-explain code <code>`.
- `/wb:writing-style` sets the voice of each file (friendly UI voice, report voice, plain). The first matching entry of `project.style.map` wins.
- `/wb:decide` turns an owner decision into a question with fixed options and keeps the answer in `docs/decisions/`.

```
wb-explain
Nothing is blocked or waiting right now.
```

## 11. Code index (codegraph)

codegraph is optional. Without it the related hooks and commands do nothing, and `wb-index` only shows how to install it. It is installed only after the user agrees in `/wb:init`.

- A new worktree is queued for indexing. When another worktree of the same repository has an index, it is copied and only changed files are read again.
- Index jobs run one at a time, at low priority, inside a heavy slot.
- In a checkout with an index, grepping for one identifier triggers a one-time hint per session to use codegraph. grep is never blocked.
- Calling codegraph again on a path that already returned "no index" is blocked with a hint to go on with grep.

```
wb-index add .          queue this checkout
wb-index status         queue and recent results
wb-index orphans        indexes left in folders that are no longer worktrees
```

To turn off automatic queueing set `project.codegraph.auto_index` to `false`; to turn off the hints set `project.codegraph.nudge` to `off`. The environment variable `WB_CODEGRAPH=off` turns off the whole feature.

## 12. Token guard, automatic resume, terse mode, checkpoints

| Feature | What it does | Managed with |
|---|---|---|
| Token guard | Turns the local token use of the last 5 hours into a share of the budget. At 90% it asks for smaller units of work, at 95% for a handoff after every wave, at 99% for a last handoff, a notification and a wait | `wb-token`, `/wb:token-guard` |
| Automatic resume | When a usage limit ends a turn, the same session is resumed headless two minutes after the reset time. Scheduling uses launchd on macOS, a systemd user timer on Linux, and a background waiter elsewhere | `wb-retry`, `/wb:auto-retry` |
| Terse mode | In a repository where it is on, rules that cut output and tool calls are added at session start | `wb-terse`, `/wb:terse` |
| Checkpoint | At a limit, a subagent stop or a conversation compaction, changes to tracked files on a lane branch are committed as `wip(wb)`. Secret file patterns and untracked files are not committed | `personal.checkpoint.enabled` |

The token guard budget defaults to 0 (not calibrated), and then the guard stays silent. Run `wb-token calibrate` when the app shows that the limit is reached; the usage at that moment becomes the budget. Only Claude Code use on this machine is counted, and the share is an estimate.

```
wb-token status
Token guard: on
Last 5 hours (local transcripts, this machine only): output …, input …, cache read …, cache write … (… replies). Weighted total … (= input + 1.25 cache write + 0.1 cache read + 5 output).
Budget not set (personal.token_guard.budget = 0): the guard is silent. …
```

The permission mode of an automatic resume defaults to `default`. In this mode tools that need approval are refused in the unattended run, so the resumed work may stop at that point. `bypassPermissions` is turned on only after the risk is confirmed with `wb-retry mode bypassPermissions --i-understand`.

## 13. The 17 skills

Type a skill in the Claude Code prompt as `/wb:<name>`. Claude also calls a skill on its own when a request matches its description. `/wb:approve` is the exception: it works only when a person types it.

| Skill | In one line |
|---|---|
| `/wb:init` | Creates the wb settings for a project |
| `/wb:doctor` | Checks settings errors, where values come from, and git, Node.js and codegraph |
| `/wb:work` | Turns a one-line request into a lane flow and guides it to the end |
| `/wb:explain` | Explains in plain words what is blocked or waiting |
| `/wb:writing-style` | Sets the voice of each file and shows its rules |
| `/wb:decide` | Turns an owner decision into a question and records the answer |
| `/wb:lanes` | Shows and records the wave and lane board |
| `/wb:pickup` | Takes over earlier work at the start of a session |
| `/wb:resume` | Resumes an interrupted wave |
| `/wb:review-lane` | Reviews a lane result against the nine items |
| `/wb:integrate` | Merges reviewed lanes into the integration branch |
| `/wb:test-report` | Runs the verification and keeps the result as a workbook |
| `/wb:report` | Publishes the final report as an artifact |
| `/wb:approve` | Grants one change to a protected branch (typed by a person only) |
| `/wb:auto-retry` | Manages the automatic resume after a limit |
| `/wb:token-guard` | Shows and calibrates the token guard |
| `/wb:terse` | Turns terse mode on and off |

### /wb:init

- When: the first time wb is used in a repository.
- How: answer four questions (project kind, message language, full verification command, whether wb manages Claude Code worktrees). Claude runs `wb-config init` and shows the result with `wb-config doctor`. Existing files are not overwritten, and nothing is committed.
- Example: `/wb:init` → answer "web-ui, en, npm test, no". Full output in section 3 of [Getting started](01-getting-started.md).

### /wb:doctor

- When: right after installation, when wb behaves unexpectedly, before starting a wave.
- How: shows the `wb-config doctor` output and explains the cause and fix of every `✗` line. Where a value comes from is shown by `wb-config explain <key>`. The workbook environment is checked by `wb-test-report env`. This skill installs nothing.
- Example: "Why is machine.lanes.max 3?"

```
wb-config explain machine.lanes.max
machine.lanes.max
  value: 3
  merge rule: smallest value among non-default layers
  applied layer: default
  set by:
    - default (…/defaults/machine.json): 3
```

### /wb:work

- When: you want to hand over work in one sentence without knowing the lane flow.
- How: Claude restates the request for confirmation and picks the kind and steps with `wb-work plan`. It reports each step in one line through lane worktrees, briefs, dispatch, review, integration, report and handoff. `wb-work progress` shows where the flow stands. It never merges into or pushes to a protected branch.
- Example: `/wb:work Add a search box to the list screen`

| Request kind | Flow |
|---|---|
| Bug | Reproduce (research lane) → fix with a regression test → review by another model → integrate → report |
| Feature | Brief → build → review → integrate → report |
| Screen | Mockup (current and proposed) → owner decision → build → review → integrate → report |
| Documents | Brief → write by the voice rules → review → report |
| Research | Find and report; no files change |
| Large design | Points to the design plugin named in the personal setting `design_plugin` when it is installed; otherwise follows the wb steps |

### /wb:explain

- When: something is blocked, nothing moves, or you want to know what a block message means.
- How: `wb-explain` checks settings errors, usage limits, a running gate, stopped lanes, the lane cap, full run slots, a stale handoff file, leftover worktrees and the protected branch. A block message leads to its rule with `wb-explain code <code>`. It only reads and never changes settings.
- Example: "Why was pkill just blocked?"

```
wb-explain code safety.kill.pattern
…
no-pattern-kill — Stop processes by PID only
  Processes are not stopped by name or pattern. A lane stops only the processes it started, by PID. …
  If blocked: Find the PID with `lsof -i :<port>` or your own run record and stop only that process. …
```

### /wb:writing-style

- When: writing or revising screen text, manuals, help or reports; filling the voice line of a brief.
- How: find the voice with `wb-style of <path>` and read its rules with `wb-style rules <voice>`. Fill a brief with `wb-style brief <template> --owned <file,…>`.
- Example: to give screen text the friendly UI voice, put this in `.wb/config.json`:

```json
"style": { "map": [
  { "glob": "src/**/*.{tsx,vue}", "style": "haeyo" },
  { "glob": "docs/**/*.md", "style": "report" }
] }
```

| Voice | For | Gist |
|---|---|---|
| `haeyo` | Screen text, in-app manual, help | Short polite sentences, one topic per screen, no question titles, abbreviations or decoration |
| `report` | Developer documents, reports, certification papers | State and problem first, one fact per sentence, no narration of the work or hype |
| `plain` | Everything else | Short sentences, follow the words already in the file |

### /wb:decide

- When: a choice that belongs to the owner comes up (structure, wording, scope); checking pending decisions at the start of a wave.
- How: run `wb-decide new` with the question, two to four options, and a recommendation with its reason. Record the answer with `wb-decide answer`. It only suggests a commit. `wb-decide list --pending` lists what is waiting.
- Example:

```
wb-decide new list-search --title "Search box position" --question "Where should the search box go?" \
  --option "A=Full width above the list" --option "B=Small box at the top right" --recommend A
wb-decide list --pending
```

### /wb:lanes

- When: you want to see which lanes are running, or create waves and lanes.
- How: shows the `wb-waves board` output as it is. Token and model totals come from `wb-waves metrics`. A lane in "running" with a growing idle time and no `*` has probably stopped, so `/wb:resume` is suggested.
- Example:

```
wave/lane  Status   Model  Task        Runs/returns  To-do  Pass/fail  Tokens  Idle
w1/l1      review   opus   impl-multi  1/0           0/2    0/0        0       0m
```

### /wb:pickup

- When: a new session takes over earlier work.
- How: reads `progress.md` from start to end and runs `wb-waves resume`. It reports stale items first, then the next steps and the lanes to resume or review. It never removes worktrees or branches on its own. At the end of the session it updates the archive and `progress.md`, commits them together and suggests `/clear`.
- Example: `/wb:pickup`

```
# Stale items to report first
  - progress.md is older than the latest work. Update it before new work.
```

### /wb:resume

- When: a wave was interrupted by a usage limit or an error; the board shows stopped lanes.
- How: shows the `wb-waves resume` report and lists stale items first. Lanes in "review" are reviewed; stopped, not started, failed or blocked lanes are sent again to the same worktree with the text from `wb-waves resume --prompt <wave>/<lane>`. Before sending, `wb-waves status <wave> <lane> pending` resets the status.
- Example: `/wb:resume`

### /wb:review-lane

- When: a lane has reported back; the board shows a lane in "review".
- How: picks the review model with `wb-route resolve review --implementer <lane model>`. For a screen change Claude opens the captures before passing `--captures-seen`. `wb-check lane` runs from the integration worktree. A pass (exit 0) marks the lane done; a failure (1) writes a return brief. The lane's code is never edited to make an item pass.
- Example: section 4.6 of [Getting started](01-getting-started.md).

### /wb:integrate

- When: merging reviewed lanes into the integration branch.
- How: checks that the integration worktree is clean and no gate is running. A large lane is tried with `--dry-run` first. After every lane of the wave is merged, the full verification runs once, the affected servers are restarted and the finished lane worktrees are removed. Code conflicts are never resolved by hand in the integration worktree; nothing is merged into a protected branch or pushed.
- Example:

```
wb-integrate wb/search/l1 --lane l1 --wave w1 --trailer "Co-Authored-By: Claude <noreply@anthropic.com>"
Merged wb/search/l1. New HEAD b572a921d734
```

### /wb:test-report

- When: an integration or final verification needs evidence; someone asks for test results as Excel.
- How: checks the environment with `wb-test-report env` and, the first time, writes the settings with `wb-test-report init`. Runs `wb-test-report run --name <name>`, commits the xlsx and json, and confirms with `wb-check test-results`. Tests are never weakened to get a green workbook.
- Example:

```
wb-test-report summary
Test results docs/test-results/2026-10-17/integration-2238.xlsx · verdict passed · commit 425ace6
  unit: total 2 · passed 2 · failed 0 · skipped 0 · flaky 0
  gate: 1 steps · failed 0 · not run 0
```

### /wb:report

- When: a wave has been integrated and verified; finished work has to be shown to someone else.
- How: collects the test results (`wb-check test-results --json`, `wb-test-report summary --json`), the defect register (`wb-defects summary --json`) and the lane ledger (`wb-waves board --json`). Keeps captures with `wb-art keep`, writes the body in Markdown, builds the HTML with `wb-art report` and publishes it as an artifact. The report stops at "ready to merge" and keeps "implemented" and "deployed" apart.
- Example: section 4.8 of [Getting started](01-getting-started.md).

### /wb:approve

- When: a merge, push or commit on a protected branch (such as `main`) is needed. Only the repository owner types it.
- How: type `/wb:approve merge-main|push-main|commit-main [branch or commit]` in the prompt. A grant is valid once, for 15 minutes by default, and only for the commit current when it was typed. A project with a gate command also needs a gate pass stamp for the same commit. `/wb:approve status` shows the grant and `/wb:approve revoke` deletes it. Force pushes stay blocked even with a grant.
- Example: `/wb:approve merge-main wb/search/int`

### /wb:auto-retry

- When: checking, turning on or off, or cancelling the automatic resume after a limit.
- How: runs `wb-retry status`, `wb-retry on|off`, `wb-retry cancel <session prefix|all>`, `wb-retry mode <mode>` or `wb-retry limits`. Claude never turns on `bypassPermissions` on its own.
- Example:

```
wb-retry status
Automatic resume: on
Resume permission mode: default
Waiting resumes: 0
```

### /wb:token-guard

- When: checking how much quota is left; turning the token guard on or off or calibrating its budget.
- How: runs `wb-token status`, `wb-token on|off` or `wb-token calibrate [<weighted tokens>]`. Calibrating without a number makes the current usage the budget, so run it when the app shows that the limit is reached. The exact usage is shown by `/usage`.
- Example: `/wb:token-guard calibrate`

### /wb:terse

- When: you want fewer output tokens and tool calls.
- How: `wb-terse on|off|status`. The switch is per repository and survives `/clear` and new sessions. When it is turned on, Claude reads `rules/terse.en.md` and follows it at once. To turn it on in every repository, put `"terse": true` in `~/.wb/personal.json`. Verification evidence and the final report are not cut.
- Example:

```
wb-terse status
Terse mode: off (source: default)
```
