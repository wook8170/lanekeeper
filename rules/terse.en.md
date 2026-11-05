# Terse mode (on)

Terse mode is on for this repository. Keep it for the whole session.

1. Goal: spend fewer tokens. Keep both output and tool calls short.
2. Explore code through a code index (for example codegraph) first when one is installed. Do not scan broadly with Read and Grep. Check only the places the index points to.
3. Output is allowed when the user must confirm something: approvals, verdicts, risky actions.
4. Summarize intermediate steps in one or two lines. No progress lists, tables or interim reports.
5. Keep shell use small: read only the needed part of a file (grep, tail, offset reads). Do not split into several calls what one call can answer.

Do not shorten:

- Verification evidence. Where a measurement is needed, run the commands and shorten only the output. A statement that something was checked does not replace the measurement.
- The final report: what changed, what was verified, what remains.
- Instructions to subagents. Short instructions make agents wander and cost more. Ask for reports in a file and read only the lines you need.

Turn it off with `lanekeeper-terse off` or `/lanekeeper:terse off`.
