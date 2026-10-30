# Getting started

wb is a Claude Code plugin that keeps the rules for splitting work across several subagents in settings files and hooks. It makes each kind of task use a suitable model, and it stops a lane from committing to a protected branch or stopping another task's server. When a lane finishes, a review checklist and a report file confirm the result.

This page covers installation, project setup, and a first 30 minutes in which one small screen feature goes from brief to report. Each step shows the real command and what it prints. Paths in the sample output are shortened to `~/work/list-app`.

## Terms

| Term | Meaning |
|---|---|
| Lane | A piece of work one subagent carries out on its own, with its own branch and its own folder (worktree) |
| Wave | A set of lanes that run together and are merged at once |
| Integration branch | The branch that collects lane results. The default name rule is `wb/*/int` |
| Controller | The main session that reviews lane results and merges them into the integration branch |
| Brief | The instructions sent to a lane. Its first line is a marker (`<!-- wb-brief v1 … -->`) |
| Owner | The person who manages the repository and grants changes to protected branches |
| Gate | The full verification command run before merging |

## 1. Requirements

| Item | Needed | Used for |
|---|---|---|
| Claude Code | Required | Runs the plugin. This page was checked with version 2.1.302 |
| Node.js 18 or later | Required | Runs the hooks and the `wb-*` commands |
| git | Required | Branch and worktree checks |
| Python 3.8 or later with openpyxl | Optional | Test result and defect register workbooks |
| codegraph | Optional | Code index. Without it the related hooks do nothing |
| cwebp or Python Pillow | Optional | Shrinks large report PNGs to WebP |

Installing openpyxl depends on the system. On Debian/Ubuntu use `sudo apt install python3-openpyxl`. Where pip into the system Python is blocked (Homebrew Python, Debian 12 and later, Ubuntu 24.04) create a virtual environment.

```
python3 -m venv ~/.wb/venv
~/.wb/venv/bin/pip install openpyxl
export WB_PYTHON=$HOME/.wb/venv/bin/python3
```

Check the result with `wb-test-report env`. On Linux without `lsof`, wb reads `/proc` instead, so nothing extra is needed.

## 2. Installation

### 2.1 Install from the marketplace

Add the marketplace and install the plugin from a terminal. The marketplace is named `wb-plugin` and the plugin `wb`.

```
claude plugin marketplace add <repository URL>
claude plugin install wb@wb-plugin
```

Sample output:

```
Adding marketplace…✔ Successfully added marketplace: wb-plugin (declared in user settings)
Installing plugin "wb@wb-plugin"...✔ Successfully installed plugin: wb@wb-plugin (scope: user)
2 userConfig options not yet set — run /plugin configure wb@wb-plugin in Claude Code, or pass --config KEY=VALUE.
```

The last line says the two options of the plugin settings screen (message language `language`, report detail `chat_detail`) have not been chosen. Without a choice the defaults (`auto`, `summary`) apply. To choose, run `/plugin configure wb@wb-plugin` inside Claude Code.

Inside a Claude Code session the same is done with `/plugin marketplace add <repository URL>` and `/plugin install wb@wb-plugin`.

### 2.2 Install from a downloaded folder

A downloaded copy of the repository can be added as a marketplace too. The plugin is then read straight from that folder, so edits to the folder apply from the next session.

```
claude plugin marketplace add ~/src/wb-plugin
claude plugin install wb@wb-plugin
```

### 2.3 Try it for one session

To load the plugin for one session without installing it, use `--plugin-dir`. The plugin is gone when the session ends.

```
claude --plugin-dir ~/src/wb-plugin
```

### 2.4 Check the installation

```
claude plugin list
```

```
Installed plugins:

  ❯ wb@wb-plugin
    Version: 0.1.0
    Read from: ~/src/wb-plugin
    Scope: user
    Status: ✔ enabled
```

The `wb-*` commands such as `wb-config` and `wb-waves` are available to the Bash commands Claude runs in a Claude Code session. To use them in an ordinary terminal, put the `bin` folder under the `Read from` path of `claude plugin list` on your `PATH`.

