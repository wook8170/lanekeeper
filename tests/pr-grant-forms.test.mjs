// What a grant for one pull request may be spent on, what counts as a merge, and where its files can be
// written. Each line below came from an attempt to get round the hook. Nothing here runs a real gh: the
// lookup is a function that answers as gh would, from the repository the line really names.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeFixture, git } from './safety-fixture.mjs'
import { evaluate } from '../hooks/scripts/safety/pretool.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HEAD = 'a'.repeat(40)
const REPO = 'github.com/acme/widgets'
const MERGE = `gh pr merge 162 --repo ${REPO} --match-head-commit ${HEAD}`

let f, O, env, ownerDir, ownerGrant

// One pull request per repository and number, as GitHub holds them.
const PRS = {
  'acme/widgets#162': { base: 'main', headOid: HEAD },
  'acme/widgets#5': { base: 'feature/y', headOid: 'c'.repeat(40) },
  'acme/widgets#7': { base: 'feature/z', headOid: 'd'.repeat(40) },
  'other/secret#162': { base: 'main', headOid: 'b'.repeat(40) },
  'other/secret#5': { base: 'main', headOid: 'e'.repeat(40) },
  'other/secret#9': { base: 'main', headOid: HEAD },
  'other/secret#7': { base: 'develop', headOid: 'f'.repeat(40) },
}
// The repository gh picks: the selector when it is an address, then --repo, GH_REPO and the folder.
function lookup(t, { selector, repo } = {}) {
  const url = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(selector ?? '')
  const named = (repo || t.env?.GH_REPO || (t.cwd === O ? 'other/secret' : 'acme/widgets')).replace(/^github\.com\//, '')
  const key = url ? `${url[1]}#${url[2]}` : `${named}#${selector ?? 162}`
  const pr = PRS[key]
  if (!pr) return null
  const [where, number] = key.split('#')
  return { ...pr, number: Number(number), url: `https://github.com/${where}/pull/${number}`, title: 't' }
}
const judge = (command, { cwd = f.repo, ...rest } = {}) => {
  const r = evaluate({ hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command }, permission_mode: 'default', session_id: 's1', ...rest }, env, { pr: lookup })
  return { ...r, codes: r.reasons.map((x) => x.code) }
}
const write = (file) => evaluate({ hook_event_name: 'PreToolUse', cwd: f.repo, tool_name: 'Write', tool_input: { file_path: file, content: '{}' }, permission_mode: 'default' }, env, {})
const grant = (over = {}) => {
  const now = Date.now()
  fs.mkdirSync(ownerDir, { recursive: true })
  fs.writeFileSync(ownerGrant, JSON.stringify({ version: 1, action: 'merge-pr', ref: `${REPO}#162`, head: HEAD, dest: 'main', created: new Date(now - 1000).toISOString(), expires: new Date(now + 600000).toISOString(), used: false, ...over }))
}
const used = () => JSON.parse(fs.readFileSync(ownerGrant, 'utf8')).used

before(() => {
  f = makeFixture()
  git(f.repo, 'remote', 'add', 'origin', `https://${REPO}.git`)
  O = path.join(f.base, 'other')
  fs.mkdirSync(O)
  git(O, 'init', '-q', '-b', 'main')
  git(O, 'remote', 'add', 'origin', `${['git', 'github.com'].join('@')}:other/secret.git`)
  env = { ...f.env, CLAUDE_CODE_ENTRYPOINT: 'cli' }
  ownerDir = path.join(f.lanekeeperHome, 'owner')
  ownerGrant = path.join(ownerDir, 'owner-grant.json')
})
after(() => f.cleanup())
beforeEach(() => {
  f.clearGrant()
  fs.rmSync(ownerDir, { recursive: true, force: true })
})

// ---- high 2: the PR that was judged and the PR that gh merges ----------------------------------------

