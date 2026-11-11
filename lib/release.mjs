// Release gates (project.release).
//
// A project lists the checks to pass before shipping in release.gates: [{ name, command, required }]
// (for example `security` = `pnpm security:release-check`, `static-analysis` = a SonarQube or Semgrep
// command). `lanekeeper-test-report gates-pass [--name <name>]` runs them on a clean HEAD and, on a pass,
// writes one stamp per gate: <git common dir>/lanekeeper/<stamp>.json { head, at, command, gate }.
// Before a release (ship verification start, merge or push to a protected branch, push of a tag in
// release.tag_patterns) every required gate needs its stamp on that commit; a gate that is not
// required only warns. A gate that already passed on a commit is not run again.
//
// The older single setting (release.security_check · security_required · security_stamp) is read as a
// gate named `security`, required, with its stamp file kept, so old configs and stamps still count.
import fs from 'node:fs'
import path from 'node:path'
import { getPath, stateDir } from './config.mjs'
import { changedSince, headState, onlyUnder, resultsPrefix } from './testresults.mjs'

export const GATE_NAME = /^[a-z0-9][a-z0-9._-]*$/
export const LEGACY_GATE = 'security'

/** The gate list, with the older single security setting folded in as the gate `security`. */
export function releaseSettings(config) {
  const r = getPath(config, 'project.release') || {}
  const gates = []
  for (const g of Array.isArray(r.gates) ? r.gates : []) {
    if (!g || typeof g.name !== 'string' || !GATE_NAME.test(g.name) || gates.some((x) => x.name === g.name)) continue
    gates.push({ name: g.name, command: typeof g.command === 'string' ? g.command.trim() : '', required: g.required !== false })
  }
  const legacy = typeof r.security_check === 'string' ? r.security_check.trim() : ''
  if ((legacy || r.security_required === true) && !gates.some((g) => g.name === LEGACY_GATE)) {
    gates.unshift({ name: LEGACY_GATE, command: legacy, required: true })
  }
  return { gates, tagPatterns: Array.isArray(r.tag_patterns) ? r.tag_patterns : ['v*'] }
}

/** Stamp file name (no .json) of a gate. `security` keeps release.security_stamp, the older file. */
export function gateStampName(config, name) {
  if (name === LEGACY_GATE) return getPath(config, 'project.release.security_stamp') || 'lanekeeper-security-pass'
  return `lanekeeper-release-${name}-pass`
}

export const gateStampFile = (sd, config, name) => path.join(sd, `${gateStampName(config, name)}.json`)

/** The command that passes one gate, named in every message about it. */
export const passCommand = (name) => `lanekeeper-test-report gates-pass --name ${name}`

/**
 * State of one gate, given its stamp (or null) and the commit to ship.
 *   unset    no command               missing  no stamp
 *   head     stamp for another commit (more than result files changed since; sameCommit decides)
 *   command  stamp written by another command          ok  stamp on this commit
 */
export function gateState(gate, stamp, head, sameCommit) {
  if (!gate.command) return 'unset'
  if (!head || !stamp || typeof stamp.head !== 'string') return 'missing'
  if (stamp.command !== gate.command) return 'command'
  if (stamp.head !== head && !sameCommit(stamp.head)) return 'head'
  return 'ok'
}

function readStamp(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'))
    return s && typeof s.head === 'string' ? s : null
  } catch {
    return null
  }
}

/**
 * Every gate on the current HEAD of `root`: { head, clean, configured, gates: [{ name, command,
 * required, state, stamp, file }] }. `configured` is false when no gate is set at all.
 */
export function releaseState(root, config) {
  const { gates } = releaseSettings(config)
  const { head, clean } = headState(root)
  const sd = stateDir(root)
  const same = (from) => onlyUnder(resultsPrefix(config), changedSince(root, from, head))
  const rows = gates.map((g) => {
    const file = sd ? gateStampFile(sd, config, g.name) : null
    const stamp = file ? readStamp(file) : null
    return { ...g, state: gateState(g, stamp, head, same), stamp, file }
  })
  return { head, clean, configured: gates.length > 0, gates: rows }
}

/** Gates that block (required, not passed) and gates that only warn (not required, not passed). */
export function splitGates(rows) {
  const open = rows.filter((g) => g.state !== 'ok')
  return { blocking: open.filter((g) => g.required), optional: open.filter((g) => !g.required) }
}

/** Message variables for one gate that has not passed on `head`. */
export const gateVars = (g, head) => ({
  gate: g.name,
  command: g.command || '-',
  head: head ? head.slice(0, 9) : '?',
  stamped: g.stamp?.head?.slice(0, 9) || '-',
  run: passCommand(g.name),
})
