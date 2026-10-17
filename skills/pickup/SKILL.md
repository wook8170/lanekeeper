---
name: pickup
description: Take over work at the start of a session. Reads progress.md (the current state) from start to end, checks git status, worktree list and recent commits, and reports stale items before any new task. Use when the user runs /wb:pickup, starts a session in a project with a handoff file, or says to continue where the last session stopped.
---

# wb pickup

1. Read `progress.md` (path: `personal.handoff.file`, default `progress.md`) first, from start to end. It holds the current state only: goals and owner decisions, branches and servers, in progress, next, waiting for answers, system notes, resume commands.
2. Past history is in the archive (`personal.handoff.archive_dir`, default `docs/progress-archive/`). Do not read it whole. When you need an earlier decision or result, search it with `grep -n '<keyword>' docs/progress-archive/*.md` and read only that part.
3. Run `wb-waves resume`. It prints the same handoff text, the archive location, git status, `git worktree list`, the last five commits, the lane ledger and the stale items.
4. Tell the user, in this order:
   - the stale items (what looks abandoned or out of date), one line each;
   - what the handoff says to do next;
   - which lanes can be resumed (`/wb:resume`) or reviewed.
5. If `progress.md` is over the line target (`personal.handoff.max_lines`, default 300), report it as a stale item. An accumulated file (old sections kept below the newest one) is moved whole with `wb-waves handoff migrate` to `docs/progress-archive/progress-until-<YYYY-MM-DD>.md`, and a fresh current-state file is written in its place. Ask the user before moving it.
6. Start new work only after the stale items are reported. Do not clean up worktrees or branches on your own.
7. When the work of this session ends, hand off:
   - Append finished content (completed waves, answered questions, state that no longer holds) to `docs/progress-archive/progress-<YYYY-MM>.md` as a `## <YYYY-MM-DD HH:MM> — <summary>` section. If finished and current items are hard to separate, run `wb-waves handoff archive "<summary>"`; it appends the whole current file. History is never deleted.
   - Rewrite `progress.md` whole: one line at the top with the archive location and `grep -n '<keyword>' docs/progress-archive/*.md`, then goals and owner decisions, branches and servers, in progress (table), next, waiting for answers, system notes, and the exact resume commands.
   - Commit both files together, then tell the user to clear the session.
