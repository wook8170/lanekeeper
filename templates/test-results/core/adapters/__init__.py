"""Result adapters. Each adapter reads one tool's output and returns (suites, tests).

An adapter module exposes `parse_file(path, suite, kind)` for the structured output
(json / xml) and `parse_log(text, suite, kind, log_path)` for a console log. Both are
optional; the registry says which tool names are known.
"""
from . import jest, playwright, pytest_junit, vitest

ADAPTERS = {'vitest': vitest, 'jest': jest, 'playwright': playwright, 'pytest': pytest_junit}


def _read(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        return f.read()


def parse(adapter, kind, suite, file=None, log=None, read=None):
    """Read one stage result. Structured output wins, the log is the fallback.

    Returns (suites, tests). `read(path)` returns the file text (injected for tests)."""
    mod = ADAPTERS.get(adapter)
    if mod is None:
        raise ValueError('unknown adapter: %s (known: %s)' % (adapter, ', '.join(sorted(ADAPTERS))))
    read = read or _read
    if file:
        return mod.parse_file(file, suite, kind, read)
    if log:
        return mod.parse_log(read(log), suite, kind, log)
    raise ValueError('adapter %s needs a result file or a log' % adapter)
