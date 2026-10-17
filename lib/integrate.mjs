// Lane integration (/wb:integrate): trial merge → conflict classification →
// rule-based resolution → regeneration → number check → guards → commit.
//
// Conflict kinds (project.integrate.rules, first match wins; unmatched = code):
//   ledger     JSON ledger: rows keyed by `id` are united, the integration side wins on a shared id,
//              lists of plain values are united (retired ids stay retired)
//   union      JSON registration file (hooks.json and the like): objects merged, lists united,
//              the integration side wins on a scalar
//   generated  output of a generator: take the integration side, then run project.integrate.regenerate
//   code       anything else: abort the merge and write a return brief asking the lane to merge
//              the integration HEAD itself and hand back a fast-forwardable HEAD
// The merge is never committed when a guard or a regeneration fails; it is aborted instead.
import fs from 'node:fs'
import path from 'node:path'
import { getPath, stateDir } from './config.mjs'
import { globToRe } from '../hooks/scripts/safety/common.mjs'
import { gitx, runShell, runGuards, writeReturnBrief } from './review.mjs'
import { pidAlive } from './slots.mjs'
import * as N from './numbers.mjs'
import * as W from './waves.mjs'

export const KINDS = ['ledger', 'union', 'generated', 'code']

export function classify(file, rules) {
  for (const r of rules || []) {
    const g = r.glob.startsWith('**/') ? [r.glob, r.glob.slice(3)] : [r.glob]
    if (g.some((x) => globToRe(x).test(file))) return r.kind
  }
  return 'code'
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const keyed = (arr) => arr.length > 0 && arr.every((x) => isObj(x) && x.id !== undefined)

function uniteList(ours, theirs) {
  if (keyed(ours) || keyed(theirs)) {
    const out = ours.map((x) => structuredClone(x))
    const ids = new Set(ours.filter(isObj).map((x) => x.id))
    for (const t of theirs) if (!isObj(t) || !ids.has(t.id)) out.push(structuredClone(t))
    return out
  }
  const seen = new Set(ours.map((x) => JSON.stringify(x)))
  const out = ours.map((x) => structuredClone(x))
  for (const t of theirs) if (!seen.has(JSON.stringify(t))) out.push(structuredClone(t))
  return out
}

// Deep merge with the integration side ("ours") winning on scalars and shared ids.
export function mergeJson(ours, theirs) {
  if (Array.isArray(ours) && Array.isArray(theirs)) return uniteList(ours, theirs)
  if (isObj(ours) && isObj(theirs)) {
    const out = {}
    for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      if (!(k in ours)) out[k] = structuredClone(theirs[k])
      else if (!(k in theirs)) out[k] = structuredClone(ours[k])
      else out[k] = mergeJson(ours[k], theirs[k])
    }
    return out
  }
  return structuredClone(ours)
}

// Ledger rows: same as mergeJson, then rows whose id is retired on either side are dropped.
export function mergeLedger(ours, theirs) {
  const out = mergeJson(ours, theirs)
  if (Array.isArray(out.retired_ids) && Array.isArray(out.cases)) {
    const retired = new Set(out.retired_ids)
    out.cases = out.cases.filter((c) => !retired.has(c.id))
  }
  return out
}

function lockFile(sd, name) {
  return path.join(sd, `${name}.lock`)
}

function lockHeld(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'))
    return pidAlive(d.pid) ? d : null
  } catch {
    return null
  }
}

function takeLock(file, now) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (lockHeld(file)) return false
  fs.rmSync(file, { force: true })
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() }), { flag: 'wx' })
    return true
  } catch {
    return false
  }
}

const stageText = (root, stage, file, env) => {
  const r = gitx(root, ['show', `:${stage}:${file}`], env)
  return r.status === 0 ? r.out : null
}

/**
 * opts: { root, branch, lane, wave, config, env, lang, dryRun, message, trailer, report, worktree, now }
 * Returns { status: 'merged'|'dry-run'|'up-to-date'|'aborted'|'blocked', reason?, conflicts: {file: kind},
 *           resolved: [], regenerated: [], guards: [], brief?, head? }
 */
