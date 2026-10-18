#!/usr/bin/env python3
"""Write a workbook from a sheet spec (used by lib/quality.mjs).

    python3 write_xlsx.py <spec.json> <out.xlsx>

spec = {"sheets": [{"name": str, "columns": [str], "rows": [[cell, ...]]}]}
Every sheet gets a bold header row, frozen panes, an autofilter and column widths
from the longest cell (capped). Needs Python 3.8+ and openpyxl.
"""
import json
import re
import sys

BAD = re.compile(r'[\[\]:*?/\\]')
CTRL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')


def sheet_name(name, used):
    base = BAD.sub('_', str(name) or 'sheet')[:31] or 'sheet'
    n, out = 2, base
    while out.lower() in used:
        suffix = f'-{n}'
        out = base[:31 - len(suffix)] + suffix
        n += 1
    used.add(out.lower())
    return out


def cell(v):
    if isinstance(v, str):
        return CTRL.sub('', v)
    if v is None:
        return ''
    return v


def main(spec_file, out):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    with open(spec_file, encoding='utf-8') as f:
        spec = json.load(f)
    wb = Workbook()
    wb.remove(wb.active)
    used = set()
    head_fill = PatternFill('solid', fgColor='E8E8ED')
    for s in spec.get('sheets', []):
        ws = wb.create_sheet(sheet_name(s.get('name'), used))
        cols = s.get('columns') or []
        ws.append([cell(c) for c in cols])
        for c in ws[1]:
            c.font = Font(bold=True)
            c.fill = head_fill
            c.alignment = Alignment(vertical='center')
        for row in s.get('rows') or []:
            ws.append([cell(v) for v in row])
        widths = [len(str(c)) for c in cols]
        for row in s.get('rows') or []:
            for i, v in enumerate(row):
                if i >= len(widths):
                    widths.append(0)
                widths[i] = max(widths[i], len(str(v)))
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = min(max(w + 2, 8), 80)
        ws.freeze_panes = 'A2'
        if cols and ws.max_row > 1:
            ws.auto_filter.ref = f'A1:{get_column_letter(len(cols))}{ws.max_row}'
    if not wb.sheetnames:
        wb.create_sheet('sheet')
    wb.save(out)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.stderr.write('usage: write_xlsx.py <spec.json> <out.xlsx>\n')
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
