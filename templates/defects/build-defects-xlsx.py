#!/usr/bin/env python3
"""Defect register (defect-register.json) -> one-sheet Excel workbook.

usage: build-defects-xlsx.py <defect-register.json> <out.xlsx> <labels.json>
labels.json: {"sheet": "...", "columns": [...9 labels...], "severity": {...}, "status": {...}}
Needs openpyxl. Exit 3 when it is missing.
"""
import json
import sys

try:
    from openpyxl import Workbook
    from openpyxl.styles import Font
except ImportError:
    sys.stderr.write("openpyxl missing: python3 -m pip install openpyxl\n")
    sys.exit(3)


def main(argv):
    src, out, labels_file = argv[1], argv[2], argv[3]
    with open(src, encoding="utf-8") as f:
        reg = json.load(f)
    with open(labels_file, encoding="utf-8") as f:
        labels = json.load(f)
    book = Workbook()
    ws = book.active
    ws.title = labels.get("sheet", "defects")[:31]
    ws.append(labels["columns"])
    for c in ws[1]:
        c.font = Font(bold=True)
    for d in reg.get("defects", []):
        ws.append([
            d.get("id", ""),
            labels["severity"].get(d.get("severity", ""), d.get("severity", "")),
            labels["status"].get(d.get("status", ""), d.get("status", "")),
            ", ".join(d.get("case_ids") or []),
            (d.get("found") or "")[:10],
            (d.get("fixed") or "")[:10],
            d.get("lane", ""),
            d.get("title", ""),
            d.get("note", ""),
        ])
    widths = [8, 10, 10, 18, 12, 12, 10, 48, 40]
    for i, w in enumerate(widths):
        ws.column_dimensions[chr(65 + i)].width = w
    ws.freeze_panes = "A2"
    book.save(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
