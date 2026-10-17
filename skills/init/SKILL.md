---
name: init
description: Set up wb in the current project. Asks four questions (project kind, message language, full verification command, whether wb also manages Claude Code worktrees) and writes .wb/config.json, ~/.wb/personal.json and the git exclude entry. Use when the user runs /wb:init or asks to start using wb in a repository.
---

# wb init

Set up wb for the project in the current working directory.

## Steps

1. Run `wb-config doctor` and read the result. If `.wb/config.json` already exists, tell the user and ask whether to keep it before going further. init never overwrites existing files.
2. Ask the user these four questions, one message, with the choices listed:
   - Project kind: `web-ui` (has screens), `service`, `library`, `other`
   - Message language: `ko` or `en`
   - Full verification command (for example the command that runs every test suite). It may be empty.
   - Should wb manage lane worktrees, including the ones Claude Code creates (`claude --worktree`, subagents with worktree isolation)? `no` (default) or `yes`. Explain before asking: with `yes`, wb's hook replaces Claude Code's own worktree creation in this project (base on the integration branch, lane ports, `.worktreeinclude`, setup command), and it is registered in this machine's `.claude/settings.local.json`. With `no`, Claude Code keeps its default behaviour; `wb-worktree create` still works.
3. Run:
   ```
   wb-config init --kind <kind> --lang <ko|en> --gate "<command>" --worktree-hook <yes|no>
   ```
   Leave out `--gate` when the answer is empty.
4. Report each line of the output to the user. When the output contains a `.gitignore` notice, show the exception line it suggests and ask before editing `.gitignore`.
5. codegraph: if `wb-config doctor` reports it missing, explain what it is and install it only after the user agrees. Never install it without consent.
6. Finish with `wb-config doctor` so the user sees the resolved values and where each one came from.

## Rules

- Do not write to `~/.wb/machine.json` or `~/.wb/routing.json` here. Those are personal files the user edits by hand; `wb-config explain <key>` shows what each key does.
- Do not commit. Suggest committing `.wb/config.json` and let the user decide.
