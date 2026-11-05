---
name: quality-ux-adversarial
description: Adversarial UX check before shipping. A checker in a context separate from the implementing session (agent lanekeeper:ux-adversary, on the model the routing picks; Opus by default) drives the running product headless and hunts for the places where a first-time user gets stuck, goes wrong or loses work, as a chosen persona doing real tasks end to end, on nine required axes (logic errors, information consistency, user context, flow context, a first-time user getting lost, the next action, a way out of errors and exceptions, accessibility with narrow width and dark theme, design system visual comparison), with evidence (a capture now, a check against the real data, measured computed style or pixels), a severity, a fix in the project's design system and a capture of the fix injected into the DOM. It never edits product code. The main session reports the findings to the owner as an artifact with before and after captures side by side, fixes only what the owner confirms, then checks again, and records the result as kind ux-adversarial. Before a version ships, the screens it changed are checked this way next to the gate, database and e2e checks, and an open blocker or high finding blocks the ship. Use when the user runs /lanekeeper:quality-ux-adversarial, asks for an adversarial UX review or a UX red team before a release, when /lanekeeper:ship-verify reaches the changed-screen check, or when it warns that ux-adversarial was not done or has an open blocker or high finding.
---

# Lanekeeper quality-ux-adversarial

Two quality skills look at the product as a user does. Use both before a release when there is a user interface.

| Skill | Question | Who | Pass |
|---|---|---|---|
| `/lanekeeper:quality-usability` | Can a beginner finish the main tasks? | beginner stand-ins, given only the goal | every P0 scenario done within 1.5 × the expected steps |
| `/lanekeeper:quality-ux-adversarial` | Where does the product contradict itself, mislead, strand or lose a real person doing real work, and does it look the same everywhere? | an adversarial checker that knows the product's rules and tries to break them | no open blocker or high finding |

Run usability first when both are due: its blockers are journeys that fail outright, this skill then looks for what goes wrong around the journeys that work.

## Rules

