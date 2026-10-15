// Small helpers shared by the wb-slot / wb-port / wb-worktree / wb-reap commands.
export function parseArgs(argv, booleans = []) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      out['--'] = argv.slice(i + 1)
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq)
      if (eq !== -1) out[name] = a.slice(eq + 1)
      else if (!booleans.includes(name) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[name] = argv[++i]
      else out[name] = true
    } else out._.push(a)
  }
  return out
}

export function readStdin() {
  return new Promise((resolve) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (raw += c))
    process.stdin.on('end', () => resolve(raw))
  })
}
