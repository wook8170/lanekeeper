---
name: pickup
description: Take over work at the start of a session. Reads the newest progress.md section, checks git status, worktree list and recent commits, and reports stale items before any new task. Use when the user runs /wb:pickup, starts a session in a project with a handoff file, or says to continue where the last session stopped.
---

# wb pickup

1. Read `progress.md` (path: `personal.handoff.file`, default `progress.md`) first. The newest section is the handoff: done, in progress, next, waiting for answers, system notes.
2. Run `wb-waves resume`. It prints the same handoff excerpt, git status, `git worktree list`, the last five commits, the lane ledger and the stale items.
3. Tell the user, in this order:
   - the stale items (what looks abandoned or out of date), one line each;
   - what the handoff says to do next;
   - which lanes can be resumed (`/wb:resume`) or reviewed.
4. Start new work only after the stale items are reported. Do not clean up worktrees or branches on your own.
5. When the work of this session ends, update `progress.md` with the current wave, finished items, open items and the exact resume command, then tell the user to clear the session.
