#!/usr/bin/env python3
"""Check the site's page and data, then write data/manifest.json.

Run from anywhere:  python3 tools/stamp.py
Check without writing:  python3 tools/stamp.py --check-only

It exits with code 0 and prints "OK TO PUBLISH" when the site is complete.
It exits with code 1 and prints "DO NOT PUBLISH" when a file the page needs is
missing, empty or not valid JSON. Publish only after a pass.

What it checks
  page/index.html   exists and is the tracker's page
  data/<id>.json    one valid JSON file for every dataset the page reads
What it writes
  data/manifest.json  the list of datasets the site loads, with a fingerprint
                      of each file so browsers fetch a file again only when it
                      has changed, and the date each file last changed

Standard library only; needs Python 3.8 or later.
"""

import argparse
import datetime
import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "page" / "index.html"
DATA = ROOT / "data"
MANIFEST = DATA / "manifest.json"
EXPECTED = ROOT / "tools" / "expected-columns.json"

ID = r"[A-Za-z0-9_-]{1,64}"
BIG_FILE = 25 * 1024 * 1024      # warn above this size
HARD_LIMIT = 95 * 1024 * 1024    # GitHub refuses files of 100 MB and more


def reject_constant(name):
    raise ValueError(f"{name} is not valid JSON and browsers refuse it")


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh, parse_constant=reject_constant)


def rows_of(value):
    """Rows as the site reads them: an array, bare or under rows/data/results."""
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for key in ("rows", "data", "results"):
            if isinstance(value.get(key), list):
                return value[key]
    return None


def page_needs(html):
    """Dataset ids the page reads, minus the values it works out itself."""
    calcs = set(re.findall(r"dash\.calc\(\s*['\"](" + ID + r")['\"]", html))
    read = set(re.findall(r"dash\.data\(\s*['\"](" + ID + r")['\"]", html))
    for block in re.findall(r"inputs\s*:\s*\[([^\]]*)\]", html):
        read.update(re.findall(r"['\"](" + ID + r")['\"]", block))
    return sorted(read - calcs)


