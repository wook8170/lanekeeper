// Process lookups without lsof (/proc fallback): a fake /proc tree stands in for Linux.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { procCwds, procListeners, procListenPorts, isMissingBinary } from '../lib/procs.mjs'

function fakeProc() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-proc-'))
  const wt = path.join(root, 'wt-l1')
  fs.mkdirSync(wt)
  fs.mkdirSync(path.join(root, 'proc', 'net'), { recursive: true })
  const mk = (pid, cwd, inodes = []) => {
    fs.mkdirSync(path.join(root, 'proc', String(pid), 'fd'), { recursive: true })
    fs.symlinkSync(cwd, path.join(root, 'proc', String(pid), 'cwd'))
    inodes.forEach((n, i) => fs.symlinkSync(`socket:[${n}]`, path.join(root, 'proc', String(pid), 'fd', String(3 + i))))
  }
  mk(101, wt)
  mk(202, root, [5551, 6662])
  fs.mkdirSync(path.join(root, 'proc', 'self')) // not a pid
  const head = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n'
  // 0x1F90 = 8080 listening (inode 5551), 0x0050 = 80 established (0x01), 0x1BBC = 7100 listening on tcp6
  fs.writeFileSync(path.join(root, 'proc', 'net', 'tcp'), `${head}   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000 0 5551 1\n   1: 0100007F:0050 0100007F:9999 01 00000000:00000000 00:00000000 00000000  1000 0 7777 1\n`)
  fs.writeFileSync(path.join(root, 'proc', 'net', 'tcp6'), `${head}   0: 00000000000000000000000000000000:1BBC 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000 0 6662 1\n`)
  return { proc: path.join(root, 'proc'), wt, root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

test('procCwds: pid -> working directory from /proc, non-pid entries ignored', () => {
  const f = fakeProc()
  try {
    const m = procCwds(f.proc)
    assert.equal(m.get(101), f.wt)
    assert.equal(m.get(202), f.root)
    assert.equal(m.size, 2)
  } finally {
    f.cleanup()
  }
})

test('procListeners / procListenPorts: only LISTEN sockets, tcp and tcp6, mapped to the owning pid', () => {
  const f = fakeProc()
  try {
    assert.deepEqual([...procListenPorts(f.proc)].sort((a, b) => a - b), [7100, 8080])
    assert.deepEqual(procListeners(f.proc).get(202)?.sort((a, b) => a - b), [7100, 8080])
    assert.equal(procListeners(f.proc).has(101), false)
  } finally {
    f.cleanup()
  }
})

test('no /proc: empty answers, no throw', () => {
  assert.equal(procCwds('/nonexistent-proc').size, 0)
  assert.equal(procListeners('/nonexistent-proc').size, 0)
  assert.equal(procListenPorts('/nonexistent-proc').size, 0)
  assert.equal(isMissingBinary({ code: 'ENOENT' }), true)
  assert.equal(isMissingBinary({ status: 1 }), false)
})
