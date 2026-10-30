// Handoff file: progress.md holds the current state only (rewritten every
// wave, target max_lines lines); finished content goes to monthly archive
// files under archive_dir. Session-start excerpt, a stale check that keeps a
// turn from ending when real work is newer than the file, and the archive and
// migration steps used by `wb-waves handoff`.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const DEFAULT_MAX_LINES = 300
export const DEFAULT_ARCHIVE_DIR = 'docs/progress-archive'
const WHOLE_CHARS = 9000

const git = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

// Handoff settings with defaults (personal.handoff).
export function handoffSettings(h = {}) {
  return {
    file: h.file || 'progress.md',
    maxLines: h.max_lines ?? DEFAULT_MAX_LINES,
    archiveDir: (h.archive_dir || DEFAULT_ARCHIVE_DIR).replace(/\/+$/, ''),
  }
}

export const countLines = (text) => (text ? text.replace(/\n$/, '').split('\n').length : 0)

// A current-state file (at most maxLines lines) is shown whole, up to 9,000
// characters. A larger file is a legacy accumulated one: header + newest
// section (up to the second "## " heading), at most 200 lines / 12 KB.
export function excerpt(text, { maxLines = DEFAULT_MAX_LINES } = {}) {
  if (countLines(text) <= maxLines) {
    if (text.length <= WHOLE_CHARS) return text.replace(/\n+$/, '')
    return `${text.slice(0, WHOLE_CHARS).replace(/\n[^\n]*$/, '')}\n…`
  }
  const out = []
  let n = 0
  for (const line of text.split('\n')) {
    if (/^## /.test(line)) n++
    if (n === 2) break
    out.push(line)
  }
  let s = out.join('\n')
  while (Buffer.byteLength(s) > 12288) s = s.slice(0, Math.floor(s.length * 0.9))
  return s.split('\n').slice(0, 200).join('\n')
}

// Short form for the session start (personal.handoff.inject = "summary"): the
// part before the second "## " heading, at most 40 lines / 2,500 characters.
// The agent is told to read the whole file.
export function summary(text) {
  const out = []
  let n = 0
  for (const line of String(text || '').split('\n')) {
    if (/^## /.test(line)) n++
    if (n === 2 || out.length === 40) break
    out.push(line)
  }
  let s = out.join('\n').replace(/\n+$/, '')
  if (s.length > 2500) s = `${s.slice(0, 2500).replace(/\n[^\n]*$/, '')}`
  return s.length < String(text || '').replace(/\n+$/, '').length ? `${s}\n…` : s
}

// Size of the handoff file against the line target.
export function sizeCheck(cwd, file, maxLines = DEFAULT_MAX_LINES) {
  const p = path.join(cwd, file)
  if (!fs.existsSync(p)) return { exists: false, lines: 0, max: maxLines, over: false }
  const lines = countLines(fs.readFileSync(p, 'utf8'))
  return { exists: true, lines, max: maxLines, over: lines > maxLines }
}

const mtimeSec = (f) => {
  try {
    return Math.floor(fs.statSync(f).mtimeMs / 1000)
  } catch {
    return 0
  }
}

// Newer than the handoff file: the last commit or a changed working file.
export function isStale(cwd, file) {
  const p = path.join(cwd, file)
  const pm = mtimeSec(p)
  const last = Number((git(cwd, ['log', '-1', '--format=%ct']) || '0').trim())
  if (last > pm) return true
  const st = git(cwd, ['status', '--porcelain']) || ''
  for (const line of st.split('\n')) {
    if (!line) continue
    let f = line.slice(3)
    if (f.includes(' -> ')) f = f.split(' -> ').pop()
    f = f.replace(/^"|"$/g, '')
    if (f === file) continue
    if (mtimeSec(path.join(cwd, f)) > pm) return true
  }
  return false
}

export const isGit = (cwd) => git(cwd, ['rev-parse', '--git-dir']) !== null

const pad = (n) => String(n).padStart(2, '0')
// Local date parts: ym 2026-10, ymd 2026-10-17, hm 18:30.
export function stamp(now = new Date()) {
  const d = new Date(now)
  const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  return { ym, ymd: `${ym}-${pad(d.getDate())}`, hm: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

// Push headings down so the shallowest one becomes level 3 and the body sits
// under its dated "## " section. Lines inside code fences stay as they are.
export function demoteHeadings(body) {
  const lines = body.split('\n')
  let fence = false
  let min = 7
  const isHead = []
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    const m = !fence && /^(#{1,6}) /.exec(l)
    isHead.push(!!m)
    if (m) min = Math.min(min, m[1].length)
  }
  const shift = min <= 6 ? Math.max(0, 3 - min) : 0
  if (!shift) return body
  return lines.map((l, i) => (isHead[i] ? '#'.repeat(Math.min(6, /^#+/.exec(l)[0].length + shift)) + l.replace(/^#+/, '') : l)).join('\n')
}

// Append a dated section to <archiveDir>/progress-<YYYY-MM>.md. The folder and
// file are created when missing. Returns the archive path relative to cwd.
export function appendArchive({ cwd, archiveDir = DEFAULT_ARCHIVE_DIR, title, body, now = new Date() }) {
  const s = stamp(now)
  const dir = path.join(cwd, archiveDir)
  fs.mkdirSync(dir, { recursive: true })
  const f = path.join(dir, `progress-${s.ym}.md`)
  const head = fs.existsSync(f) ? '' : `# progress archive ${s.ym}\n`
  const text = demoteHeadings(String(body || '').replace(/\s+$/, ''))
  fs.appendFileSync(f, `${head}\n## ${s.ymd} ${s.hm} — ${String(title || '').trim() || '-'}\n\n${text}\n`)
  return path.relative(cwd, f)
}

// Append the whole current handoff file as one archive section. The handoff
// file itself is left as it is; the caller rewrites it as the current state.
export function archiveCurrent({ cwd, file = 'progress.md', archiveDir = DEFAULT_ARCHIVE_DIR, title, now = new Date() }) {
  const p = path.join(cwd, file)
  if (!fs.existsSync(p)) return { archived: false, reason: 'missing' }
  const body = fs.readFileSync(p, 'utf8')
  if (!body.trim()) return { archived: false, reason: 'empty' }
  return { archived: true, to: appendArchive({ cwd, archiveDir, title, body, now }), lines: countLines(body) }
}

// Fresh current-state file. t is a translator; the template is locale text.
export function skeleton(t, { archiveDir = DEFAULT_ARCHIVE_DIR, until = null, now = new Date() } = {}) {
  const s = stamp(now)
  const prev = until ? t('handoff.template.until', { path: until }) : ''
  return `${t('handoff.template', { date: `${s.ymd} ${s.hm}`, archive: archiveDir, prev })}\n`
}

// A handoff file over maxLines is an accumulated one: move it whole to
// <archiveDir>/progress-until-<YYYY-MM-DD>.md (git mv when tracked) and write a
// fresh current-state skeleton in its place. force moves a smaller file too.
export function migrateLegacy({ cwd, file = 'progress.md', archiveDir = DEFAULT_ARCHIVE_DIR, maxLines = DEFAULT_MAX_LINES, t, now = new Date(), force = false }) {
  const p = path.join(cwd, file)
  if (!fs.existsSync(p)) return { moved: false, reason: 'missing' }
  const lines = countLines(fs.readFileSync(p, 'utf8'))
  if (lines <= maxLines && !force) return { moved: false, reason: 'small', lines, max: maxLines }
  const s = stamp(now)
  const dir = path.join(cwd, archiveDir)
  fs.mkdirSync(dir, { recursive: true })
  let name = `progress-until-${s.ymd}.md`
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `progress-until-${s.ymd}-${i}.md`
  const to = path.join(dir, name)
  const rel = path.relative(cwd, to)
  const tracked = isGit(cwd) && git(cwd, ['ls-files', '--error-unmatch', '--', file]) !== null
  if (!(tracked && git(cwd, ['mv', '--', file, rel]) !== null)) fs.renameSync(p, to)
  fs.writeFileSync(p, skeleton(t, { archiveDir, until: rel, now }))
  return { moved: true, to: rel, lines, max: maxLines, git: tracked }
}
