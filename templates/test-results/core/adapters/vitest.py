"""vitest: `--reporter=json --outputFile=<file>` or the console log of one run."""
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
    starts = [tr['startTime'] for tr in results if tr.get('startTime') is not None]
    ends = [tr['endTime'] for tr in results if tr.get('endTime') is not None]
    t0 = data.get('startTime') if data.get('startTime') is not None else (min(starts) if starts else None)
    dur = (max(ends) - t0) if ends and t0 is not None else None  # wall clock, not the sum of files
    for tr in results:
        file = tr.get('name', '')
        ars = tr.get('assertionResults', [])
        if not ars and tr.get('status') == 'failed':
            failed += 1
            tests.append(test_row(kind, suite_name, '(file failed to load)', 'failed', file, None,
                                  first_line(tr.get('message', '')), source))
        for a in ars:
            st = a.get('status')
            if st == 'passed':
                passed += 1
            elif st == 'failed':
                failed += 1
                msg = '\n'.join(a.get('failureMessages') or [])
                line = (a.get('location') or {}).get('line')
                if line is None:
                    lm = re.search(re.escape(os.path.basename(file)) + r':(\d+):\d+', clean(msg))
                    line = int(lm.group(1)) if lm else None
                name = ' > '.join(list(a.get('ancestorTitles', [])) + [a.get('title', '')])
                tests.append(test_row(kind, suite_name, name, 'failed', file, line, first_line(msg), source,
                                      duration=a.get('duration')))
            else:
                skipped += 1
    total = data.get('numTotalTests', passed + failed + skipped)
    return [suite(kind, suite_name, source, total, passed, failed, skipped, 0, round(dur) if dur is not None else None)], tests


def _counts(line):
    c = {k: 0 for k in ('failed', 'passed', 'skipped', 'todo')}
    for n, k in re.findall(r'(\d+) (failed|passed|skipped|todo)', line):
        c[k] += int(n)
    m = re.search(r'\((\d+)\)\s*$', line)
    return (int(m.group(1)) if m else sum(c.values())), c


def parse_log(text, suite_name, kind, log_path=''):
    """One vitest run: ` Tests  1 failed | 2 passed (3)`, ` Duration  1.2s`, ` FAIL  file > a > b` lines."""
    lines = [clean(x) for x in text.splitlines()]
    name = suite_name or os.path.basename(log_path).rsplit('.', 1)[0] or 'vitest'
    tests, total, counts, dur = [], None, None, None
    for i, ln in enumerate(lines):
        if re.match(r'^\s+Tests\s+\d', ln):
            total, counts = _counts(ln)
        elif re.match(r'^\s+Duration\s+', ln) and dur is None:
            dur = parse_duration(ln.split('Duration', 1)[1].split('(')[0])
        elif ln.startswith(' FAIL  '):
            parts = [p.strip() for p in ln[7:].strip().split(' > ')]
            file = parts[0].split(' [')[0]
            title = ' > '.join(parts[1:]) or file
            err, line_no = '', None
            for nxt in lines[i + 1:i + 600]:
                if nxt.startswith(' FAIL  ') or nxt.startswith('⎯'):
                    break
                if not err and nxt.strip():
                    err = nxt.strip()[:300]
                lm = re.match(r'^\s*❯ (\S+?):(\d+):\d+', nxt)
                if lm and lm.group(1).endswith(os.path.basename(file)):
                    line_no = int(lm.group(2))
                    break
            tests.append(test_row(kind, name, title, 'failed', file, line_no, err, '%s:%d' % (log_path, i + 1) if log_path else ''))
    if counts is None:
        failed = len(tests)
        return [suite(kind, name, log_path, failed, 0, failed, 0, 0, dur, status='failed' if failed else 'notRun')], tests
    return [suite(kind, name, log_path, total, counts['passed'], counts['failed'], counts['skipped'] + counts['todo'], 0, dur)], tests
