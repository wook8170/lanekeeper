// Readable code (project.code_standards.readability): settings, the brief lines and the
// patterns the warn hook looks for (history markers in comments, a missing header
// comment on a new file, a function with too many parameters, a screen component with
// too many props).
// Used by bin/lanekeeper-style, lib/review.mjs and hooks/scripts/codestd/warn.mjs.
// Read lib/code-standards.mjs first: this file adds to the same settings section.
import { getPath } from './config.mjs'

export const DEFAULTS = Object.freeze({ enabled: true, doc: '', max_params: 7, max_props: 12, review_tasks: 3, fresh_eyes_review: true })

const RULE_KEYS = ['judge', 'split', 'one_place', 'names', 'comments', 'readme', 'check']

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max

export function readability(config) {
  const r = getPath(config, 'project.code_standards.readability') || {}
  return {
    enabled: r.enabled !== false,
    doc: typeof r.doc === 'string' ? r.doc.trim() : DEFAULTS.doc,
    max_params: isInt(r.max_params, 1, 50) ? r.max_params : DEFAULTS.max_params,
    max_props: isInt(r.max_props, 1, 100) ? r.max_props : DEFAULTS.max_props,
    review_tasks: isInt(r.review_tasks, 1, 10) ? r.review_tasks : DEFAULTS.review_tasks,
    fresh_eyes_review: r.fresh_eyes_review !== false,
  }
}

// Text for {{readability}}: a head line and the seven rules as sub-items, or '' when off.
export function briefText(config, t) {
  const rd = readability(config)
  if (!rd.enabled) return ''
  const head = rd.doc ? t('readable.brief.head_doc', { doc: rd.doc }) : t('readable.brief.head')
  const vars = { max: rd.max_params, props: rd.max_props, tasks: rd.review_tasks }
  return [head, ...RULE_KEYS.map((k) => `  - ${t(`readable.brief.${k}`, vars)}`)].join('\n')
}

// ---- warn hook patterns -----------------------------------------------------------

// Source with string and comment contents blanked (same length), plus the comment texts.
export function splitSource(text) {
  const src = String(text || '')
  let code = ''
  const comments = []
  let i = 0
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    let end = -1
    if (two === '//' && (i === 0 || /[\s;{}(),]/.test(src[i - 1]))) end = lineEnd(src, i)
    else if (two === '/*') end = closeAt(src, i + 2, '*/')
    else if (src.startsWith('<!--', i)) end = closeAt(src, i + 4, '-->')
    if (end >= 0) {
      comments.push(src.slice(i, end))
      code += blank(src.slice(i, end))
      i = end
      continue
    }
    if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
      const stop = quoteEnd(src, i)
      code += src[i] + blank(src.slice(i + 1, stop - 1)) + (stop - 1 > i ? src[stop - 1] : '')
      i = stop
      continue
    }
    code += src[i]
    i++
  }
  return { code, comments }
}

const blank = (s) => s.replace(/[^\n]/g, ' ')
const lineEnd = (s, i) => (s.indexOf('\n', i) < 0 ? s.length : s.indexOf('\n', i))
const closeAt = (s, from, close) => (s.indexOf(close, from) < 0 ? s.length : s.indexOf(close, from) + close.length)

function quoteEnd(src, start) {
  const q = src[start]
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') i++
    else if (src[i] === q) return i + 1
    else if (src[i] === '\n' && q !== '`') return i
  }
  return src.length
}

