---
name: report
description: Write the final report of a wave or task as a published artifact — figures and evidence in the chat, before and after captures, the test result workbook and the defect register attached. Use when the user runs /lanekeeper:report, when a wave is integrated and verified, or when finished work has to be shown to someone else.
---

# Lanekeeper report

The Stop hook `artifact-check` blocks the end of the turn once if this stage ends without an artifact, or when the project keeps result workbooks and the newest one is missing, uncommitted or for another run.

## Steps

1. Evidence:
   - Test results: `lanekeeper-check test-results --json` (attach `file` and `json`) and `lanekeeper-test-report summary --json` (quote the numbers as they are; never round a failed verdict up).
   - Defects: `lanekeeper-defects summary --json` and `lanekeeper-defects export` (writes `defect-register.md` and `.xlsx` next to the register; without openpyxl only the Markdown file, exit 3).
   - Lane ledger: `lanekeeper-waves board --json` for lanes, returns and models.
2. Captures: keep the ones worth seeing again with `lanekeeper-art keep <png>... --slug <topic>` (into `paths.artifacts_keep`, committed; a PNG over `artifacts_keep_webp.over_kb` becomes WebP). Throw-away ones go to `lanekeeper-art temp`.
3. Write the body in Markdown: what changed and why, before and after, figures, verification, defects, what remains and what the owner must decide. Use the report style of the project (`project.style.map` for `.md`).
4. Publish:
   - With the Artifact tool: build the page with `lanekeeper-art report --title <title> --md <body.md> --image "Before=<png>" --image "After=<png>" [--keep --slug <topic>]` and publish the HTML file. Images are embedded as data URIs, so the page works on a remote device (`personal.report.viewer: remote`).
   - Without the Artifact tool (`personal.report.artifact_fallback: html-file`): give the user the path of that HTML file.
5. Chat: `personal.report.chat_detail` `detailed` puts the tables, evidence and figures in the reply as well; `summary` gives a short summary and the artifact link.
6. Keep the final report text under `paths.reports_final` and commit it with the kept artifacts. Scratch reports stay uncommitted.
7. Stop at "ready to merge". Merging to the protected branch needs the owner's order.

## Do not

- Do not use local addresses or local file links for a remote viewer.
- Do not report "implemented" as "migrated and deployed"; say which one is done.
