"""Common result model shared by every adapter and the workbook writer.

suite  {kind, name, total, passed, failed, skipped, flaky, durationMs, status, source}
test   {kind, suite, project, name, file, line, status, durationMs, error, log, caseId, attempts, rerun}
gate   {step, cmd, status, exit, durationMs, detail, log}

kind    unit | integration | e2e | uistab
status  passed | failed | skipped | flaky | notRun
"""
import re

ANSI = re.compile(r'\x1b\[[0-9;]*m')
KINDS = ('unit', 'integration', 'e2e', 'uistab')


def clean(s):
    return ANSI.sub('', s or '')


def first_line(s):
    for ln in clean(s).splitlines():
        if ln.strip():
            return ln.strip()[:300]
    return ''


def parse_duration(text):
    """'961.22s' | '389ms' | '21.1m' | '1h 2m' -> milliseconds (None when there is no unit)."""
    if not text:
        return None
    total = 0.0
    found = False
    for num, unit in re.findall(r'(\d+(?:\.\d+)?)\s*(ms|s|m|h)\b', text):
        found = True
        v = float(num)
        total += {'ms': v, 's': v * 1000, 'm': v * 60000, 'h': v * 3600000}[unit]
    return round(total) if found else None


def suite(kind, name, source, total=0, passed=0, failed=0, skipped=0, flaky=0, duration=None, status=None):
    if status is None:
        status = 'failed' if failed else ('passed' if total else 'notRun')
    return {'kind': kind, 'name': name, 'total': total, 'passed': passed, 'failed': failed,
            'skipped': skipped, 'flaky': flaky, 'durationMs': duration, 'status': status, 'source': source}


def test_row(kind, suite_name, name, status, file='', line=None, error='', log='', project='', duration=None,
             attempts=None):
    return {'kind': kind, 'suite': suite_name, 'project': project, 'name': name, 'file': file, 'line': line,
            'status': status, 'durationMs': duration, 'error': error, 'log': log, 'caseId': '',
            'attempts': attempts or [], 'rerun': ''}


def suites_from_tests(tests, kind, source):
    """Group test rows by project (or suite) into suite rows."""
    by = {}
    for t in tests:
        s = by.setdefault(t['project'] or t['suite'], {'total': 0, 'passed': 0, 'failed': 0, 'skipped': 0, 'flaky': 0, 'dur': 0})
        s['total'] += 1
        s[t['status'] if t['status'] in s else 'skipped'] += 1
        s['dur'] += t['durationMs'] or 0
    return [suite(kind, k, source, v['total'], v['passed'], v['failed'], v['skipped'], v['flaky'], round(v['dur']))
            for k, v in by.items()]
