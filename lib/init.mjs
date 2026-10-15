// Project initialization (/wb:init) and environment check (/wb:doctor).
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { wbHome, stateDir, resolveConfig, explain, PLUGIN_ROOT } from './config.mjs'
import { syncWorktreeHooks } from './worktree-hooks.mjs'

export const PROJECT_KINDS = ['web-ui', 'service', 'library', 'other']
export const BRIEFS_EXCLUDE = '.wb/briefs/'
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
// worktreeHook (default false): let wb create Claude Code's worktrees too.
export function initProject(projectDir, answers, env = process.env, pluginRoot = PLUGIN_ROOT) {
  const { kind = 'other', language = 'en', gate = '', worktreeHook = false } = answers
  if (!PROJECT_KINDS.includes(kind)) throw new Error(`unknown project kind: ${kind}`)
  if (!['ko', 'en'].includes(language)) throw new Error(`unknown language: ${language}`)
  const actions = []

  writeJsonIfMissing(
    path.join(projectDir, '.wb', 'config.json'),
    { version: 1, project_kind: kind, gate: { command: gate, verify_all: '', append_checks: [] }, ...(worktreeHook ? { worktree: { hook: true } } : {}) },
    actions,
  )
  writeJsonIfMissing(path.join(wbHome(env), 'personal.json'), { version: 1, language }, actions)

  const state = stateDir(projectDir)
  if (!state) {
    actions.push({ type: 'notGit' })
  } else {
    fs.mkdirSync(state, { recursive: true })
    const exclude = path.join(path.dirname(state), 'info', 'exclude')
    const body = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : ''
    if (!body.split('\n').includes(BRIEFS_EXCLUDE)) {
      fs.mkdirSync(path.dirname(exclude), { recursive: true })
      fs.writeFileSync(exclude, `${body}${body && !body.endsWith('\n') ? '\n' : ''}${BRIEFS_EXCLUDE}\n`)
      actions.push({ type: 'exclude', file: exclude, line: BRIEFS_EXCLUDE })
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
  if (kind === 'web-ui') actions.push({ type: 'uiHint' })
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
  'project.project_kind',
  'project.git.protected_branches',
]

export function doctor(projectDir, env = process.env) {
  const checks = []
  const major = Number(process.versions.node.split('.')[0])
  checks.push({ id: 'node', status: major >= 18 ? 'ok' : 'fail', detail: process.versions.node })
  const isGit = Boolean(stateDir(projectDir))
  checks.push({ id: 'git', status: isGit ? 'ok' : 'warn', detail: projectDir })
  const hasProject = fs.existsSync(path.join(projectDir, '.wb', 'config.json'))
  checks.push({ id: 'projectConfig', status: hasProject ? 'ok' : 'warn' })
  const resolved = resolveConfig({ projectDir, env })
  checks.push({
    id: 'config',
    status: resolved.errors.length ? 'fail' : resolved.warnings.length ? 'warn' : 'ok',
    errors: resolved.errors,
    warnings: resolved.warnings,
  })
  const codegraph = (env.PATH || '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, 'codegraph')))
  checks.push({ id: 'codegraph', status: codegraph ? 'ok' : 'warn' })
  const keys = DOCTOR_KEYS.map((k) => explain(resolved, k))
  return { checks, keys, effective: resolved.effective }
}
