// Docs search (project.docs_search): the project's document index commands, put into
// the impl, fix and return briefs ({{docs_search}} and {{code_search}}), the session
// start context and the gate kind `docs-index` (see lib/quality.mjs).
// Used by bin/lanekeeper-style, lib/review.mjs, lib/quality.mjs and hooks/scripts/rules/session-start.mjs.
// Read lib/code-standards.mjs first: the brief lines are filled with its applyToBrief().
import { getPath } from './config.mjs'
import { findBin } from './codegraph.mjs'
import { findWikiIndex, WIKI_TOKEN } from './wiki.mjs'

export const KEYS = Object.freeze(['search', 'read', 'backlinks', 'build', 'mcp_server', 'sources', 'stale_marker', 'skill'])
export const REBUILD = Object.freeze(['gate', 'manual'])
export const DEFAULT_SKILL = 'wook-skills:project-wiki'

// Commands may hold {wiki_index}, the path of the wiki skill's indexer on this machine
// (its plugin cache path changes with every version, so it is not written into settings).
function resolveToken(cmd, env) {
  if (!cmd.includes(WIKI_TOKEN)) return cmd
  const file = findWikiIndex(env)
  return file ? cmd.split(WIKI_TOKEN).join(`"${file}"`) : cmd
}

export function docsSearch(config, env = process.env) {
  const d = getPath(config, 'project.docs_search') || {}
  const text = (k) => (typeof d[k] === 'string' ? d[k].trim() : '')
  const out = Object.fromEntries(KEYS.map((k) => [k, resolveToken(text(k), env)]))
  if (!('skill' in d)) out.skill = DEFAULT_SKILL
  out.rebuild = REBUILD.includes(d.rebuild) ? d.rebuild : 'gate'
  return out
}

// The feature is on only when the project names a search command.
export const isEnabled = (config, env = process.env) => docsSearch(config, env).search !== ''

// Optional sentences, in order, for the settings that are set.
function extras(ds, t) {
  const out = []
  if (ds.sources) out.push(t('docsearch.sources', { sources: ds.sources }))
  if (ds.read && ds.backlinks) out.push(t('docsearch.read_backlinks', { read: ds.read, backlinks: ds.backlinks }))
  else if (ds.read) out.push(t('docsearch.read', { read: ds.read }))
  else if (ds.backlinks) out.push(t('docsearch.backlinks', { backlinks: ds.backlinks }))
  if (ds.mcp_server) out.push(t('docsearch.mcp', { server: ds.mcp_server }))
  if (ds.stale_marker) out.push(t('docsearch.stale', { marker: ds.stale_marker }))
  if (ds.skill) out.push(t('docsearch.skill', { skill: ds.skill }))
  return out
}

// Text for {{docs_search}}, or '' when no search command is set.
export function briefLine(config, t, env = process.env) {
  const ds = docsSearch(config, env)
  if (!ds.search) return ''
  return [t('docsearch.brief', { search: ds.search }), ...extras(ds, t), t('docsearch.brief.cite')].join(' ')
}

// Text for {{code_search}}: codegraph first for code, the index first for documents.
// '' when the codegraph nudge is off. Without codegraph on this machine it adds how to go on.
export function codeSearchLine(config, t, env = process.env) {
  if (getPath(config, 'project.codegraph.nudge') === 'off') return ''
  const head = t('codesearch.brief')
  return findBin(env) ? head : `${head} ${t('codesearch.missing')}`
}

// One line for the session start context, or '' when no search command is set.
export function sessionLine(config, t, env = process.env) {
  const ds = docsSearch(config, env)
  if (!ds.search) return ''
  return [t('docsearch.session', { search: ds.search }), ...extras(ds, t)].join(' ')
}
