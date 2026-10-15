// Shared helpers for the safety hooks: verdicts, globs, paths, messages.
import fs from 'node:fs'
import path from 'node:path'
import { translator } from '../../../lib/i18n.mjs'

export const ALLOW = 'allow'
export const ASK = 'ask'
export const DENY = 'deny'
const RANK = { allow: 0, ask: 1, deny: 2 }

// A verdict is { decision, code, vars, consume? }. Several verdicts combine to
// the strictest one; every non-allow reason is kept for the message.
export const allow = (extra = {}) => ({ decision: ALLOW, ...extra })
export const ask = (code, vars = {}) => ({ decision: ASK, code, vars })
export const deny = (code, vars = {}) => ({ decision: DENY, code, vars })

export function combine(verdicts) {
  let decision = ALLOW
  const reasons = []
  const consume = []
  for (const v of verdicts.flat()) {
    if (!v) continue
    if (RANK[v.decision] > RANK[decision]) decision = v.decision
    if (v.decision !== ALLOW && v.code) reasons.push(v)
    if (v.consume) consume.push(v.consume)
  }
  return { decision, reasons: reasons.filter((r) => r.decision === decision), consume }
}

// Glob for branch names and paths. `**` crosses `/`; `*` does not unless
// wide is set (protected names are matched wide, so release/* covers
// release/1.2/hotfix as well).
export function globToRe(glob, { wide = false } = {}) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*'
      i++
      if (glob[i + 1] === '/') i++
    } else if (c === '*') re += wide ? '.*' : '[^/]*'
    else if (c === '?') re += wide ? '.' : '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

export const matchAny = (name, globs, opts) => !!name && (globs || []).some((g) => globToRe(g, opts).test(name))

export function inside(child, parent) {
  if (!child || !parent) return false
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function realish(p) {
  // realpath of the longest existing prefix, so /tmp and /private/tmp compare equal
  let cur = p
  const tail = []
  while (cur && cur !== path.dirname(cur)) {
    try {
      return path.join(fs.realpathSync(cur), ...tail.reverse())
    } catch {
      tail.push(path.basename(cur))
      cur = path.dirname(cur)
    }
  }
  return p
}

// Block message in three parts: why · how to fix · where to ask.
export function formatReasons(lang, reasons) {
  const t = translator(lang)
  const lines = []
  const seen = new Set()
  for (const r of reasons) {
    const key = `${r.code}|${JSON.stringify(r.vars)}`
    if (seen.has(key)) continue
    seen.add(key)
    const head = r.decision === DENY ? t('safety.blocked') : t('safety.confirm')
    lines.push(`${head}: ${t(`safety.${r.code}.why`, r.vars)}`)
    lines.push(`${t('safety.fix')}: ${t(`safety.${r.code}.fix`, r.vars)}`)
  }
  lines.push(`${t('safety.help')}: ${t('safety.where')}`)
  return `[wb] ${lines.join('\n')}`
}
