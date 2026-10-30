---
name: quality-ux-adversarial
description: Adversarial UX check before shipping. A checker in a context separate from the implementing session (agent wb:ux-adversary, Fable recommended, Opus otherwise) drives the running product headless and hunts for the places where a first-time user gets stuck, goes wrong or loses work, on five axes (data correctness, location and way back, what to do on this screen, flow continuity, visual consistency), with evidence (a capture now, a check against the real data, measured computed style or pixels), a severity, a fix in the project's design system and a capture of the fix injected into the DOM. It never edits product code. The main session reports the findings to the owner as an artifact with before and after captures side by side, fixes only what the owner confirms, then checks again, and records the result as kind ux-adversarial. Use when the user runs /wb:quality-ux-adversarial, asks for an adversarial UX review or a UX red team before a release, or when /wb:ship-verify warns that ux-adversarial was not done or has an open blocker.
---

# wb quality-ux-adversarial

Two quality skills look at the product as a user does. Use both before a release when there is a user interface.

| Skill | Question | Who | Pass |
|---|---|---|---|
| `/wb:quality-usability` | Can a beginner finish the main tasks? | beginner stand-ins, given only the goal | every P0 scenario done within 1.5 × the expected steps |
| `/wb:quality-ux-adversarial` | Where does the product mislead, strand or lose the user, and does it look the same everywhere? | an adversarial checker that knows the product's rules and tries to break them | no open blocker finding |

Run usability first when both are due: its blockers are journeys that fail outright, this skill then looks for what goes wrong around the journeys that work.

## Rules

