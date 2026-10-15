"""Playwright: json reporter output or the `list` reporter console log (retries -> flaky)."""
import json
import re

from model import clean, first_line, parse_duration, suites_from_tests, test_row


def parse_file(path, suite_name, kind, read):
    return parse_json(json.loads(read(path)), kind, path)


def parse_json(data, kind='e2e', source=''):
    tests = []

    def walk(s, titles, file):
        f = s.get('file') or file
        t2 = titles + ([s['title']] if s.get('title') and s.get('title') != s.get('file') else [])
        for spec in s.get('specs', []):
            for t in spec.get('tests', []):
                results = t.get('results', [])
                attempts = [r.get('status') for r in results]
                st = t.get('status')
                status = {'expected': 'passed', 'unexpected': 'failed', 'flaky': 'flaky', 'skipped': 'skipped'}.get(st, st)
                if status == 'passed' and attempts and attempts[-1] == 'skipped':
                    status = 'skipped'
                last = results[-1] if results else {}
                err = ''
                for r in results:
                    if r.get('status') not in ('passed', 'skipped'):
                        errs = r.get('errors') or ([r['error']] if r.get('error') else [])
                        if errs:
                            err = first_line(errs[0].get('message', ''))
                            break
                name = ' › '.join(t2 + [spec.get('title', '')])
                tests.append(test_row(kind, t.get('projectName', ''), name, status, spec.get('file', f),
                                      spec.get('line'), err, source, t.get('projectName', ''),
                                      last.get('duration'), attempts))
        for sub in s.get('suites', []):
            walk(sub, t2, f)

    for s in data.get('suites', []):
        walk(s, [], s.get('file', ''))
    return suites_from_tests(tests, kind, source), tests


PW_LINE = re.compile(r'^\s+(✓|✘|-|×|ok|x)\s+\d+\s+\[([\w-]+)\] › (\S+?):(\d+):\d+ › (.+?)(?: \((\d[\d.]*m?s|\d[\d.]*m)\))?\s*$')


def parse_log(text, suite_name, kind='e2e', log_path=''):
    """`✓ 1 [chromium] › specs/x.spec.ts:12:3 › title (2.0s)` lines. A test that shows up again
    (retry) adds an attempt; failed then passed = flaky. The first error line comes from the `1) [project] › ...` block."""
    lines = [clean(x) for x in text.splitlines()]
    order, by = [], {}
    for i, ln in enumerate(lines):
        m = PW_LINE.match(ln)
        if not m:
            continue
        mark, proj, file, line, rest, dur = m.groups()
        title = re.sub(r'\s*\(retry #\d+\)', '', rest).strip()
        key = (proj, file, int(line), title)
        st = {'✓': 'passed', 'ok': 'passed', '-': 'skipped'}.get(mark, 'failed')
        if key not in by:
            order.append(key)
            by[key] = test_row(kind, proj, title, st, file, int(line), '', '%s:%d' % (log_path, i + 1) if log_path else '',
                               proj, parse_duration(dur or ''), [st])
        else:
            by[key]['attempts'].append(st)
            by[key]['durationMs'] = parse_duration(dur or '')
    for t in by.values():
        a = t['attempts']
        t['status'] = 'flaky' if (a[-1] == 'passed' and 'failed' in a) else a[-1]
    for i, ln in enumerate(lines):
        m = re.match(r'^\s+\d+\) \[([\w-]+)\] › (\S+?):(\d+):\d+ › (.+?)\s*$', ln)
        if not m:
            continue
        proj, file, line = m.group(1), m.group(2), int(m.group(3))
        for t in by.values():
            if t['project'] == proj and t['file'] == file and t['line'] == line and not t['error']:
                for nxt in lines[i + 1:i + 30]:
                    s = nxt.strip()
                    if s and not s.startswith('Retry #') and not s.startswith('─'):
                        t['error'] = s[:300]
                        break
                if log_path:
                    t['log'] = '%s:%d' % (log_path, i + 1)
    tests = [by[k] for k in order]
    return suites_from_tests(tests, kind, log_path), tests
