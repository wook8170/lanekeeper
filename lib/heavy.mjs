// Which slot kinds a shell command needs, from defaults/heavy-patterns.json
// plus project additions (project.slots.heavy / project.slots.browser).
import fs from 'node:fs'
import path from 'node:path'
import { PLUGIN_ROOT } from './config.mjs'

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'eval'])
export const WRAPPER = 'lanekeeper-slot'

let cache
export function patternGroups() {
  if (!cache) cache = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'defaults', 'heavy-patterns.json'), 'utf8')).groups
  return cache
}

const compile = (src) => {
  try {
    return new RegExp(src, 'i')
  } catch {
    return null
  }
}

// [{ kind, group, re }] for the resolved config.
export function rulesFor(config) {
  const groups = patternGroups()
  const rules = []
  for (const kind of ['heavy', 'browser']) {
    for (const group of config.machine?.slots?.[kind]?.patterns || []) {
      for (const src of groups[group] || []) {
        const re = compile(src)
        if (re) rules.push({ kind, group, re })
      }
    }
    for (const src of config.project?.slots?.[kind] || []) {
      const re = compile(src)
      if (re) rules.push({ kind, group: 'project', re })
    }
  }
  return rules
}

export const commandText = (cmd) => [cmd.name, ...cmd.args.map((a) => a.text)].join(' ')

// Kinds a lanekeeper-slot invocation holds: --kind heavy,browser or --kind heavy --kind browser.
export function wrapperKinds(cmd) {
  const kinds = new Set()
  const texts = cmd.args.map((a) => a.text)
  for (let i = 0; i < texts.length; i++) {
    if (texts[i] === '--') break
    if (texts[i] === '--kind' && texts[i + 1]) for (const k of texts[i + 1].split(',')) kinds.add(k.trim())
    else if (texts[i].startsWith('--kind=')) for (const k of texts[i].slice(7).split(',')) kinds.add(k.trim())
  }
  if (kinds.size === 0) kinds.add('heavy')
  return kinds
}

function match(text, rules) {
  const kinds = new Set()
  const groups = new Set()
  for (const r of rules) {
    if (r.re.test(text)) {
      kinds.add(r.kind)
      groups.add(r.group)
    }
  }
  return { kinds, groups }
}

// The command a lanekeeper-slot invocation runs (the words after `--`). For
// `sh -c '<script>'` the script itself is returned.
export function wrappedText(cmd) {
  const texts = cmd.args.map((a) => a.text)
  const at = texts.indexOf('--')
  const inner = at === -1 ? [] : texts.slice(at + 1)
  if (inner.length >= 3 && SHELLS.has(inner[0]) && /^-\w*c$/.test(inner[1])) return inner[2]
  return inner.join(' ')
}

// Simple commands (from shell.parse) -> [{ text, kinds, missing, groups }]
// for the ones that need a slot they do not hold. Commands already run by
// lanekeeper-slot are checked against the kinds the wrapper takes.
export function unwrappedHeavy(cmds, rules) {
  const out = []
  for (const c of cmds) {
    if (SHELLS.has(c.name)) continue
    const wrapped = c.name === WRAPPER
    const text = wrapped ? wrappedText(c) : commandText(c)
    const { kinds, groups } = match(text, rules)
    const held = wrapped ? wrapperKinds(c) : new Set()
    const missing = [...kinds].filter((k) => !held.has(k))
    if (missing.length) out.push({ text, kinds: [...kinds].sort(), missing: missing.sort(), groups: [...groups], wrapped })
  }
  return out
}

// A shell-safe suggestion: lanekeeper-slot --kind <kinds> -- <original command>
export function suggestWrap(command, kinds) {
  return `lanekeeper-slot --kind ${kinds.join(',')} -- sh -c ${shellQuote(command)}`
}

export function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}
