# Code standards

When several lanes write code, each lane can treat file size, error handling and the direction of imports differently. This feature tells every lane the project's own code standards and checks them again at the gate, at review and with a warning hook.

Lanekeeper carries no project's standards. The six general principles are in the `/lanekeeper:code-standards` skill. The project's limits, paths, helper names and check commands stay in the project's standards document, and the setting `project.code_standards` points at it. Every default is empty or off, so nothing happens in a repository that does not set it. The one exception is the readable code rules of section 4: they are on by default and go into briefs and review.

## 1. General principles

| Principle | Content |
|---|---|
| Limits and the ratchet | A new file or a new function has no allowance: it starts within the limits. Feature work does not edit the baseline of the checks |
| Routes call services | Every database call moves to a service, direct or through another object. The service opens the transaction. A service never imports a route |
| Error logging helpers | No empty catch and no `console`. An error that may be ignored is logged with a helper. Forms that only get past the checks (`.catch(helper)`, `catch (e) { void e }`, `globalThis.console`) are forbidden too |
| No cycles and no re-export files | Add no import cycle. After moving code, leave no file at the old path that only re-exports it |
| Characterization tests first | Before a split, write tests that pin the current behavior and commit them separately. After a move, never rewrite snapshots or golden files with `-u` |
| Behavior and protected paths | Keep text, responses, status codes, test handles, order and log formats. Import protected modules only inside the protected paths |

Where the standards document is more specific than a principle, the document wins.

## 2. Settings

Put them under `code_standards` in `.lanekeeper/config.json`. Defaults per key are in [Configuration](03-configuration.md).

| Key | Meaning |
|---|---|
| `project.code_standards.doc` | Path and anchor of the standards document. When set, briefs and warnings name this location |
| `project.code_standards.checks` | Commands that check the standards. They run as the gate kind `code-standards` |
| `project.code_standards.helpers` | Names of the error logging helpers. They go into briefs and warnings |
| `project.code_standards.protected_paths` | Paths (globs) that may import the protected modules |
| `project.code_standards.exempt_paths` | Paths (globs) the warning hook skips, for example a command-line tool whose job is printing |
| `project.code_standards.warn_hook` | `true` turns on the warning hook for newly written code |

```json
"code_standards": {
  "doc": "CONTRIBUTING.md#code-standards",
  "checks": ["npm run -s lint:structure", "npm run -s typecheck"],
  "helpers": ["ignoreError", "warnError"],
  "protected_paths": ["server/src/billing/**"],
  "exempt_paths": ["cli/**"],
  "warn_hook": true
}
```

The full example is `examples/code-standards-config.json` in the plugin. Check the values with `lanekeeper-config get project.code_standards`.

## 3. Where it applies

**Briefs.** With `doc` set, `lanekeeper-style brief impl` and `lanekeeper-style brief fix` add this line to the scope section. Return briefs written by `/lanekeeper:review-lane` get the same line. Without `doc` the line is left out.

