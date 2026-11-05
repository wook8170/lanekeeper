---
name: explain
description: Explain in plain words what is blocked or waiting right now, why, and how to recover; look up the rule behind a block message. Use when the user runs /lanekeeper:explain, asks why something was blocked or why nothing is moving, pastes a Lanekeeper block message, or asks what a rule is for.
---

# Lanekeeper explain

Answer in the user's language, in short plain sentences, without jargon. Give three things for each item: what is happening, why, and what to do. Say what you will do yourself and what only the user can do.

## What is stuck right now

1. Run `lanekeeper-explain`. It checks settings errors, usage limits, a running gate, lanes that stopped or failed, lanes waiting for review, the lane cap, full run slots, stale handoff, leftover worktrees and the protected branch.
2. Tell the user the summary line first, then each blocked item, then waiting items. Notes last. Do not read out all of them if there are many; start with the ones that stop work.
3. If the user can act on an item, give the exact next step. If only the owner can (for example a grant), say who and what to ask.

## A block message

1. The block messages have three parts: why it was blocked, how to fix it, where to ask. Find the code in the text (for example `safety.git.lane_commit`) or ask the user to paste the message.
2. Run `lanekeeper-explain code <code>`. It prints the message and the rule behind it: the rule, why it exists, where it is enforced and how to recover.
3. Explain the rule's reason in your own plain words. Do not suggest a way around the rule. If the user believes the rule is wrong for the project, point to the setting that changes it (the catalog names it) and say the owner decides.

## Rules in general

- `lanekeeper-rules list` shows all rules, `lanekeeper-rules show <id>` one rule in full. The generated catalog is `rules/catalog.<lang>.md`.
- `lanekeeper-explain links` lists documents the project linked under `explain.links` (training material, manuals). Offer them when the user wants to learn more. Lanekeeper ships none.
- For a setting value and where it comes from, use `lanekeeper-config explain <key>` (`/lanekeeper:doctor`).

This skill only reads. Do not change settings, delete worktrees or touch lanes from here; propose the step and let the user or the controller do it.
