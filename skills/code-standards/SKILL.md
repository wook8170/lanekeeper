---
name: code-standards
description: Apply the project's code standards while writing, splitting, moving or reviewing code — readable code (decisions apart from actions, split by feature, one rule in one place, names, comments without history, a README per domain folder, a fresh-eyes check), size limits and the ratchet, routes that call services for every database access, error logging through helpers (no empty catch, no console), no import cycles or re-export files, characterization tests before a split, and behavior kept as it was. Reads the project's own standards document from project.code_standards.doc and applies it as written. Use when writing new code or changing code, when splitting a large file or function, when moving code between files, when briefing or reviewing an implementation, split or fix lane, or when the code standards warning or gate step reports a finding.
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
| `warn_hook` | `true` adds a warning (never a block) when new code brings an empty catch, `.catch(() => value)` or `console`, and the readable code notes below. |
| `readability` | The readable code rules below: `enabled` (default `true`), `doc`, `max_params` (default 7), `max_props` (default 12), `review_tasks` (default 3), `fresh_eyes_review` (default `true`). |

No `doc`: apply the principles below and say in the report that the project names no standards document.

## The six principles

1. **Limits and the ratchet.** A new file or a new function has no allowance: it starts within the limits of the document (lines, complexity, nesting). Only a file or function that already went over the limit has the small allowance the document gives, and the counts of complexity, empty catch and console never grow. To change a large function, move the changed part into a new function, hook or component instead of adding to it. Do not edit the baseline file of the checks in feature work; relock it only when counts went down, by the command the document names.
2. **Routes call services.** A route handler only checks the request, checks permissions and writes the response. Every database call moves to a service, whether direct (`db.*`, `tx.*`) or through another object (`app.db.*`, `request.server.db.*`). The service opens the transaction and keeps the order of statements inside it. A service never imports a route; it returns an expected failure as a value and the route picks the status code and the message.
3. **Errors go through the logging helpers.** No empty catch (a catch with only a comment counts as empty), no `.catch(() => value)` and no `console`. An error that may be ignored is logged with a helper from `helpers`, with the location and the reason. Forms that only get past the checks are also forbidden: `.catch(helper)` without a location and a reason, `catch (e) { void e }`, `globalThis.console`, `console[...]`. `console` stays only where printing is the job (a command-line tool) and in start-up code that runs before the logger exists.
4. **No import cycles and no re-export files.** Do not add an import cycle. Move shared types and constants to a lower module, or turn the direction around with a registration point or injection. After moving code, do not leave a file at the old path that only re-exports it; change every import to the new path. The only exceptions are public package entry points the document lists.
5. **Characterization tests before a split.** Before splitting or moving code, write tests that pin the current behavior, run them on the code before the split and commit them separately. After the split the same tests pass without changing an expected value. Never rewrite a snapshot or a golden file with `-u` after a move.
6. **Keep behavior and the protected paths.** A split or a move changes no behavior: screen text, response bodies, status codes, test handles (`data-testid`, accessible names), the order of events and registrations, and log formats stay as they were. A defect found on the way goes to the defect list instead of being fixed in the same change. Code that imports a protected module stays inside `protected_paths`; do not widen the list to pass a check.

## Readable code

The limits say how big code may be; they do not say whether a first-time reader can find and change one feature. These seven rules cover that. They are on unless `project.code_standards.readability.enabled` is false, and `readability.doc` may name the project's own text of them.

1. **Keep decisions apart from actions.** A rule that decides (may this happen, what should change) is a pure function that returns a result: allowed, rejected, needs confirmation, or the change to apply. One rule, one function. A handler only reads, asks for the decision and acts on the result. A clean-up (resetting state, releasing a lock) happens once in one place, not before every `return`.
2. **Split by feature, not by position.** Split files, hooks and components by what the user sees or by a domain concept. Do not cut a function into pieces in statement order (`createX`, `part2`, `helpers2`), and do not pass one bundle of many values (`ctx`, `deps`) between the pieces. Each piece takes what it needs and returns its own result. More than `max_params` (default 7) parameters, or one input object with more than `max_params` fields, means the boundary is wrong. A screen component may take up to `max_props` (default 12) props, because display options and event props come with it.
3. **One rule in one place.** A rule needed in two places (two frameworks, server and screen) is one pure function in a shared module. Code that must exist twice is split with the same names and the same boundaries; a part that exists on one side only says why in its header comment.
4. **Names.** No one-letter names or abbreviations, except short loop indexes, short arrow parameters and the framework's own conventions. Booleans start with `is`, `has`, `can` or `should`; functions start with a verb; one concept has one name in the whole repository (the glossary wins when there is one).
5. **Comments.** Write what and why, not a retelling of the code. History stays in git and the design documents: no version numbers, tickets, task numbers, who changed what, or line numbers of a design document. To cite a source, name its section. One comment language per repository. Every new file starts with a three-line header: what the file does, who calls it, what to read first; add one to an existing file you change.
6. **A reading path.** Each domain folder has a one-page `README.md`: what happens there, where requests come in, the order they pass through, what to read first. Update it in the same change when a folder is added or the flow changes.
7. **Check with fresh eyes.** When the change is done, pick 1 to `review_tasks` (default 3) tasks a first-time reader might get. It passes when the place to change is found within 3 files and 300 lines, no rule must be changed in two places, and the tests to change are a few lines of that rule's tests. If it fails, redraw the boundaries in the same change. Write the tasks and the result in the report.

The warning hook notes history markers in comments, a new file without a header comment, a function over `max_params`, and a screen component over `max_props`. The other rules are checked at review (`/lanekeeper:review-lane`, "Readable code").

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
