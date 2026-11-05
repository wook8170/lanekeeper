# Privacy

Lanekeeper is a Claude Code plugin that runs on your machine. The author does not operate a server for it and receives no data from it.

## What it collects

Nothing is collected or sent to the author or to any third party. There is no telemetry, analytics or crash reporting.

## What it keeps on your machine

The plugin writes these local files. They stay until you delete them.

| Where | What |
|---|---|
| `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/…`) | Usage-limit records, token guard totals and calibration (with your Claude account ID as read from `~/.claude.json`), automatic resume state and logs, hook throttles |
| `~/.lanekeeper/` | Your personal and machine settings, slot leases, the codegraph index queue |
| `<repo>/.lanekeeper/` | Project settings, briefs, codegraph call metrics |
| `<git common dir>/lanekeeper/` | Lane ledger (model names, token counts, brief hashes), owner grants, gate stamps, port leases |

Conversation text and credentials are not stored. The token guard reads only the usage entry and the account ID from `~/.claude.json`, and only usage fields from the conversation logs in `~/.claude/projects`.

## Network use

- When Claude runs `gh pr merge`, the safety hook runs `gh pr view` through your own `gh` login to read the PR's base branch from GitHub.
- The review's serving check reads a page from `localhost`, `127.0.0.0/8` or `[::1]` only.
- Automatic resume is off by default. When you turn it on, it starts `claude` with your own Claude Code login after a usage limit resets.
- The report skill asks Claude to publish a report with Claude's own Artifact tool when that tool is available. The page goes to your claude.ai account.

## Children

The plugin is a developer tool and is not directed at children under 18.

## Contact

Questions: open an issue at https://github.com/wook8170/lanekeeper/issues.
