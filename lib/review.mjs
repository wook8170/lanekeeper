// Lane review (/wb:review-lane): nine mechanical checks on a lane's result and,
// when one fails, a return brief for the same lane.
//
// Items (design 4.3):
//   1 head      reported HEAD exists and has the integration HEAD as ancestor
//   2 report    report file exists, required fields filled, matches the returned message
//   3 guards    project guards pass (project.review.guards; none = skip)
//   4 prefail   the failure before the fix is recorded (skip when only docs changed)
//   5 scope     the diff stays inside the brief's owned files and avoids its forbidden files
//   6 captures  UI change: captures exist and the main session opened them
//   7 serving   web UI change: the served code carries the change marker
//   8 tests     lane: test results in the report / integration·final: committed result workbook
//   9 terms     `wb-check terms` did not grow; new terms are queued for /wb:decide
// Each item is { n, id, status: pass|fail|skip, code, vars }.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { PLUGIN_ROOT, getPath, stateDir } from './config.mjs'
import { sections, parseMarker } from './brief.mjs'
import { checkTestResults, resultPaths } from './testresults.mjs'
import { globToRe, expandBraces } from '../hooks/scripts/safety/common.mjs'
import * as W from './waves.mjs'

export const ITEMS = ['head', 'report', 'guards', 'prefail', 'scope', 'captures', 'serving', 'tests', 'terms']
export const REPORT_FIELDS = ['head', 'tests', 'remaining']

export function gitx(cwd, args, env = process.env) {
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return { status: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}
const gitOut = (cwd, args, env) => {
  const r = gitx(cwd, args, env)
  return r.status === 0 ? r.out : null
}

export function runShell(command, cwd, env = process.env) {
  const r = spawnSync('sh', ['-c', command], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60e3 })
  return { status: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}`.trim() }
}

// Run named guard commands; returns the names that failed.
export function runGuards(guards, cwd, env) {
  const failed = []
  for (const g of guards || []) {
    const r = runShell(g.command, cwd, env)
    if (r.status !== 0) failed.push({ name: g.name || g.command, out: r.out.split('\n').slice(-5).join('\n') })
  }
  return failed
}

const SHA_RE = /\b[0-9a-f]{7,40}\b/
const HEAD_LINE_RE = /HEAD|커밋|commit/i

// The SHA the report gives as the new HEAD: the first line that names HEAD and carries a SHA.
export function reportedHead(text) {
  for (const l of String(text || '').split('\n')) {
    if (!HEAD_LINE_RE.test(l)) continue
    const m = l.match(SHA_RE)
    if (m) return m[0]
  }
  return null
}

const PASS_RE = /(\d+)\s*(?:\/\s*\d+\s*)?(?:건|개|tests?)?\s*(?:모두\s*|전부\s*)?(?:통과|passed|passing|pass\b)/i
const FAIL_RE = /(?:실패|failed|failures?|fail)\s*[:=]?\s*(\d+)|(\d+)\s*(?:건|개|tests?)?\s*(?:실패|failed|failing)/i

export function passCount(text) {
  const m = String(text || '').match(PASS_RE)
  return m ? Number(m[1]) : null
}
export function failCount(text) {
  let max = 0
  let seen = false
  for (const l of String(text || '').split('\n')) {
    const m = l.match(FAIL_RE)
    if (!m) continue
    seen = true
    max = Math.max(max, Number(m[1] ?? m[2]))
  }
  return seen ? max : null
}

const FIELD_RE = {
  tests: /시험|테스트|\btests?\b|testing/i,
  remaining: /남은|한계|확인\s*필요|미확인|미해결|remaining|limit|open (issue|item|question)|follow[- ]?up|known issue/i,
}

export function reportFields(text, required = REPORT_FIELDS) {
  const missing = []
  for (const f of required) {
    if (f === 'head' ? !reportedHead(text) : !FIELD_RE[f].test(text)) missing.push(f)
  }
  return missing
}

const PREFAIL_RE = [
  /수정\s*전[^\n]*(실패|fail|red|빨강)/i,
  /(실패|fail)[^\n]*수정\s*전/i,
  /before (the )?(fix|change)[^\n]*(fail|red)/i,
  /fail(ed|s|ing)?[^\n]*before (the )?(fix|change)/i,
]
export const hasPrefail = (text) => PREFAIL_RE.some((re) => re.test(String(text || '')))

const IMG_RE = /(?:^|[\s`'"(<\[])((?:~\/|\.{1,2}\/|\/)?[\w.@+~-]+(?:\/[\w.@+~-]+)*\.(?:png|webp|jpe?g))\b/gi
export function capturePaths(text) {
  return [...new Set([...String(text || '').matchAll(IMG_RE)].map((m) => m[1]))]
}

// Path globs written in a brief: backtick tokens, else comma separated words after a colon.
function globsIn(line) {
  const ticks = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim())
  const raw = ticks.length ? ticks : (line.split(/[:：]/).slice(1).join(':') || '').split(/[,，、]\s*|\s+/)
  return raw
    .map((s) => s.replace(/^[-*\s]+|[\s.)]+$/g, ''))
    .filter((s) => s && /[/.*]/.test(s) && !/\s/.test(s) && !s.startsWith('{{'))
    .map((s) => (s.endsWith('/') ? `${s}**` : s))
}

