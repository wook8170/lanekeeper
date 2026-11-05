// Rule catalog (rules/catalog.json): every rule with why, where it is enforced and
// how to recover. Message codes in locales (e.g. safety.git.lane_commit) map back to
// the rule that produced them, so a blocked user can read the reason in plain words.
import fs from 'node:fs'
import path from 'node:path'
import { PLUGIN_ROOT } from './config.mjs'

export const GROUPS = ['git', 'process', 'safety', 'dispatch', 'session', 'quality', 'planned']

export function loadCatalog(root = PLUGIN_ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, 'rules', 'catalog.json'), 'utf8')).rules
}

const codeMatches = (pattern, code) => (pattern.endsWith('*') ? code.startsWith(pattern.slice(0, -1)) : pattern === code)

// Rule that owns a message code. Exact codes win over wildcards.
export function ruleForCode(rules, code) {
  let wild = null
  for (const r of rules) {
    for (const e of r.enforced) {
      for (const c of e.codes || []) {
        if (c === code) return r
        if (!wild && codeMatches(c, code)) wild = r
      }
    }
  }
  return wild
}

export const findRule = (rules, id) => rules.find((r) => r.id === id) || null

const where = (e, t) => {
  if (e.kind === 'planned') return t('rules.where.planned', { lane: e.lane })
  if (e.kind === 'config') return t('rules.where.config', { key: e.key })
  return `\`${e.path}\``
}

// One rule as lines of plain text (used by `lanekeeper-rules show`, `lanekeeper-explain`).
export function describeRule(rule, lang, t) {
  const l = lang === 'ko' ? 'ko' : 'en'
  return [
    `${rule.id} — ${rule.title[l]}`,
    `  ${rule.rule[l]}`,
    `  ${t('rules.why')}: ${rule.why[l]}`,
    `  ${t('rules.where')}: ${rule.enforced.map((e) => where(e, t)).join(', ')}`,
    `  ${t('rules.recover')}: ${rule.recover[l]}`,
  ]
}

// Markdown catalog for one language (rules/catalog.<lang>.md is generated from this).
export function renderMarkdown(rules, lang, t) {
  const l = lang === 'ko' ? 'ko' : 'en'
  const out = [`# ${t('rules.md.title')}`, '', t('rules.md.intro'), '']
  for (const g of GROUPS) {
    const list = rules.filter((r) => r.group === g)
    if (!list.length) continue
    out.push(`## ${t(`rules.group.${g}`)}`, '')
    for (const r of list) {
      out.push(`### ${r.title[l]} (\`${r.id}\`)`, '', r.rule[l], '')
      out.push(`- ${t('rules.why')}: ${r.why[l]}`)
      out.push(`- ${t('rules.where')}: ${r.enforced.map((e) => where(e, t)).join(', ')}`)
      out.push(`- ${t('rules.recover')}: ${r.recover[l]}`, '')
    }
  }
  return `${out.join('\n').trimEnd()}\n`
}

// Group order of the user manual: the order a new user usually meets the rules.
export const MANUAL_ORDER = ['git', 'safety', 'process', 'dispatch', 'session', 'quality', 'planned']

// docs/<lang>/04-rules.md: the catalog in reading order, with the message codes
// and settings of each rule pulled out of its enforcement list.
export function renderManual(rules, lang, t) {
  const l = lang === 'ko' ? 'ko' : 'en'
  const ordered = MANUAL_ORDER.flatMap((g) => rules.filter((r) => r.group === g))
  const no = new Map(ordered.map((r, i) => [r.id, i + 1]))
  const out = [`# ${t('rules.manual.title')}`, '']
  out.push(t('rules.manual.intro', { count: rules.length }), '')
  out.push(t('rules.manual.verdicts'), '', t('rules.manual.message'), '', t('rules.manual.order'), '')
  out.push(`> ${t('rules.manual.generated')}`, '')
  out.push(`## ${t('rules.manual.summary')}`, '')
  out.push(`| ${t('rules.manual.col.no')} | ${t('rules.manual.col.rule')} | id | ${t('rules.manual.col.group')} |`, '|---|---|---|---|')
  for (const r of ordered) out.push(`| ${no.get(r.id)} | ${r.title[l]} | \`${r.id}\` | ${t(`rules.group.${r.group}`)} |`)
  out.push('')
  for (const g of MANUAL_ORDER) {
    const list = ordered.filter((r) => r.group === g)
    if (!list.length) continue
    out.push(`## ${t(`rules.group.${g}`)}`, '', t(`rules.manual.group.${g}`), '')
    for (const r of list) {
      const codes = [...new Set(r.enforced.flatMap((e) => e.codes || []))]
      const settings = r.enforced.filter((e) => e.kind === 'config').map((e) => e.key)
      out.push(`### ${no.get(r.id)}. ${r.title[l]} (\`${r.id}\`)`, '')
      out.push(`- ${t('rules.manual.blocks')}: ${r.rule[l]}`)
      out.push(`- ${t('rules.why')}: ${r.why[l]}`)
      out.push(`- ${t('rules.recover')}: ${r.recover[l]}`)
      if (codes.length) out.push(`- ${t('rules.manual.codes')}: ${codes.map((c) => `\`${c}\``).join(', ')}`)
      if (settings.length) out.push(`- ${t('rules.manual.settings')}: ${settings.map((k) => `\`${k}\``).join(', ')}`)
      out.push(`- ${t('rules.where')}: ${r.enforced.filter((e) => e.kind !== 'config').map((e) => where(e, t)).join(', ') || '-'}`, '')
    }
  }
  return `${out.join('\n').trimEnd()}\n`
}

// Problems in the catalog: missing text, enforcement targets that do not exist,
// message codes without a locale entry.
export function validateCatalog(rules, { root = PLUGIN_ROOT, messages }) {
  const problems = []
  const ids = new Set()
  for (const r of rules) {
    const p = (m) => problems.push(`${r.id}: ${m}`)
    if (ids.has(r.id)) p('duplicate id')
    ids.add(r.id)
    if (!GROUPS.includes(r.group)) p(`unknown group ${r.group}`)
    for (const k of ['title', 'rule', 'why', 'recover']) for (const l of ['ko', 'en']) if (!r[k]?.[l]?.trim()) p(`${k}.${l} empty`)
    if (!r.enforced?.length) p('no enforcement place')
    for (const e of r.enforced || []) {
      if (e.kind === 'planned') {
        if (!e.lane) p('planned without lane')
        continue
      }
      if (e.kind === 'config') {
        if (!e.key) p('config without key')
        continue
      }
      if (!e.path || !fs.existsSync(path.join(root, e.path))) p(`missing path ${e.path}`)
      for (const c of e.codes || []) {
        if (c.endsWith('*')) {
          if (!Object.keys(messages).some((k) => k.startsWith(c.slice(0, -1)))) p(`no message for ${c}`)
        } else if (!Object.keys(messages).some((k) => k === c || k.startsWith(`${c}.`))) p(`no message for ${c}`)
      }
    }
  }
  return problems
}