const LINES_WITHOUT_A_NAMED_TARGET = () => [
  'gh pr merge 5',
  'cd "$X" && gh pr merge 5',
  '(cd "$X"; gh pr merge 5)',
  'cd $(cat /tmp/p) && gh pr merge 5',
  `GIT_DIR=${O}/.git gh pr merge 5`,
  `env GIT_DIR=${O}/.git gh pr merge 5`,
  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url GIT_CONFIG_VALUE_0=https://github.com/other/secret gh pr merge 5',
  `env -C ${O} gh pr merge 5`,
  'set -a; GH_REPO=other/secret; gh pr merge 5',
  'source /tmp/e; gh pr merge 5',
  '. /tmp/e && gh pr merge 5',
  'echo 162 | xargs gh pr merge',
  `pushd ${f.repo} && popd && gh pr merge 5`,
  `cd ${f.repo}; cd "$OLDPWD" && gh pr merge 5`,
  'gh pr merge --repo= 5',
  'GH_REPO=other/secret gh pr merge 5 --repo acme/widgets',
  'gh pr merge 5 --repo acme/widgets',
]
test('a merge that does not name its PR and its whole repository does not pass, whatever the PR found is', () => {
  for (const line of LINES_WITHOUT_A_NAMED_TARGET()) assert.equal(judge(line).decision, 'deny', line)
})

test('a merge that names both passes into a branch that is not protected, with or without a head', () => {
  assert.equal(judge(`gh pr merge 5 --repo ${REPO} --squash -d`).decision, 'allow')
  assert.equal(judge(`gh pr merge 5 --repo ${REPO} --match-head-commit ${'c'.repeat(40)} --merge`).decision, 'allow')
  assert.equal(judge(`gh pr merge 5 --repo ${REPO} --subject done --body-file /tmp/b`).decision, 'allow')
  assert.equal(judge(`cd "$X" && gh pr merge 5 --repo ${REPO}`).decision, 'allow', 'the folder plays no part once the line names the repository')
  assert.equal(judge(`GH_REPO=other/secret gh pr merge 5 --repo ${REPO}`).decision, 'allow', '--repo is what gh goes by')
  assert.deepEqual(judge(`echo 7 | xargs gh pr merge 5 --repo ${REPO}`).codes, ['gh.unresolved'], 'xargs can add a second PR')
})

test('the refusal gives the exact line to run next, keeping the merge method and -d', () => {
  const r = judge('gh pr merge 5 --rebase --delete-branch')
  assert.deepEqual(r.codes, ['gh.form'])
  assert.equal(r.reasons[0].vars.line, `gh pr merge 5 --repo ${REPO} --match-head-commit ${'c'.repeat(40)} --rebase -d`)
  assert.equal(judge(r.reasons[0].vars.line).decision, 'allow', 'and that line passes')
  assert.equal(judge('gh pr merge 5').reasons[0].vars.line, `gh pr merge 5 --repo ${REPO} --match-head-commit ${'c'.repeat(40)} --squash`)
})

// ---- high 3 and medium 3: the line a grant may be spent on ---------------------------------------------

test('a grant is spent only on the one line, and every other form leaves it unused', () => {
  const lines = [
    `gh pr merge 162 --repo ${REPO}`,
    'gh pr merge 162 --repo acme/widgets',
    'gh pr merge 162',
    `GIT_DIR=${O}/.git gh pr merge 162`,
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url GIT_CONFIG_VALUE_0=https://github.com/other/secret gh pr merge 162',
    'cd "$X" && gh pr merge 162',
    'declare -x GH_REPO=other/secret; gh pr merge 162',
    'set -a; GH_REPO=other/secret; gh pr merge 162',
    'source /tmp/e; gh pr merge 162',
    `git push origin HEAD:feature/x && ${MERGE}`,
    `${MERGE} && echo done`,
    `sleep 3000; ${MERGE}`,
    `${MERGE} --auto`,
    `${MERGE} --admin`,
    `${MERGE}; ${MERGE}`,
    `for i in 1 2; do ${MERGE}; done`,
    `f() { ${MERGE}; }; f; f`,
    `f() { ${MERGE}; }; f && f`,
    `echo a b | xargs -n1 ${MERGE}`,
    `gh pr merge 162 --repo ${REPO} --match-head-commit ffff`,
    `gh pr merge 162 --repo ${REPO} --match-head-commit ${'b'.repeat(40)}`,
    `bash -c "${MERGE}"`,
    `nohup ${MERGE} &`,
    `${MERGE} &`,
    `timeout 5 ${MERGE}`,
    `command ${MERGE}`,
    `/opt/homebrew/bin/${MERGE}`,
    `cd ${O} && ${MERGE}`,
    `X=1 ${MERGE}`,
    `${MERGE} > /tmp/out`,
    `${MERGE} --squash --rebase`,
    `${MERGE} -d -d`,
    `${MERGE} --subject done`,
    `gh pr merge https://github.com/acme/widgets/pull/162 --match-head-commit ${HEAD}`,
    `gh pr --repo ${REPO} merge 162 --match-head-commit ${HEAD}`,
  ]
  for (const line of lines) {
    grant()
    const r = judge(line)
    assert.equal(r.decision, 'deny', line)
    assert.equal(used(), false, line)
  }
})