def first_heading(html):
    m = re.search(r"<h1[^>]*>(.*?)</h1>", html, flags=re.S | re.I)
    if not m:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--title", help="page title for the browser tab (default: keep the last one, or the page's heading)")
    ap.add_argument("--check-only", action="store_true", help="check, but do not write data/manifest.json")
    args = ap.parse_args()

    errors, warnings = [], []

    # ---- the page -------------------------------------------------------
    html = ""
    if not PAGE.is_file():
        errors.append("page/index.html is missing. Save the tracker's page there.")
    else:
        html = PAGE.read_text(encoding="utf-8", errors="replace")
        if "dash.draw(" not in html and "data-draw" not in html:
            errors.append("page/index.html does not look like the tracker's page (no drawings found).")
        if "\\u003c" in html[:200] or html.lstrip().startswith('{"'):
            errors.append("page/index.html holds escaped or JSON text. Save the page's text itself, not the document that wraps it.")
        if "/_blob/" in html:
            warnings.append("page/index.html points at a file stored in the tracker (/_blob/...). That file is not on this site, so it will not show.")
        if "claude.use(" in html:
            warnings.append("page/index.html uses claude.use(...), which works only inside Claude. That part of the page will not work here.")
        for src in re.findall(r"<script[^>]+src=[\"']([^\"']+)[\"']", html) + re.findall(r"<link[^>]+href=[\"']([^\"']+)[\"']", html):
            if not (ROOT / "page" / src).is_file():
                warnings.append(f"page/index.html names the file {src!r}, which is not in page/. Copy it there or it is dropped.")

    needed = page_needs(html) if html else []

    # ---- the data -------------------------------------------------------
    previous = {}
    if MANIFEST.is_file():
        try:
            previous = load_json(MANIFEST)
        except Exception:
            previous = {}
    prev_sets = previous.get("datasets") if isinstance(previous.get("datasets"), dict) else {}

    expected = {}
    if EXPECTED.is_file():
        try:
            expected = load_json(EXPECTED)
        except Exception as exc:
            warnings.append(f"tools/expected-columns.json could not be read ({exc}).")

    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    datasets = {}
    files = sorted(p for p in DATA.glob("*.json") if p.name != "manifest.json") if DATA.is_dir() else []
    by_id = {p.stem: p for p in files}

    for ds in needed:
        if ds not in by_id:
            errors.append(f"data/{ds}.json is missing. The page reads the dataset {ds!r}.")

    for ds, path in by_id.items():
        if not re.fullmatch(ID, ds):
            warnings.append(f"data/{path.name} is skipped: a dataset name may hold only letters, digits, _ and -.")
            continue
        raw = path.read_bytes()
        size = len(raw)
        try:
            value = load_json(path)
        except Exception as exc:
            errors.append(f"data/{path.name} is not valid JSON: {exc}")
            continue
        rows = rows_of(value)
        if rows is None:
            (errors if ds in needed else warnings).append(
                f"data/{path.name} holds no list of rows (an array, or an object with rows, data or results).")
        elif not rows and ds in needed:
            errors.append(f"data/{path.name} has no rows.")
        if size >= HARD_LIMIT:
            errors.append(f"data/{path.name} is {size / 1048576:.0f} MB. GitHub refuses files of 100 MB or more.")
        elif size >= BIG_FILE:
            warnings.append(f"data/{path.name} is {size / 1048576:.0f} MB, which is slow to load. Simplify it if you can.")
        if ds not in needed:
            warnings.append(f"data/{path.name} is not read by the page. It is published anyway.")

        want = expected.get(ds) if isinstance(expected, dict) else None
        if rows and isinstance(want, list):
            seen = set()
            for r in rows[:500]:
                if isinstance(r, dict):
                    seen.update(r.keys())
            lacking = [c for c in want if c not in seen]
            if lacking:
                warnings.append(f"data/{path.name} has no column named {', '.join(lacking)}. The page reads it, so check that part of the page.")

        sha = hashlib.sha256(raw).hexdigest()
        prev = prev_sets.get(ds) if isinstance(prev_sets.get(ds), dict) else {}
        changed = prev.get("changed") if prev.get("sha256") == sha and prev.get("changed") else now
        datasets[ds] = {
            "file": path.name,
            "bytes": size,
            "rows": len(rows) if rows is not None else None,
            "sha256": sha,
            "changed": changed,
        }

    # ---- report ---------------------------------------------------------
    title = args.title or previous.get("title") or first_heading(html) or "Tracker"
    manifest = {
        "title": title,
        "titleSuffix": previous.get("titleSuffix", "Tenax Strategies"),
        "lang": previous.get("lang", "en"),
        "published": now,
        "datasets": datasets,
    }
    if isinstance(previous.get("params"), dict):
        manifest["params"] = previous["params"]

    print(f"Page: {'found' if html else 'MISSING'}  ({len(html):,} characters)")
    print(f"Datasets the page reads: {len(needed)}  ({', '.join(needed) or 'none'})")
    for ds in sorted(datasets):
        d = datasets[ds]
        fresh = "changed now" if d["changed"] == now else f"unchanged since {d['changed'][:10]}"
        rows = "n/a" if d["rows"] is None else f"{d['rows']:,}"
        print(f"  {ds:<12} {rows:>8} rows  {d['bytes'] / 1024:>9,.0f} KB  {fresh}")
    for w in warnings:
        print(f"WARNING: {w}")
    for e in errors:
        print(f"ERROR: {e}")

    if errors:
        print("\nDO NOT PUBLISH. Fix the errors above and run this again.")
        return 1
    if not args.check_only:
        DATA.mkdir(exist_ok=True)
        MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print("\nWrote data/manifest.json")
    print("OK TO PUBLISH.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
