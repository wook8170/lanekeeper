#!/usr/bin/env node
// PreToolUse(Write · Edit · MultiEdit): code standards warning. Never blocks.
//
// Active when project.code_standards.warn_hook is true. For a code file
// (.js/.ts/.jsx/.tsx/.vue/.svelte and the .mjs/.cjs forms) it compares the new
// text with the text it replaces and adds a note to the model's context when
// the new code brings an empty catch (comments only count as empty), a
// `.catch(() => value)`, `console.` / `console[…]` / `globalThis.console`,
// `catch (e) { void e }`, or `.catch(<helper>)` for a name in
// project.code_standards.helpers. The note names the helpers and the document
// (project.code_standards.doc).
// Skipped: test files and folders, and project.code_standards.exempt_paths (for
// example a CLI whose job is printing). Not a safety hook: fail-open.
import fs from 'node:fs'
import path from 'node:path'
import { resolveConfig, projectRoot } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { ctxOutput, hookMain } from '../../../lib/runtime.mjs'
import { codeStandards, scanAdded, CODE_EXT_RE, TEST_PATH_RE } from '../../../lib/code-standards.mjs'
import { globToRe, expandBraces } from '../safety/common.mjs'

const match = (file, globs) => globs.flatMap(expandBraces).some((g) => globToRe(g).test(file) || (g.startsWith('**/') && globToRe(g.slice(3)).test(file)))

// [before, after] text pairs of this call.
function changes(tool, ti, abs) {
  if (tool === 'Write') {
    let old = ''
    try {
      old = fs.readFileSync(abs, 'utf8')
    } catch {
      old = ''
    }
    return [[old, ti.content]]
  }
  const edits = tool === 'MultiEdit' ? ti.edits || [] : [ti]
  return edits.map((e) => [e.old_string, e.new_string])
}

export function handle(input, env = process.env) {
  const tool = input.tool_name
  if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) return null
  const ti = input.tool_input || {}
  if (!ti.file_path || !CODE_EXT_RE.test(String(ti.file_path))) return null
  const cwd = input.cwd || process.cwd()
  const root = projectRoot(cwd, env)
  const resolved = resolveConfig({ projectDir: root, env })
  const cs = codeStandards(resolved.config)
  if (!cs.warn_hook) return null
  const abs = path.resolve(cwd, ti.file_path)
  const rel = path.relative(root, abs).split(path.sep).join('/')
  if (TEST_PATH_RE.test(rel) || (cs.exempt_paths.length && match(rel, cs.exempt_paths))) return null
  const found = new Map()
  for (const [before, after] of changes(tool, ti, abs)) {
    for (const h of scanAdded(before, after, cs.helpers)) if (!found.has(h.id)) found.set(h.id, h)
  }
  if (!found.size) return null
  const t = translator(resolved.effective.language)
  const lines = [`[lanekeeper] ${t('codestd.warn.head', { file: rel })}`]
  for (const h of found.values()) lines.push(`  - ${t(`codestd.warn.${h.id}`)}${h.sample ? ` (${h.sample})` : ''}`)
  lines.push(`  ${cs.helpers.length ? t('codestd.warn.helpers', { helpers: cs.helpers.join(', ') }) : t('codestd.warn.no_helpers')}`)
  if (cs.doc) lines.push(`  ${t('codestd.warn.doc', { doc: cs.doc })}`)
  return ctxOutput('PreToolUse', lines.join('\n'))
}

hookMain(import.meta, (i, e) => handle(i, e))
