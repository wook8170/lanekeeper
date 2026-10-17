// Process lookups that work without lsof. Linux images (containers, minimal servers) often have no
// lsof; /proc then gives the same two answers: a process's working directory and the TCP ports it
// listens on. `procDir` is a parameter so tests can point at a fake tree.
import fs from 'node:fs'
import path from 'node:path'

const pidDirs = (procDir) => {
  try {
    return fs.readdirSync(procDir).filter((n) => /^\d+$/.test(n))
  } catch {
    return []
  }
}

// pid -> working directory, for the processes this user may read.
export function procCwds(procDir = '/proc') {
  const out = new Map()
  for (const n of pidDirs(procDir)) {
    try {
      out.set(Number(n), fs.readlinkSync(path.join(procDir, n, 'cwd')))
    } catch {}
  }
  return out
}

// TCP sockets in LISTEN state: inode -> port (/proc/net/tcp and tcp6, state 0A).
function listenInodes(procDir) {
  const out = new Map()
  for (const f of ['tcp', 'tcp6']) {
    let text = ''
    try {
      text = fs.readFileSync(path.join(procDir, 'net', f), 'utf8')
    } catch {}
    for (const line of text.split('\n').slice(1)) {
      const c = line.trim().split(/\s+/)
      if (c.length > 9 && c[3] === '0A') out.set(c[9], parseInt(c[1].split(':').pop(), 16))
    }
  }
  return out
}

// Every listening TCP port on the machine (Set), whichever process owns it.
export const procListenPorts = (procDir = '/proc') => new Set(listenInodes(procDir).values())

// pid -> listening TCP ports, for the processes this user may read.
export function procListeners(procDir = '/proc') {
  const inodes = listenInodes(procDir)
  const out = new Map()
  if (!inodes.size) return out
  for (const n of pidDirs(procDir)) {
    let fds = []
    try {
      fds = fs.readdirSync(path.join(procDir, n, 'fd'))
    } catch {
      continue
    }
    for (const fd of fds) {
      let link = ''
      try {
        link = fs.readlinkSync(path.join(procDir, n, 'fd', fd))
      } catch {
        continue
      }
      const m = /^socket:\[(\d+)\]$/.exec(link)
      if (m && inodes.has(m[1])) {
        const pid = Number(n)
        if (!out.has(pid)) out.set(pid, [])
        if (!out.get(pid).includes(inodes.get(m[1]))) out.get(pid).push(inodes.get(m[1]))
      }
    }
  }
  return out
}

// execFileSync error from a missing program (as opposed to a non-zero exit).
export const isMissingBinary = (e) => e?.code === 'ENOENT'
