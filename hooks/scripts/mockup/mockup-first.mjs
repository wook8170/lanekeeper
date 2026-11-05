#!/usr/bin/env node
// PreToolUse(Write · Edit · MultiEdit): a UI structure change needs a recorded mockup
// decision first.
//
// Active when project.mockup.decision_required is true and project.mockup.ui_globs is
// not empty. A write is a structure change when it creates a UI file, or when the set of
// markup tags (or CSS selectors, for style sheets) differs between the old and new text.
// Text, attribute and property edits pass.
// A decision is a file in the decisions folder (paths.decisions) with the marker
//   <!-- lanekeeper-decision v1 status=decided kind=mockup scope=src/list/**,src/shared/Table.tsx -->
// whose scope covers the file (no scope = every UI file). `lanekeeper-decide new --kind mockup
// --scope …` writes it as status=pending, which does not unlock; `lanekeeper-decide answer` turns it
// to decided. A hand-written marker without status counts as decided. Not a safety hook: fail-open.
import fs from 'node:fs'
import path from 'node:path'
import { resolveConfig, projectRoot, getPath } from '../../../lib/config.mjs'
import { translator } from '../../../lib/i18n.mjs'
import { hookMain } from '../../../lib/runtime.mjs'
import { globToRe, expandBraces } from '../safety/common.mjs'

const STYLE_RE = /\.(css|scss|sass|less)$/i
const DECISION_RE = /<!--\s*(?:lanekeeper|wb)-decision\s+v\d+\b([^>]*?)-->/g

const match = (file, globs) => globs.flatMap(expandBraces).some((g) => globToRe(g).test(file) || (g.startsWith('**/') && globToRe(g.slice(3)).test(file)))

export function tags(text, style = false) {
  const s = String(text || '')
  const re = style ? /([^{};]+)\{/g : /<([A-Za-z][\w.:-]*)/g
  return [...s.matchAll(re)].map((m) => m[1].trim().replace(/\s+/g, ' ')).sort()
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

// Is this tool call a structure change of `abs`?
export function isStructural(tool, ti, abs) {
  const style = STYLE_RE.test(abs)
  const exists = fs.existsSync(abs)
  if (tool === 'Write') {
    if (!exists) return true
    return !same(tags(fs.readFileSync(abs, 'utf8'), style), tags(ti.content, style))
  }
  const edits = tool === 'MultiEdit' ? ti.edits || [] : [ti]
  return edits.some((e) => !same(tags(e.old_string, style), tags(e.new_string, style)))
}

export function decisionsDir(root, config) {
  const tpl = String(getPath(config, 'project.paths.decisions') || 'docs/decisions/{date}-{slug}.md')
  const head = tpl.split('{')[0]
  return path.resolve(root, head.endsWith('/') ? head : path.dirname(head))
}

// Mockup decisions: [{ file, scope: [glob] }]
export function mockupDecisions(dir) {
  const out = []
  let names = []
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
  } catch {
    return out
  }
  for (const n of names) {
    const text = fs.readFileSync(path.join(dir, n), 'utf8')
    for (const m of text.matchAll(DECISION_RE)) {
      const attrs = Object.fromEntries(m[1].trim().split(/\s+/).filter((x) => x.includes('=')).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]))
      if (attrs.kind !== 'mockup' || attrs.status === 'pending') continue
      out.push({ file: n, scope: attrs.scope ? attrs.scope.split(',').filter(Boolean) : [] })
    }
  }
  return out
}

export function handle(input, env = process.env) {
  const tool = input.tool_name
  if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) return null
  const ti = input.tool_input || {}
  if (!ti.file_path) return null
  const cwd = input.cwd || process.cwd()
  const root = projectRoot(cwd, env)
  const resolved = resolveConfig({ projectDir: root, env })
  const m = getPath(resolved.config, 'project.mockup') || {}
  const globs = m.ui_globs || []
  if (m.decision_required === false || !globs.length) return null
  const abs = path.resolve(cwd, ti.file_path)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel) || !match(rel, globs)) return null
  if (!isStructural(tool, ti, abs)) return null
  const dir = decisionsDir(root, resolved.config)
  if (mockupDecisions(dir).some((d) => !d.scope.length || match(rel, d.scope))) return null
  const t = translator(resolved.effective.language)
  const reason = [
    `[lanekeeper] ${t('safety.blocked')}: ${t('mockup.why', { file: rel })}`,
    `${t('safety.fix')}: ${t('mockup.fix', { dir: path.relative(root, dir) || '.', file: rel })}`,
    `${t('safety.help')}: ${t('mockup.where')}`,
  ].join('\n')
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
}

hookMain(import.meta, (i, e) => handle(i, e))