test('the one line passes once, with each merge method and from any folder', () => {
  for (const tail of ['', ' --squash', ' --merge', ' --rebase', ' -d', ' --squash -d', ' -d --merge']) {
    grant()
    assert.equal(judge(`${MERGE}${tail}`, { cwd: O }).decision, 'allow', tail)
    assert.equal(used(), true, tail)
    assert.deepEqual(judge(`${MERGE}${tail}`).codes, ['gh.need_grant'], `used up: ${tail}`)
  }
})

test('with a grant in hand a wrong line is told the right one', () => {
  grant()
  const r = judge('gh pr merge 162 --squash')
  assert.deepEqual(r.codes, ['gh.form'])
  assert.equal(r.reasons[0].vars.line, `${MERGE} --squash`)
  assert.equal(judge(r.reasons[0].vars.line).decision, 'allow')
})

test('a head that moved after the grant needs a new grant', () => {
  grant({ head: 'b'.repeat(40) })
  assert.deepEqual(judge(`${MERGE} --squash`).codes, ['gh.need_grant'])
  assert.equal(used(), false)
})

test('a subagent is refused the one line too', () => {
  grant()
  assert.deepEqual(judge(MERGE, { agent_id: 'a1' }).codes, ['gh.lane_merge'])
  assert.equal(used(), false)
})

test('need_grant says what the owner does and what the agent runs, in both languages', () => {
  const r = judge('gh pr merge 162 --squash')
  assert.deepEqual(r.codes, ['gh.need_grant'])
  assert.equal(r.reasons[0].vars.line, `${MERGE} --squash`)
  for (const lang of ['ko', 'en']) {
    const fix = JSON.parse(fs.readFileSync(path.join(ROOT, `locales/${lang}.json`), 'utf8'))['safety.gh.need_grant.fix']
    assert.match(fix, /lanekeeper-grant merge-pr \{number\} --repo \{repo\}/, lang)
    assert.match(fix, /\{line\}/, lang)
    assert.match(fix, /\/lanekeeper:approve merge-pr \{number\} --repo \{repo\}/, lang)
  }
})

// ---- high 4: lines that were not read as a merge ---------------------------------------------------------

test('a gh line that cannot be read as something else is refused, and asks no lookup', () => {
  const lines = [
    'gh -s 162 pr merge --repo other/secret',
    'gh pr -s 162 merge --repo other/secret',
    'gh --admin 5 pr merge --repo other/secret',
    'gh pr --squash 5 merge --repo other/secret',
    'gh -d 5 pr merge -R other/secret',
    'gh -t pr merge 5 --repo other/secret',
    'gh pr -s view merge',
    'gh -- pr merge 5',
    'A=pr; gh $A merge 5 --repo other/secret',
    'X="pr merge 5 --repo other/secret"; gh $X',
    'gh $(echo pr) merge 5 --repo other/secret',
    'gh pr $S 5 --repo other/secret',
    'gh -R $R pr merge 5',
    'gh mg 5 --repo other/secret',
    'gh co 5',
    'GH_CONFIG_DIR=/tmp/gh gh mg 5',
    'gh alias set mg "pr merge"',
    'gh alias import /tmp/a.yml',
    'gh extension install o/gh-x',
    'gh extension exec x',
    'gh pr merge --help',
    'gh pr merge 5 "$R"',
    'gh pr merge "$N" --repo other/secret',
    'gh pr merge 5 --repo "$R"',
    'GH_REPO="$R" gh pr merge 5',
    'gh pr merge -R=other/secret 5',
    'gh pr nosuch 5',
  ]
  for (const line of lines) {
    let asked = 0
    const r = evaluate({ hook_event_name: 'PreToolUse', cwd: f.repo, tool_name: 'Bash', tool_input: { command: line }, permission_mode: 'default', session_id: 's1' }, env, { pr: () => (asked++, null) })
    assert.equal(r.decision, 'deny', line)
    assert.ok(r.reasons.some((x) => x.code === 'gh.unresolved' || x.code === 'shell.unresolved'), `${line}: ${r.reasons.map((x) => x.code)}`)
  }
})

