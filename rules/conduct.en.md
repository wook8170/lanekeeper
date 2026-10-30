# Reporting, communication and fixing

## Accurate reporting
- Keep "the feature is implemented" apart from "it is merged and deployed". Say separately whether migrations were applied.
- After a merge, restart or resync every affected server first; only then report that the change is live.
- Before fixing, check which app and which variant (edition, port, working folder) is actually running.

## Communication
- When a request could mean a code or docs change or an operational action (restarting a server, say), ask once.
- When the same question comes again, answer it directly before any other work.
- Chat replies carry the evidence and the figures themselves. Do not stop at "checked".

## Fixing
- Do not hide a symptom with a stopgap or a workaround. Find the root cause and fix it. When it cannot be fixed now, report that and why.
- No emoji in the product UI. Use icon resources (SVG and the like) where an icon is needed.