1. Separate context. The checker is a subagent that did not take part in the implementation: agent `lanekeeper:ux-adversary` (routing task `adversarial`; pass the model that `lanekeeper-route resolve adversarial --implementer <model>` prints. That is `"opus"` by default. When your routing adds a higher model such as `"fable"`, it comes first unless it is the implementer's model). The main session does not check its own work.
2. No product code changes. The checker writes findings and fix proposals into its result folder and nothing else. The real fix is a separate lane after the owner confirms it.
3. Every finding has, in this order: what the user goes through, in one sentence → steps to reproduce → evidence (a capture taken now, plus a check against the real data from the test database or API, or measured computed style or pixels) → severity → axis → fix proposal in the project's design system (its tokens, classes and components, by name) → a capture of the fix made by injecting DOM or CSS into the same page, with the injected code attached.
4. Report to the owner, fix after confirmation. The main session publishes the findings as an artifact with the now and fix captures side by side. Fixes start only for the findings the owner confirms. After a fix is merged, the checker (a fresh run) checks those findings again.
5. Browser: headless only. Captures at 2x (device scale factor 2). Playwright adds `--hide-scrollbars` by default; drop it (`ignoreDefaultArgs: ['--hide-scrollbars']`), otherwise an overflow scroll bar disappears from the capture and a clipped area looks intact.
6. Edge states are created on purpose: light and dark theme, wide and narrow width, keyboard only, no permission (each role below the owner), empty state, very long names, a lot of data, leaving before saving, double clicks, back, reload and deep links.
7. When the product has another front-end implementation of the same screens, every finding is checked there as well and a difference is marked as a parity finding.
8. Before a ship, every screen the version changed is checked (see "Before a ship: the changed screens"). Gate, lane tests and the design lint baseline do not replace it: they do not see a label a first-time user misreads, a dead end, or spacing that touches.

## How the checker works

The check is about a real person using the screens, not only about the design system. The checker:

1. Picks the personas first: who comes to these screens and why (for example a first-time business user, an administrator, a viewer with few permissions), with their role and how much they know.
2. Writes, per persona, the real task scenarios that person would do, and does each one from the first screen to the end in the isolated stack, by hand in the headless browser. No shortcut through the API, no starting halfway.
3. On every screen writes one line: what this person has understood so far and what they are about to do next. A screen where the line is "does not know" or differs from what the product expects is a finding.
4. Sorts each finding into one or more of the nine axes below and gives it a severity.

## Axes and severity

All nine axes are required. Each one appears in the report with its findings, or with "checked, no finding" and the scenarios that covered it.

| Axis | What the checker looks at |
|---|---|
| ① Logic errors | Screen behaviour and state transitions agree with each other: finished work does not stay "in progress", an impossible combination cannot be chosen, a cancelled action is not applied, a double click does not run twice, back and reload do not undo or repeat a step. |
| ② Information consistency | The same value looks the same on every screen (number, unit, name, status wording). Summary and detail agree. Tables, badges and wording match the real data from the test database or API. Totals, counts and filter results add up. Empty, zero and none are told apart. A save shows up on the other screens at once. |
| ③ User context | Who comes to this screen and why (role, experience). What that person needs to know is visible; internal information they do not need (internal ids, raw error codes, implementation terms) is not shown. |
| ④ Flow context | What the user did on the previous screen and where they go next. The result carries over (the new item is selected, context such as the selected source, filter and page is kept). The user can tell where they are and get back; back, reload and a deep link return to the same place; closing a modal leads where they expect. No place in the middle of a flow breaks off or has no way back. |
| ⑤ First-time user getting lost | Where a first-time user is stuck, stops at a term they do not know, or does not know what to do in an empty state. |
| ⑥ The next action | On every screen "what to do now" is visible at once: one clear primary action, a button whose name matches its result, a disabled control that says why. |
| ⑦ A way out of errors and exceptions | Failure, no permission, a limit reached, a timeout, a lost connection: the screen says the cause and what to do, and the user can get out without losing work. |
| ⑧ Accessibility, narrow width, dark theme | Keyboard only (focus order, visible focus, no trap), the screen reader name and role of every control, narrow width without clipping or a horizontal scroll, dark theme without invisible text or wrong status colours. |
| ⑨ Design system visual comparison | Measured with computed style or pixels against the design system of record: spacing off the scale or touching with no gap, line height too tight, type sizes or weights mixed in one block, table row heights that differ, buttons or badges of different sizes for the same role, colours outside the tokens, weak contrast, misused status colours, alignment (baseline, left edge, numbers right-aligned, icon and text centred), data font, wrapping, clipping, ellipsis. The same element (button pair, list row, header, empty state, badge) compared across screens, light and dark, wide and narrow. A design lint baseline counts tokens and classes in the source; it does not see these, so they are measured on the page. |

Every axis has the same weight: axis ⑨ is one of the nine, not the whole check, and it goes into the findings table with a severity like any other finding, not into a footnote. A finding on two axes names both.

| Severity | When |
|---|---|
| blocker | the user cannot finish, loses data, or sees wrong data and acts on it |
| high | the user finishes only by guessing, retrying or asking someone; a state that looks broken |
| medium | the user hesitates or takes a detour; an inconsistency a user notices |
| low | polish; a user rarely notices |

A ship is blocked while any blocker or high finding is open (not fixed and checked again, and not declined by the owner).

The checker also marks each finding as a defect fix (restores the intended look or behaviour) or a design change (needs the owner's decision), and notes when a proposal conflicts with a recorded design decision of the project.

## Steps

1. Settle the inputs with the user or from the project. Nothing below is built into the plugin:
   - target screens or features, and the version or commit;
   - how to start the product in isolation (the project's e2e harness or dev stack), with lane ports from `lanekeeper-port lease --lane <id>`; never the owner's or protected ports, never the working database;
   - the design system of record (`project.mockup.tokens_css`, and the specification documents the project names);
   - roles and test data the checker may create, and how to clean them up;
   - the other front-end implementation, if any;
   - the result folder (scratch, not committed) and the report language (`personal.language`).
2. Write the brief from [references/brief.ko.md](references/brief.ko.md) or [references/brief.en.md](references/brief.en.md). Fill every `{{…}}`; the dispatch guard checks the cover, the sections and the model. One brief per checker; split a large product into areas (at most `machine.lanes.max` at once) and give each its own result folder.
3. Dispatch `lanekeeper:ux-adversary` with the brief. Browser steps run through `lanekeeper-slot --kind browser -- …`. The checker writes `findings.md` (format in [references/findings.md](references/findings.md)), `now-<n>.png` and `fix-<n>.png` per finding, and the injected code per fix ([references/inject-capture.md](references/inject-capture.md)).
4. Read the report and spot-check it: open two or three captures, re-run one data check. A finding without evidence, or a fix proposal outside the design system, goes back to the checker.
5. Report to the owner as an artifact, built from [references/artifact.md](references/artifact.md): counts by severity and axis first, then one card per finding with the now and fix captures side by side, the one-sentence user impact, the evidence and the proposal. Embed the images as `data:` URIs. Ask the owner which findings to fix; design changes are the owner's call.
6. Record the result (counts in [references/findings.md](references/findings.md)):

   `lanekeeper-quality record ux-adversarial --verdict passed|failed --from <counts.json>`

   The verdict is failed while any blocker or high finding is open (not fixed and checked again, and not declined by the owner).
7. Confirmed fixes go to implementation lanes with a brief. After they are merged, dispatch a fresh checker on those findings (and the screens around them), update the statuses and record again.
8. Commit the result JSON, the workbook and the index. Captures stay in the scratch folder unless the owner wants them kept (`lanekeeper-art keep`).

## Before a ship: the changed screens

`/lanekeeper:ship-verify` runs this check on the screens the version changed, after the gate, database and e2e checks pass and before the production readiness verdict (`verifying-production-readiness`).

1. List the changed screens: the screen and style files changed since the previous released version (`git diff --name-only <previous tag>..HEAD` against the suite's `stale_paths`), mapped to the routes or flows that use them. A version without changed screens records the kind with zero cells and says so in the report.
2. The checker is a fresh `lanekeeper:ux-adversary` in a context that did not build those screens. It starts the product in isolation (the project's e2e harness or an isolated stack, lane ports, never the working database), walks each changed flow headless in the browser and keeps 2x captures.
3. It works as described in "How the checker works": personas, real task scenarios end to end through each changed flow, one line per screen on what the person understood and is about to do, and all nine axes, axis ⑨ measured.
4. Findings that need the screen to change are collected and put to the owner in one artifact (findings table and captures, viewable remotely). Fixes start only after the owner confirms them; then a fresh checker checks them again.
5. An open blocker or high finding blocks the ship. Record the kind before the readiness verdict starts.

## Ship precheck

`ux-adversarial` is in `quality.ship.advisory` by default. `lanekeeper-quality precheck` and the ship gate hook then warn, without blocking, when the kind has no result (not done before shipping), when its newest result failed (an open blocker or high finding), or when it is stale. To make it block, add `ux-adversarial` to `quality.ship.requires`; `/lanekeeper:init` does this for a project of kind `web-ui`; to drop the warning, set `quality.ship.advisory` to `[]`. Give the suite `stale_paths` for the screen code (for example `{ "category": "ux-adversarial", "stale_paths": ["src/ui/**"] }`) so a change outside the screens does not make the result stale.

## Do not

- Do not let the checker edit product code, settings or tests, or commit. Its write access is its result folder.
- Do not fix anything before the owner confirms it, and do not batch unconfirmed design changes into a fix lane.
- Do not drop a finding, lower its severity or mark it declined to get a pass. Only the owner declines a finding.
- Do not open a browser with a window. Do not take 1x captures.
- Do not write test data into the owner's or a production database. Do not stop processes by name; stop the PIDs the checker started and confirm the ports are closed.
- Do not put customer data, personal names or mail addresses in findings or captures.
