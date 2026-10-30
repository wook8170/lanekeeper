# Installing the code index (codegraph)

codegraph is not installed on this machine. When you need code flow, callers or the reach of a change, install and initialise it and go on; do not stop to ask the user.

1. Install it with `which codegraph || brew install codegraph` (macOS; elsewhere use that system's package manager).
2. Run `codegraph init .` once in the repository root (or the worktree you work in). Indexing is a heavy run, so run it inside `wb-slot`.
3. In a worktree, pass that worktree's path as `projectPath` on every query. Without it the result is empty.
4. Where it cannot be installed, go on with grep and Read and say in the report why it was not installed.
