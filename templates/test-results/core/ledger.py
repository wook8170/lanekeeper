"""Case ledger: read `<module>.cases.json`, link e2e results to case ids, compare.

Ledger file: {version, module, prefix, retired_ids[], cases:[{id, title, priority, status, ...}]}
(a bare list of cases is accepted too). status: active | fixme. The older words pass | fail |
notImplemented | blocked are read as active | fixme | fixme | fixme.
A case may carry `spec` (file name) and `testTitle` to link a test that does not print the id.
"""
import json
import os
import re

from strings import T

LEGACY = {'pass': 'active', 'fail': 'fixme', 'notImplemented': 'fixme', 'blocked': 'fixme'}


def _norm(c, module=''):
    c = dict(c)
    c['status'] = LEGACY.get(c.get('status', ''), c.get('status', 'active'))
    c.setdefault('module', module)
    c.setdefault('scenario', c.get('title', ''))
    return c


def load_cases(cases_dir=None, documents=None):
    """-> (cases{id: case}, retired{id}). `documents` = already read json texts (a ledger at an older commit)."""
    cases, retired = {}, set()
    if documents is None:
        documents = []
        if cases_dir and os.path.isdir(cases_dir):
            for name in sorted(os.listdir(cases_dir)):
                if name.endswith('.cases.json'):
                    with open(os.path.join(cases_dir, name), encoding='utf-8') as f:
                        documents.append(f.read())
    for doc in documents:
        d = json.loads(doc)
        module = ''
        if isinstance(d, dict):
            module = d.get('module', '')
            retired.update(d.get('retired_ids', []))
            d = d.get('cases', [])
        for c in d:
            cases[c['id']] = _norm(c, module)
    return cases, retired


def id_regex(ids):
    """Regex for ids of the ledger's own prefixes, e.g. `PAY-001`. Empty ledger -> None."""
    prefixes = sorted({re.sub(r'-\d+$', '', i) for i in ids if re.search(r'-\d+$', i)}, key=len, reverse=True)
    if not prefixes:
        return None
    return re.compile(r'\b(' + '|'.join(re.escape(p) for p in prefixes) + r')-(\d+)((?:\s*[·,/]\s*\d+\b)*)')


def title_case_ids(name, rx):
    """Ids in a test title. `PAY-001 · 002` (later numbers without the prefix) expands to PAY-001, PAY-002."""
    out = []
    if rx is None:
        return out
    for m in rx.finditer(name):
        prefix, first, rest = m.groups()
        width = len(first)
        out.append('%s-%s' % (prefix, first))
        out += ['%s-%s' % (prefix, n.zfill(width)) for n in re.findall(r'\d+', rest or '')]
    return list(dict.fromkeys(out))


def link_cases(tests, cases):
    """Set test['caseIds'] (and caseId) for e2e / uistab rows: ids in the title first, then
    ledger `spec` + `testTitle` (or its 「quoted」 phrases) matches."""
    rx = id_regex(cases)
    by_spec = {}
    for c in cases.values():
        if c.get('spec'):
            by_spec.setdefault(os.path.basename(c['spec']), []).append(c)
    for t in tests:
        if t['kind'] not in ('e2e', 'uistab'):
            continue
        ids = title_case_ids(t['name'], rx)
        for c in by_spec.get(os.path.basename(t['file'] or ''), []):
            title = (c.get('testTitle') or '').strip()
            quoted = re.findall(r'「([^」]{4,})」', title)
            if (title and title in t['name']) or any(q in t['name'] for q in quoted):
                ids.append(c['id'])
        t['caseIds'] = list(dict.fromkeys(ids))
        t['caseId'] = t['caseIds'][0] if t['caseIds'] else ''


def compare(tests, cases, retired=(), priority=None):
    """Mismatch rows between the ledger and the run. Empty list = they agree."""
    by_case = {}
    for t in tests:
        if t['kind'] in ('e2e', 'uistab'):
            for cid in t.get('caseIds') or ([]):
                by_case.setdefault(cid, []).append(t)
    rows = []
    for cid, ts in sorted(by_case.items()):
        per = ' · '.join('%s %s' % (t['project'], t['status']) + ('(rerun %s)' % t['rerun'] if t.get('rerun') else '') for t in ts)
        sts = {t['status'] for t in ts}
        actual = 'failed' if 'failed' in sts else ('flaky' if 'flaky' in sts else ('passed' if 'passed' in sts else 'skipped'))
        c = cases.get(cid)
        base = {'caseId': cid, 'actual': actual, 'detail': per}
        if cid in retired:
            rows.append(dict(base, priority='', module='', ledger='(retired)', kind=T('ledger.retired'), scenario=ts[0]['name']))
            continue
        if not c:
            rows.append(dict(base, priority='', module='', ledger='(not in ledger)', kind=T('ledger.missing'), scenario=ts[0]['name']))
            continue
        led = c['status']
        kind = None
        if led == 'active' and actual == 'failed':
            kind = T('ledger.active_failed')
        elif led == 'active' and actual == 'flaky':
            kind = T('ledger.active_flaky')
        elif led == 'active' and actual == 'skipped':
            kind = T('ledger.active_skipped')
        elif led == 'fixme' and actual == 'passed':
            kind = T('ledger.fixme_passed')
        if kind:
            rows.append(dict(base, priority=c.get('priority', ''), module=c.get('module', ''), ledger=led, kind=kind,
                             scenario=c.get('scenario', '')))
    if priority:
        for cid, c in sorted(cases.items()):
            if c.get('priority') == priority and c['status'] == 'active' and cid not in by_case:
                rows.append({'caseId': cid, 'priority': c.get('priority', ''), 'module': c.get('module', ''), 'ledger': c['status'],
                             'actual': 'notRun', 'detail': '', 'kind': T('ledger.not_in_run', priority=priority),
                             'scenario': c.get('scenario', '')})
    return rows
