#!/usr/bin/env python3
"""Embed (or update) a self-contained lab page in the Super App's index.html.

The app keeps every lab as base64 in `const LABS = { key: { title, b64 } }` and opens it
in an iframe via srcdoc. This script:
  1. adds or replaces LABS[<key>] (title + base64 of the lab HTML), keeping other labs untouched;
  2. adds a tab to the lab bar (<div class="tabs">) if missing.
Home "path" tiles and topic cards are design work: add those by hand (see the skill).

Usage:
  python embed_lab.py <index.html> <lab.html> --key echo --title "Echo Simulator Lab" \
         --tab-long "Echo simulator" --tab-short "Echo" [--dry-run]
"""
import argparse, base64, re, sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("index"); ap.add_argument("lab")
    ap.add_argument("--key", required=True); ap.add_argument("--title", required=True)
    ap.add_argument("--tab-long", required=True); ap.add_argument("--tab-short", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9]*", a.key):
        sys.exit("key must be lowercase letters/digits (it becomes the #hash route)")

    s = open(a.index, encoding="utf-8").read()
    lab_html = open(a.lab, encoding="utf-8").read()
    b64 = base64.b64encode(lab_html.encode("utf-8")).decode("ascii")

    i = s.find("const LABS = {")
    if i < 0: sys.exit("could not find 'const LABS = {' in index.html")
    j = s.find("\n};", i)
    if j < 0: sys.exit("could not find the end of the LABS object")
    block = s[i:j]
    title = a.title.replace('"', '\\"')
    entry = f'{a.key}: {{ title: "{title}", b64: "{b64}" }}'
    pat = re.compile(r'(\n\s*)' + re.escape(a.key) + r':\s*\{\s*title:\s*"[^"]*",\s*b64:\s*"[^"]*"\s*\}')
    if pat.search(block):
        block2 = pat.sub(lambda m: m.group(1) + entry, block, count=1); action = "replaced"
    else:
        block2 = block.rstrip()
        if not block2.endswith(","): block2 += ","
        block2 += "\n  " + entry; action = "added"
    s = s[:i] + block2 + s[j:]

    tab_msg = "tab already present"
    if f'data-topic="{a.key}"' not in s:
        t = s.find('<div class="tabs">')
        if t < 0:
            tab_msg = "WARNING: no <div class=\"tabs\"> found; add the tab by hand"
        else:
            end = s.find("</div>", t)
            tab = (f'  <a href="#{a.key}" data-topic="{a.key}"><span class="long">{a.tab_long}</span>'
                   f'<span class="short">{a.tab_short}</span></a>\n    ')
            s = s[:end] + tab + s[end:]; tab_msg = "tab added"

    print(f"LABS['{a.key}'] {action} ({len(lab_html)/1024:.0f} KB html → {len(b64)/1024:.0f} KB base64); {tab_msg}")
    print("Reminder: add a home tile / topic card by hand (copy the .card pattern, new colour token), "
          "and update the topics-page lede if it states the number of labs.")
    if not a.dry_run:
        open(a.index, "w", encoding="utf-8").write(s)


if __name__ == "__main__":
    main()
