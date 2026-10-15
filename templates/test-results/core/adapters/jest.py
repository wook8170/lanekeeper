"""jest: `--json --outputFile=<file>` or the console log of one run."""
import json
import os
import re

from model import clean, first_line, parse_duration, suite, test_row


def parse_file(path, suite_name, kind, read):
    return _from_json(json.loads(read(path)), suite_name, kind, path)


def _from_json(data, suite_name, kind, source):
    tests = []
    passed = failed = skipped = 0
    results = data.get('testResults', [])
    ends = [tr['endTime'] for tr in results if tr.get('endTime') is not None]
    t0 = data.get('startTime')
    dur = (max(ends) - t0) if ends and t0 is not None else None
    for tr in results:
        file = tr.get('name', '')
        ars = tr.get('assertionResults', [])
        if not ars and tr.get('status') == 'failed':
            failed += 1
            tests.append(test_row(kind, suite_name, '(suite failed to run)', 'failed', file, None,
                                  first_line(tr.get('message', '')), source))
        for a in ars:
            st = a.get('status')
            if st == 'passed':
                passed += 1
            elif st == 'failed':
                failed += 1
                msg = '\n'.join(a.get('failureMessages') or [])
                loc = a.get('location') or {}
                line = loc.get('line')
                if line is None:
                    lm = re.search(re.escape(os.path.basename(file)) + r':(\d+):\d+', clean(msg))
                    line = int(lm.group(1)) if lm else None
                name = ' > '.join(list(a.get('ancestorTitles', [])) + [a.get('title', '')])
                tests.append(test_row(kind, suite_name, name, 'failed', file, line, first_line(msg), source,
                                      duration=a.get('duration')))
            else:  # pending | todo | skipped | disabled
                skipped += 1
    total = passed + failed + skipped
    return [suite(kind, suite_name, source, total, passed, failed, skipped, 0, round(dur) if dur is not None else None)], tests


def parse_log(text, suite_name, kind, log_path=''):
    """Summary line `Tests:  1 failed, 2 passed, 3 total`, `Time:  1.2 s`, `● Suite › test` failure blocks."""
    lines = [clean(x) for x in text.splitlines()]
    name = suite_name or os.path.basename(log_path).rsplit('.', 1)[0] or 'jest'
    counts, total, dur = None, None, None
    tests = []
    for i, ln in enumerate(lines):
        m = re.match(r'^Tests:\s+(.*)$', ln)
        if m:
            counts = {k: 0 for k in ('failed', 'passed', 'skipped', 'todo')}
            for n, k in re.findall(r'(\d+) (failed|passed|skipped|todo)', m.group(1)):
                counts[k] += int(n)
            t = re.search(r'(\d+) total', m.group(1))
            total = int(t.group(1)) if t else sum(counts.values())
        elif re.match(r'^Time:\s+', ln) and dur is None:
            dur = parse_duration(ln.split(':', 1)[1].split(',')[0].replace(' s', 's'))
        elif ln.startswith('  ● ') and '›' in ln:
            title = ln[4:].strip()
            err = ''
            for nxt in lines[i + 1:i + 40]:
                if nxt.strip():
                    err = nxt.strip()[:300]
                    break
            tests.append(test_row(kind, name, title.replace(' › ', ' > '), 'failed', '', None, err,
                                  '%s:%d' % (log_path, i + 1) if log_path else ''))
    # a failure block is printed once per failed test
    seen, uniq = set(), []
    for t in tests:
        if t['name'] not in seen:
            seen.add(t['name'])
            uniq.append(t)
    if counts is None:
        n = len(uniq)
        return [suite(kind, name, log_path, n, 0, n, 0, 0, dur, status='failed' if n else 'notRun')], uniq
    return [suite(kind, name, log_path, total, counts['passed'], counts['failed'], counts['skipped'] + counts['todo'], 0, dur)], uniq