// Each pattern is checked against comment text only.
export const HISTORY_RES = [
  /(?<![\w.])v?\d+\.\d+\.\d+(?![\w.])(?=\s*(?:—|–|-\s))/g,
  /(?<![\w-])(?!(?:UTF|ISO|SHA|AES|RSA|RFC|CVE|ES|HTTP|TLS|IEC|EN|KS|X|COVID)-)[A-Z]{1,5}-\d{1,5}(?![\w-])/g,
  /(?<![\w.])[A-Z]{1,2}\d{1,3}[a-z]?:(?=\s|$)/gm,
  /(?:#L\d+|(?<![\w#])L\d{3,})(?:\s*-\s*L?\d+)?(?!\w)/g,
  /\b(?:PR|issue|이슈)\s*#\d+|\(#\d+\)/g,
]

export function historyMarkers(text) {
  const out = []
  for (const comment of splitSource(text).comments) {
    for (const re of HISTORY_RES) out.push(...(comment.match(re) || []))
  }
  return out
}

const SKIP_LINE_RE = /^(?:#!.*|['"]use [\w ]+['"];?|<script\b[^>]*>|<template\b[^>]*>?)$/
const COMMENT_START_RE = /^(?:\/\/|\/\*|<!--)/

const startsWithComment = (lines) => COMMENT_START_RE.test(lines.find((l) => !SKIP_LINE_RE.test(l)) || '')

// A new file of five or more non-empty lines starts with a comment (after a shebang,
// a directive, or the opening script or template tag). A .vue or .svelte file may
// instead put it at the top of its script block.
export function headerMissing(text, file = '') {
  if (/\.d\.[cm]?ts$/i.test(file)) return false
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 5 || startsWithComment(lines)) return false
  const script = lines.findIndex((l) => /^<script\b/.test(l))
  return !(/\.(?:vue|svelte)$/i.test(file) && script >= 0 && startsWithComment(lines.slice(script)))
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'new', 'super', 'with', 'do', 'else', 'yield', 'import', 'in', 'of', 'void', 'delete', 'case', 'throw'])

// Index after the parenthesis that closes the one at `open`, or -1.
function closeParen(code, open) {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')' && --depth === 0) return i + 1
  }
  return -1
}

// Top-level parts of a list, split on commas outside (), [], {} and <>.
export function topLevelParts(inner) {
  const parts = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '=' && inner[i + 1] === '>') {
      cur += '=>'
      i++
      continue
    }
    if ('([{<'.includes(ch)) depth++
    else if (')]}>'.includes(ch)) depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

