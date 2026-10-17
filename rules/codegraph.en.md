# Code index (codegraph)

codegraph is installed on this machine. Split the work like this when reading code.

1. Flow, callers and change impact: use codegraph (`codegraph_explore`, `codegraph_callers`, `codegraph_impact`). In a worktree, pass that worktree as `projectPath`.
2. Exact line numbers and strings: use grep. Reading a file again for line numbers is expected.
3. Calls inside Vue `watch` callbacks and routes registered as arrays can be missing from the graph. Check those with grep as well.
4. After a "not initialized" response, do not call codegraph for that path again. The index is built from the queue (`wb-index status`); until then continue with grep and Read.
