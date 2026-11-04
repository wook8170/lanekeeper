// wb settings loader: reads every layer, validates it, merges it and records
// where each value came from.
//
// Namespaces of the merged tree: routing · machine · personal · project.
// Layers, lowest precedence first:
//   default    <plugin>/defaults/{routing,machine,personal,config}.json
//   project    <repo>/.wb/config.json   (top-level keys = project; optional
//              "routing" / "machine" / "personal" sections feed those namespaces)
//   machine    <WB_HOME>/machine.json
//   userConfig CLAUDE_PLUGIN_OPTION_* (plugin.json userConfig, hook processes only)
//   personal   <WB_HOME>/routing.json, <WB_HOME>/personal.json
//
// Merge rules by key kind:
//   ordinary value   higher layer wins (personal > userConfig > machine > project > default)
//   protected list   union of every layer, default included (UNION_KEYS)
//   cap              smallest value among non-default layers; default only when
//                    no other layer sets it (MIN_KEYS)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { SCHEMAS, check, checkRouting } from './schema.mjs'

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const LAYERS = ['default', 'project', 'machine', 'userConfig', 'personal']
export const NAMESPACES = ['routing', 'machine', 'personal', 'project']

export const UNION_KEYS = new Set([
  'routing.denied',
  'machine.ports.protected',
  'project.git.protected_branches',
  'project.protected_paths',
  'project.protected_data.paths',
  'project.protected_data.ports',
  'project.protected_data.containers',
])

export const MIN_KEYS = new Set([
  'machine.lanes.max',
  'machine.slots.heavy.count',
  'machine.slots.browser.count',
  'machine.load.max',
])

// userConfig option (plugin.json) -> merged key
export const USER_CONFIG_MAP = {
  CLAUDE_PLUGIN_OPTION_LANGUAGE: 'personal.language',
  CLAUDE_PLUGIN_OPTION_CHAT_DETAIL: 'personal.report.chat_detail',
}

