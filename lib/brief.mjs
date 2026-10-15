// Brief (lane instruction sheet) parsing and checking.
//
// A brief starts with a marker line:
//   <!-- wb-brief v1 type=impl-multi lane=l3 template=impl implementer=opus -->
// and carries six required sections (heading names in ko or en):
//   goal · scope · forbidden · test rules · report location · commit rules
// plus three required statements anywhere in the text:
//   headless browsers only · no full test suite (main runs it once) · worktree base commit
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const MARKER_RE = /<!--\s*wb-brief\s+v(\d+)\b([^>]*?)-->/

export const SECTIONS = {
  goal: /^(목표|goal|objective)/i,
  scope: /^(범위|scope)/i,
  forbidden: /^(금지|do\s*not|don'?t|forbidden|not\s+allowed)/i,
  tests: /^(시험|테스트|tests?\b|testing)/i,
  report: /^(보고|report)/i,
  commit: /^(커밋|commit)/i,
}
export const SECTION_ORDER = Object.keys(SECTIONS)

const HEADLESS_RE = /헤드리스|headless/i
const SUITE_RE = /(전체|전\s*패키지)\s*(시험\s*|테스트\s*)?(스위트|suite)|full[- ]?(test[- ])?suite/i
const NEGATION_RE = /금지|않|말\s*것|하지\s*마|\bno\b|\bnot\b|never|don'?t|forbidden|prohibit/i
const BASE_LINE_RE = /\bHEAD\b|기준|\bbase\b/i
const SHA_RE = /\b[0-9a-f]{7,40}\b/
const PLACEHOLDER_RE = /\{\{\s*([\w.-]+)\s*\}\}/

export function parseMarker(text) {
  const m = String(text || '').match(MARKER_RE)
  if (!m) return null
  const attrs = {}
  for (const kv of m[2].trim().split(/\s+/).filter(Boolean)) {
    const i = kv.indexOf('=')
    if (i > 0) attrs[kv.slice(0, i)] = kv.slice(i + 1)
  }
  return { version: Number(m[1]), attrs }
}

// Headings with their body text. Body runs to the next heading of the same or a higher level.
export function sections(text) {
  const lines = String(text || '').split('\n')
  const heads = []
  lines.forEach((l, i) => {
    const m = l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) heads.push({ level: m[1].length, title: m[2].replace(/[*_`]/g, '').trim(), line: i })
  })
  return heads.map((h, idx) => {
    let end = lines.length
    for (const n of heads.slice(idx + 1)) {
      if (n.level <= h.level) {
        end = n.line
        break
      }
    }
    const body = lines.slice(h.line + 1, end).join('\n').replace(/<!--[\s\S]*?-->/g, '').trim()
    return { ...h, body }
  })
}

// Check brief text. Returns { ok, marker, missing: [item…] } where item is one of
// SECTION_ORDER, or 'marker' · 'placeholder' · 'headless' · 'full_suite' · 'base'.
export function checkBrief(text) {
  const missing = []
  const marker = parseMarker(text)
  if (!marker) missing.push('marker')
  const secs = sections(text)
  for (const name of SECTION_ORDER) {
    const s = secs.find((x) => SECTIONS[name].test(x.title))
    if (!s || !s.body.replace(/^[-*\s]+$/gm, '').trim()) missing.push(name)
  }
  const lines = String(text || '').split('\n')
  if (!HEADLESS_RE.test(text)) missing.push('headless')
  if (!lines.some((l) => SUITE_RE.test(l) && NEGATION_RE.test(l))) missing.push('full_suite')
  const baseAttr = marker?.attrs?.base && SHA_RE.test(marker.attrs.base)
  if (!baseAttr && !lines.some((l) => BASE_LINE_RE.test(l) && SHA_RE.test(l.replace(MARKER_RE, '')))) missing.push('base')
  const ph = String(text || '').match(PLACEHOLDER_RE)
  return { ok: missing.length === 0 && !ph, marker, missing, placeholder: ph ? ph[1] : null }
}

const PATH_RE = /(?:^|[\s`'"(<\[])((?:~\/|\.{1,2}\/|\/)?[\w.@+~-]+(?:\/[\w.@+~-]+)*\.md)\b/g

function candidatePaths(text) {
  const out = []
  for (const m of String(text || '').matchAll(PATH_RE)) out.push(m[1])
  return out
}

function resolvePath(p, bases, home) {
  if (p.startsWith('~/')) return [path.join(home, p.slice(2))]
  if (path.isAbsolute(p)) return [p]
  return bases.filter(Boolean).map((b) => path.resolve(b, p))
}

function readSmall(file) {
  try {
    const st = fs.statSync(file)
    if (!st.isFile() || st.size > 512 * 1024) return null
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

// Gather the brief behind a dispatch prompt: the prompt itself plus brief files it
// names (files with a marker, or under a folder called "briefs"), one more level
// deep for a shared common brief. Returns { text, files, marker }.
export function collectBrief(prompt, { cwd, projectRoot, home = os.homedir(), maxFiles = 8 } = {}) {
  const texts = [String(prompt || '')]
  const files = []
  const seen = new Set()
  let frontier = [String(prompt || '')]
  for (let depth = 0; depth < 2 && files.length < maxFiles; depth++) {
    const next = []
    for (const t of frontier) {
      for (const p of candidatePaths(t)) {
        for (const abs of resolvePath(p, [cwd, projectRoot], home)) {
          if (seen.has(abs) || files.length >= maxFiles) continue
          seen.add(abs)
          const body = readSmall(abs)
          if (body === null) continue
          const inBriefs = abs.split(path.sep).includes('briefs')
          if (!inBriefs && !MARKER_RE.test(body)) continue
          files.push(abs)
          texts.push(body)
          next.push(body)
          break
        }
      }
    }
    frontier = next
  }
  const text = texts.join('\n\n')
  // The marker of the dispatched brief: the prompt's own, else the first file's.
  const marker = parseMarker(prompt) || texts.slice(1).map(parseMarker).find(Boolean) || null
  return { text, files, marker }
}
