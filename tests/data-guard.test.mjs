// Protected data (project.protected_data): a lane that writes to a protected
// database file, port or container is denied; the main session is asked; an
// unreadable command is asked; read-only queries and other targets pass.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeFixture } from './safety-fixture.mjs'
import { sqlKind } from '../hooks/scripts/safety/data-guard.mjs'

function setup() {
  const f = makeFixture()
  f.projectConfig({ version: 1, protected_data: { paths: ['data/owner.db', '~/owner-data/**'], ports: [5432, 3307], containers: ['owner-pg'] } })
  return f
}
const lane = (f, cmd, extra = {}) => f.judge(cmd, { agent: 'agent-x', ...extra })

test('sqlKind: writes, reads and unclear text', () => {
  assert.equal(sqlKind(['INSERT INTO t VALUES (1)']), 'write')
  assert.equal(sqlKind(['select 1; delete from t']), 'write')
  assert.equal(sqlKind(['SELECT * FROM t']), 'read')
  assert.equal(sqlKind(['\\dt']), 'read')
  assert.equal(sqlKind(['vacuum']), 'write')
  assert.equal(sqlKind([]), 'unknown')
  assert.equal(sqlKind(['do_something()']), 'unknown')
})

test('protected port: a lane write is denied, a read passes, an unreadable input asks', () => {
  const f = setup()
  try {
    let r = lane(f, 'psql -h localhost -p 5432 -c "DELETE FROM users"')
    assert.equal(r.decision, 'deny')
    assert.deepEqual(r.codes, ['data.write'])
    assert.equal(lane(f, 'psql -p 5432 -c "SELECT count(*) FROM users"').decision, 'allow')
    assert.equal(lane(f, 'psql "postgresql://u@localhost:5432/app" -c "UPDATE t SET a=1"').decision, 'deny')
    assert.equal(lane(f, 'PGPORT=5432 psql -c "drop table t"').decision, 'deny')
    assert.equal(lane(f, 'echo "TRUNCATE t" | psql -p 5432').decision, 'deny')
    r = lane(f, 'psql -p 5432 -f seed.sql')
    assert.equal(r.decision, 'ask')
    assert.deepEqual(r.codes, ['data.unclear'])
    assert.equal(lane(f, 'psql -p 5432 < seed.sql').decision, 'ask')
    assert.equal(lane(f, 'mysql -h 127.0.0.1 -P 3307 -e "INSERT INTO t VALUES (1)"').decision, 'deny')
    assert.equal(lane(f, 'pg_restore -p 5432 -d app dump.pgc').decision, 'deny')
  } finally {
    f.cleanup()
  }
})

test('protected port: another port passes; no port on a protected default port asks before a write', () => {
  const f = setup()
  try {
    assert.equal(lane(f, 'psql -p 41003 -c "DELETE FROM users"').decision, 'allow')
    assert.equal(lane(f, 'mysql -P 41004 -e "drop database x"').decision, 'allow')
    // psql without a port goes to 5432 unless PGPORT is set outside: cannot tell, ask
    assert.equal(lane(f, 'psql -c "DELETE FROM users"').decision, 'ask')
    assert.equal(lane(f, 'psql -c "SELECT 1"').decision, 'allow')
    // mysql default 3306 is not protected here
    assert.equal(lane(f, 'mysql -e "DELETE FROM users"').decision, 'allow')
  } finally {
    f.cleanup()
  }
})

test('main session: a write to protected data asks the owner instead of denying', () => {
  const f = setup()
  try {
    const r = f.judge('psql -p 5432 -c "DELETE FROM users"')
    assert.equal(r.decision, 'ask')
    assert.deepEqual(r.codes, ['data.write'])
  } finally {
    f.cleanup()
  }
})

test('protected path: file tools, redirects, writers and sqlite writes are denied for a lane; reads pass', () => {
  const f = setup()
  try {
    const db = path.join(f.repo, 'data', 'owner.db')
    assert.equal(lane(f, null, { tool: 'Write', input: { file_path: db, content: 'x' } }).decision, 'deny')
    assert.equal(lane(f, 'echo x > data/owner.db').decision, 'deny')
    assert.equal(lane(f, 'cp fresh.db data/owner.db').decision, 'deny')
    assert.equal(lane(f, 'rm -f ~/owner-data/a/b.db').decision, 'deny')
    assert.equal(lane(f, 'sqlite3 data/owner.db "DELETE FROM t"').decision, 'deny')
    assert.equal(lane(f, 'sqlite3 data/owner.db "SELECT * FROM t"').decision, 'allow')
    assert.equal(lane(f, 'sqlite3 data/owner.db').decision, 'ask')
    assert.equal(lane(f, 'cat data/owner.db').decision, 'allow')
    // the lane's own test database is fine
    assert.equal(lane(f, 'sqlite3 data/test.db "DELETE FROM t"').decision, 'allow')
    assert.equal(lane(f, null, { tool: 'Write', input: { file_path: path.join(f.repo, 'data', 'test.db'), content: 'x' } }).decision, 'allow')
  } finally {
    f.cleanup()
  }
})

test('protected container: docker exec writes are denied, reads pass, a shell script asks; docker cp into it is denied', () => {
  const f = setup()
  try {
    assert.equal(lane(f, 'docker exec -i owner-pg psql -U app -c "DELETE FROM t"').decision, 'deny')
    assert.equal(lane(f, 'docker exec owner-pg psql -c "SELECT 1"').decision, 'allow')
    assert.equal(lane(f, 'docker exec owner-pg pg_isready').decision, 'allow')
    assert.equal(lane(f, 'docker exec -it owner-pg bash').decision, 'ask')
    assert.equal(lane(f, 'docker exec owner-pg sh -c "rm -rf /var/lib/postgresql/data"').decision, 'deny')
    assert.equal(lane(f, 'docker cp seed.sql owner-pg:/tmp/seed.sql').decision, 'deny')
    assert.equal(lane(f, 'docker exec lane-pg psql -c "DELETE FROM t"').decision, 'allow')
    assert.equal(lane(f, 'docker compose exec owner-pg psql -c "drop table t"').decision, 'deny')
  } finally {
    f.cleanup()
  }
})

test('no protected_data configured: nothing is judged', () => {
  const f = makeFixture()
  try {
    assert.equal(f.judge('psql -p 5432 -c "DELETE FROM users"', { agent: 'agent-x' }).decision, 'allow')
  } finally {
    f.cleanup()
  }
})

test('protected_data lists are merged from every layer (union) and checked by the schema', async () => {
  const { resolveConfig } = await import('../lib/config.mjs')
  const f = setup()
  try {
    f.machine({ version: 1 })
    const r = resolveConfig({ projectDir: f.repo, env: f.env })
    assert.deepEqual(r.errors, [])
    assert.deepEqual(r.config.project.protected_data.ports, [5432, 3307])
    f.projectConfig({ version: 1, protected_data: { ports: ['x'] } })
    const bad = resolveConfig({ projectDir: f.repo, env: f.env })
    assert.ok(bad.errors.some((e) => e.path.startsWith('project.protected_data.ports')), JSON.stringify(bad.errors))
  } finally {
    f.cleanup()
  }
})