const OWNED_RE = /소유\s*파일|owned files|files you own|소유 범위|owned paths/i
const FILES_RE = /파일|경로|files?|paths?/i

// { owned: [glob], forbidden: [glob] } from the brief's scope and forbidden sections.
export function briefScope(text) {
  const owned = []
  const forbidden = []
  for (const s of sections(text)) {
    const lines = s.body.split('\n')
    if (/^(범위|scope)/i.test(s.title)) for (const l of lines) if (OWNED_RE.test(l)) owned.push(...globsIn(l))
    if (/^(금지|do\s*not|don'?t|forbidden)/i.test(s.title)) for (const l of lines) if (FILES_RE.test(l) && /`/.test(l)) forbidden.push(...globsIn(l))
  }
  return { owned: [...new Set(owned)], forbidden: [...new Set(forbidden)] }
}

const matches = (file, globs) => globs.flatMap(expandBraces).some((g) => globToRe(g).test(file) || file.startsWith(g.replace(/\*\*$/, '')) && g.endsWith('**'))

const UI_EXT = /\.(tsx|jsx|vue|svelte|html|css|scss|less)$/i

export function isUiChange(files, config) {
  const globs = getPath(config, 'project.mockup.ui_globs') || []
  if (globs.length) return files.some((f) => matches(f, globs))
  return getPath(config, 'project.project_kind') === 'web-ui' && files.some((f) => UI_EXT.test(f))
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

// Default `wb-check terms` runner. Contract (L10): exit 0 = no growth over the baseline,
// exit 1 = grew, exit 2 = subcommand missing. With --json it prints
// { ok, new_terms: [..], queued: [..] }; every new term must be in queued.
export function defaultTermsRunner(cwd, env) {
  const r = spawnSync(path.join(PLUGIN_ROOT, 'bin', 'wb-check'), ['terms', '--json'], { cwd, env, encoding: 'utf8' })
  let json = null
  try {
    json = JSON.parse(r.stdout || 'null')
  } catch {
    /* plain output */
  }
  return { status: r.status ?? 1, json }
}

async function fetchText(url) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    return { ok: true, status: res.status, text: await res.text() }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * opts: {
 *   root        integration worktree (where the integration branch is checked out)
 *   laneDir     lane worktree (guards and terms run here; default root)
 *   head        lane HEAD (sha or ref; default: the HEAD named in the report)
 *   base        integration ref (default: HEAD of root)
 *   report      lane report file      returnText  the lane's returned message
 *   brief       brief file            scope       extra owned globs
 *   captures    capture files         capturesSeen  the main session opened every capture
 *   serveUrl, marker   served code and the text the change adds
 *   stage       lane | integration | final
 *   config, env, termsRunner
 * }
 */
export async function reviewLane(opts) {
  const { root, config, env = process.env } = opts
  const laneDir = opts.laneDir || root
  const items = []
  const add = (id, status, code, vars = {}) => items.push({ n: ITEMS.indexOf(id) + 1, id, status, code: `${id}.${code}`, vars })

  const reportText = opts.report ? readText(opts.report) : null
  const briefText = opts.brief ? readText(opts.brief) : null
  const marker = briefText ? parseMarker(briefText) : null

  // 1 head
  const baseRef = opts.base || 'HEAD'
  const base = gitOut(root, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], env)
  const headRef = opts.head || reportedHead(reportText)
  let head = null
  if (!headRef) add('head', 'fail', 'missing')
  else {
    head = gitOut(root, ['rev-parse', '--verify', '--quiet', `${headRef}^{commit}`], env)
    if (!head) add('head', 'fail', 'unknown', { head: headRef })
    else if (!base) add('head', 'fail', 'no_base', { base: baseRef })
    else if (gitx(root, ['merge-base', '--is-ancestor', base, head], env).status !== 0) add('head', 'fail', 'not_based', { head: head.slice(0, 12), base: base.slice(0, 12) })
    else add('head', 'pass', 'ok', { head: head.slice(0, 12), base: base.slice(0, 12) })
  }

  // 2 report
  if (reportText === null) add('report', 'fail', 'missing', { file: opts.report || '-' })
  else {
    const required = getPath(config, 'project.review.report_fields') || REPORT_FIELDS
    const missing = reportFields(reportText, required)
    const diffs = []
    const rh = reportedHead(reportText)
    if (opts.head && rh && head && !head.startsWith(rh)) diffs.push(`HEAD ${rh} ≠ ${String(opts.head).slice(0, 12)}`)
    if (opts.returnText) {
      const a = reportedHead(opts.returnText)
      if (a && rh && !a.startsWith(rh) && !rh.startsWith(a)) diffs.push(`HEAD ${rh} ≠ ${a}`)
      const p1 = passCount(reportText)
      const p2 = passCount(opts.returnText)
      if (p1 !== null && p2 !== null && p1 !== p2) diffs.push(`pass ${p1} ≠ ${p2}`)
    }
    if (missing.length) add('report', 'fail', 'fields', { fields: missing.join(', ') })
    else if (diffs.length) add('report', 'fail', 'differs', { diffs: diffs.join('; ') })
    else add('report', 'pass', 'ok', { file: path.basename(opts.report) })
  }

  // diff of the lane against the integration HEAD
  let files = []
  if (head && base) {
    const mb = gitOut(root, ['merge-base', base, head], env) || base
    files = (gitOut(root, ['diff', '--name-only', mb, head], env) || '').split('\n').filter(Boolean)
  }
  const codeChanged = files.some((f) => !/\.(md|txt)$/i.test(f))

  // 3 guards
  const guards = getPath(config, 'project.review.guards') || []
  if (!guards.length) add('guards', 'skip', 'none')
  else {
    const failed = runGuards(guards, laneDir, env)
    if (failed.length) add('guards', 'fail', 'fail', { names: failed.map((f) => f.name).join(', ') })
    else add('guards', 'pass', 'ok', { n: guards.length })
  }

  // 4 prefail
  const tpl = marker?.attrs?.template
  if (['research', 'docs', 'review', 'mockup'].includes(tpl) || (head && !codeChanged)) add('prefail', 'skip', 'na')
  else if (reportText && hasPrefail(reportText)) add('prefail', 'pass', 'ok')
  else add('prefail', 'fail', 'missing')

  // 5 scope
  const sc = briefText ? briefScope(briefText) : { owned: [], forbidden: [] }
  const owned = [...sc.owned, ...(opts.scope || [])]
  if (!owned.length && !sc.forbidden.length) add('scope', 'skip', 'no_brief')
  else if (!head) add('scope', 'fail', 'no_head')
  else {
    const outside = owned.length ? files.filter((f) => !matches(f, owned)) : []
    const hit = files.filter((f) => matches(f, sc.forbidden))
    const bad = [...new Set([...outside, ...hit])]
    if (bad.length) add('scope', 'fail', 'outside', { files: bad.slice(0, 10).join(', '), n: bad.length })
    else add('scope', 'pass', 'ok', { n: files.length })
  }

  // 6 captures
  const ui = isUiChange(files, config)
  const reportDir = opts.report ? path.dirname(path.resolve(opts.report)) : root
  const caps = [...new Set([...(opts.captures || []), ...capturePaths(reportText)])]
  const exists = (p) => {
    const home = env.HOME || ''
    const cand = p.startsWith('~/') ? [path.join(home, p.slice(2))] : path.isAbsolute(p) ? [p] : [laneDir, root, reportDir].map((b) => path.resolve(b, p))
    return cand.some((c) => fs.existsSync(c))
  }
  if (!caps.length && !ui) add('captures', 'skip', 'na')
  else if (!caps.length) add('captures', 'fail', 'none')
  else {
    const missing = caps.filter((c) => !exists(c))
    if (missing.length) add('captures', 'fail', 'missing', { files: missing.join(', ') })
    else if (!opts.capturesSeen) add('captures', 'fail', 'unseen', { n: caps.length })
    else add('captures', 'pass', 'ok', { n: caps.length })
  }

  // 7 serving
  if (!ui) add('serving', 'skip', 'na')
  else if (!opts.serveUrl || !opts.marker) add('serving', 'fail', 'unknown')
  else {
    const r = await fetchText(opts.serveUrl)
    if (!r.ok) add('serving', 'fail', 'unreachable', { url: opts.serveUrl, msg: r.error })
    else if (!r.text.includes(opts.marker)) add('serving', 'fail', 'stale', { url: opts.serveUrl, marker: opts.marker })
    else add('serving', 'pass', 'ok', { url: opts.serveUrl })
  }

  // 8 tests
  const stage = opts.stage || 'lane'
  if (stage === 'lane') {
    const p = passCount(reportText)
    const f = failCount(reportText)
    if (p === null) add('tests', 'fail', 'missing')
    else if (f) add('tests', 'fail', 'failing', { n: f })
    else add('tests', 'pass', 'ok', { n: p })
  } else {
    const r = checkTestResults(root, config, { requirePass: true })
    let differs = r.items.find((i) => i.id === 'head_differs')
    if (differs) {
      // committing the results after the run moves HEAD; that alone is not a different run
      const { resultsBase } = resultPaths(root, config)
      const changed = gitOut(root, ['diff', '--name-only', differs.vars.run, 'HEAD'], env)
      if (changed !== null && changed.split('\n').filter(Boolean).every((f) => path.resolve(root, f).startsWith(resultsBase + path.sep))) differs = null
    }
    if (!r.ok) add('tests', 'fail', 'workbook', { items: r.items.filter((i) => i.level === 'fail').map((i) => i.id).join(', ') })
    else if (differs) add('tests', 'fail', 'head_differs', differs.vars)
    else add('tests', 'pass', 'workbook_ok', { file: r.file })
  }

  // 9 terms
  const dict = getPath(config, 'project.glossary.terms_dict')
  if (!dict || !fs.existsSync(path.resolve(laneDir, dict))) add('terms', 'skip', 'no_dict')
  else {
    const r = (opts.termsRunner || defaultTermsRunner)(laneDir, env)
    if (r.status === 2) add('terms', 'skip', 'unavailable')
    else if (r.status !== 0) add('terms', 'fail', 'grew')
    else {
      const queued = new Set(r.json?.queued || [])
      const loose = (r.json?.new_terms || []).filter((x) => !queued.has(x))
      if (loose.length) add('terms', 'fail', 'not_queued', { terms: loose.slice(0, 10).join(', ') })
      else add('terms', 'pass', 'ok')
    }
  }

  items.sort((a, b) => a.n - b.n)
  return { verdict: items.some((i) => i.status === 'fail') ? 'fail' : 'pass', items, head, base, files }
}

// ---- return brief -------------------------------------------------------

export function fillTemplate(lang, vars) {
  const l = lang === 'ko' ? 'ko' : 'en'
  const tpl = fs.readFileSync(path.join(PLUGIN_ROOT, 'templates', 'review', l, 'return.md'), 'utf8')
  return tpl.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== '' ? String(vars[k]) : m))
}

