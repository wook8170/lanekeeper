# Installing the code index (codegraph)

codegraph is not installed on this machine. Do not install it yourself. Go on with `rg` and Read.

1. When code flow, callers or the reach of a change would take many searches, tell the user once that codegraph is missing and show the install command: `brew install codegraph` (macOS; elsewhere that system's package manager).
2. Install it only after the user agrees in their own message. Then run `codegraph init .` once in the repository root (or the worktree you work in). Indexing is a heavy run, so run it inside `lanekeeper-slot`.
3. In a worktree, pass that worktree's path as `projectPath` on every query. Without it the result is empty.
4. When the user declines, or it cannot be installed, keep using `rg` and Read and do not ask again in this session.
