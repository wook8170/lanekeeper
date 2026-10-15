---
name: init
description: Set up wb in the current project. Asks three questions (project kind, message language, full verification command) and writes .wb/config.json, ~/.wb/personal.json and the git exclude entry. Use when the user runs /wb:init or asks to start using wb in a repository.
---

# wb init

Set up wb for the project in the current working directory.

## Steps

1. Run `wb-config doctor` and read the result. If `.wb/config.json` already exists, tell the user and ask whether to keep it before going further. init never overwrites existing files.
2. Ask the user these three questions, one message, with the choices listed:
   - Project kind: `web-ui` (has screens), `service`, `library`, `other`
   - Message language: `ko` or `en`
   - Full verification command (for example the command that runs every test suite). It may be empty.
3. Run:
   ```
   wb-config init --kind <kind> --lang <ko|en> --gate "<command>"
   ```
   Leave out `--gate` when the answer is empty.
4. Report each line of the output to the user. When the output contains a `.gitignore` notice, show the exception line it suggests and ask before editing `.gitignore`.
5. When the project kind is `web-ui`, mention that UI stability checks can be added later with `/wb:ui-check`. Do not install anything now.
6. codegraph: if `wb-config doctor` reports it missing, explain what it is and install it only after the user agrees. Never install it without consent.
7. Finish with `wb-config doctor` so the user sees the resolved values and where each one came from.

## Rules

- Do not write to `~/.wb/machine.json` or `~/.wb/routing.json` here. Those are personal files the user edits through `/wb:advanced`.
- Do not commit. Suggest committing `.wb/config.json` and let the user decide.
