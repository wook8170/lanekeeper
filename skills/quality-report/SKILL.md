---
name: quality-report
description: Build the quality report of a version from the archived results — the latest result per kind (unit, integration, gate, e2e, UI stability, usability, adversarial UX check, ship verification), missing kinds, known issues, excluded tests and the run history — as a workbook (quality-<version>.xlsx, one sheet per kind plus a summary) and a readable Markdown and HTML page. Use when the user runs /wb:quality-report, asks for a quality report or a release quality summary, or at the end of /wb:ship-verify.
---

# wb quality-report

## Steps

1. `wb-quality index` rebuilds `index.json` and `INDEX.md` from the result files (older date folders are listed as the older layout, their numbers inferred from the content).
2. `wb-quality report [--version <V>]` (default: the version in `quality.version_file`). It writes `<results>/<V>/quality-<V>.xlsx`, `.md` and `.html`. Without Python 3.8+ and openpyxl the workbook is skipped with a notice; the Markdown and HTML are still written.
3. Read the Markdown. It has the latest result per kind, the required kinds without a result, the failures of the latest results (known issues), the skipped and fixme counts (excluded tests) and the run history.
4. For a document that goes to customers or reviewers, write the text from these numbers in plain business language: no tool, agent or internal path names, no claims without a number. Keep the version and the date of each figure.
5. Commit the roll-up files with the index. To show it remotely, publish the HTML as an artifact.

## Do not

- Do not edit the numbers in the roll-up by hand. Run the missing or failed kinds and build it again.
- Do not report a version as ready while a required kind is missing or failed; the lead line of the report says which it is.
