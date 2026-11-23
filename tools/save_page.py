#!/usr/bin/env python3
"""Save the tracker's page as page/index.html.

    python3 tools/save_page.py <file>

<file> is the tracker's page as saved to disk from the tracker. It can be the
page's HTML itself, or the stored document that wraps it as JSON, such as
{"text": "<meta ...>..."} or {"data": {"text": "..."}}. Either way the page's
text is written to page/index.html unchanged.

Save the page to disk with the tool's own save-to-file option. Do not retype
it: the page is tens of thousands of characters and one slip breaks it.
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "page" / "index.html"


def find_text(value, depth=0):
    """The page text inside a stored document, wherever it is wrapped."""
    if isinstance(value, str):
        return value if "dash.draw(" in value or "data-draw" in value else None
    if depth > 4:
        return None
    if isinstance(value, dict):
        for key in ("text", "data", "document", "doc", "value"):
            if key in value:
                found = find_text(value[key], depth + 1)
                if found:
                    return found
        for v in value.values():
            found = find_text(v, depth + 1)
            if found:
                return found
    if isinstance(value, list):
        for v in value:
            found = find_text(v, depth + 1)
            if found:
                return found
    return None


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    src = pathlib.Path(sys.argv[1])
    if not src.is_file():
        print(f"ERROR: {src} is not a file.")
        return 1
    raw = src.read_text(encoding="utf-8")
    text = None
    stripped = raw.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            text = find_text(json.loads(raw))
        except ValueError:
            text = None
    if text is None and ("dash.draw(" in raw or "data-draw" in raw) and "\\u003c" not in raw[:300]:
        text = raw
    if not text:
        print("ERROR: no tracker page found in that file. It should hold the page's HTML, with its dash.draw(...) scripts.")
        return 1
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"Wrote page/index.html ({len(text):,} characters).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
