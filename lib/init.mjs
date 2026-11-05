// Project initialization (/lanekeeper:init) and environment check (/lanekeeper:doctor).
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { lanekeeperHome, stateDir, resolveConfig, explain, PLUGIN_ROOT } from './config.mjs'
import { syncWorktreeHooks } from './worktree-hooks.mjs'
import { doctorInfo, formatSize, EXCLUDE_LINE } from './codegraph.mjs'
import { projectConfigFile } from './naming.mjs'

export const PROJECT_KINDS = ['web-ui', 'service', 'library', 'other']
export const BRIEFS_EXCLUDE = '.lanekeeper/briefs/'
export const METRICS_EXCLUDE = '.lanekeeper/metrics/'
const TEST_RESULTS_PROBE = 'docs/test-results/probe.xlsx'

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

function writeJsonIfMissing(file, data, actions) {
  if (fs.existsSync(file)) {
    actions.push({ type: 'kept', file })
    return
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
  actions.push({ type: 'wrote', file })
}

// answers: { kind, language, gate, worktreeHook } — the init questions.
// worktreeHook (default false): let lanekeeper create Claude Code's worktrees too.
export function initProject(projectDir, answers, env = process.env, pluginRoot = PLUGIN_ROOT) {
  const { kind = 'other', language = 'en', gate = '', worktreeHook = false } = answers
  if (!PROJECT_KINDS.includes(kind)) throw new Error(`unknown project kind: ${kind}`)
  if (!['ko', 'en'].includes(language)) throw new Error(`unknown language: ${language}`)
  const actions = []

  writeJsonIfMissing(
    projectConfigFile(projectDir),
    {
      version: 1,
      project_kind: kind,
      gate: { command: gate, verify_all: '', append_checks: [] },
      // A project with screens ships only after the changed screens passed the adversarial UX check.
      ...(kind === 'web-ui' ? { quality: { ship: { requires: ['ux-adversarial'] } } } : {}),
      ...(worktreeHook ? { worktree: { hook: true } } : {}),
    },
    actions,
  )
  writeJsonIfMissing(path.join(lanekeeperHome(env), 'personal.json'), { version: 1, language }, actions)

  const state = stateDir(projectDir)
  if (!state) {
    actions.push({ type: 'notGit' })
  } else {
    fs.mkdirSync(state, { recursive: true })
    const exclude = path.join(path.dirname(state), 'info', 'exclude')
    const body = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : ''
    const have = new Set(body.split('\n').map((l) => l.trim()))
    const add = [BRIEFS_EXCLUDE, EXCLUDE_LINE, METRICS_EXCLUDE].filter((l) => !have.has(l) && !have.has(l.replace(/\/$/, '')))
    if (add.length) {
      fs.mkdirSync(path.dirname(exclude), { recursive: true })
      fs.writeFileSync(exclude, `${body}${body && !body.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`)
      for (const line of add) actions.push({ type: 'exclude', file: exclude, line })
    }
    // A broad ignore pattern such as `test-results/` also hides docs/test-results/.
    const hit = git(['check-ignore', '--no-index', '-v', TEST_RESULTS_PROBE], projectDir)
    if (hit) {
      const pattern = hit.split('\t')[0].split(':').slice(2).join(':')
      if (!pattern.startsWith('!')) actions.push({ type: 'gitignore', pattern, path: 'docs/test-results/' })
    }
  }
  if (worktreeHook && state) {
    const on = resolveConfig({ projectDir, env }).config.project?.worktree?.hook === true
    if (!on) actions.push({ type: 'worktreeHookKept' })
    else {
      const r = syncWorktreeHooks(projectDir, pluginRoot, true)
      actions.push(r.state === 'conflict' ? { type: 'worktreeHookConflict', file: r.file } : { type: 'worktreeHook', file: r.file })
    }
  }
  return actions
}

const DOCTOR_KEYS = [
  'personal.language',
  'personal.report.chat_detail',
  'routing.denied',
  'machine.lanes.max',
  'machine.slots.heavy.count',
  'machine.slots.browser.count',
  'machine.load.max',
  'machine.load.tiers',
  'machine.load.check_every_min',
  'project.project_kind',
  'project.git.protected_branches',
]

export function doctor(projectDir, env = process.env) {
  const checks = []
  const major = Number(process.versions.node.split('.')[0])
  checks.push({ id: 'node', status: major >= 18 ? 'ok' : 'fail', detail: process.versions.node })
  const isGit = Boolean(stateDir(projectDir))
  checks.push({ id: 'git', status: isGit ? 'ok' : 'warn', detail: projectDir })
  const hasProject = fs.existsSync(projectConfigFile(projectDir))
  checks.push({ id: 'projectConfig', status: hasProject ? 'ok' : 'warn' })
  const resolved = resolveConfig({ projectDir, env })
  checks.push({
    id: 'config',
    status: resolved.errors.length ? 'fail' : resolved.warnings.length ? 'warn' : 'ok',
    errors: resolved.errors,
    warnings: resolved.warnings,
  })
  const cg = doctorInfo(projectDir, resolved.config, env)
  checks.push({ id: 'codegraph', status: cg.installed ? 'ok' : 'warn' })
  if (cg.installed) {
    if (cg.indexed !== null) checks.push({ id: 'codegraphIndex', status: cg.indexed ? 'ok' : 'warn' })
    if (cg.queue) checks.push({ id: 'codegraphQueue', status: cg.queue.failed.length ? 'warn' : 'ok', detail: { waiting: cg.queue.waiting, running: cg.queue.running, failed: cg.queue.failed.length, items: cg.queue.failed } })
    const bytes = cg.orphans.reduce((n, o) => n + o.bytes, 0)
    checks.push({ id: 'codegraphOrphans', status: cg.orphans.length ? 'warn' : 'ok', detail: { count: cg.orphans.length, size: formatSize(bytes), bytes, paths: cg.orphans.map((o) => o.path) } })
  }
  const oldKey = resolved.sources.some((s) => s.ns === 'project' && s.layer !== 'default' && s.data?.codegraph?.index_on_worktree !== undefined)
  if (oldKey) checks.push({ id: 'codegraphOldKey', status: 'warn' })
  if (cg.autoExcludes?.length) checks.push({ id: 'codegraphAutoExclude', status: 'warn', detail: { lines: cg.autoExcludes.join(', ') } })
  const keys = DOCTOR_KEYS.map((k) => explain(resolved, k))
  return { checks, keys, effective: resolved.effective }
}