```
export PATH="$HOME/src/wb-plugin/bin:$PATH"
```

## 3. Project setup

The project folder must be a git repository with at least one commit. Lane worktrees are made from a commit, so without one `wb-worktree create` stops and asks for a first commit. Open Claude Code in this folder and type `/wb:init`. Claude asks four questions in one message.

| Question | Choices | Stored in |
|---|---|---|
| Project kind | `web-ui` (has screens) · `service` · `library` · `other` | `project.project_kind`. Review uses it to tell screen changes apart |
| Message language | `ko` · `en` | `personal.language` |
| Full verification command | For example `npm test`. May be empty | `project.gate.command` |
| Should wb also manage the worktrees Claude Code creates | `no` (default) · `yes` | `project.worktree.hook`. See "Lane worktrees" in [Features](02-features.md) |

With the answers Claude runs the command below. Running it yourself gives the same result.

```
wb-config init --kind web-ui --lang en --gate "npm test" --worktree-hook no
```

```
Wrote: ~/work/list-app/.wb/config.json
Wrote: ~/.wb/personal.json
Added `.wb/briefs/` to ~/work/list-app/.git/info/exclude
Added `.codegraph/` to ~/work/list-app/.git/info/exclude
Added `.wb/metrics/` to ~/work/list-app/.git/info/exclude
Initialization finished. Run `/wb:doctor` to review the result.
```

What init does:

- It writes `.wb/config.json` (project settings) and `~/.wb/personal.json` (personal settings). Existing files are not overwritten; they are reported as `Kept:`.
- It adds `.wb/briefs/`, `.codegraph/` and `.wb/metrics/` to `.git/info/exclude` so they stay out of git status.
- It does not commit. Commit `.wb/config.json`, since the team shares it.

Check the result with `/wb:doctor` (or `wb-config doctor`).

```
wb check
✓ Node.js 22.22.2: ok
✓ git repository (~/work/list-app): ok
✓ project settings .wb/config.json: ok
✓ settings resolution: ok
✓ codegraph: ok
! codegraph index of this checkout: check — missing — build it with `wb-index add .`
✓ index queue: ok — waiting 0 · running 0 · recent failures 0
✓ leftover indexes: ok
key values and their sources:
  personal.language = "en"  [personal]
  personal.report.chat_detail = "summary"  [default]
  routing.denied = []  [default]
  machine.lanes.max = 3  [default]
  machine.slots.heavy.count = 2  [default]
  machine.slots.browser.count = 2  [default]
  machine.load.max = "auto"  [default]
  project.project_kind = "web-ui"  [project]
  project.git.protected_branches = ["main","master","release/*"]  [default]
  (effective) language = en, load.max = 20
```

For a `✗` line see [Troubleshooting](05-troubleshooting.md). Without codegraph installed the codegraph lines turn into a note, and the rest of wb works as usual.

## 4. The first 30 minutes

The sample task is "Add a search box to the list screen". In a small app with one screen file `src/List.tsx` and a test file, one lane goes through brief → mockup → lane → review → integrate → report → handoff.

| Step | What you do | Main commands Claude runs | Result |
|---|---|---|---|
| 1 Prepare | Choose the integration branch and the screen files | `git switch -c`, edit settings | Integration branch `wb/search/int` |
| 2 Brief | Type the request in one line with `/wb:work` | `wb-work plan` | Request kind and the model of each step |
| 3 Mockup | Look at the mockups and pick one | `wb-decide new`, `wb-decide answer` | Decision record `docs/decisions/…` |
| 4 Lane setup | Nothing | `wb-worktree create`, `wb-style brief`, `wb-check brief`, `wb-waves lane` | Lane worktree and brief |
| 5 Lane run | Watch the board | Agent tool call, `wb-waves board` | Lane branch commit and report file |
| 6 Review | Decide whether to send a return | `wb-check lane` | Nine-item verdict |
| 7 Integrate | Nothing | `wb-integrate`, `wb-test-report run` | Merge into the integration branch, result workbook |
| 8 Report | Open the report page | `wb-art report` | Report HTML with before and after captures |
| 9 Handoff | Clear the session with `/clear` | `wb-waves handoff archive` | `progress.md` and the archive |

