// Handoff guard: progress.md excerpt at session start and a stale check that
// keeps a turn from ending when real work is newer than the handoff file.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const git = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

// From the top of the file to just before the second "## " heading
// (header + newest section), at most 200 lines / 12 KB.
export function excerpt(text) {
  const out = []
  let n = 0
  for (const line of text.split('\n')) {
    if (/^## /.test(line)) n++
    if (n === 2) break
    out.push(line)
  }
  let s = out.join('\n')
  while (Buffer.byteLength(s) > 12288) s = s.slice(0, Math.floor(s.length * 0.9))
  return s.split('\n').slice(0, 200).join('\n')
}

const mtimeSec = (f) => {
  try {
    return Math.floor(fs.statSync(f).mtimeMs / 1000)
  } catch {
    return 0
  }
}

// Newer than the handoff file: the last commit or a changed working file.
export function isStale(cwd, file) {
  const p = path.join(cwd, file)
  const pm = mtimeSec(p)
  const last = Number((git(cwd, ['log', '-1', '--format=%ct']) || '0').trim())
  if (last > pm) return true
  const st = git(cwd, ['status', '--porcelain']) || ''
  for (const line of st.split('\n')) {
    if (!line) continue
    let f = line.slice(3)
    if (f.includes(' -> ')) f = f.split(' -> ').pop()
    f = f.replace(/^"|"$/g, '')
    if (f === file) continue
    if (mtimeSec(path.join(cwd, f)) > pm) return true
  }
  return false
}

export const isGit = (cwd) => git(cwd, ['rev-parse', '--git-dir']) !== null