export function ruleFor(key) {
  if (UNION_KEYS.has(key)) return 'union'
  if (MIN_KEYS.has(key)) return 'min'
  return 'override'
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

export function getPath(tree, key) {
  let cur = tree
  for (const part of key.split('.')) {
    if (!isObj(cur) || !(part in cur)) return undefined
    cur = cur[part]
  }
  return cur
}

function setPath(tree, key, value) {
  const parts = key.split('.')
  let cur = tree
  for (const part of parts.slice(0, -1)) {
    if (!isObj(cur[part])) cur[part] = {}
    cur = cur[part]
  }
  cur[parts.at(-1)] = value
}

export function expandHome(p, home = os.homedir()) {
  if (typeof p !== 'string') return p
  if (p === '~') return home
  if (p.startsWith('~/')) return path.join(home, p.slice(2))
  return p
}

export function wbHome(env = process.env) {
  return env.WB_HOME ? path.resolve(env.WB_HOME) : path.join(env.HOME || os.homedir(), '.wb')
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

export function projectRoot(cwd = process.cwd(), env = process.env) {
  if (env.WB_PROJECT_DIR) return path.resolve(env.WB_PROJECT_DIR)
  return git(['rev-parse', '--show-toplevel'], cwd) || path.resolve(cwd)
}

// Shared state directory for all worktrees of a repository (<git-common-dir>/wb).
export function stateDir(root) {
  const common = git(['rev-parse', '--git-common-dir'], root)
  if (!common) return null
  return path.join(path.resolve(root, common), 'wb')
}

function readJson(file) {
  if (!fs.existsSync(file)) return { exists: false }
  try {
    return { exists: true, data: JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch (e) {
    return { exists: true, parseError: e.message }
  }
}

// Each source = { layer, file, ns, data } where data is the namespace-local object.
export function collectSources({ projectDir, env = process.env } = {}) {
  const sources = []
  const issues = []
  const add = (layer, file, ns, data) => {
    // Old name of project.codegraph.auto_index, still read for one release; the new name wins.
    const cg = ns === 'project' ? data?.codegraph : null
    if (isObj(cg) && cg.index_on_worktree !== undefined && cg.auto_index === undefined) cg.auto_index = cg.index_on_worktree
    sources.push({ layer, file, ns, data })
  }
  const load = (layer, file, nsOrSplit) => {
    const r = readJson(file)
    if (!r.exists) return
    if (r.parseError) {
      issues.push({ level: 'error', file, path: '', msg: `invalid JSON: ${r.parseError}`, code: 'json' })
      return
    }
    if (!isObj(r.data)) {
      issues.push({ level: 'error', file, path: '', msg: 'top level must be an object', code: 'type' })
      return
    }
    if (nsOrSplit === 'project-split') {
      const projectPart = {}
      for (const [k, v] of Object.entries(r.data)) {
        if (k === 'routing' || k === 'machine' || k === 'personal') {
          if (isObj(v)) add(layer, file, k, v)
          else issues.push({ level: 'error', file, path: k, msg: 'section must be an object', code: 'type' })
        } else projectPart[k] = v
      }
      add(layer, file, 'project', projectPart)
    } else add(layer, file, nsOrSplit, r.data)
  }

  const defaults = path.join(PLUGIN_ROOT, 'defaults')
  load('default', path.join(defaults, 'routing.json'), 'routing')
  load('default', path.join(defaults, 'machine.json'), 'machine')
  load('default', path.join(defaults, 'personal.json'), 'personal')
  load('default', path.join(defaults, 'config.json'), 'project')

  if (projectDir) load('project', path.join(projectDir, '.wb', 'config.json'), 'project-split')

  const home = wbHome(env)
  load('machine', path.join(home, 'machine.json'), 'machine')

  for (const [envKey, key] of Object.entries(USER_CONFIG_MAP)) {
    const v = env[envKey]
    if (v === undefined || v === '') continue
    const [ns, ...rest] = key.split('.')
    const data = {}
    setPath(data, rest.join('.'), v)
    add('userConfig', `env:${envKey}`, ns, data)
  }

  load('personal', path.join(home, 'routing.json'), 'routing')
  load('personal', path.join(home, 'personal.json'), 'personal')
  return { sources, issues }
}

function mergeInto(target, src, prefix, layer, origins) {
  for (const [k, v] of Object.entries(src)) {
    const key = `${prefix}.${k}`
    if (UNION_KEYS.has(key) || MIN_KEYS.has(key)) continue
    if (isObj(v)) {
      if (!isObj(target[k])) {
        target[k] = {}
        dropOrigins(origins, key)
      }
      mergeInto(target[k], v, key, layer, origins)
      if (Object.keys(v).length === 0 && !origins.has(key)) origins.set(key, layer)
    } else {
      target[k] = clone(v)
      dropOrigins(origins, key)
      origins.set(key, layer)
    }
  }
}

function dropOrigins(origins, key) {
  for (const k of [...origins.keys()]) if (k === key || k.startsWith(`${key}.`)) origins.delete(k)
}

const layerRank = (l) => LAYERS.indexOf(l)

export function mergeSources(sources) {
  const ordered = [...sources].sort((a, b) => layerRank(a.layer) - layerRank(b.layer))
  const config = {}
  const origins = new Map()
  for (const ns of NAMESPACES) config[ns] = {}
  for (const s of ordered) mergeInto(config[s.ns], s.data, s.ns, s.layer, origins)

  for (const key of UNION_KEYS) {
    const [ns, ...rest] = key.split('.')
    const sub = rest.join('.')
    const out = []
    const seen = new Set()
    const from = []
    for (const s of ordered) {
      if (s.ns !== ns) continue
      const v = getPath(s.data, sub)
      if (v === undefined) continue
      if (!Array.isArray(v)) continue // schema check reports it
      if (!from.includes(s.layer)) from.push(s.layer)
      for (const item of v) {
        const id = JSON.stringify(item)
        if (!seen.has(id)) {
          seen.add(id)
          out.push(clone(item))
        }
      }
    }
    if (from.length) {
      setPath(config[ns], sub, out)
      origins.set(key, from.join('+'))
    }
  }

  for (const key of MIN_KEYS) {
    const [ns, ...rest] = key.split('.')
    const sub = rest.join('.')
    let def
    let best
    let last
    for (const s of ordered) {
      if (s.ns !== ns) continue
      const v = getPath(s.data, sub)
      if (v === undefined) continue
      if (s.layer === 'default') {
        def = { v, layer: s.layer }
        continue
      }
      last = { v, layer: s.layer }
      if (typeof v === 'number' && (!best || v < best.v)) best = { v, layer: s.layer }
    }
    const pick = best || last || def
    if (pick) {
      setPath(config[ns], sub, clone(pick.v))
      origins.set(key, pick.layer)
    }
  }
  return { config, origins }
}

function detectLanguage(env) {
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || ''
  return /^ko/i.test(raw) ? 'ko' : 'en'
}

// Load tiers (machine.load.tiers). "auto" turns into a multiple of the logical
// core count: light_only = cores * 1.5, hold_new_lanes = cores * 2,
// stop_heavy = cores * 2.8 (rounded). hold_new_lanes matches the auto
// load.max (cores * 2), so new lanes stop where slot waits begin; the
// light-only band sits below it. light_only is never above hold_new_lanes and
// stop_heavy is never below hold_new_lanes.
export const TIER_RATIOS = { light_only: 1.5, hold_new_lanes: 2, stop_heavy: 2.8 }

export function resolveTiers(config, cores = os.cpus().length) {
  const raw = config.machine?.load?.tiers || {}
  const pick = (k) => (typeof raw[k] === 'number' ? raw[k] : Math.round(cores * TIER_RATIOS[k]))
  const hold = pick('hold_new_lanes')
  return { light_only: Math.min(hold, pick('light_only')), hold_new_lanes: hold, stop_heavy: Math.max(hold, pick('stop_heavy')) }
}

export function effectiveValues(config, env = process.env) {
  const lang = config.personal?.language
  const loadMax = config.machine?.load?.max
  return {
    language: lang === 'ko' || lang === 'en' ? lang : detectLanguage(env),
    load_max: typeof loadMax === 'number' ? loadMax : os.cpus().length * 2,
    load_tiers: resolveTiers(config),
  }
}

export function validateSources(sources) {
  const issues = []
  for (const s of sources) {
    const r = check(SCHEMAS[s.ns], s.data)
    const prefix = s.ns
    for (const e of r.errors) issues.push({ level: 'error', file: s.file, ns: s.ns, path: join(prefix, e.path), msg: e.msg, code: e.code })
    for (const w of r.warnings) issues.push({ level: 'warning', file: s.file, ns: s.ns, path: join(prefix, w.path), msg: w.msg, code: w.code })
  }
  return issues
}

const join = (a, b) => (b ? (b.startsWith('[') ? `${a}${b}` : `${a}.${b}`) : a)

export function resolveConfig({ projectDir, env = process.env } = {}) {
  const { sources, issues: loadIssues } = collectSources({ projectDir, env })
  const issues = [...loadIssues, ...validateSources(sources)]
  const { config, origins } = mergeSources(sources)
  const cross = checkRouting(config.routing)
  for (const e of cross.errors) issues.push({ level: 'error', file: '(merged)', path: e.path, msg: e.msg, code: e.code })
  for (const w of cross.warnings) issues.push({ level: 'warning', file: '(merged)', path: w.path, msg: w.msg, code: w.code })
  return {
    config,
    origins,
    sources,
    effective: effectiveValues(config, env),
    errors: issues.filter((i) => i.level === 'error'),
    warnings: issues.filter((i) => i.level === 'warning'),
  }
}

// Where a key's value comes from: the merge rule, the winning layer and every
// layer that sets it.
export function explain(resolved, key) {
  const value = getPath(resolved.config, key)
  const [ns, ...rest] = key.split('.')
  const sub = rest.join('.')
  const setBy = []
  for (const s of resolved.sources) {
    if (s.ns !== ns) continue
    const v = sub ? getPath(s.data, sub) : s.data
    if (v !== undefined) setBy.push({ layer: s.layer, file: s.file, value: v })
  }
  setBy.sort((a, b) => layerRank(a.layer) - layerRank(b.layer))
  let from = resolved.origins.get(key)
  let children
  if (from === undefined && isObj(value)) {
    children = {}
    for (const [k, l] of resolved.origins) if (k.startsWith(`${key}.`)) children[k] = l
  }
  return { key, value, rule: ruleFor(key), from: from ?? null, children, setBy }
}
