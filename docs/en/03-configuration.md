# Configuration

wb settings come in four file layers. Values the team decides together go in the project settings committed to the repository; machine specifics and personal preferences go in files under your home folder that are not committed. This page lists the files of each layer, how values are merged, and the default and meaning of every key.

## 1. Settings layers

| Layer | File | Tracked by git | Holds |
|---|---|---|---|
| Default | Plugin `defaults/config.json`, `machine.json`, `personal.json`, `routing.json` | Plugin repository | The default of every key |
| Project | `<repository>/.wb/config.json` | Committed | Project kind, branch rules, storage paths, verification command, voice map |
| Machine | `~/.wb/machine.json` | No | Lane count, run slots, load threshold, protected ports, lane port range |
| Plugin settings screen | `/plugin configure wb@wb-plugin` | No | Message language, report detail. Read only when hooks run |
| Personal | `~/.wb/routing.json`, `~/.wb/personal.json` | No | Model routing and denied models, language, report detail, automatic resume, handoff, token guard |

The top-level keys of the project file are the `project` namespace. `machine`, `personal` and `routing` sections in the same file are read as values of those namespaces. For example, a project lowers the lane count to 2 with `"machine": { "lanes": { "max": 2 } }` in `.wb/config.json`.

To use another folder than `~/.wb`, set the environment variable `WB_HOME`. Sample files are in the plugin's `examples/` folder.

## 2. How values are merged

| Kind of key | Rule | Keys |
|---|---|---|
| Ordinary value | The higher layer wins: personal > plugin settings screen > machine > project > default | Every key not in the two rows below |
| Protected list | Union of every layer. No layer can remove an entry another layer added | `routing.denied`, `machine.ports.protected`, `project.git.protected_branches`, `project.protected_paths` |
| Cap | The smallest value among the non-default layers. The default applies only when no other layer sets it | `machine.lanes.max`, `machine.slots.heavy.count`, `machine.slots.browser.count`, `machine.load.max` |

Caps leave the default out so that a personal machine file can set a value above the default (3 lanes). A project can only lower it further.

## 3. Commands to check settings

```
wb-config get <key>         merged value
wb-config explain <key>     merge rule, applied layer, every layer that sets it
wb-config validate          format check per file; exit code 1 on errors
wb-config dump              the whole merged settings
wb-config doctor            checks and where the main values come from
```

Unknown keys are ignored with a warning. A value of the wrong form is an error, and while a settings error exists the safety hooks block git changes, killing processes, deletion and browser runs.

```
wb-config validate
Settings are valid.
```

## 4. Key reference

Defaults are written as JSON. Keys marked "reserved" are format-checked only; no command or hook of 0.1.0 reads them. Keys marked "skill reference" are not read by commands; Claude follows them through the skill instructions.

### 4.1 Model routing (`routing`)

Kept in the personal file `~/.wb/routing.json`.

| Key | Default | Meaning | Example |
|---|---|---|---|
| `routing.version` | `1` | File format version | `1` |
| `routing.models` | see below | Agent tool value (`agent_param`) and grade (`rank`) per model name. A larger rank is a higher grade | `{"opus":{"agent_param":"opus","rank":3}}` |
| `routing.denied` | `[]` | Models not to use. Merged as a protected list | `["fable"]` |
| `routing.denied_note` | `{}` | Notes on why a model is denied (skill reference) | `{"fable":"personal choice"}` |
| `routing.tasks` | see below | Per task type: `label`, `chain` (fallback order), `floor` (minimum grade), `on_floor` (`wait-notify`), `differ_from` (`implementer`) | `{"review":{"chain":["opus"]}}` |
| `routing.limits_state` | `"${CLAUDE_PLUGIN_DATA}/limits.json"` | File that records models out of quota | keep the default |

The default `routing.models` are fable (rank 4), opus (3), sonnet (2) and haiku (1). The ten default `routing.tasks` match the table in section 2 of [Features](02-features.md). To change one task type, write only the keys to change.

```json
{
  "version": 1,
  "denied": ["fable"],
  "denied_note": { "fable": "personal choice; delete this line to lift it" },
  "tasks": { "review": { "chain": ["opus"] } }
}
```