### 4.1 Prepare: integration branch and screen files

Create the integration branch that collects lane results. Match `project.git.integration_branch_pattern` (default `wb/*/int`). Lane results never go straight into a protected branch such as `main`.

```
git switch -c wb/search/int
```

The mockup-first rule works only when the screen files are named. Add them to `.wb/config.json` and commit.

```json
{
  "version": 1,
  "project_kind": "web-ui",
  "gate": { "command": "npm test", "verify_all": "", "append_checks": [] },
  "mockup": { "ui_globs": ["src/**/*.tsx"] }
}
```

### 4.2 Brief: turn the request into steps

Type this in Claude Code:

```
/wb:work Add a search box to the list screen
```

Claude restates the request in one sentence, asks you to confirm, and then picks the request kind and steps with `wb-work plan`.

```
wb-work plan "Add a search box to the list screen"
```

```
Request kind: screen change
  1. Restate the request in one sentence and confirm it with the user
  2. A mockup lane draws the current and proposed screens (model opus)
  3. The owner chooses from the mockups (`/wb:decide`)
  4. An implementation lane builds it as the brief says (model opus)
  5. A different model reviews it in a fresh context (model fable)
  6. Merge the reviewed lane into the integration branch
  7. Report: what was checked and what remains, kept apart
  8. Update `progress.md` and tell the user to `/clear`
```

The model of each step is the routing result of `routing.json`. Models you denied in personal settings and models out of quota are skipped and the next model is shown. "Waiting until HH:MM" means every model of the required grade is out of quota.

`wb-work progress` shows where the flow stands at any time.

```
[■□□□□□□] 1/7 Understand · no lanes
```

### 4.3 Mockup: compare the current screen and the options

Changing the screen structure without a mockup decision is blocked by the mockup-first hook. For example, when Claude tries to add a search input to `src/List.tsx`:

```
[wb] Blocked: src/List.tsx changes the UI structure (elements or selectors) and no mockup decision is recorded
How to fix: Show a mockup (the current screen and the options) as an artifact first, create a decision with `wb-decide new <slug> --kind mockup --scope src/List.tsx …`, then record the owner's choice with `wb-decide answer` (docs/decisions). …
Where to ask: The "Mockup first" section of the README. To turn the check off set mockup.decision_required to false in .wb/config.json (a decision for the repository owner).
```

Claude has a mockup lane draw the current screen and the options, shows them, and writes the question as a record.

```
wb-decide new list-search --kind mockup --scope "src/**/*.tsx" \
  --title "Search box position" --question "Where should the search box go?" \
  --option "A=Full width above the list" --option "B=Small box at the top right" --recommend A
```

```
Decision request created: docs/decisions/2026-10-17-list-search.md
Commit suggestion: `git add docs/decisions/2026-10-17-list-search.md` and commit. Nothing is committed automatically.
```

When you choose A, Claude records the answer.

```
wb-decide answer list-search --choice "A. Full width above the list" --note "Search is the main action"
```

```
Decision recorded: docs/decisions/2026-10-17-list-search.md
Commit suggestion: `git add docs/decisions/2026-10-17-list-search.md` and commit. Nothing is committed automatically.
```

When the first line of the record becomes `<!-- wb-decision v1 status=decided kind=mockup scope=src/**/*.tsx -->`, writes to screen files in that scope are allowed. Lane worktrees are created from the integration HEAD, so commit the decision to the integration branch before creating the lane. Otherwise the lane worktree has no decision record.

### 4.4 Lane setup: worktree and brief

Create the wave and the lane worktree.

```
wb-waves init-wave w1 --title "List search box"
wb-worktree create l1
```

```
Created wave w1.
Created the worktree of lane l1: ~/work/wt-l1 (branch wb/search/l1, base wb/search/int 06a6d7da9)
Ports: web=41000 web2=41001 api=41002 db=41003 aux=41004
Added to the codegraph index queue (`wb-index status`).
```

