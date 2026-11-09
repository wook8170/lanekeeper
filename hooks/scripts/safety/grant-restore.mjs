#!/usr/bin/env node
// PostToolUseFailure (Bash): the line a grant was spent on exited with an error, so the change did not
// happen. The grant goes back to unused, and the person is not asked the same thing again. This never
// makes a grant, and a grant that comes back is bound as before: same commit, target and time limit.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig, projectRoot, stateDir, lanekeeperHome } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { logDecision } from '../../../lib/owner-decisions.mjs'
import { ownerDir, restoreGrant } from './grant.mjs'

export function afterFailure(input, env = process.env, now = Date.now()) {
  if (input.tool_name !== 'Bash' || input.agent_id) return null
  const cwd = input.cwd || process.cwd()
  const root = projectRoot(cwd, env)
  const line = input.tool_input?.command
  const back = [stateDir(root), ownerDir(lanekeeperHome(env))].find((sd) => sd && restoreGrant(sd, line, now))
  if (!back) return null
  logDecision(back, { action: 'grant-restored', via: 'hook', line: String(line).trim().slice(0, 300) }, new Date(now))
  const t = translator(resolveConfig({ projectDir: root, env }).effective.language)
  return { hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext: `[lanekeeper] ${t('safety.grant_restored')}` } }
}

// Not a workflow hook: the guard that spends a grant runs in every repository, so this does too.
if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => (raw += c))
  process.stdin.on('end', () => {
    try {
      const out = afterFailure(JSON.parse(raw || '{}'))
      if (out) process.stdout.write(`${JSON.stringify(out)}\n`)
    } catch (e) {
      process.stderr.write(`[lanekeeper] ${String(e?.message || e)}\n`)
    }
    process.exit(0)
  })
}