### 4.2 Machine (`machine`)

Kept in the personal file `~/.wb/machine.json`. Port numbers live only in this file.

| Key | Default | Meaning | Example |
|---|---|---|---|
| `machine.version` | `1` | File format version | `1` |
| `machine.lanes.max` | `3` | Lanes that may be alive at the same time. Cap rule | `6` |
| `machine.load.max` | `"auto"` | Slot runs wait at or above this 1-minute load. `auto` is logical cores × 2. Cap rule | `16` |
| `machine.load.auto_rule` | `"logical_cores * 2"` | Description of the `auto` formula (reserved) | keep the default |
| `machine.load.sample` | `"1min"` | Load average to compare: `1min` · `5min` · `15min` | `"5min"` |
| `machine.slots.heavy.count` | `2` | Heavy run slots. Cap rule | `3` |
| `machine.slots.heavy.patterns` | `["full-test","e2e","typecheck-all","build","install","codegraph-index"]` | Pattern group names treated as heavy runs (`defaults/heavy-patterns.json`) | `["full-test","e2e"]` |
| `machine.slots.browser.count` | `2` | Browser slots. Cap rule | `1` |
| `machine.slots.browser.patterns` | `["chrome-headless","playwright","cdp"]` | Pattern group names treated as browser runs | `["playwright"]` |
| `machine.slots.lease_dir` | `"~/.wb/run/slots"` | Folder of slot lease files | keep the default |
| `machine.slots.stale_after_min` | `90` | Leases not renewed for this many minutes are reclaimed | `120` |
| `machine.slots.guard` | `"warn"` | Heavy commands run without a slot: `warn` shows a hint, `deny` blocks | `"deny"` |
| `machine.ports.protected` | `[]` | Ports whose processes must not be stopped. Entries have `name`, `port`, `project`, `note`. Protected list rule | `[{"name":"my-api","port":8080,"project":"*"}]` |
| `machine.ports.lane_range.base` | `41000` | First port of the lane range | `42000` |
| `machine.ports.lane_range.step` | `20` | Ports taken by one lane | `10` |
| `machine.ports.lane_range.per_lane` | `["web","web2","api","db","aux"]` | Port names lent to each lane | `["web","api"]` |
| `machine.ports.lane_range.max_lanes` | `9` | Most lanes in the range | `6` |
| `machine.ports.leases` | `"{git_common_dir}/wb/ports.json"` | Port lease ledger | keep the default |
| `machine.servers` | `[]` | Servers to restart after integration. Entries have `name`, `port_ref`, `restart`, `verify_url_path` (skill reference) | `[{"name":"my-web","port_ref":"my-api","restart":"manual"}]` |

### 4.3 Personal (`personal`)

Kept in the personal file `~/.wb/personal.json`. `language` and `report.chat_detail` can also be chosen on the plugin settings screen; the value in this file wins.

