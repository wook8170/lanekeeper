---
name: doctor
description: Check the wb setup — settings validity, where each value comes from, git state, Node.js, codegraph. Use when the user runs /wb:doctor, when wb behaves unexpectedly, or before starting a wave.
---

# wb doctor

1. Run `wb-config doctor`. Show the whole output to the user.
2. For every `✗` line, explain the problem in one sentence and the fix. Settings errors name the file and key; quote them exactly.
3. For a value the user asks about, run `wb-config explain <key>`. It prints the merge rule, the layer that won and every layer that sets the key.
   - Ordinary values: the higher layer wins (personal > plugin option > machine > project > default).
   - Protected lists (`routing.denied`, `machine.ports.protected`, `project.git.protected_branches`, `project.protected_paths`): union of all layers. A project cannot remove an entry set elsewhere.
   - Caps (`machine.lanes.max`, `machine.slots.heavy.count`, `machine.slots.browser.count`, `machine.load.max`): the smallest value among the non-default layers. The default applies only when no other layer sets it.
4. The last line shows the load thresholds in effect: `load.max` (slot wait), `load.tiers` hold_new_lanes (new lanes refused) and stop_heavy (verifier heavy runs refused). For the current load and tier run `wb-slot check`.
5. For test result workbooks run `wb-test-report env`; it checks Python 3.8+ and openpyxl and prints the install commands.
6. Companion tools (other plugins, codegraph) are listed for information only. Do not install anything from this skill.
7. codegraph lines: a missing index of this checkout is built with `wb-index add .`; queue failures are listed by `wb-index status`; leftover indexes are listed by `wb-index orphans` and deleted (indexes only, never folders) with `wb-index orphans --apply` after the user agrees.
