#!/usr/bin/env python3
"""Короткий дайджест Playwright-трейсів невдалих тестів: консоль, помилки сторінки, невдалі запити.

Використання: trace-digest.py <каталог test-results>. Ніяких секретів не друкує: лише тип/текст подій.
"""
import json
import sys
import zipfile
from pathlib import Path

root = Path(sys.argv[1])
for trace in sorted(root.rglob("trace.zip"))[:3]:
    print(f"## {trace.parent.name[:90]}")
    try:
        with zipfile.ZipFile(trace) as z:
            names = [n for n in z.namelist() if n.endswith(".trace")]
            shown = 0
            for name in names:
                for line in z.read(name).decode("utf8", "replace").splitlines():
                    try:
                        ev = json.loads(line)
                    except ValueError:
                        continue
                    kind = ev.get("type")
                    if kind == "console":
                        text = ev.get("text", "")
                        print(f"console.{ev.get('messageType')}: {text[:240]}")
                        shown += 1
                    elif kind == "event" and ev.get("method") in ("pageError", "crash"):
                        print(f"{ev.get('method')}: {json.dumps(ev.get('params', {}))[:300]}")
                        shown += 1
                    elif kind == "log" and "abort" in json.dumps(ev).lower():
                        print(f"log: {json.dumps(ev)[:240]}")
                        shown += 1
                    if shown >= 40:
                        break
            if shown == 0:
                print("(подій консолі/помилок сторінки немає)")
    except Exception as exc:  # noqa: BLE001
        print(f"не вдалося прочитати трейс: {exc}")
