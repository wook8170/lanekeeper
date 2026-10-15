#!/usr/bin/env node
// SessionStart: keep the opt-in WorktreeCreate / WorktreeRemove hooks in the
// main checkout's .claude/settings.local.json in line with
// project.worktree.hook and the current plugin root (see lib/worktree-hooks.mjs).
// Fails open: any problem leaves the settings as they are and prints nothing.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig, projectRoot, PLUGIN_ROOT } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { status, syncWorktreeHooks } from '../../../lib/worktree-hooks.mjs'

export function run(input, env = process.env, pluginRoot = PLUGIN_ROOT) {
  const root = projectRoot(input.cwd || process.cwd(), env)
  const resolved = resolveConfig({ projectDir: root, env })
  if (resolved.errors.length) return ''
  const enabled = resolved.config.project?.worktree?.hook === true
  // nothing to do when the hooks are off and were never written
  if (!enabled && status(root, pluginRoot).state === 'off') return ''
  const r = syncWorktreeHooks(root, pluginRoot, enabled)
  if (!r.changed && r.state !== 'conflict') return ''
  const t = translator(resolved.effective.language)
  const key = r.state === 'conflict' ? 'wthook.conflict' : enabled ? 'wthook.synced_on' : 'wthook.synced_off'
  return JSON.stringify({ systemMessage: `[wb] ${t(key, { file: r.file })}` })
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => (raw += c))
  process.stdin.on('end', () => {
    let out = ''
    try {
      out = run(JSON.parse(raw || '{}'))
    } catch {}
    if (out) process.stdout.write(`${out}\n`)
    process.exit(0)
  })
}
