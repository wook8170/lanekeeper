---
name: work
description: Turn a one-line request into a lane flow and guide the user through it in plain words. Classifies the request, shows the steps with the model each agent step will use, writes briefs, dispatches lanes, shows progress and ends the wave with a handoff. Use when the user runs /wb:work, gives a task in one sentence, or asks how to get something done with lanes.
---

# wb work

This skill is for people who do not know the lane workflow. Speak in the user's language (`wb-config get personal.language`; `auto` follows the system) in short, plain sentences. Name a command only after saying what it does. Never show a raw error code alone: say what happened, why, and what you will do next.

## 1. Understand

1. Restate the request in one sentence and ask the user to confirm it. If it has two possible readings, ask which one; do not pick silently.
2. Run `wb-work plan "<request>"`. It prints the request kind and the ordered steps with the model each agent step will use. A step that says "waiting until HH:MM" means the model's usage limit is full; do not lower the model, tell the user the time.
3. Show the plan as a short numbered list in plain words. Do not show the JSON.

Request kinds and what they change:

| Kind | Flow |
|---|---|
| bug | reproduce (research lane) → fix + regression test → review by another model → integrate → report |
| feature | brief (the design) → adversarial design review until high 0 (`/wb:design-adversarial`) → build → review → implementation adversarial review → integrate → report |
| ui | mockup (current and proposed) → owner decision (`/wb:decide`) → build → review → integrate → report |
| docs | brief → write by the style rules (`/wb:writing-style`) → review → report |
| research | find and report; no file changes |
| big-design | the plan says whether the design plugin named in `design_plugin` (personal settings) is installed; when none is named, follow the wb steps; the design gets the adversarial design review (`/wb:design-adversarial`) before the owner decides; ask before installing anything; wb does not depend on it |

## 2. Run the lanes

1. One lane per independent piece of work, within the lane cap (`machine.lanes.max`). Create the worktree with `wb-worktree create <lane>`, register the lane with `wb-waves lane …` (`/wb:lanes`).
2. Write the brief from `templates/briefs/` with the style filled in: `wb-style brief <type> --owned <files> --var lane=<lane> …`. Check it with `wb-check brief <file>` before dispatching.
3. Dispatch with the model the plan names. The dispatch guard blocks a wrong model or an incomplete brief; read its message to the user in plain words (see `/wb:explain`).
4. After each step tell the user, in one line, what finished and what starts next.

## 3. Show progress

Run `wb-work progress` whenever the user asks "where are we" and after every lane change. It prints a seven-stage line, for example `[■■■□□□□] 3/7 Building · 2 running · 1 in review`. Stages: understand, brief, build, review, integrate, report, record. If a lane is blocked or failed, say so first and run `wb-explain`.

## 4. Finish

1. Review each lane (`/wb:review-lane`, when installed), integrate, then report: what was checked, what was not, what remains. Keep checked and unchecked apart.
2. At the end of every wave hand off: append finished content to `docs/progress-archive/progress-<YYYY-MM>.md` (or run `wb-waves handoff archive "<summary>"`), rewrite `progress.md` as the current state only, commit both, and tell the user to run `/clear`; say that the handoff is written so the next session can continue.
3. Do not push or merge into a protected branch. The owner grants that with `/wb:approve`.
