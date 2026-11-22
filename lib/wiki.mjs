// Project wiki set-up for /lanekeeper:init: finds the indexer of the wiki skill
// (wook-skills project-wiki), runs its `init` and fills project.docs_search.
// Called by lib/init.mjs; lib/docs-search.mjs uses findWikiIndex() for {wiki_index}.
// Read lib/docs-search.mjs first for what the settings do.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const WIKI_TOKEN = '{wiki_index}'
export const WIKI_CONFIG = path.join('.wiki', 'config.json')
export const DOC_DIRS = ['docs', 'doc', 'documentation']
const SKILL_REL = path.join('skills', 'project-wiki', 'bin', 'wiki-index.mjs')

// Settings written by init. Commands run in the project folder, where the indexer finds .wiki/config.json by itself. The commands keep {wiki_index}; it is resolved when used.
export const WIKI_SETTINGS = Object.freeze({
  search: `node ${WIKI_TOKEN} search "{query}"`,
  read: `node ${WIKI_TOKEN} read {id}`,
  backlinks: `node ${WIKI_TOKEN} backlinks {id}`,
  build: `node ${WIKI_TOKEN} build --if-changed --quiet`,
  rebuild: 'gate',
  skill: 'wook-skills:project-wiki',
})

const numericParts = (v) => v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : 0))

function byVersion(a, b) {
  const x = numericParts(a)
  const y = numericParts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  return 0
}

const listDirs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [])

// The indexer script of the newest installed wook-skills, or null.
// LANEKEEPER_WIKI_INDEX names the script directly; `off` turns the lookup off.
export function findWikiIndex(env = process.env) {
  const v = env.LANEKEEPER_WIKI_INDEX
  if (v === 'off' || v === '0') return null
  if (v) return fs.existsSync(v) ? v : null
  const home = env.HOME || os.homedir()
  const roots = [...new Set([env.CLAUDE_CONFIG_DIR, path.join(home, '.claude')].filter(Boolean))]
  for (const root of roots) {
    const cache = path.join(root, 'plugins', 'cache')
    for (const market of listDirs(cache)) {
      const base = path.join(cache, market, 'wook-skills')
      const found = listDirs(base).sort(byVersion).reverse().map((ver) => path.join(base, ver, SKILL_REL)).find((f) => fs.existsSync(f))
      if (found) return found
    }
    const market = path.join(root, 'plugins', 'marketplaces')
    const fromMarket = listDirs(market).flatMap((m) => [path.join(market, m, 'wook-skills', SKILL_REL), path.join(market, m, SKILL_REL)]).find((f) => fs.existsSync(f))
    if (fromMarket) return fromMarket
    const personal = path.join(root, SKILL_REL)
    if (fs.existsSync(personal)) return personal
  }
  return null
}

export const docsDir = (projectDir) => DOC_DIRS.find((d) => fs.existsSync(path.join(projectDir, d)) && fs.statSync(path.join(projectDir, d)).isDirectory()) || null

// Add docs_search to the project settings file written by this init run.
function writeSettings(configFile) {
  const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  cfg.docs_search = { ...WIKI_SETTINGS }
  fs.writeFileSync(configFile, `${JSON.stringify(cfg, null, 2)}\n`)
}

// Decide and do the wiki set-up. `configWritten` is true when init wrote the settings
// file in this run (an existing file is never changed; its addition is only suggested).
// Returns the init actions to print.
export function setupWiki({ projectDir, configFile, configWritten, hasSearch, env = process.env }) {
  if (hasSearch || env.LANEKEEPER_WIKI === 'off') return []
  const dir = docsDir(projectDir)
  if (!dir) return []
  const script = findWikiIndex(env)
  if (!script) return [{ type: 'wikiMissing', dir }]
  const actions = []
  if (!fs.existsSync(path.join(projectDir, WIKI_CONFIG))) {
    try {
      execFileSync(process.execPath, [script, 'init', '--root', projectDir], { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 })
      actions.push({ type: 'wikiInit', file: path.join(projectDir, WIKI_CONFIG) })
    } catch (e) {
      return [{ type: 'wikiInitFailed', reason: String(e.stderr || e.message || e).trim().split('\n')[0].slice(0, 200) }]
    }
  }
  if (configWritten) {
    writeSettings(configFile)
    actions.push({ type: 'wikiConfig', file: configFile })
  } else actions.push({ type: 'wikiConfigSuggest', json: JSON.stringify({ docs_search: WIKI_SETTINGS }) })
  return actions
}