| Key | Default | Meaning | Example |
|---|---|---|---|
| `personal.version` | `1` | File format version | `1` |
| `personal.language` | `"auto"` | Message language. `auto` follows the system locale | `"en"` |
| `personal.report.chat_detail` | `"summary"` | Chat report detail. `summary` gives a summary and the artifact link; `detailed` also puts tables, evidence and figures in the chat | `"detailed"` |
| `personal.report.viewer` | `"local"` | Where reports are read. `remote` builds them to open on a remote device (skill reference) | `"remote"` |
| `personal.report.artifact_fallback` | `"html-file"` | What to use without the Artifact tool: `html-file` · `none` | `"none"` |
| `personal.report.artifact_check` | `true` | Block once when the report stage ends without an artifact | `false` |
| `personal.auto_retry.enabled` | `true` | Automatic resume after a usage limit | `false` |
| `personal.auto_retry.permission_mode` | `"default"` | Permission mode of the resumed session: `default` · `acceptEdits` · `plan` · `bypassPermissions` | `"acceptEdits"` |
| `personal.auto_retry.bypass_ack` | `false` | Record that the `bypassPermissions` risk was confirmed. Written by `wb-retry mode bypassPermissions --i-understand` | do not write by hand |
| `personal.handoff.enabled` | `true` | `progress.md` handoff hooks | `false` |
| `personal.handoff.file` | `"progress.md"` | Handoff file path (relative to the repository) | `"docs/progress.md"` |
| `personal.handoff.throttle_min` | `20` | Minutes before the same session is blocked again | `30` |
| `personal.handoff.max_lines` | `300` | Line target of the handoff file (20 or more) | `200` |
| `personal.handoff.archive_dir` | `"docs/progress-archive"` | Archive folder | `"docs/history"` |
| `personal.checkpoint.enabled` | `true` | `wip(wb)` commits at a limit, a subagent stop or a compaction | `false` |
| `personal.paths.scratch_root` | `"~/.wb-scratch/{project}"` | Scratch folder that is never committed. `{project}` is the repository folder name | `"~/scratch/{project}"` |
| `personal.token_guard.enabled` | `true` | Token guard | `false` |
| `personal.token_guard.stages` | `[90,95,99]` | Stage thresholds (%) | `[85,95,99]` |
| `personal.token_guard.budget` | `0` | Fallback budget (weighted tokens) used when there is no official usage. At 0 the 100% derived from the account's calibration is used; without one the guard is silent. Written by `wb-token calibrate <n>` | `250000000` |
| `personal.token_guard.window_hours` | `5` | Recent hours whose usage is added up for the fallback budget | `5` |
| `personal.token_guard.fresh_min` | `10` | Minutes the official usage is used as it is. Older than that, an estimate of the local use since then is added | `5` |
| `personal.token_guard.source` | `"auto"` | Usage source. `auto`: official value plus estimate, `official`: official value only, `local`: fallback budget only | `"official"` |
| `personal.terse` | `false` | Terse mode in every repository without its own switch | `true` |
| `personal.design_plugin` | `""` | Name of a separate plugin to point to for large design requests | `"my-design-plugin"` |

### 4.4 Project (`project`)

Kept at the top level of `.wb/config.json` in the repository. The path inside the file is the key name without `project.`.

**Basics and git**

| Key | Default | Meaning | Example |
|---|---|---|---|
| `project.version` | `1` | File format version | `1` |
| `project.project_kind` | `"other"` | `web-ui` · `service` · `library` · `other`. With `web-ui`, changes to screen files count as screen changes | `"web-ui"` |
| `project.git.protected_branches` | `["main","master","release/*"]` | Protected branches. Protected list rule | `["develop"]` |
| `project.git.integration_branch_pattern` | `"wb/*/int"` | Name rule of integration branches | `"team/*/int"` |
| `project.git.lane_branch_pattern` | `"wb/*/l*"` | Name rule of lane branches | `"team/*/l*"` |
| `project.git.worktree_root` | `"{repo}/../wt-{task}"` | Lane worktree path. `{repo}` is the main checkout, `{task}` the lane name | `"{repo}/../lanes/{task}"` |
| `project.git.main_checkout` | `"auto"` | Location of the main checkout (reserved) | keep the default |
| `project.git.feature_push` | `"ask"` | Feature branch pushes from the main session: `ask` · `allow` · `deny` | `"allow"` |
| `project.git.gate_stamp` | `"wb-gate-pass"` | File name of the gate pass stamp (`<git common dir>/wb/<name>.json`) | keep the default |
| `project.git.owner_grant_ttl_min` | `15` | Minutes an owner grant stays valid | `30` |

**Storage paths (`project.paths`)**

Placeholders are `{lane}`, `{date}`, `{slug}`, `{name}`, `{HHMM}`, `{stamp}` and `{scratch_root}`.

