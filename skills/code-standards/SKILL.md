---
name: code-standards
description: Apply the project's code standards while writing, splitting, moving or reviewing code — size limits and the ratchet, routes that call services for every database access, error logging through helpers (no empty catch, no console), no import cycles or re-export files, characterization tests before a split, and behavior kept as it was. Reads the project's own standards document from project.code_standards.doc and applies it as written. Use when writing new code or changing code, when splitting a large file or function, when moving code between files, when briefing or reviewing an implementation, split or fix lane, or when the code standards warning or gate step reports a finding.
---

# Lanekeeper code-standards

The plugin does not carry any project's rules. It holds six general principles and points at the project's document, which has the exact limits, paths, helper names and commands.

## Read the project's settings first

```
lanekeeper-config get project.code_standards
```

| Key | Use |
|---|---|
| `doc` | The project's standards document, with an anchor (for example `AGENTS.md#code-standards`). Read that section before writing code and apply it as written. Where it is stricter or more specific than a principle below, the document wins. |
| `checks` | Commands that check the standards mechanically. `/lanekeeper:quality-gate` runs them as the gate kind `code-standards`. |
| `helpers` | Names of the error logging helpers. Use them where an error may be ignored. |
| `protected_paths` | Folders that may import the protected modules named in the document. |
| `exempt_paths` | Paths the warning hook skips (for example a command-line tool whose job is printing). |
| `warn_hook` | `true` adds a warning (never a block) when new code brings an empty catch, `.catch(() => value)` or `console`. |

No `doc`: apply the principles below and say in the report that the project names no standards document.

## The six principles

1. **Limits and the ratchet.** A new file or a new function has no allowance: it starts within the limits of the document (lines, complexity, nesting). Only a file or function that already went over the limit has the small allowance the document gives, and the counts of complexity, empty catch and console never grow. To change a large function, move the changed part into a new function, hook or component instead of adding to it. Do not edit the baseline file of the checks in feature work; relock it only when counts went down, by the command the document names.
2. **Routes call services.** A route handler only checks the request, checks permissions and writes the response. Every database call moves to a service, whether direct (`db.*`, `tx.*`) or through another object (`app.db.*`, `request.server.db.*`). The service opens the transaction and keeps the order of statements inside it. A service never imports a route; it returns an expected failure as a value and the route picks the status code and the message.
3. **Errors go through the logging helpers.** No empty catch (a catch with only a comment counts as empty), no `.catch(() => value)` and no `console`. An error that may be ignored is logged with a helper from `helpers`, with the location and the reason. Forms that only get past the checks are also forbidden: `.catch(helper)` without a location and a reason, `catch (e) { void e }`, `globalThis.console`, `console[...]`. `console` stays only where printing is the job (a command-line tool) and in start-up code that runs before the logger exists.
4. **No import cycles and no re-export files.** Do not add an import cycle. Move shared types and constants to a lower module, or turn the direction around with a registration point or injection. After moving code, do not leave a file at the old path that only re-exports it; change every import to the new path. The only exceptions are public package entry points the document lists.
5. **Characterization tests before a split.** Before splitting or moving code, write tests that pin the current behavior, run them on the code before the split and commit them separately. After the split the same tests pass without changing an expected value. Never rewrite a snapshot or a golden file with `-u` after a move.
6. **Keep behavior and the protected paths.** A split or a move changes no behavior: screen text, response bodies, status codes, test handles (`data-testid`, accessible names), the order of events and registrations, and log formats stay as they were. A defect found on the way goes to the defect list instead of being fixed in the same change. Code that imports a protected module stays inside `protected_paths`; do not widen the list to pass a check.

## When writing or changing code

1. Read the section that `doc` points at.
2. Write the code within the limits. Use the helpers for ignored errors.
3. If the warning hook adds a note, fix the code before going on. The note names the helpers and the document.
4. Run only the tests you touched. The main session runs the checks in `checks` after collecting the lanes.

## When splitting or moving code

1. Write the characterization tests, run them on the current code and commit them alone.
2. Split or move. Keep the boundaries and names the same across paired files (for example the same screen in two frameworks).
3. Run the same tests with no expected value changed. Change tests that read the source text only to follow the new location, never to check less.
4. Fix every quotation of the moved path in the documents in the same change.

## When briefing or reviewing a lane

- `lanekeeper-style brief impl|fix` adds the line "follow the code standards in `<doc>`" to the scope of the brief when `doc` is set. Return briefs from `/lanekeeper:review-lane` get the same line.
- The review items the checks cannot see are listed in `/lanekeeper:review-lane` under "Code standards".

## Do not

- Do not loosen the baseline, the limits, `protected_paths` or `exempt_paths` to pass a check.
- Do not copy a project's rules into the plugin settings. Keep them in the project's document and point `doc` at it.