The lane branch name is the integration branch name with its last part replaced by the lane name. The ports are lent to this lane alone, and the lane starts servers only on them.

The brief comes from a template in `templates/briefs/`. `wb-style brief` fills the style line (`{{style}}`), and `--var` fills the other placeholders. init does not create the brief folder, so create it once.

```
mkdir -p .wb/briefs
wb-style brief impl --owned src/List.tsx,src/list.test.mjs \
  --var lane=l1 --var title="List search box" \
  --var worktree=~/work/wt-l1 --var branch=wb/search/l1 --var base_sha=06a6d7d \
  --var read_first="docs/decisions/2026-10-17-list-search.md" \
  --var goal="Put a full-width search box above the list and show only the items that contain the typed text." \
  --var owned_files="src/List.tsx, src/list.test.mjs" \
  --var acceptance="Typing a search term leaves only the matching items" \
  --var report_path="~/.wb-scratch/list-app/reports/l1.md" \
  --var trailer="Co-Authored-By: Claude <noreply@anthropic.com>" > .wb/briefs/l1.md
wb-check brief .wb/briefs/l1.md
```

```
Brief check passed: .wb/briefs/l1.md
  type=impl-multi lane=l1 template=impl
```

With an unfilled placeholder left, the check fails with exit code 1.

```
Brief check failed: .wb/briefs/l1.md
  ✗ {{style}}
  type=impl-multi lane=l1 template=impl
```

Finally register the lane in the ledger.

```
wb-waves lane w1 l1 --task impl-multi --model opus --brief .wb/briefs/l1.md \
  --todo "Add the search box" --todo "Filter test"
```

```
Added lane l1 to wave w1.
```

### 4.5 Lane run

Claude sends the brief with the Agent tool. The dispatch hook checks the brief marker and the model. Without `model` the call is blocked:

```
[wb] Blocked: No model given. Routing for task `impl-multi` picks `opus`.
How to fix: Pass model: "opus" to the Agent call.
Routing: impl-multi → opus
```

A model below the minimum grade is blocked too:

```
[wb] Blocked: Model `haiku` is below the floor `sonnet` of task `impl-multi`.
How to fix: Use `opus`. Routing never goes below the floor.
```

With the right model the hook prints nothing and lets the call through. While the lane runs, watch the board.

```
wb-waves board
```

```
wave/lane  Status   Model  Task        Runs/returns  To-do  Pass/fail  Tokens  Idle
w1/l1      running* opus   impl-multi  1/0           0/2    0/0        0       0m

running 1  (* = agent running now)
```

The lane commits only to its own lane branch and writes its result to the report file named in the brief. When the lane ends, its status becomes "review".

```
[■■■■□□□] 4/7 Review · 1 in review
```

The lane report holds the new HEAD, the test results and what remains. Review reads this file as the source of truth. Write the test result on one line, such as `tests: 12 passed / 0 failed`. Record the failure before the fix separately, such as `failed before the fix: 1`; review does not count that record as a failure.

```
# l1 report — list search box

- New HEAD: c968ed5
- Acceptance 1 (typing a search term leaves only the matching items): done
- Changed files: src/List.tsx, src/list.test.mjs
- Failure before the fix: added the filter test first and saw it fail
- Tests: node --test src/list.test.mjs — 1 passed
- Captures: cap/before.png, cap/after.png
- Remaining: none
```

### 4.6 Review

`/wb:review-lane` has Claude judge the nine items with `wb-check lane`. This is a screen change, so Claude opens the captures before passing `--captures-seen`, and checks that the served code carries the marker of this change (the `list-search` class name).

```
wb-check lane l1 --report ~/.wb-scratch/list-app/reports/l1.md \
  --return ~/.wb-scratch/list-app/reports/l1.return.txt --brief .wb/briefs/l1.md \
  --lane-dir ~/work/wt-l1 --captures-seen \
  --serve-url http://127.0.0.1:41000/src/List.tsx --marker list-search --wave w1 --record
```

