# Code standards

When several lanes write code, each lane can treat file size, error handling and the direction of imports differently. This feature tells every lane the project's own code standards and checks them again at the gate, at review and with a warning hook.

Lanekeeper carries no project's standards. The six general principles are in the `/lanekeeper:code-standards` skill. The project's limits, paths, helper names and check commands stay in the project's standards document, and the setting `project.code_standards` points at it. Every default is empty or off, so nothing happens in a repository that does not set it.

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

## 4. Considerations

- The warning hook matches the shape of the text with regular expressions. It can warn about `console.` inside a comment or a string, and can miss a complex form spread over several lines. The commands in `checks` make the final decision.
- Files written through Bash (`sed`, redirection) are not seen by the warning hook.
- The names of the protected modules are not in the settings. They stay in the standards document and are checked at review and by the project's own commands.
