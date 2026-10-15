// Terse mode: output-minimizing rules injected at session start. On when
// personal.terse is true, or when this repository's switch file says on
// (<git-common-dir>/wb/terse, set by `wb-terse on`).
import fs from 'node:fs'
import path from 'node:path'
import { PLUGIN_ROOT, getPath, stateDir } from './config.mjs'

export const terseFile = (root) => {
  const sd = stateDir(root)
  return sd ? path.join(sd, 'terse') : null
}

export function terseState(root, resolved) {
  const f = terseFile(root)
  let repo = null
  try {
    if (f) repo = fs.readFileSync(f, 'utf8').trim()
  } catch {
    /* no switch file */
  }
  if (repo === 'on') return { on: true, source: 'repo' }
  if (repo === 'off') return { on: false, source: 'repo' }
  return getPath(resolved.config, 'personal.terse') === true ? { on: true, source: 'personal' } : { on: false, source: 'default' }
}

export function terseRules(lang) {
  const f = path.join(PLUGIN_ROOT, 'rules', `terse.${lang === 'ko' ? 'ko' : 'en'}.md`)
  return fs.readFileSync(f, 'utf8').trim()
}