// The name of the function whose parameter list opens at `open`, or null for a call,
// a condition or a function type (`cb: (a, b) => void`, `type F = (a) => b`).
function signatureName(code, open, close) {
  const before = code.slice(Math.max(0, open - 120), open)
  const after = code.slice(close, close + 200)
  const fn = before.match(/\bfunction\b\s*\*?\s*([\w$]*)\s*(?:<[^()]*>)?\s*$/)
  if (fn) return fn[1] || '(anonymous)'
  if (/^\s*(?::[^=;{}]+)?=>/.test(after)) {
    if (/(?:[:<|&]|\btype\s+[\w$]+\s*(?:<[^()]*>)?\s*=)\s*$/.test(before)) return null
    return (before.match(/([\w$]+)\s*=\s*(?:(?:React\.)?(?:memo|forwardRef)\s*\(\s*)?(?:async\s*)?(?:<[^()]*>)?\s*$/) || [])[1] || '(arrow)'
  }
  const method = before.match(/(?:^|[\n;{}])\s*(?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*\*?([\w$]+)\s*(?:<[^()]*>)?\s*$/)
  if (method && !KEYWORDS.has(method[1]) && /^\s*(?::[^;{}=]+)?\{/.test(after)) return method[1]
  return null
}

// Text of the block that starts at the first `{` at or after `from` (braces included), or ''.
function blockAt(code, from) {
  const open = code.indexOf('{', from)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return code.slice(open, i + 1)
  }
  return ''
}

const JSX_RE = /^\(?\s*<[A-Za-z>]/
const RETURN_JSX_RE = /\breturn\s*\(?\s*<[A-Za-z>]/

// A React function component: a name that starts with a capital letter and a body that returns JSX.
function isComponent(code, name, close) {
  if (!/^[A-Z]/.test(name)) return false
  const rest = code.slice(close).replace(/^\s*(?::[^=;{}]+)?/, '')
  if (rest.startsWith('=>')) {
    const expr = rest.slice(2).trimStart()
    return expr.startsWith('{') ? RETURN_JSX_RE.test(blockAt(expr, 0)) : JSX_RE.test(expr)
  }
  return RETURN_JSX_RE.test(blockAt(code, close))
}

// Fields of a type literal or object body (without the outer braces); `;`, `,` and new lines separate.
const fieldCount = (body) => topLevelParts(body.replace(/[;\n]/g, ',')).length

// Fields of a destructured object parameter, or -1 when the parameter is not one.
function destructuredFields(param) {
  if (!param.startsWith('{')) return -1
  return topLevelParts(param.slice(1, param.lastIndexOf('}'))).length
}

// Functions with more than `max` parameters or fields of one destructured input object.
// A React component's props are compared with `maxProps` instead.
// [{ name, count, kind: 'params' | 'fields' | 'props' }]
export function longSignatures(text, max = DEFAULTS.max_params, maxProps = DEFAULTS.max_props) {
  const { code } = splitSource(text)
  const out = []
  for (let open = code.indexOf('('); open >= 0; open = code.indexOf('(', open + 1)) {
    const close = closeParen(code, open)
    if (close < 0) break
    const name = signatureName(code, open, close)
    if (!name) continue
    const params = topLevelParts(code.slice(open + 1, close - 1))
    const fields = params.length === 1 ? destructuredFields(params[0]) : -1
    if (params.length > max) out.push({ name, count: params.length, kind: 'params' })
    else if (fields >= 0 && isComponent(code, name, close)) {
      if (fields > maxProps) out.push({ name, count: fields, kind: 'props' })
    } else if (fields > max) out.push({ name, count: fields, kind: 'fields' })
  }
  return out
}

// Vue `defineProps` with more than `maxProps` props: a type literal, a named interface
// or type in the same file, a runtime object or an array of names. [{ name, count, kind }]
export function longDefineProps(text, maxProps = DEFAULTS.max_props) {
  const { code } = splitSource(text)
  const out = []
  for (const m of code.matchAll(/\bdefineProps\s*(?:<\s*([\w$]+)?\s*)?/g)) {
    const at = m.index + m[0].length
    let count = -1
    if (m[1]) {
      const decl = new RegExp(String.raw`\b(?:interface\s+${m[1]}\b[^{]*|type\s+${m[1]}\s*=\s*)\{`).exec(code)
      if (decl) count = fieldCount(blockAt(code, decl.index + decl[0].length - 1).slice(1, -1))
    } else if (code[at] === '{') count = fieldCount(blockAt(code, at).slice(1, -1))
    else if (code[at] === '(') {
      const arg = code.slice(at + 1).trimStart()
      if (arg.startsWith('{')) count = fieldCount(blockAt(arg, 0).slice(1, -1))
      else if (arg.startsWith('[')) count = topLevelParts(arg.slice(1, arg.indexOf(']'))).length
    }
    if (count > maxProps) out.push({ name: 'defineProps', count, kind: 'props' })
  }
  return out
}

// Readability findings that appear more often in `after` than in `before` (new code only).
// Returns [{ id, count, sample }].
export function scanReadable(before, after, { maxParams = DEFAULTS.max_params, maxProps = DEFAULTS.max_props, isNew = false, file = '' } = {}) {
  const hits = []
  const marks = historyMarkers(after)
  const gained = marks.length - historyMarkers(before).length
  if (gained > 0) hits.push({ id: 'history', count: gained, sample: marks.slice(0, 3).join(', ') })
  if (isNew && headerMissing(after, file)) hits.push({ id: 'header', count: 1, sample: '' })
  const inputs = (text) => [...longSignatures(text, maxParams, maxProps), ...longDefineProps(text, maxProps)]
  const now = inputs(after)
  const was = inputs(before)
  for (const id of ['params', 'props']) {
    const kinds = id === 'props' ? ['props'] : ['params', 'fields']
    const found = now.filter((x) => kinds.includes(x.kind))
    const grown = found.length - was.filter((x) => kinds.includes(x.kind)).length
    if (grown > 0) hits.push({ id, count: grown, sample: found.map((x) => `${x.name}: ${x.count}`).slice(0, 3).join(', ') })
  }
  return hits
}
