// Code standards (project.code_standards): the project's own coding rules document,
// the checks the gate runs, the error logging helpers and the protected paths.
//
//   briefLine()          text for {{code_standards}} in the impl and fix briefs
//   applyToBrief()       fills that line, or drops it when no document is set
//   scanAdded()          patterns in newly written code (warn hook, never blocks)
//
// The plugin knows no project's rules; it points lanes at the document the
// project names and repeats the helper names and protected paths from settings.
import { getPath } from './config.mjs'

export const PLACEHOLDER_LINE_RE = /^.*\{\{\s*code_standards\s*\}\}.*(?:\n|$)/m

export function codeStandards(config) {
  const c = getPath(config, 'project.code_standards') || {}
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : [])
  return {
    doc: typeof c.doc === 'string' ? c.doc.trim() : '',
    checks: list(c.checks),
    helpers: list(c.helpers),
    protected_paths: list(c.protected_paths),
    exempt_paths: list(c.exempt_paths),
    warn_hook: c.warn_hook === true,
  }
}

// One line for the brief, or '' when no document is set.
export function briefLine(config, t) {
  const cs = codeStandards(config)
  if (!cs.doc) return ''
  const parts = [t('codestd.brief', { doc: cs.doc })]
  if (cs.helpers.length) parts.push(t('codestd.brief.helpers', { helpers: cs.helpers.join(', ') }))
  if (cs.protected_paths.length) parts.push(t('codestd.brief.protected', { paths: cs.protected_paths.join(', ') }))
  return parts.join(' ')
}

// Replace the {{code_standards}} placeholder (the rest of its line stays, e.g. "- "),
// or remove the whole line when the project names no document.
export function applyToBrief(text, line) {
  if (!PLACEHOLDER_LINE_RE.test(text)) return text
  if (!line) return text.replace(PLACEHOLDER_LINE_RE, '')
  return text.replace(/\{\{\s*code_standards\s*\}\}/, line)
}

// ---- warn hook patterns -----------------------------------------------------------

export const CODE_EXT_RE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i
export const TEST_PATH_RE = /(?:^|\/)(?:tests?|__tests__|__mocks__|e2e)\/|\.(?:test|spec)\.[^/]+$/i

const VALUE = String.raw`(?:null|undefined|true|false|-?\d[\d.]*|'[^'\n]*'|"[^"\n]*"|\[\s*\]|\{\s*\}|\(\s*\{\s*\}\s*\)|[\w$.]+(?!\s*[(\w$.]))`
const ARROW_HEAD = String.raw`\.catch\(\s*(?:async\s*)?(?:\(\s*[\w$]*\s*\)|[\w$]+)\s*=>\s*`
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// [{ id, re }]; helper names add the `.catch(helper)` form.
export function patterns(helpers = []) {
  const out = [
    { id: 'empty_catch', re: /(?<![.\w$])catch\s*(?:\(\s*[^)]*\))?\s*\{(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}/g },
    { id: 'void_catch', re: /(?<![.\w$])catch\s*\(\s*([\w$]+)\s*\)\s*\{\s*void\s+\1\s*;?\s*\}/g },
    { id: 'catch_value', re: new RegExp(`${ARROW_HEAD}${VALUE}\\s*\\)`, 'g') },
    { id: 'console', re: /(?<![\w$])(?:globalThis\.)?console\s*(?:\.|\[)/g },
  ]
  const names = helpers.filter((h) => /^[\w$.]+$/.test(h))
  if (names.length) out.push({ id: 'catch_helper', re: new RegExp(`\\.catch\\(\\s*(?:${names.map(esc).join('|')})\\s*\\)`, 'g') })
  return out
}

const count = (re, text) => (String(text || '').match(re) || []).length

// Patterns that appear more often in `after` than in `before` (new code only).
// Returns [{ id, sample }].
export function scanAdded(before, after, helpers = []) {
  const hits = []
  for (const p of patterns(helpers)) {
    const n = count(p.re, after) - count(p.re, before)
    if (n <= 0) continue
    p.re.lastIndex = 0
    const m = p.re.exec(String(after))
    hits.push({ id: p.id, count: n, sample: m ? m[0].replace(/\s+/g, ' ').slice(0, 60) : '' })
  }
  return hits
}
