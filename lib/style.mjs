// Writing style per file: project.style.map (glob -> haeyo | report | plain) decides
// which voice a lane uses for the files it owns. The first matching entry wins.
// renderStyle() produces the text that fills {{style}} in the brief templates.
import fs from 'node:fs'
import path from 'node:path'
import { PLUGIN_ROOT } from './config.mjs'

export const STYLES = ['haeyo', 'report', 'plain']

// ** matches across folders, * within one folder, ? one character.
export function globToRe(glob) {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          out += '(?:.*/)?'
        } else out += '.*'
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '')

export function styleFor(map, file) {
  const f = norm(file)
  for (const e of map || []) if (globToRe(norm(e.glob)).test(f)) return { style: e.style, glob: e.glob }
  return null
}

// Text that goes into the brief. One style for every file -> a single line;
// mixed -> one line per style with the files it covers; no match -> a fallback line.
export function renderStyle(map, files, t) {
  const list = (files || []).map(norm).filter(Boolean)
  const groups = new Map()
  const unmatched = []
  for (const f of list) {
    const hit = styleFor(map, f)
    if (!hit) unmatched.push(f)
    else groups.set(hit.style, [...(groups.get(hit.style) || []), f])
  }
  if (!groups.size) return t('style.none')
  const line = (s) => t(`style.${s}.line`)
  if (groups.size === 1 && !unmatched.length) return line([...groups.keys()][0])
  const parts = [...groups].map(([s, fs_]) => t('style.file_line', { files: fs_.join(', '), rule: line(s) }))
  if (unmatched.length) parts.push(t('style.file_line', { files: unmatched.join(', '), rule: t('style.none') }))
  return parts.join(' / ')
}

// Full rule text for one style (rules/writing-style.<lang>.md, section "## <style>").
export function styleRules(style, lang) {
  const file = path.join(PLUGIN_ROOT, 'rules', `writing-style.${lang === 'ko' ? 'ko' : 'en'}.md`)
  const body = fs.readFileSync(file, 'utf8')
  const sections = body.split(/^## /m).slice(1)
  for (const s of sections) {
    const [head, ...rest] = s.split('\n')
    if (head.trim() === style) return rest.join('\n').trim()
  }
  return null
}

// Fill {{name}} placeholders that appear in vars; leave the others untouched.
export function fillTemplate(text, vars) {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}
