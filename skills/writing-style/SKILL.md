---
name: writing-style
description: Apply the right writing voice to a file. Looks up the style for a path in project.style.map (haeyo for screen text, manual and help; report for developer, report and certification documents; plain otherwise), prints the rules, and fills the style into lane briefs. Use when writing or revising screen text, manuals, help or reports, when the user runs /lanekeeper:writing-style, or when a brief has a style line to fill.
---

# Lanekeeper writing-style

1. Find the style of a file: `lanekeeper-style of <path…>`. The first matching entry of `style.map` in `.lanekeeper/config.json` wins. Default map: `docs/**/*.md` → report. Add entries per project, for example screen text → haeyo.
2. Read the rules for that style: `lanekeeper-style rules haeyo|report|plain`.
3. Write or revise the text by those rules. Every style also follows the four hard-to-read sentence forms listed at the end of its rules: no missing connecting words, no over-personified things, no strings of three or more nouns, no long gap between paired words. Before finishing, read it once as the intended reader would and drop any sentence that explains the work instead of the subject.

## What each style means

| Style | For | Short rules |
|---|---|---|
| haeyo | screen text, in-app manual, help, notices | short polite sentences; one topic per screen; no question titles; no dash-joined sentences; no abbreviations or developer terms; no decoration |
| report | developer documents, reports, certification papers, release documents | plain declarative tone; state and problem first; one fact per sentence; no narration of the work; no hype or unsupported judgement; unconfirmed items marked as such |
| plain | everything else | short sentences; follow the file's existing words; no emoji |

Words for the same concept come from the project glossary when one exists. This skill does not decide words.

## In lane briefs

Brief templates have a `{{style}}` placeholder in the report section. Fill it with the owned files in view:

```
lanekeeper-style brief <type> --owned <file,file> --var lane=<lane> --var title="<title>" …
```

One style for all owned files gives a single line; mixed styles give one line per group of files; no match gives "no style set". The command leaves the other placeholders for the controller to fill. A brief with an unfilled `{{style}}` is blocked by the dispatch guard.

Change the map by editing `.lanekeeper/config.json` (`project.style.map`), then check it with `lanekeeper-config validate`.