test('the gh commands that read or work elsewhere still pass', () => {
  for (const line of ['gh', 'gh --version', 'gh --help', 'gh help pr merge', 'gh pr', 'gh repo', 'gh pr view 5 --json url', 'gh pr view "$N" --json url', 'gh pr list', 'gh pr checks 5', 'gh pr comment 5 --body merge', 'gh pr create --title merge --body "$(cat /tmp/b)"', 'gh -R o/r pr view 5', 'gh pr -R o/r view 5', 'gh pr --repo=o/r view 5', 'gh repo view', 'gh repo sync o/r --branch x', 'gh run list', 'gh run view "$ID"', 'gh auth status', 'gh issue create --title t', 'gh alias list', 'gh extension list', 'gh search prs merge']) {
    assert.equal(judge(line).decision, 'allow', line)
  }
})

// ---- high 5: merge-main says nothing about a pull request -----------------------------------------------

test('a merge-main grant is not spent on any gh merge', () => {
  for (const line of ['gh pr merge 162', 'gh pr merge 9 --repo other/secret', 'GH_REPO=other/secret gh pr merge 9', 'gh pr merge https://github.com/other/secret/pull/9', `GIT_DIR=${O}/.git gh pr merge 9`, `GIT_DIR=${O}/.git gh pr merge 162`, `${MERGE} --squash`]) {
    f.grant('merge-main', HEAD)
    assert.equal(judge(line).decision, 'deny', line)
    assert.equal(f.readGrant().used, false, line)
  }
})

// ---- medium 1: the protected list of another repository is not known here ------------------------------

test('a PR of a repository outside the session folder needs a grant, whatever its base', () => {
  const line = `gh pr merge 7 --repo github.com/other/secret --match-head-commit ${'f'.repeat(40)} --squash`
  assert.deepEqual(judge(line).codes, ['gh.need_grant'], 'develop is protected only in that repository')
  assert.deepEqual(judge(`cd ${O} && gh pr merge 7`).codes, ['gh.need_grant'])
  assert.equal(judge(line, { cwd: O }).decision, 'allow', 'in its own folder the settings of that folder decide')
  assert.deepEqual(judge(`gh pr merge 5 --repo ${REPO} --squash`, { cwd: path.join(f.base, 'home') }).codes, ['gh.need_grant'], 'a folder with no repository knows nothing')
  const asked = judge('lanekeeper-grant merge-pr 7 --repo github.com/other/secret')
  assert.deepEqual(asked.codes, ['owner.grant_pr'], 'and the dialog can be raised for it')
})

test('in the repository of the session a branch off the protected list needs no grant, and the dialog says so', () => {
  assert.deepEqual(judge(`lanekeeper-grant merge-pr 5 --repo ${REPO}`).codes, ['owner.pr_not_protected'])
})

// ---- medium 2: the same effect by another door -----------------------------------------------------------