```
Lane l1 review: pass
  ✓ 1. Reported HEAD — HEAD c968ed5125a0 on integration HEAD 06a6d7da9908
  ✓ 2. Report file — l1.md has the required fields
  – 3. Project guards — No guards configured (project.review.guards)
  ✓ 4. Failure before the fix — Failure before the fix is recorded
  ✓ 5. Brief scope — All 2 changed files are in scope
  ✓ 6. Captures checked — 2 captures checked
  ✓ 7. Served code marker — Marker found at http://127.0.0.1:41000/src/List.tsx
  ✓ 8. Test results — 1 passing tests reported
  – 9. Terms — Skipped: no glossary
```

Below is the first review. No captures or served URL were given, and the report wrote the test result as "passed 1 / failed 0", so the passed count could not be read.

```
Lane l1 review: 3 failed
  ✓ 1. Reported HEAD — HEAD c968ed5125a0 on integration HEAD 06a6d7da9908
  ✓ 2. Report file — l1.md has the required fields
  – 3. Project guards — No guards configured (project.review.guards)
  ✓ 4. Failure before the fix — Failure before the fix is recorded
  ✓ 5. Brief scope — All 2 changed files are in scope
  ✗ 6. Captures checked — UI change without captures
  ✗ 7. Served code marker — Web UI change without a URL (--serve-url) and a marker (--marker) to check
  ✗ 8. Test results — The report has no test result (passed count)
  – 9. Terms — Skipped: no glossary
Return brief: .wb/briefs/l1-return-1.md
```

Claude shows the failed items and asks whether to send the return brief to the same lane. A return brief passes the dispatch check as it is. With `--record` a pass marks the lane done and a failure counts one return in the ledger.

### 4.7 Integrate

Run `/wb:integrate` in the folder where the integration branch is checked out. Try a large lane with a trial merge first.

```
wb-integrate wb/search/l1 --dry-run
wb-integrate wb/search/l1 --lane l1 --wave w1 --trailer "Co-Authored-By: Claude <noreply@anthropic.com>"
```

```
Trial merge of wb/search/l1 passed (not committed, rolled back)
Merged wb/search/l1. New HEAD b572a921d734
```

When every lane of the wave is merged, run the full verification once and keep the result as a workbook (`/wb:test-report`). The first time, edit the stage list of `.wb/verify.config.json` that `wb-test-report init` writes. The example has one pytest stage.

```json
{
  "version": 1,
  "gate": { "script": "gate", "skip_in_verify": ["test"], "slot": "heavy" },
  "stages": [
    { "name": "unit", "adapter": "pytest", "kind": "unit", "suite": "app",
      "cmd": "python3 -m pytest tests -q --junitxml={file}", "slot": "heavy" }
  ]
}
```

`gate.script` is the name of a script in the project's `package.json` `scripts`. The commands that script chains with `&&` run one step at a time. If no script has that name, `wb-test-report run` prints a hint and stops. Instead of a script you can list the commands directly, for example `"gate": { "steps": [{ "name": "test", "cmd": "npm test" }] }`. Steps named in `skip_in_verify` are left out of the gate and run by `stages` instead.

```
wb-test-report run --name integration
```

```
[gate 1/1] node --test src/list.test.mjs
[wb-slot] Running in slot heavy#1: sh -c node --test src/list.test.mjs
…
[gate] 1 steps · passed 1 · failed 0 · …/gate.json
[wb-slot] Running in slot heavy#1: sh -c python3 -m pytest tests -q --junitxml=…
2 passed in 0.01s
~/work/list-app/docs/test-results/2026-10-17/integration-2238.xlsx: verdict passed · suites 1 · gate 1 steps · failed 0 · flaky 0 · ledger mismatches 0 · test rows 0

[verify] results folder ~/work/list-app/test-results/runs/integration-20261017-2238 · failed stages none
Gate pass stamp written: commit 425ace6… · ~/work/list-app/.git/wb/wb-gate-pass.json
```

The date and time in the workbook name are the local time (system time zone) when the run started. When the gate and every stage pass and there are no uncommitted changes, the run writes the gate pass stamp. Section 4.10 uses the stamp for changes to a protected branch.

