// Names of the settings folders and environment variables, and how the names
// used before 0.2.0 (when the plugin was called wb) are still read.
//
//   user settings      $LANEKEEPER_HOME, else ~/.lanekeeper
//                      ~/.wb is read instead when ~/.lanekeeper does not exist
//   project settings   <repo>/.lanekeeper/config.json
//                      <repo>/.wb/config.json is read instead when the new file does not exist
//   shared state       <git-common-dir>/lanekeeper
//                      <git-common-dir>/wb is used instead when only the old folder exists
//   environment        LANEKEEPER_<X>; WB_<X> is copied to LANEKEEPER_<X> when the new
//                      name is not set, so the new name wins when both are set
//
// Nothing is moved or renamed on disk. The session start hook tells the user
// once which old names are still in use (legacyNotice).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const NAME = 'lanekeeper'
export const LEGACY_NAME = 'wb'
export const DIR = '.lanekeeper'
export const LEGACY_DIR = '.wb'
export const ENV_PREFIX = 'LANEKEEPER_'
export const LEGACY_ENV_PREFIX = 'WB_'
export const LEGACY_GATE_STAMP = 'wb-gate-pass'

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

// Copy every WB_<X> to LANEKEEPER_<X> that is not set yet. Returns the new names
// that were filled in this way.
export function applyLegacyEnv(env = process.env) {
  const copied = []
  for (const key of Object.keys(env)) {
    if (!key.startsWith(LEGACY_ENV_PREFIX)) continue
    const next = ENV_PREFIX + key.slice(LEGACY_ENV_PREFIX.length)
    if (env[next] !== undefined) continue
    env[next] = env[key]
    copied.push(next)
  }
  return copied
}

// User settings folder: { dir, legacy, preferred }.
export function homeInfo(env = process.env) {
  if (env.LANEKEEPER_HOME) return { dir: path.resolve(env.LANEKEEPER_HOME), legacy: false }
  const base = env.HOME || os.homedir()
  const preferred = path.join(base, DIR)
  const old = path.join(base, LEGACY_DIR)
  if (!isDir(preferred) && isDir(old)) return { dir: old, legacy: true, preferred }
  return { dir: preferred, legacy: false }
}

export const userHome = (env = process.env) => homeInfo(env).dir

// Project settings folder: { dir, legacy, preferred }.
export function projectInfo(root) {
  const preferred = path.join(root, DIR)
  const old = path.join(root, LEGACY_DIR)
  if (!fs.existsSync(path.join(preferred, 'config.json')) && fs.existsSync(path.join(old, 'config.json'))) return { dir: old, legacy: true, preferred }
  return { dir: preferred, legacy: false }
}

export const projectConfigFile = (root) => path.join(projectInfo(root).dir, 'config.json')

// A project-relative path written with the new folder name (".lanekeeper/…"),
// pointed at the old folder when the project still uses it.
export function projectRel(root, rel) {
  const s = String(rel)
  if (!root || !(s === DIR || s.startsWith(`${DIR}/`))) return s
  return projectInfo(root).legacy ? LEGACY_DIR + s.slice(DIR.length) : s
}

// A path written with "~/.lanekeeper", pointed at the folder homeInfo chose.
export function homeRel(p, env = process.env) {
  const s = String(p)
  const prefix = `~/${DIR}`
  if (!(s === prefix || s.startsWith(`${prefix}/`))) return s
  return userHome(env) + s.slice(prefix.length)
}

// Shared state folder inside the git common dir: { dir, legacy, preferred }.
export function stateInfo(commonDir) {
  const preferred = path.join(commonDir, NAME)
  const old = path.join(commonDir, LEGACY_NAME)
  if (!isDir(preferred) && isDir(old)) return { dir: old, legacy: true, preferred }
  return { dir: preferred, legacy: false }
}

// Old names still in use, as { kind, old, preferred } items.
//   kind = home | project | state | env
export function legacyInUse({ env = process.env, root = null, commonDir = null, copiedEnv = [] } = {}) {
  const items = []
  const h = homeInfo(env)
  if (h.legacy) items.push({ kind: 'home', old: h.dir, preferred: h.preferred })
  if (root) {
    const p = projectInfo(root)
    if (p.legacy) items.push({ kind: 'project', old: p.dir, preferred: p.preferred })
  }
  if (commonDir) {
    const s = stateInfo(commonDir)
    if (s.legacy) items.push({ kind: 'state', old: s.dir, preferred: s.preferred })
  }
  for (const name of copiedEnv) items.push({ kind: 'env', old: LEGACY_ENV_PREFIX + name.slice(ENV_PREFIX.length), preferred: name })
  return items
}

// Returns the items to tell the user about, or [] when this same set was already
// shown. The record of what was shown is markerFile (a JSON file).
export function legacyNotice(items, markerFile) {
  if (!items.length) return []
  const signature = items.map((i) => `${i.kind}:${i.old}`).sort().join('|')
  try {
    if (JSON.parse(fs.readFileSync(markerFile, 'utf8')).signature === signature) return []
  } catch {}
  try {
    fs.mkdirSync(path.dirname(markerFile), { recursive: true })
    fs.writeFileSync(markerFile, `${JSON.stringify({ signature, at: new Date().toISOString() })}\n`)
  } catch {}
  return items
}
