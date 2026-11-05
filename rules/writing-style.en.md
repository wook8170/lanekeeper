# Writing style rules

The style for each kind of file comes from `style.map` in `.lanekeeper/config.json`. The rules per style follow.

## haeyo
For: screen text, in-app manual, help, notices. (The name is the Korean polite-friendly register; in English use plain second-person sentences.)

- Write short, polite, direct sentences. Say "Save the file", not "You may wish to save".
- Keep one topic per screen. Put the action or value the user cares about first.
- Titles are statements or noun phrases. Do not write question titles.
- Do not decorate with extra explanation. Button labels and hints name the action as it is.
- Do not chain sentences with dashes. Split them.
- No abbreviations or developer terms. Follow the project glossary when one exists.
- The text must not sound machine-written. Avoid "easy and fast", "powerful" and the like.

### Do not write the four hard-to-read sentence forms
- When two sentences are related by reason, result, contrast, order or condition, say so with a connecting word ("so", "but", "only if"). Write "Lookups are slow, so we add a cache", not "Lookups are slow. We add a cache."
- Do not give things and features human actions (swallow, chase its tail, wake up, kill). Write what actually happens: "the function catches the error and logs nothing".
- Do not string three or more nouns together without particles or prepositions. Unpack them. Fixed names such as product names are exempt.
- Do not put a long gap between subject and verb, or between a modifier and what it modifies. Split the sentence when a long phrase sits between them.

## report
For: developer documents, reports, certification papers, release documents. The reader is an executive, a business owner, a customer or a project manager, not a developer.

- Plain declarative business tone.
- Current state or problem first, then the approach, the main content, then the impact and points to consider.
- One fact per sentence. Split a long sentence into two or three, and unpack strings of nouns.
- Mark what was not confirmed as "unconfirmed". Do not fill gaps with guesses.
- Use tables and lists only for comparisons, conditions and procedures. Drop empty headings and 1.1.1-style nesting.
- Do not restate the same content in other words in the overview, summary and conclusion. Keep it in one place.
- Leave out implementation detail that does not bear on a decision, or move it to an appendix.

### Leave no trace of the writing
- Sentences that narrate the work ("Let us analyze", "On review", "Next we look at", "We have fixed")
- Mentions of the commands, prompts, agents, scripts or tools used
- Repeated "This document", "In summary", "In conclusion"; empty emphasis such as "The key point is"
- Self-assessment of the document, work logs, TODOs, internal notes, draft leftovers

### No hype or metaphors
brain, blood vessel, heart, neural network, like Lego blocks, like a puzzle, engine, hub, game changer, powerful, groundbreaking, innovative, seamless, robust, scalable. The only exception is a real technical term.

### Turn unsupported judgments into facts
"efficient", "optimal", "stable", "high performance", "highly scalable", "cuts cost", "raises productivity" are used only with a figure or evidence. Otherwise state the actual structure or effect (for example "highly scalable" becomes "features are added as modules, so changes to existing features stay small").

### Business terms instead of developer slang

| Developer term | Use instead |
|---|---|
| pipeline | processing steps, processing flow |
| orchestration | coordinated management of the work |
| glue | integration function |
| source of truth | reference data |
| bootstrap | initial setup |
| plug it in | set up so the function can be added |
| loose coupling | keep dependencies between systems small |
| fail fast | find errors early |
| graceful degradation | keep the remaining functions running during a partial failure |
| single pane of glass | one management screen |

Common industry terms such as API, DB, AI, ERP and WAS stay as they are. Explain a needed technical term briefly the first time it appears.

### Final check
Ask three questions of every sentence. Fix or delete it when any answer is no.
1. Would a company employee write this in a report?
2. Does a reader who is not a developer understand it at once?
3. Would the meaning change if the sentence were gone? (If not, delete it.)

### Do not write the four hard-to-read sentence forms
- When two sentences are related by reason, result, contrast, order or condition, say so with a connecting word ("so", "but", "only if"). Write "Lookups are slow, so we add a cache", not "Lookups are slow. We add a cache."
- Do not give things and features human actions (swallow, chase its tail, wake up, kill). Write what actually happens: "the function catches the error and logs nothing".
- Do not string three or more nouns together without particles or prepositions. Unpack them. Fixed names such as product names are exempt.
- Do not put a long gap between subject and verb, or between a modifier and what it modifies. Split the sentence when a long phrase sits between them.

## plain
For: files that match neither of the above.

- Short sentences. Follow the wording and terms already in the file.
- No emoji or decoration.

### Do not write the four hard-to-read sentence forms
- When two sentences are related by reason, result, contrast, order or condition, say so with a connecting word ("so", "but", "only if"). Write "Lookups are slow, so we add a cache", not "Lookups are slow. We add a cache."
- Do not give things and features human actions (swallow, chase its tail, wake up, kill). Write what actually happens: "the function catches the error and logs nothing".
- Do not string three or more nouns together without particles or prepositions. Unpack them. Fixed names such as product names are exempt.
- Do not put a long gap between subject and verb, or between a modifier and what it modifies. Split the sentence when a long phrase sits between them.