// Write a return brief for `lane` into paths.briefs; returns its path.
export function writeReturnBrief({ root, config, lang, lane, title, findings, base, worktree, branch, report, style, trailer }) {
  const pattern = String(getPath(config, 'project.paths.briefs') || '.wb/briefs/{lane}.md')
  let n = 1
  let file
  do {
    file = path.resolve(root, pattern.replace('{lane}', `${lane}-return-${n}`))
    n++
  } while (fs.existsSync(file))
  const ko = lang === 'ko'
  const text = fillTemplate(lang, {
    lane,
    title,
    base_sha: base,
    worktree: worktree || (ko ? '레인 워크트리' : 'the lane worktree'),
    branch: branch || (ko ? '레인 브랜치' : 'the lane branch'),
    findings: findings.map((f) => `- ${f}`).join('\n'),
    report_path: report || (ko ? '레인 보고 파일' : 'the lane report file'),
    style: style || (ko ? '보고서체' : 'plain report style'),
    trailer: trailer || (ko ? '커밋 메시지 끝에 프로젝트가 정한 트레일러를 붙인다.' : 'End commit messages with the trailer the project requires.'),
  })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

// Record the review in the lane ledger: verification + done, or verification + return.
export function recordReview(root, wave, lane, result, reason, now = Date.now()) {
  const sd = stateDir(root)
  if (!sd || !wave || !lane) return false
  W.addVerification(sd, wave, lane, 'review', result.verdict, reason, now)
  if (result.verdict === 'pass') W.setStatus(sd, wave, lane, 'done', 'review pass', now)
  else W.addReturn(sd, wave, lane, reason, now)
  return true
}
