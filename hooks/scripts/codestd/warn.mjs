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
// With project.code_standards.readability on (the default) it also notes history
// markers in comments (version numbers, tickets, task numbers, design line numbers),
// a new file without a header comment, and a function with more than
// readability.max_params parameters or fields of one destructured input object, and
// a React function component or Vue defineProps with more than readability.max_props props.
// Skipped: test files and folders, and project.code_standards.exempt_paths (for
// example a CLI whose job is printing). Not a safety hook: fail-open.
import fs from 'node:fs'
import path from 'node:path'
import { resolveConfig, projectRoot } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { ctxOutput, hookMain } from '../../../lib/runtime.mjs'
import { codeStandards, scanAdded, CODE_EXT_RE, TEST_PATH_RE } from '../../../lib/code-standards.mjs'
import { readability, scanReadable } from '../../../lib/readability.mjs'
import { globToRe, expandBraces } from '../safety/common.mjs'

const match = (file, globs) => globs.flatMap(expandBraces).some((g) => globToRe(g).test(file) || (g.startsWith('**/') && globToRe(g.slice(3)).test(file)))

// [before, after, isNew] for each text change of this call. isNew: a Write to a missing file.
function changes(tool, ti, abs) {
  if (tool === 'Write') {
    let old = ''
    let isNew = false
    try {
      old = fs.readFileSync(abs, 'utf8')
    } catch {
      isNew = true
    }
    return [[old, ti.content, isNew]]
  }
  const edits = tool === 'MultiEdit' ? ti.edits || [] : [ti]
  return edits.map((e) => [e.old_string, e.new_string, false])
}

// Findings of this call, first one per id: { errors: Map, readable: Map }.
function findings(tool, ti, abs, rel, cs, rd) {
  const errors = new Map()
  const readable = new Map()
  for (const [before, after, isNew] of changes(tool, ti, abs)) {
    for (const h of scanAdded(before, after, cs.helpers)) if (!errors.has(h.id)) errors.set(h.id, h)
    if (!rd.enabled) continue
    for (const h of scanReadable(before, after, { maxParams: rd.max_params, maxProps: rd.max_props, isNew, file: rel })) if (!readable.has(h.id)) readable.set(h.id, h)
  }
  return { errors, readable }
}

function noteLines({ rel, errors, readable, cs, rd, t }) {
  const item = (text, h) => `  - ${text}${h.sample ? ` (${h.sample})` : ''}`
  const lines = [`[lanekeeper] ${t('codestd.warn.head', { file: rel })}`]
  for (const h of errors.values()) lines.push(item(t(`codestd.warn.${h.id}`), h))
  for (const h of readable.values()) lines.push(item(t(`readable.warn.${h.id}`, { max: rd.max_params, props: rd.max_props }), h))
  if (errors.size) lines.push(`  ${cs.helpers.length ? t('codestd.warn.helpers', { helpers: cs.helpers.join(', ') }) : t('codestd.warn.no_helpers')}`)
  if (cs.doc) lines.push(`  ${t('codestd.warn.doc', { doc: cs.doc })}`)
  if (readable.size && rd.doc) lines.push(`  ${t('readable.warn.doc', { doc: rd.doc })}`)
  return lines
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
  const rd = readability(resolved.config)
  const { errors, readable } = findings(tool, ti, abs, rel, cs, rd)
  if (!errors.size && !readable.size) return null
  const t = translator(resolved.effective.language)
  return ctxOutput('PreToolUse', noteLines({ rel, errors, readable, cs, rd, t }).join('\n'))
}

hookMain(import.meta, (i, e) => handle(i, e))
