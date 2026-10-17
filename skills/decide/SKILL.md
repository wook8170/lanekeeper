---
name: decide
description: Put an owner decision to the user as a short question with fixed options, and record the answer as a file under docs/decisions/. Use when the user runs /wb:decide, when a lane or the controller needs an owner choice (structure, wording, scope), or when pending decisions should be listed.
---

# wb decide

Decisions live in `project.paths.decisions` (default `docs/decisions/<date>-<slug>.md`) and are committed, so the next session does not ask again. Use this for choices that belong to the owner, not for ones the controller can settle from the brief.

## Ask

1. Write the question so it can be answered in one line: what is being decided, two to four options, and your recommendation with the reason. Options say what changes for the user, not how it is built.
2. Create the record: `wb-decide new <slug> --title "<title>" --question "<question>" --option "A=<text>" --option "B=<text>" --recommend A`. It writes the file with status "pending" and prints a commit suggestion. It never commits.
3. Show the user the question, the options and the recommendation in plain words (a screen change: show the mockups first, the current and the proposed side by side).
4. Wait for the answer. Do not start work that depends on it.

## Record

`wb-decide answer <slug> --choice "<chosen option text>" [--note "<reason>"]` fills the decision block, sets the status to "decided" and prints a commit suggestion. Commit the file when the user agrees.

## List

`wb-decide list --pending` shows what is still waiting. Mention pending decisions at the start of a wave.

## Word questions

When a new term has no entry in the glossary, ask in a fixed form with three answers: register as is, use another word, ignore. Put the term list in the question; record the answer here and in the glossary's `decided` field when the glossary skill is installed.