test('gh api, repo sync and curl that would move a branch are refused', () => {
  for (const line of [
    'gh api repos/o/r/pulls/1/merge -X PUT',
    'gh api -XPUT repos/o/r/pulls/1/merge',
    'gh api --method=PUT repos/o/r/pulls/1/merge',
    'gh api repos/o/r/pulls/1/merge/ -X PUT',
    'gh api -X PUT repos/o/r/pulls/1/%6Derge',
    'gh api -X PUT "repos/o/r/pulls/$N/merge"',
    'P=repos/o/r/pulls/1/merge; gh api -X PUT $P',
    'gh api graphql -f query="mutation{mergePullRequest(input:{}){clientMutationId}}"',
    'gh api graphql -f query="mutation{updateRef(input:{}){clientMutationId}}"',
    'gh api graphql -F query=@/tmp/q.graphql',
    'gh api graphql --input /tmp/q.json',
    'gh api graphql',
    'gh api repos/o/r/merges -f base=main -f head=feature/x',
    'gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=abc -F force=true',
    'gh api /repos/o/r/git/refs -f ref=refs/heads/main -f sha=abc',
    'gh api -X PUT repos/o/r/contents/a.txt -f message=m -f content=e',
    'gh api -X DELETE repos/o/r/branches/main/protection',
    'gh api repos/o/r/merge-upstream -f branch=main',
    'gh api --no-such-option repos/o/r/pulls',
    'gh repo sync o/r --branch main --source o/up --force',
    'curl -X PUT -H "Authorization: token $(gh auth token)" https://api.github.com/repos/o/r/pulls/1/merge',
    'curl -XPUT https://api.github.com/repos/o/r/pulls/1/merge',
    'curl --request=PATCH https://ghe.example.com/api/v3/repos/o/r/git/refs/heads/main -d {}',
    'curl -d @/tmp/q https://api.github.com/graphql',
    'curl -d {} https://api.github.com/repos/o/r/merges',
  ]) {
    assert.deepEqual(judge(line).codes, ['gh.unresolved'], line)
  }
})

test('gh api and curl that only read, or write elsewhere, still pass', () => {
  for (const line of [
    'gh api repos/o/r/pulls/1',
    'gh api repos/o/r/pulls/1/merge',
    'gh api -XGET repos/o/r/pulls/1/merge',
    'gh api -X GET repos/o/r/commits -f sha=main',
    `gh api graphql -f query='query { viewer { login } }'`,
    `gh api graphql -f query='{ viewer { login } }' -F n=1`,
    'gh api -X POST repos/o/r/issues/1/comments -f body=merged',
    'gh api repos/o/r/pulls --paginate --jq .[].number',
    'curl https://api.github.com/repos/o/r/pulls/1/merge',
    'curl -X GET https://api.github.com/repos/o/r/git/refs/heads/main',
    'curl -X POST https://example.com/hook -d {}',
  ]) {
    assert.equal(judge(line).decision, 'allow', line)
  }
})

// ---- high 1: writing the folder of the grants ------------------------------------------------------------

test('writing the grant folder from inside it, from above it, or with another case is refused', () => {
  for (const line of [
    'cd ~/.lanekeeper && mkdir owner',
    'cd ~/.lanekeeper; cd owner; N=gr; cp /tmp/g owner-${N}ant.json',
    'cd ~/.lanekeeper && tar -xf /tmp/h.tar',
    'cd ~/.lanekeeper && mv owner o2',
    'cd ~/.lanekeeper && cp -r /tmp/fake/owner owner',
    'cd ~/.lanekeeper && ln -s /tmp/fake/owner owner',
    'cd ~/.lanekeeper && cd owner && cp /tmp/g x',
    'cd ~/.lanekeeper; cd owner; cp /tmp/g own{er-grant,x}.json',
    'cd ~/.lanekeeper/ow* && cp /tmp/g owner-g*',
    'cd ~/.LANEKEEPER && python3 /tmp/mk.py',
    'tar -xf /tmp/h.tar -C ~',
    'cd ~ && tar -xf /tmp/h.tar',
    'tar -xf /tmp/h.tar -C ~/.lanekeeper',
    'tar --directory=$HOME -xf /tmp/h.tar',
    'cd ~ && unzip -o /tmp/h.zip',
    'unzip -o /tmp/h.zip -d ~',
    'cp -r /tmp/fake/.lanekeeper ~/',
    'cp -R /tmp/fake/. ~/',
    'cp -a /tmp/fake/. ~',
    'cp -R --target-directory=$HOME /tmp/fake/.',
    'rsync -a /tmp/fake/ ~/',
    'ditto /tmp/fake ~',
    'mv /tmp/fake/.lanekeeper ~/',
    'cd ~ && cp -r /tmp/fake/.lanekeeper .',
    'ln -s ~ /tmp/hh',
    'cp /tmp/g ~/.lanekeeper/ow*/own{er-grant,x}.json',
    'cp /tmp/g ~/.lanekeeper/ow{ner,x}/g',
    'cp /tmp/g ~/.LANEKEEPER/OWNER/OWNER-GRANT.JSON',
    'cp /tmp/g ~/.lanekeeper/OWNER/OWNER-GRANT.JSON',
    'cp /tmp/g ~/.lanekeeper/OWNER/x',
    'D=~/.lanekeeper/ow; cp /tmp/g ${D}ner/g',
    'N=owner-gr; cp /tmp/g ~/.lanekeeper/ow{ner,}/${N}ant.json',
    'H=$HOME/.lanekeeper; cp /tmp/g $H/ow{ner,}/x',
    'printf x > ~/.lanekeeper/ow{ner,}/x',
    'cat /tmp/g > ~/.lanekeeper/OWNER/OWNER-GRANT.JSON',
    'cd ~/.lanekeeper && cat /tmp/g > own*/own*.json',
    'cp /tmp/g /tmp/hh/.lanekeeper/ow{ner,}/x',
    'cp /tmp/g ~/.l*/owner/x',
    'git clone /tmp/fake ~/.lanekeeper/owner',
    'cd ~/.lanekeeper && git clone /tmp/fake owner',
  ]) {
    assert.ok(judge(line).codes.includes('paths.state'), `${line}: ${judge(line).codes}`)
  }
})