| Key | Default | Meaning | Example |
|---|---|---|---|
| `project.paths.briefs` | `".wb/briefs/{lane}.md"` | Briefs | `".wb/briefs/{lane}.md"` |
| `project.paths.lane_reports` | `"{scratch_root}/reports/{lane}.md"` | Lane report files (not committed) | keep the default |
| `project.paths.reports_final` | `"docs/reports/{date}/{slug}.md"` | Final report text (committed) | `"docs/reports/{slug}.md"` |
| `project.paths.artifacts_temp` | `"{scratch_root}/art/{slug}/"` | Throw-away captures and report HTML | keep the default |
| `project.paths.artifacts_keep` | `"docs/reports/artifacts/{slug}/"` | Captures worth seeing again (committed) | `"docs/img/{slug}/"` |
| `project.paths.artifacts_keep_webp` | `{"over_kb":300,"quality":80}` | PNGs over this size (KB) become WebP at this quality | `{"over_kb":500,"quality":85}` |
| `project.paths.decisions` | `"docs/decisions/{date}-{slug}.md"` | Decision records (committed) | keep the default |
| `project.paths.test_results` | `"docs/test-results/{date}/{name}-{HHMM}.xlsx"` | Test result workbooks (committed). A `.json` of the same name comes with each | keep the default |
| `project.paths.test_runs_raw` | `"test-results/runs/{name}-{stamp}/"` | Raw logs (not committed) | keep the default |
| `project.paths.metrics` | `".wb/metrics/"` | codegraph response log | keep the default |
| `project.paths.e2e_ledger` | `"docs/e2e/"` | Test case ledger and defect register | `"tests/ledger/"` |

**Verification and documents**

| Key | Default | Meaning | Example |
|---|---|---|---|
| `project.gate.command` | `""` | Full verification command run before merging. When set, merges and pushes to a protected branch also need a gate pass stamp | `"npm test"` |
| `project.gate.verify_all` | `""` | Reserved | leave empty |
| `project.gate.append_checks` | `[]` | Reserved | leave empty |
| `project.glossary.terms_dict` | `"docs/glossary/terms.yaml"` | Glossary. When it exists, review item 9 runs | keep the default |
| `project.glossary.terms_scan` | `"docs/glossary/config.json"` | Reserved | keep the default |
| `project.glossary.copy_globs` | `[]` | Reserved | leave empty |
| `project.style.map` | `[{"glob":"docs/**/*.md","style":"report"}]` | Voice per file. The first matching entry wins. Voices are `haeyo` · `report` · `plain` | `[{"glob":"src/**/*.tsx","style":"haeyo"}]` |
| `project.mockup.ui_globs` | `[]` | Screen files. When empty, the mockup-first hook is off | `["src/**/*.tsx"]` |
| `project.mockup.tokens_css` | `""` | Design token CSS used to draw mockups (skill reference) | `"src/styles/tokens.css"` |
| `project.mockup.decision_required` | `true` | Require a mockup decision for screen structure changes | `false` |
| `project.ui_stability.enabled` | `false` | Reserved | keep the default |
| `project.ui_stability.adapter` | `"uistab.adapter.ts"` | Reserved | keep the default |

**Code index, runs and lanes**

| Key | Default | Meaning | Example |
|---|---|---|---|
| `project.codegraph.nudge` | `"warn"` | codegraph hint on an identifier grep: `warn` · `off` | `"off"` |
| `project.codegraph.auto_index` | `true` | Queue indexing automatically on worktree creation, on grep and on a "no index" response | `false` |
| `project.codegraph.index_on_worktree` | none | Old name of `auto_index`, read as an alias for one release | do not use |
| `project.slots.heavy` | `[]` | Extra regular expressions treated as heavy runs | `["^make all$"]` |
| `project.slots.browser` | `[]` | Extra regular expressions treated as browser runs | `["^npm run shots$"]` |
| `project.worktree.setup` | `""` | Setup command run inside a slot in a new lane worktree. It receives `WB_LANE` and `WB_PORT_<name>` | `"npm ci"` |
| `project.worktree.hook` | `false` | Let wb also create the worktrees Claude Code makes | `true` |
| `project.protected_paths` | `[]` | Paths (globs) agents must not write. Protected list rule | `["db/prod/**"]` |
| `project.dispatch.brief` | `"deny"` | Brief check: `deny` blocks, `warn` only shows a hint, `off` skips it | `"warn"` |
| `project.dispatch.exempt_agents` | `["fork","claude-code-guide","statusline-setup"]` | Agent types that skip the brief check | `["fork"]` |
| `project.waves.stale_min` | `20` | A running lane with no activity for this many minutes counts as stopped | `40` |
| `project.numbers` | `{}` | Number reservation series. Each has `dir`, `pattern`, `width`, `start` | see below |

