---
name: docs-sync
description: After a change of screens or features, bring every document that describes them up to date in one pass — in-app manual, user and developer docs, help articles, UI strings, product page, screenshots, backlog copies, changelog and generated documents. Builds an impact map from the change (which documents must change), regenerates what is generated, drafts the text edits, recaptures the affected pictures and runs the checks, then gates the change. Use when the user runs /lanekeeper:docs-sync, asks to update the docs or the manual after a change, when `lanekeeper-docs check` or the `docs` quality kind failed, or at the end of a lane that changed screens.
---

# Lanekeeper docs-sync

Settings: `docs_sync` in `.lanekeeper/config.json` (example: `examples/docs-sync-config.json` in the plugin). The change is the merge-base with `docs_sync.base` (default `main`) up to the working tree, uncommitted and new files included. `--base <ref>` picks another base; `--base release` takes the newest tag matching `docs_sync.release_tag`.

## Steps

1. `lanekeeper-docs map`. No `docs_sync.targets`: show the user the example file and ask which documents the project keeps (manual, guides, help, UI strings, product page, screenshots, generated docs, changelog) and where. Write them as targets, rules, mirrors and groups, then run `lanekeeper-docs map` again.
2. Read the table first. **required** items fail the gate when left alone: a document line that still quotes a phrase the screens no longer show, the other side of a mirrored pair, the rest of a group, a generated document whose source changed. **review** items are documents that mention the changed part of a screen, recapture candidates and the pages showing them.
3. `lanekeeper-docs apply` runs the autofix commands that apply (generated references, counts, ledgers). Never edit generated files by hand.
4. `lanekeeper-docs drafts --out <scratch file>` lists, per file, "old phrase → new phrase", phrases that are gone and pictures to match. Check each phrase against the running screen, then edit. Follow the writing style of the project (`docs_sync.style`, `/lanekeeper:writing-style`). Keep mirrored copies identical. Count numbers and lists instead of copying old ones.
5. Recapture the pictures with the command in section 4 of the map. Use the project's own ports, never a server someone else is using, a headless browser and scale 2. Use the fixed test data the capture script expects, never the working database.
6. `lanekeeper-docs verify` runs the checks (`docs_sync.checks`). Fix what fails.
7. `lanekeeper-docs check` until it passes. Report section 6 of the map (left by hand) to the user.

When a required item truly needs no edit (a document that quotes an old name on purpose), add an acknowledgement with the reason to `docs_sync.ack_file`: `{ "acks": [ { "target": "user-docs", "file": "docs/guide/history.md", "phrase": "Copy link", "reason": "…", "by": "owner", "at": "2026-10-20" } ] }`. It passes that item only.

## With the quality results

With `docs_sync.targets` set, `lanekeeper-quality` knows the kind `docs` (category gate) that runs `lanekeeper-docs check --base <docs_sync.quality_base>` (default `release`). One target is one test, so dropping a target shows up as fewer tests. Add `docs` to `quality.ship.requires` to make the ship precheck require it.

## Do not

- Do not add an acknowledgement to get a pass when the document is simply out of date.
- Do not raise `max_files_per_phrase` or drop a target to silence the gate.
- Do not start a browser with a window, and do not write test data into the owner's database.
