# Owner report artifact

The main session builds one HTML page from `findings.md` and publishes it as an artifact (the `artifact-design` guidance applies: light and dark theme, phone width). Captures are embedded as `data:image/png;base64,…` URIs encoded by a script, never pasted into the conversation.

Order of the page:

1. Lead line: version, commit, area, the verdict (open blocker and high findings, or none), and what the owner is asked to decide.
2. Counts: by severity and by axis, parity findings, cells checked and not checked.
3. One card per finding, blockers first, then high, medium, low:
   - number, screen, severity, axis, defect fix or design change;
   - the one sentence the user goes through, as the card title;
   - now and fix captures side by side (stacked on a narrow screen), each with its theme and width;
   - evidence: the data check (screen value next to the real value) or the measurement;
   - fix proposal with the design system names; a note when it conflicts with a recorded decision;
   - the injected code, folded.
4. Not checked, and why.
5. Decision list: one line per finding with the choice fix now · later · decline, which the owner answers in chat.

Keep the text plain: no tool or agent names, no claims without a number or a capture. Republish to the same file path after the owner's answers and after the re-check, so the link stays the same.