```json
"numbers": { "migration": { "dir": "db/migrations", "pattern": "^(\\d+)_", "width": 3, "start": 1 } }
```

`wb-number reserve migration --lane l3` returns a number above the files in the folder and the live reservations.

**Review, integration and explanations**

| Key | Default | Meaning | Example |
|---|---|---|---|
| `project.review.guards` | `[]` | Commands run by review item 3. Entries have `name`, `command` | `[{"name":"lint","command":"npm run lint"}]` |
| `project.review.report_fields` | `["head","tests","remaining"]` | Items a lane report must have | `["head","tests"]` |
| `project.integrate.rules` | see below | Conflict classes. Entries have `glob` and `kind` (`ledger` · `union` · `generated` · `code`). The first matching rule wins | `[{"glob":"**/*.snap","kind":"generated"}]` |
| `project.integrate.regenerate` | `[]` | Commands that rebuild generated files after a conflict. Entries have `name`, `command`, `glob` | `[{"name":"lock","command":"npm install","glob":"**/package-lock.json"}]` |
| `project.integrate.guards` | `[]` | Commands run on the merged tree. Any failure rolls the merge back | `[{"name":"typecheck","command":"npm run typecheck"}]` |
| `project.explain.links` | `[]` | Training material shown by `wb-explain links`. Entries have `title`, `href` | `[{"title":"Team guide","href":"docs/guide.md"}]` |

The default `project.integrate.rules` are seven rules. `**/*.cases.json` and `**/defect-register.json` are ledgers (`ledger`), `**/hooks/hooks.json` is a registration file (`union`), and `**/*.xlsx`, `**/package-lock.json`, `**/pnpm-lock.yaml` and `**/yarn.lock` are generated (`generated`). A file no rule matches counts as code.

## 5. Examples

**Project (`.wb/config.json`)**

```json
{
  "version": 1,
  "project_kind": "web-ui",
  "gate": { "command": "npm test", "verify_all": "", "append_checks": [] },
  "git": { "protected_branches": ["develop"] },
  "style": { "map": [
    { "glob": "src/**/*.{tsx,vue}", "style": "haeyo" },
    { "glob": "docs/**/*.md", "style": "report" }
  ] },
  "worktree": { "setup": "npm ci" },
  "slots": { "heavy": ["^make all$"] },
  "machine": { "lanes": { "max": 2 } }
}
```

**Machine (`~/.wb/machine.json`)**

```json
{
  "version": 1,
  "lanes": { "max": 6 },
  "load": { "max": 16 },
  "slots": { "guard": "deny" },
  "ports": {
    "protected": [
      { "name": "my-api", "port": 8080, "project": "*", "note": "dev server I keep running" }
    ]
  }
}
```

With both files in place, `machine.lanes.max` is 2 by the cap rule, because the project's 2 is smaller than the machine file's 6.

**Personal (`~/.wb/personal.json`)**

```json
{
  "version": 1,
  "language": "en",
  "report": { "chat_detail": "detailed", "viewer": "remote" },
  "auto_retry": { "enabled": true, "permission_mode": "default" },
  "paths": { "scratch_root": "~/.wb-scratch/{project}" }
}
```

## 6. Environment variables

| Variable | Meaning |
|---|---|
| `WB_HOME` | Folder of the personal and machine settings (default `~/.wb`) |
| `WB_PROJECT_DIR` | Sets the project root directly |
| `WB_CODEGRAPH` | `off` turns off every codegraph feature. A path selects that executable |
| `WB_SLOT_HELD` | Set by `wb-slot` for the command it runs. Do not set it yourself |
| `WB_LANE`, `WB_PORT_<name>` | Lane name and ports passed to the `project.worktree.setup` command |
