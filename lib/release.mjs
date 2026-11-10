// Release security gate (project.release).
//
// A project names its security check (for example `pnpm security:release-check`) in
// release.security_check. `lanekeeper-test-report security-pass` runs it on a clean HEAD and, on a
// pass, writes <git common dir>/lanekeeper/<release.security_stamp>.json { head, at, command }.
// Before a release (ship verification start, merge or push to a protected branch, push of a tag in
// release.tag_patterns) the stamp has to be on that commit. A commit that already passed is not run
// again. With no check set the gate only warns ("not configured"), unless release.security_required.
import fs from 'node:fs'
import { getPath, stateDir } from './config.mjs'
import { changedSince, headState, onlyUnder, resultsPrefix, securityStampFile } from './testresults.mjs'

export function releaseSettings(config) {
  const r = getPath(config, 'project.release') || {}
  return {
    command: typeof r.security_check === 'string' ? r.security_check.trim() : '',
    required: r.security_required === true,
    tagPatterns: Array.isArray(r.tag_patterns) ? r.tag_patterns : ['v*'],
  }
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
 * State of the release security gate on the current HEAD of `root`.
 *   unconfigured  no check, not required       -> warn only
 *   unset         no check, required           -> block
 *   missing       no stamp (or no git state)   -> block
 *   head          stamp for another commit (more than result files changed since) -> block
 *   command       stamp written by another command -> block
 *   ok            stamp on this commit
 */
export function securityState(root, config) {
  const S = releaseSettings(config)
  if (!S.command) return { state: S.required ? 'unset' : 'unconfigured', command: '' }
  const { head, clean } = headState(root)
  const sd = stateDir(root)
  const file = sd ? securityStampFile(sd, config) : null
  const s = file ? readStamp(file) : null
  if (!head || !s) return { state: 'missing', command: S.command, head, clean, file }
  if (s.command !== S.command) return { state: 'command', command: S.command, head, clean, file, stamp: s }
  if (s.head !== head && !onlyUnder(resultsPrefix(config), changedSince(root, s.head, head))) {
    return { state: 'head', command: S.command, head, clean, file, stamp: s }
  }
  return { state: 'ok', command: S.command, head, clean, file, stamp: s }
}

export const securityBlocks = (st) => !['ok', 'unconfigured'].includes(st.state)