export function integrate(opts) {
  const { root, branch, config, env = process.env, now = Date.now() } = opts
  const out = { status: 'blocked', conflicts: {}, resolved: [], regenerated: [], guards: [] }
  const g = (args) => gitx(root, args, env)

  if (g(['rev-parse', '--verify', '--quiet', `${branch}^{commit}`]).status !== 0) return { ...out, reason: 'no_branch', vars: { branch } }
  if (g(['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status === 0) return { ...out, reason: 'merging' }
  if (g(['status', '--porcelain', '--untracked-files=no']).out) return { ...out, reason: 'dirty' }

  const sd = stateDir(root)
  if (!sd) return { ...out, reason: 'no_git' }
  const gate = lockHeld(lockFile(sd, 'gate'))
  if (gate) return { ...out, reason: 'gate_locked', vars: { pid: gate.pid } }
  const lock = lockFile(sd, 'integrate')
  if (!takeLock(lock, now)) return { ...out, reason: 'locked' }

  try {
    const base = g(['rev-parse', 'HEAD']).out
    const intName = g(['rev-parse', '--abbrev-ref', 'HEAD']).out
    out.base = base
    if (g(['merge-base', '--is-ancestor', branch, 'HEAD']).status === 0) return { ...out, status: 'up-to-date' }

    const m = g(['merge', '--no-commit', '--no-ff', branch])
    const conflicted = g(['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean)
    if (m.status !== 0 && !conflicted.length) {
      g(['merge', '--abort'])
      return { ...out, status: 'aborted', reason: 'merge_failed', vars: { msg: (m.err || m.out).split('\n')[0] } }
    }
    const rules = getPath(config, 'project.integrate.rules') || []
    for (const f of conflicted) out.conflicts[f] = classify(f, rules)

    const abort = (reason, findings, vars = {}) => {
      g(['merge', '--abort'])
      const brief = opts.lane
        ? writeReturnBrief({
            root,
            config,
            lang: opts.lang,
            lane: opts.lane,
            title: reason,
            findings,
            base,
            branch,
            worktree: opts.worktree,
            report: opts.report,
            trailer: opts.trailer,
          })
        : null
      record('fail', `${reason}: ${findings.join(' | ')}`)
      return { ...out, status: 'aborted', reason, vars, brief }
    }
    const record = (result, detail) => {
      if (opts.wave && opts.lane) {
        try {
          W.addVerification(sd, opts.wave, opts.lane, 'integrate', result, detail, now)
          if (result === 'fail') W.addReturn(sd, opts.wave, opts.lane, detail, now)
        } catch {
          /* lane not in the ledger */
        }
      }
    }
    const ko = opts.lang === 'ko'
    const ff = ko
      ? `통합 브랜치 최신(${base.slice(0, 12)})을 레인 브랜치에 병합하고 충돌을 풀어, 통합 브랜치가 빨리 감기로 받을 수 있는 HEAD 를 돌려준다.`
      : `Merge the latest integration HEAD (${base.slice(0, 12)}) into the lane branch, resolve the conflicts and return a HEAD the integration branch can fast-forward to.`

    const code = conflicted.filter((f) => out.conflicts[f] === 'code')
    if (code.length) return abort('code_conflict', [...code.map((f) => (ko ? `코드 충돌: \`${f}\`` : `Code conflict: \`${f}\``)), ff], { files: code.join(', ') })

    for (const f of conflicted) {
      const kind = out.conflicts[f]
      if (kind === 'generated') {
        if (g(['checkout', '--ours', '--', f]).status !== 0) return abort('code_conflict', [ko ? `생성물 충돌을 풀 수 없음: \`${f}\`` : `Cannot resolve generated file: \`${f}\``, ff], { files: f })
      } else {
        const a = stageText(root, 2, f, env)
        const b = stageText(root, 3, f, env)
        let merged
        try {
          merged = (kind === 'ledger' ? mergeLedger : mergeJson)(JSON.parse(a), JSON.parse(b))
        } catch {
          return abort('code_conflict', [ko ? `JSON 으로 읽을 수 없는 충돌: \`${f}\`` : `Conflict is not readable JSON: \`${f}\``, ff], { files: f })
        }
        fs.writeFileSync(path.join(root, f), `${JSON.stringify(merged, null, 2)}\n`)
      }
      if (g(['add', '--', f]).status !== 0) return abort('code_conflict', [f, ff], { files: f })
      out.resolved.push(f)
    }

    // regeneration
    // files the lane brought in (a generated file resolved to our side no longer shows in the index diff)
    const mb = g(['merge-base', 'HEAD', branch]).out
    const changed = [...new Set([...conflicted, ...g(['diff', '--name-only', mb, branch]).out.split('\n').filter(Boolean)])]
    for (const r of getPath(config, 'project.integrate.regenerate') || []) {
      if (r.glob && !changed.some((f) => globToRe(r.glob).test(f) || globToRe(r.glob.replace(/^\*\*\//, '')).test(f))) continue
      const res = runShell(r.command, root, env)
      if (res.status !== 0) return abort('regenerate_failed', [ko ? `재생성 실패: ${r.name || r.command}` : `Regeneration failed: ${r.name || r.command}`], { name: r.name || r.command })
      g(['add', '-u'])
      out.regenerated.push(r.name || r.command)
    }

    // reserved numbers
    for (const name of Object.keys(getPath(config, 'project.numbers') || {})) {
      let cfg
      try {
        cfg = N.seriesConfig(config, name)
      } catch {
        continue
      }
      const dup = N.check(sd, name, cfg, [root]).problems.filter((p) => p.code === 'duplicate_file')
      if (dup.length) return abort('number_conflict', dup.map((p) => (ko ? `번호 ${p.vars.n} 중복: ${p.vars.files}. \`wb-number reserve ${name}\` 로 새 번호를 받아 파일 이름과 참조를 고친다.` : `Number ${p.vars.n} used twice: ${p.vars.files}. Take a new one with \`wb-number reserve ${name}\` and fix the file name and references.`)), { series: name })
    }

    // guards on the merged tree
    const failed = runGuards(getPath(config, 'project.integrate.guards') || [], root, env)
    out.guards = failed.map((f) => f.name)
    if (failed.length) return abort('guard_failed', failed.map((f) => (ko ? `가드 실패: ${f.name}\n  ${f.out.replace(/\n/g, '\n  ')}` : `Guard failed: ${f.name}\n  ${f.out.replace(/\n/g, '\n  ')}`)), { names: out.guards.join(', ') })

    if (opts.dryRun) {
      g(['merge', '--abort'])
      return { ...out, status: 'dry-run' }
    }
    const msg = [opts.message || `merge ${branch} into ${intName}`, ...(opts.trailer ? ['', opts.trailer] : [])].join('\n')
    const c = g(['commit', '-q', '-m', msg])
    if (c.status !== 0) {
      g(['merge', '--abort'])
      return { ...out, status: 'aborted', reason: 'commit_failed', vars: { msg: (c.err || c.out).split('\n')[0] } }
    }
    record('pass', `merged ${branch}`)
    return { ...out, status: 'merged', head: g(['rev-parse', 'HEAD']).out }
  } finally {
    fs.rmSync(lock, { force: true })
  }
}
