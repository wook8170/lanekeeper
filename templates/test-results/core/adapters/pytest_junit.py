"""pytest: `--junitxml=<file>` (no plugin needed) or the console log of one run."""
import os
import re
import xml.etree.ElementTree as ET

from model import clean, first_line, parse_duration, suite, test_row


def parse_file(path, suite_name, kind, read):
    root = ET.fromstring(read(path))
    cases = root.iter('testcase')
    tests = []
    passed = failed = skipped = 0
    dur = 0.0
    for tc in cases:
        dur += float(tc.get('time') or 0)
        cls, name = tc.get('classname') or '', tc.get('name') or ''
        file = tc.get('file') or (cls.replace('.', '/') + '.py' if cls else '')
        line = int(tc.get('line')) if (tc.get('line') or '').isdigit() else None
        title = '%s::%s' % (cls, name) if cls else name
        bad = tc.find('failure')
        if bad is None:
            bad = tc.find('error')
        if bad is not None:
            failed += 1
            msg = bad.get('message') or (bad.text or '')
            tests.append(test_row(kind, suite_name, title, 'failed', file, line, first_line(msg), path,
                                  duration=round(float(tc.get('time') or 0) * 1000)))
        elif tc.find('skipped') is not None:
            skipped += 1
        else:
            passed += 1
    total = passed + failed + skipped
    return [suite(kind, suite_name, path, total, passed, failed, skipped, 0, round(dur * 1000))], tests


def parse_log(text, suite_name, kind, log_path=''):
    """`FAILED tests/test_a.py::test_x - message` lines and the closing `== 1 failed, 2 passed in 0.5s ==`."""
    lines = [clean(x) for x in text.splitlines()]
    name = suite_name or os.path.basename(log_path).rsplit('.', 1)[0] or 'pytest'
    tests = []
    counts, dur = None, None
    for i, ln in enumerate(lines):
        m = re.match(r'^(FAILED|ERROR) (\S+?)::(\S.*?)(?: - (.*))?$', ln)
        if m:
            tests.append(test_row(kind, name, m.group(3), 'failed', m.group(2), None, (m.group(4) or '')[:300],
                                  '%s:%d' % (log_path, i + 1) if log_path else ''))
            continue
        m = re.match(r'^=+ (.+?) in ([\d.]+)s(?: \(.*\))? =+$', ln)
        if m:
            counts = {k: 0 for k in ('failed', 'passed', 'skipped', 'error', 'xfailed', 'xpassed')}
            for n, k in re.findall(r'(\d+) (failed|passed|skipped|error|errors|xfailed|xpassed)', m.group(1)):
                counts['error' if k == 'errors' else k] += int(n)
            dur = round(float(m.group(2)) * 1000)
    if counts is None:
        n = len(tests)
        return [suite(kind, name, log_path, n, 0, n, 0, 0, None, status='failed' if n else 'notRun')], tests
    failed = counts['failed'] + counts['error']
    total = failed + counts['passed'] + counts['skipped'] + counts['xfailed'] + counts['xpassed']
    return [suite(kind, name, log_path, total, counts['passed'] + counts['xpassed'], failed, counts['skipped'] + counts['xfailed'], 0, dur)], tests