test('the file tools fold case as well, for the grant and for the personal file', () => {
  for (const rel of ['.LANEKEEPER/OWNER/OWNER-GRANT.JSON', '.lanekeeper/OWNER/OWNER-GRANT.JSON', '.lanekeeper/OWNER/x', '.lanekeeper/Owner/owner-grant.JSON']) {
    assert.deepEqual(write(path.join(f.home, rel)).reasons.map((x) => x.code), ['paths.state'], rel)
  }
  const r = evaluate({ hook_event_name: 'PreToolUse', cwd: f.repo, tool_name: 'Write', tool_input: { file_path: path.join(f.home, '.LANEKEEPER/PERSONAL.JSON'), content: '{"bypass_ack":true}' } }, env, {})
  assert.deepEqual(r.reasons.map((x) => x.code), ['paths.ack'])
  assert.equal(write(path.join(f.home, '.lanekeeper/machine.json')).reasons[0].code, 'paths.config', 'the settings still ask')
  assert.equal(write(path.join(f.home, '.LANEKEEPER/MACHINE.JSON')).reasons[0].code, 'paths.config')
})

test('work beside the grant folder is left alone', () => {
  for (const line of ['cat ~/.lanekeeper/owner/owner-grant.json', 'ls -la ~/.lanekeeper', 'cd ~/.lanekeeper && ls', 'cd ~/.lanekeeper && cat machine.json', 'cp /tmp/a.txt ~/', 'cp /tmp/a.txt ~/notes.txt', 'cp -R /tmp/x ~/proj/x', 'rsync -a /tmp/x/ ~/proj/', 'tar -xf /tmp/a.tar -C /tmp/y', 'tar -cf /tmp/a.tar -C ~ proj', 'cd ~ && ls', 'cd ~ && git status', 'echo hi > ~/notes.txt', 'rm -f /tmp/*.log', 'cp .lanekeeper/config.json /tmp/c.json', 'CFG=.lanekeeper/config.json; node /tmp/x.mjs $CFG']) {
    assert.ok(!judge(line).codes.includes('paths.state'), `${line}: ${judge(line).codes}`)
  }
})

test('the closed git routes stay closed', () => {
  for (const [line, code] of [
    ['git -c remote.origin.push=refs/heads/feature/x:refs/heads/main push origin feature/x', 'git.push_all'],
    ['git -c remote.origin.mirror=true push origin feature/x', 'git.push_all'],
    ['git push --mirror origin', 'git.push_all'],
    ['git -c core.hooksPath=/x push origin main', 'grant.missing'],
    ['git -c core.hooksPath=/x merge feature/x', 'grant.missing'],
    ['git push origin HEAD:heads/main', 'grant.missing'],
    ['lanekeeper-grant merge-main --dialog-ticket x', 'owner.variant'],
    ['lanekeeper-grant --dialog-ticket x', 'owner.variant'],
    ['cd .git && cd lanekeeper && N=gr && cp /tmp/g owner-${N}ant.json', 'paths.git_control'],
    ['cp -R /tmp/x/. .git/', 'paths.git_control'],
    ['tar -xf /tmp/h.tar -C .git', 'paths.git_control'],
  ]) {
    assert.ok(judge(line).codes.includes(code), `${line}: ${judge(line).codes}`)
  }
})
