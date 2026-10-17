// kill-guard: pattern kills are always blocked; kills aimed at a process that
// listens on a protected port (machine.ports.protected) are blocked.
import { allow, ask, deny } from './common.mjs'

const PATTERN_KILLERS = new Set(['pkill', 'killall', 'pkill.exe', 'taskkill'])
const PID_FINDERS = /\b(pgrep|pidof|pkill)\b/

export function protectedPorts(config) {
  const list = config.machine?.ports?.protected || []
  const out = new Map()
  for (const p of list) if (p && Number.isInteger(p.port) && p.port > 0) out.set(p.port, p.name || String(p.port))
  return out
}

// ports named in an lsof/fuser/kill-port style text: ":8080", "tcp:8080", "8080/tcp"
export function portsIn(text) {
  const out = new Set()
  for (const m of text.matchAll(/(?:^|[\s:=])(?:tcp|udp)?:(\d{2,5})\b/gi)) out.add(Number(m[1]))
  for (const m of text.matchAll(/\b(\d{2,5})\/(?:tcp|udp)\b/gi)) out.add(Number(m[1]))
  return [...out]
}

export function judgeKill(cmd, ctx) {
  const ports = protectedPorts(ctx.config)
  const name = cmd.name
  if (PATTERN_KILLERS.has(name)) return deny('kill.pattern', { cmd: name })
  if (name === 'kill-port' || ((name === 'npx' || name === 'pnpx' || name === 'bunx') && cmd.args[0]?.text === 'kill-port')) {
    return checkPorts(cmd.args.map((a) => Number(a.text)).filter(Number.isInteger), ports)
  }
  if (name === 'fuser') {
    if (!cmd.args.some((a) => /^-[a-zA-Z]*k/.test(a.text))) return null
    const found = cmd.args.flatMap((a) => portsIn(a.text))
    if (found.length) return checkPorts(found, ports)
    return ports.size ? ask('kill.unresolved', { cmd: 'fuser -k' }) : allow()
  }
  if (name !== 'kill') return null
  const args = cmd.args
  const texts = args.map((a) => a.text)
  if (texts.some((t) => t === '-l' || t === '-L' || t === '-0' || t === '-s0' || t === '-n0')) return allow()
  // PIDs from a pipe through xargs
  if (cmd.xargs) {
    const src = cmd.pipedFrom
    const srcText = src ? [src.name, ...src.args.map((a) => a.text)].join(' ') : ''
    if (!src || PID_FINDERS.test(srcText) || src.name === 'ps' || src.name === 'grep' || src.name === 'awk') {
      return deny('kill.pattern', { cmd: srcText || 'xargs kill' })
    }
    if (src.name === 'lsof') {
      const found = portsIn(srcText)
      return found.length ? checkPorts(found, ports) : ports.size ? ask('kill.unresolved', { cmd: 'lsof | xargs kill' }) : allow()
    }
    return ports.size ? ask('kill.unresolved', { cmd: 'xargs kill' }) : allow()
  }
  const out = []
  for (const a of args) {
    const t = a.text
    if (t.startsWith('-') || t.startsWith('%')) continue
    if (a.dynamic) {
      if (PID_FINDERS.test(t)) return deny('kill.pattern', { cmd: t.slice(0, 80) })
      if (/\blsof\b/.test(t)) {
        const found = portsIn(t)
        out.push(found.length ? checkPorts(found, ports) : ports.size ? ask('kill.unresolved', { cmd: t.slice(0, 80) }) : allow())
        continue
      }
      out.push(ports.size ? ask('kill.unresolved', { cmd: t.slice(0, 80) }) : allow())
      continue
    }
    if (!/^\d+$/.test(t)) continue
    if (!ports.size) continue
    const listening = ctx.listenPorts(Number(t))
    if (listening === null) {
      out.push(ask('kill.unresolved', { cmd: `kill ${t}` }))
      continue
    }
    const hit = listening.find((p) => ports.has(p))
    if (hit) out.push(deny('kill.protected_port', { pid: t, port: hit, name: ports.get(hit) }))
  }
  return out.length ? out : allow()
}

function checkPorts(found, ports) {
  const hit = found.find((p) => ports.has(p))
  return hit ? deny('kill.protected_port', { pid: '-', port: hit, name: ports.get(hit) }) : allow()
}
