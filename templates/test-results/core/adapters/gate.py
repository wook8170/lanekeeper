"""Gate step record: `gate.json` written by run-gate.mjs, or a plain pass/fail marker log."""
import re

from model import clean


def parse_json(data, source=''):
    return [{'step': s.get('name', ''), 'cmd': s.get('cmd', ''), 'status': s.get('status', ''), 'exit': s.get('exit'),
             'durationMs': s.get('durationMs'), 'detail': s.get('detail', ''), 'log': s.get('log', source)}
            for s in data.get('steps', [])]


def parse_log(text, log_path=''):
    """Lines that start with a check mark (passed) or a cross (failed); the rest is ignored."""
    rows = []
    for i, ln in enumerate(clean(text).splitlines(), 1):
        m = re.match(r'^\s*(✓|✔|✗|✘|×)\s+(.+?)\s*$', ln)
        if m:
            rows.append({'step': m.group(2), 'cmd': '', 'status': 'passed' if m.group(1) in '✓✔' else 'failed',
                         'exit': None, 'durationMs': None, 'detail': '', 'log': '%s:%d' % (log_path, i) if log_path else ''})
    return rows