1. Separate context. The checker is a subagent that did not take part in the implementation: agent `wb:ux-adversary` (routing task `adversarial`; pass `model: "fable"`, or `"opus"` when Fable is not available or is the implementer's model). The main session does not check its own work.
2. No product code changes. The checker writes findings and fix proposals into its result folder and nothing else. The real fix is a separate lane after the owner confirms it.
3. Every finding has, in this order: what the user goes through, in one sentence → steps to reproduce → evidence (a capture taken now, plus a check against the real data from the test database or API, or measured computed style or pixels) → severity → axis → fix proposal in the project's design system (its tokens, classes and components, by name) → a capture of the fix made by injecting DOM or CSS into the same page, with the injected code attached.
4. Report to the owner, fix after confirmation. The main session publishes the findings as an artifact with the now and fix captures side by side. Fixes start only for the findings the owner confirms. After a fix is merged, the checker (a fresh run) checks those findings again.
5. Browser: headless only. Captures at 2x (device scale factor 2). Playwright adds `--hide-scrollbars` by default; drop it (`ignoreDefaultArgs: ['--hide-scrollbars']`), otherwise an overflow scroll bar disappears from the capture and a clipped area looks intact.
6. Edge states are created on purpose: light and dark theme, wide and narrow width, keyboard only, no permission (each role below the owner), empty state, very long names, a lot of data, leaving before saving, double clicks, back, reload and deep links.
7. When the product has another front-end implementation of the same screens, every finding is checked there as well and a difference is marked as a parity finding.

## Axes and severity

| Axis | What the checker looks at |
|---|---|
| ① Data correctness | Numbers, lists, counts and states on screen match the real data. The same value is the same on every screen. Totals, counts and filter results add up. A save shows up on the other screens at once. Empty, zero and none are told apart. |
| ② Location and way back | The user can tell where they are (workspace, project, page, form) and how to get back. Back, reload and a deep link return to the same place. Closing a modal or a drawer leads where the user expects. |
| ③ What to do on this screen | The next action is clear on arrival: one primary action, an empty state that names the first step, a disabled control that says why. |
| ④ Flow continuity | The result of one task carries into the next: the new item is selected or highlighted, the next step is offered, context (selected data source, filter, page) is kept, nothing forces the user to start over. |
| ⑤ Visual consistency | Spacing off the spacing scale or uneven between elements of the same kind, colours outside the tokens, weak contrast, invisible in dark theme, misused status colours, alignment (baseline, left edge, numbers right-aligned in tables, icon and text centred), type size off the scale, weight, data font, wrapping, clipping, ellipsis. The same element (button pair, list row, header, empty state, badge) compared across screens. Measured, light and dark, wide and narrow. |

Axis ⑤ has the same weight as the other four: it goes into the findings table with a severity like any other finding, not into a footnote. A finding on two axes names both.

| Severity | When |
|---|---|
| blocker | the user cannot finish, loses data, or sees wrong data and acts on it |
| high | the user finishes only by guessing, retrying or asking someone; a state that looks broken |
| medium | the user hesitates or takes a detour; an inconsistency a user notices |
| low | polish; a user rarely notices |

The checker also marks each finding as a defect fix (restores the intended look or behaviour) or a design change (needs the owner's decision), and notes when a proposal conflicts with a recorded design decision of the project.

## Steps

1. Settle the inputs with the user or from the project. Nothing below is built into the plugin:
   - target screens or features, and the version or commit;
   - how to start the product in isolation (the project's e2e harness or dev stack), with lane ports from `wb-port lease --lane <id>`; never the owner's or protected ports, never the working database;
   - the design system of record (`project.mockup.tokens_css`, and the specification documents the project names);
   - roles and test data the checker may create, and how to clean them up;
   - the other front-end implementation, if any;
   - the result folder (scratch, not committed) and the report language (`personal.language`).
2. Write the brief from [references/brief.ko.md](references/brief.ko.md) or [references/brief.en.md](references/brief.en.md). Fill every `{{…}}`; the dispatch guard checks the cover, the sections and the model. One brief per checker; split a large product into areas (at most `machine.lanes.max` at once) and give each its own result folder.
3. Dispatch `wb:ux-adversary` with the brief. Browser steps run through `wb-slot --kind browser -- …`. The checker writes `findings.md` (format in [references/findings.md](references/findings.md)), `now-<n>.png` and `fix-<n>.png` per finding, and the injected code per fix ([references/inject-capture.md](references/inject-capture.md)).
4. Read the report and spot-check it: open two or three captures, re-run one data check. A finding without evidence, or a fix proposal outside the design system, goes back to the checker.
5. Report to the owner as an artifact, built from [references/artifact.md](references/artifact.md): counts by severity and axis first, then one card per finding with the now and fix captures side by side, the one-sentence user impact, the evidence and the proposal. Embed the images as `data:` URIs. Ask the owner which findings to fix; design changes are the owner's call.
6. Record the result (counts in [references/findings.md](references/findings.md)):

   `wb-quality record ux-adversarial --verdict passed|failed --from <counts.json>`

   The verdict is failed while any blocker finding is open (not fixed and checked again, and not declined by the owner).
7. Confirmed fixes go to implementation lanes with a brief. After they are merged, dispatch a fresh checker on those findings (and the screens around them), update the statuses and record again.
8. Commit the result JSON, the workbook and the index. Captures stay in the scratch folder unless the owner wants them kept (`wb-art keep`).

## Ship precheck

`ux-adversarial` is in `quality.ship.advisory` by default. `wb-quality precheck` and the ship gate hook then warn, without blocking, when the kind has no result (not done before shipping), when its newest result failed (an open blocker finding), or when it is stale. To make it block, add `ux-adversarial` to `quality.ship.requires`; to drop the warning, set `quality.ship.advisory` to `[]`. Give the suite `stale_paths` for the screen code (for example `{ "category": "ux-adversarial", "stale_paths": ["src/ui/**"] }`) so a change outside the screens does not make the result stale.

## Do not

- Do not let the checker edit product code, settings or tests, or commit. Its write access is its result folder.
- Do not fix anything before the owner confirms it, and do not batch unconfirmed design changes into a fix lane.
- Do not drop a finding, lower its severity or mark it declined to get a pass. Only the owner declines a finding.
- Do not open a browser with a window. Do not take 1x captures.
- Do not write test data into the owner's or a production database. Do not stop processes by name; stop the PIDs the checker started and confirm the ports are closed.
- Do not put customer data, personal names or mail addresses in findings or captures.