```
- Code standards: follow the code standards in `CONTRIBUTING.md#code-standards` (work that breaks them is not done). Log an error that may be ignored with an error logging helper (ignoreError, warnError). Import the protected modules only inside the protected paths (server/src/billing/**).
```

**Gate.** With `checks` set, the quality kind `code-standards` (category gate) appears. Each command is one step, and every step runs even when an earlier one fails. Run it with `lanekeeper-quality run code-standards` or `lanekeeper-quality run --category gate`. A suite of the same name in `quality.suites` replaces it.

**Review.** After the nine checked items, `/lanekeeper:review-lane` checks by hand what the gate cannot see: a commit of characterization tests before the split, no `-u` after the move, kept text, responses, status codes, test handles, order and log formats, no re-export files, no protected module imported outside the protected paths, and no allowance for new files and functions. A failed item goes back as a finding of the return brief.

**Warning hook.** With `warn_hook` set to `true`, the PreToolUse hook `codestd/warn` looks at code files (`.js`, `.ts`, `.jsx`, `.tsx`, `.vue`, `.svelte`, and the `.mjs` and `.cjs` forms) written with Write, Edit or MultiEdit. It compares the new text with the text it replaces and warns only about these forms when they are new:

- an empty catch (`catch {}`, `catch (e) {}`, a catch with only comments)
- a `.catch` that only returns a value, such as `.catch(() => null)` or `.catch(() => {})`
- `console.`, `console[…]`, `globalThis.console`
- `catch (e) { void e }`
- `.catch(helper)` that passes a name from `helpers` as it is

The warning names the helpers and the location of the standards document. The hook never blocks the tool call, so the owner gets no extra place to confirm. Test files (`*.test.*`, `*.spec.*`, `test/`, `tests/`, `__tests__/` and similar) and `exempt_paths` are skipped.

## 4. Readable code

The size limits only stop code from getting too big. Code can stay within them and still be hard to follow, for example when a function is cut in statement order into many small pieces. The rules in this section check whether a first-time reader can find and change one feature easily.

The setting `project.code_standards.readability` covers them. Unlike the other keys it is on by default; set `enabled` to `false` to turn it off.

| Key | Default | Meaning |
|---|---|---|
| `readability.enabled` | `true` | `false` removes the brief line, the review items and the readability warnings of the hook |
| `readability.doc` | `""` | Path and anchor of the project's own readability document. When set, briefs and warnings name it |
| `readability.max_params` | `7` | Upper limit for the number of parameters and for the fields of one input object |
| `readability.max_props` | `12` | Upper limit for the props of a screen component (React function component, Vue `defineProps`) |
| `readability.review_tasks` | `3` | Upper limit of tasks in the fresh-eyes check (1 to this value) |
| `readability.fresh_eyes_review` | `true` | The fresh-eyes check of a large change is done adversarially in a separate context |

### The seven rules

1. **Keep decisions apart from actions.** A rule that decides (may this happen, what should change) is a pure function that returns a result: allowed, rejected, needs confirmation, or the change to apply. A handler only reads, asks for the decision and acts on it. A clean-up such as resetting state happens once, in one place.
2. **Split by feature.** Split files, hooks and components by what the user sees or by a domain concept. Do not cut a function into pieces in statement order (`part2`), and do not pass a shared bundle of many values (`ctx`, `deps`) between pieces. More parameters or input fields than `max_params` means the boundary is wrong. A screen component may take up to `max_props` props, because display options and event props come with it.
3. **One rule in one place.** A rule needed in several places (two frameworks, server and screen) is one pure function in a shared module. Code that must exist twice is split with the same names and the same boundaries.
4. **Names.** No one-letter names or abbreviations. Booleans start with `is`, `has`, `can` or `should`; functions start with a verb. One concept has one name in the whole repository.
5. **Comments.** Write what and why. History (version numbers, tickets, task numbers, line numbers of a design document) stays in git and the design documents; cite a source by its section name. A new file starts with a three-line header: what the file does, who calls it, what to read first.
6. **A reading path.** Each domain folder has a one-page `README.md`: what happens there, where requests come in, the order they pass through, what to read first.
7. **Check with fresh eyes.** When a change is done, pick 1 to `review_tasks` tasks a first-time reader might get. It passes when the place to change is found within 3 files and 300 lines and no rule must be changed in two places. If it fails, redraw the boundaries in the same change.

### Example: splitting a decision

Before the split, one handler decides the rules and changes state at the same time. A task such as "change the message for a drop on a locked shelf" means reading 140 lines from the top, and the clean-up repeats before every `return`.

```js
function onShelfDrop(field, shelf, state) {
  if (field.kind === 'json' && field.nested) { state.dragging = null; toast('Nested JSON cannot be dropped'); return }
  if (shelf.locked) { state.dragging = null; toast('This shelf is locked'); return }
  if (shelf.accepts !== field.kind) { state.dragging = null; toast('This field does not fit the shelf'); return }
  // … the scale check and the apply step go on for more than 100 lines
  state.dragging = null
}
```

After the split, each rule is one pure function and the decision function calls them in order. The handler only reads, asks for the decision and acts on it. The message task changes `rejectLockedShelf` and a few lines of its test.

```js
// Decides whether a field may be dropped on a shelf. The screen only acts on the result.
const rejectNestedJson = (field) => (field.kind === 'json' && field.nested ? reject('Nested JSON cannot be dropped') : null)
const rejectLockedShelf = (shelf) => (shelf.locked ? reject('This shelf is locked') : null)
const rejectWrongFieldKind = (field, shelf) => (shelf.accepts !== field.kind ? reject('This field does not fit the shelf') : null)

export function judgeShelfDrop(field, shelf) {
  return rejectNestedJson(field) ?? rejectLockedShelf(shelf) ?? rejectWrongFieldKind(field, shelf) ?? checkScale(field, shelf) ?? planApply(field, shelf)
}

function onShelfDrop(field, shelf, state) {
  const verdict = judgeShelfDrop(field, shelf)
  if (verdict.kind === 'reject') toast(verdict.message)
  else if (verdict.kind === 'apply') applyPlan(state, verdict.plan)
  state.dragging = null
}
```

### Where it applies

- **Briefs.** `lanekeeper-style brief impl|fix` and return briefs get a "Readable code" line with a summary of the seven rules in the scope section, filled with `max_params`, `max_props`, `review_tasks` and `doc`. With `enabled: false` the line is left out.
- **Review.** `/lanekeeper:review-lane` checks the fresh-eyes items (1 to `review_tasks` tasks, 3 files and 300 lines at most, no rule changed in two places) and the signs of a mechanical split (names after a position or an order, shared bundles such as `ctx` or `deps`, more inputs than `max_params`, more component props than `max_props`). With `fresh_eyes_review` on, the check of a split, a move, a refactoring or a large change goes to the agent `lanekeeper:design-adversary` in a separate context.
- **Warning hook.** Only in projects with `warn_hook` on. When newly written code brings one of these, the hook adds one warning line and never blocks the tool call.
  - A history marker in a comment: a version such as `1.8.7 —`, a ticket such as `F-22`, a task number such as `B5:`, a design line number such as `L2390` or `#L120`, a PR number such as `(#816)`
  - A new file of five or more lines without a header comment (in `.vue` and `.svelte` a comment at the top of the script block counts; `.d.ts` is skipped)
  - A function declaration with more parameters than `max_params`, or one destructured input object with more fields than `max_params`
  - A screen component with more props than `max_props`: the destructured props of a React function component (a name that starts with a capital letter and a body that returns JSX, also inside `memo` or `forwardRef`) and Vue `defineProps` (a type literal, an interface or type in the same file, a runtime object, an array of names)

The patterns are narrow to keep false warnings low. Text inside strings, a version with no separator after it (`node 18.0.0`), standard names (`UTF-8`, `ISO-8601`, `SHA-256`), ranges (`A1:B2`), calls and conditions, and function types (`cb: (a, b) => void`) are not matched. Decisions apart from actions, splitting by feature and the meaning of names are hard to measure, so review and the fresh-eyes check cover them.

## 5. Considerations

- The warning hook matches the shape of the text with regular expressions. It can warn about `console.` inside a comment or a string, and can miss a complex form spread over several lines. The commands in `checks` make the final decision.
- Files written through Bash (`sed`, redirection) are not seen by the warning hook.
- The names of the protected modules are not in the settings. They stay in the standards document and are checked at review and by the project's own commands.
