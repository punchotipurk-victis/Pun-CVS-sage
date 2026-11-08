#!/usr/bin/env python3
"""Build the 3D Heart section's pages from heart3d/src into self-contained HTML files.

The Super App opens every lab through iframe srcdoc, so three.js, CSS, JS and data are inlined.
Both pages share the same modules; each page has its own template:

  src/index.html      -> dist/heart3d.html     LABS.heart3d    "3D Heart"             (#heart3d)
  src/pathology.html  -> dist/pathology.html   LABS.pathology  "Pathology simulator"  (#pathology)

Template markers (anywhere in a line; contents are inserted verbatim):
  <!--@THREE-->            three.min.js r0.158.0 (shared copy: ../echo-sim/vendor/three.min.js)
  <!--@INC:path-->         file contents, unchanged          (path relative to heart3d/); .html parts are expanded too
  <!--@INCSTRIP:path-->    file contents with surrounding whitespace stripped
  <!--@JSON:id:path-->     <script type="application/json" id="id">…</script> (validated, compact)

The refined-heart adapter is included straight from ../echo-sim/export/neo-heart-adapter.js
(one source of truth), between the NEO-HEART markers that echo-sim/tools/integrate_heart_mesh.py expects.

Usage:
  python heart3d/tools/build_heart3d.py                 # both pages
  python heart3d/tools/build_heart3d.py --page heart3d  # one page
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                                   # heart3d/
sys.path.insert(0, os.path.join(ROOT, "..", "echo-sim", "tools"))
from build_lab import check_inline, fetch_three, THREE_VERSION  # reuse the echo build's checks

PAGES = {"heart3d": ("src/index.html", "dist/heart3d.html"),
         "pathology": ("src/pathology.html", "dist/pathology.html")}
THREE = os.path.join(ROOT, "..", "echo-sim", "vendor", "three.min.js")
MARK = re.compile(r"<!--@(THREE|INC|INCSTRIP|JSON)(?::([^>]*))?-->")


def build(template, out):
    rp = lambda p: os.path.normpath(os.path.join(ROOT, p))
    if not os.path.exists(THREE):
        print(f"three.min.js missing; fetching three@{THREE_VERSION} …"); fetch_three(THREE)
    tpl = open(rp(template), encoding="utf-8").read()
    used = []

    def sub(m):
        kind, arg = m.group(1), m.group(2) or ""
        if kind == "THREE":
            txt = open(THREE, encoding="utf-8").read(); check_inline(txt, "three.min.js"); used.append(("three.min.js", len(txt))); return txt
        if kind in ("INC", "INCSTRIP"):
            txt = open(rp(arg), encoding="utf-8").read()
            if kind == "INCSTRIP": txt = txt.strip()
            if arg.endswith(".html"): txt = MARK.sub(sub, txt)       # shared parts may hold markers
            if arg.endswith(".js"): check_inline(txt, arg)
            used.append((arg, len(txt))); return txt
        jid, path = arg.split(":", 1)
        data = json.load(open(rp(path), encoding="utf-8"))
        txt = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
        used.append((path, len(txt))); return f'<script type="application/json" id="{jid}">{txt}</script>'

    html = MARK.sub(sub, tpl)
    for must in ("<!doctype html", 'charset="utf-8"', 'name="viewport"'):
        if must not in html.lower(): print(f"WARNING: {template} is missing {must!r}")
    os.makedirs(os.path.dirname(rp(out)), exist_ok=True)
    open(rp(out), "w", encoding="utf-8").write(html)
    for n, k in used: print(f"  inlined {n:48s} {k/1024:8.1f} KB")
    print(f"Built {out} ({len(html.encode('utf-8'))/1024:.0f} KB)")
    return rp(out)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--page", choices=list(PAGES), action="append")
    a = ap.parse_args()
    for k in a.page or [k for k in PAGES if os.path.exists(os.path.join(ROOT, PAGES[k][0]))]:
        build(*PAGES[k])


if __name__ == "__main__":
    main()
