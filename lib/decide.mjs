// /wb:decide support: owner decisions as files (project.paths.decisions).
// A decision file starts with a marker line and keeps its answer between two markers,
// so `wb-decide answer` can fill it without parsing prose.
//   <!-- wb-decision v1 status=pending -->
//   ... <!-- wb:decision --> text <!-- /wb:decision -->
import fs from 'node:fs'
import path from 'node:path'
import { PLUGIN_ROOT } from './config.mjs'

export const MARKER_RE = /<!--\s*wb-decision\s+v1\s+status=(pending|decided)\s*-->/
const BODY_RE = /(<!-- wb:decision -->)([\s\S]*?)(<!-- \/wb:decision -->)/

export const slugOk = (s) => /^[a-z0-9ㄱ-힝][\wㄱ-힝-]{0,60}$/i.test(String(s))

export function today(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10)
}

export function decisionPath(root, pattern, { date, slug }) {
  return path.resolve(root, String(pattern || 'docs/decisions/{date}-{slug}.md').replace('{date}', date).replace('{slug}', slug))
}

const template = (lang) => fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'decision', `${lang === 'ko' ? 'ko' : 'en'}.md`), 'utf8')

export function render({ lang, title, question, options, recommend, date }) {
  const opts = options.map((o) => `- ${o.key}. ${o.text}`).join('\n')
  const rec = recommend ? options.find((o) => o.key === recommend) : null
  return template(lang)
    .replace('{{title}}', title)
    .replace('{{date}}', date)
    .replace('{{question}}', question)
    .replace('{{options}}', opts)
    .replace('{{recommend}}', rec ? `${rec.key}. ${rec.text}` : '-')
}

export function parse(text) {
  const m = MARKER_RE.exec(text)
  if (!m) return null
  const title = /^#\s+(.+)$/m.exec(text)?.[1] || ''
  const body = BODY_RE.exec(text)?.[2].trim() || ''
  return { status: m[1], title, body }
}

export function answer(text, { choice, note, date, lang }) {
  if (!MARKER_RE.test(text)) return null
  const label = lang === 'ko' ? { date: '결정일', note: '이유' } : { date: 'Decided', note: 'Reason' }
  const body = [`${choice}`, '', `${label.date}: ${date}`, note ? `${label.note}: ${note}` : null].filter((x) => x !== null).join('\n')
  return text.replace(MARKER_RE, '<!-- wb-decision v1 status=decided -->').replace(BODY_RE, `$1\n${body}\n$3`)
}

export function list(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({ file: f, ...(parse(fs.readFileSync(path.join(dir, f), 'utf8')) || { status: null, title: '', body: '' }) }))
    .filter((d) => d.status)
}