Commit the workbook with the `.json` of the same name and confirm with `wb-check test-results`. The raw log folder (`test-results/runs/`) is not committed, so add a `.gitignore` line that points only at the top-level folder, such as `/test-results/`. Writing `test-results/` also hides `docs/test-results/`.

```
Test result check passed.
  ✓ Newest result workbook: docs/test-results/2026-10-17/integration-2238.xlsx
  ✓ Committed: docs/test-results/2026-10-17/integration-2238.xlsx
  ✓ Verdict: passed
  ✓ Only result files changed after the run commit 425ace6 (HEAD 599d4cd). The run still counts.
```

Committing the result files moves HEAD, but when nothing outside the results folder changed after the run, the run still counts. When code changed, `The run commit … differs from the current HEAD …` appears and the run must be repeated.

### 4.8 Report

`/wb:report` has Claude gather the test results, the defect register and the before and after captures into a report page and publish it as an artifact. Images are embedded in the HTML, so the page works on a remote device.

```
wb-art report --title "List search box" --md body.md \
  --image "Before=cap/before.png" --image "After=cap/after.png" --slug list-search
```

```
Report HTML: ~/.wb-scratch/list-app/art/list-search/index.html (4KB, 2 images embedded)
```

Keep the captures worth seeing again with `wb-art keep <png> --slug list-search`; they go to `docs/reports/artifacts/list-search/` and are committed. If the report stage tries to end without an artifact, a Stop hook blocks it once.

The report stops at "ready to merge". Merging into the protected branch (`main`) is the owner's decision.

### 4.9 Handoff and cleanup

In a repository with `progress.md`, a Stop hook blocks the end of a turn once and asks for a handoff when there are commits or changed files newer than the last update. Creating `progress.md` the first time is up to you or Claude; after that the hook keeps it current.

```
[wb handoff] Work newer than progress.md was detected (a commit or a changed file). Update the handoff and then finish. …
```

Move finished content to the monthly archive and rewrite `progress.md` as the current state.

```
wb-waves handoff archive "W1 list search box done"
```

```
Appended to the archive: docs/progress-archive/progress-2026-10.md
Now rewrite progress.md whole as the current state and commit it together with the archive file.
```

Commit both files together and clear the session with `/clear`. The next session takes over with `/wb:pickup`.

Remove the finished lane worktree. If a process still runs inside that folder, the command lists the PIDs and does not remove it.

```
wb-worktree remove l1 --delete-branch
```

```
Removed the worktree ~/work/wt-l1 (ports released 1, unregistered l1, branch deleted wb/search/l1)
```

### 4.10 Changes to the protected branch

To merge into or push to a protected branch such as `main`, the owner types this in the prompt:

```
/wb:approve merge-main wb/search/int
```

```
[wb] Owner grant recorded: merge-main · wb/search/int · commit 2c2d39f56 · 15 min (expires 2026-10-17 22:55 (UTC+09:00)) · one use. Only this commit can be applied. A gate pass stamp for the same commit is also required: …/.git/wb/wb-gate-pass.json
```

A grant is valid once, for 15 minutes, and only for the commit current when it was typed. The expiry is shown in this machine's local time. A project with `project.gate.command` also needs a gate pass stamp for the same commit. `wb-test-report run` in section 4.7 writes it on a full pass. A project that sets only the gate command, without a verification file (`.wb/verify.config.json`), runs `wb-test-report gate-pass` in the integration branch folder. That command runs `project.gate.command` and writes the stamp when it passes.

```
wb-test-report gate-pass
```

```
Running the gate: npm test
…
Gate pass stamp written: commit 2c2d39f56 · ~/work/list-app/.git/wb/wb-gate-pass.json
```

If only result files were committed after the stamp, it stays valid. Any other change blocks the merge with `The gate pass stamp belongs to another commit (…)`, so run it again.

## What to read next

- [Features](02-features.md): how to use each feature, and the 27 skills
- [Configuration](03-configuration.md): settings layers and every key
- [Rules](04-rules.md): the 41 rules and how to fix the work when blocked
- [Troubleshooting](05-troubleshooting.md): common messages and questions
