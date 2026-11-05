#!/usr/bin/env python3
"""Assemble the Echo Simulator Lab into ONE self-contained HTML file.

The Super App loads every lab through iframe srcdoc, so nothing can be fetched by
relative URL: three.js, all JS/CSS and the JSON data must be inlined.

Usage:
  python build_lab.py <echo-sim-dir> [--template src/index.html] [--out dist/echo-sim.html] [--three vendor/three.min.js]
  (the dev render test: --template src/dev/render-test.html --out dist/render-test.html)

Template markers inside the template (one per line):
  <!--@THREE-->                          -> <script>three.min.js r158</script>
  <!--@CSS:src/ui/style.css-->           -> <style>...</style>
  <!--@JS:src/engine/phantom.js-->       -> <script>...</script>
  <!--@JSON:phantom:data/phantom-normal.json-->  -> <script type="application/json" id="phantom">...</script>
  <!--@JSON?:viewsOverrides:data/views.overrides.json-->  ('?' = optional; emits "{}" if missing)
"""
import argparse, io, json, os, re, subprocess, sys, tarfile, tempfile

THREE_VERSION = "0.158.0"   # last version that still ships build/three.min.js; matches the other labs


def fetch_three(dest):
    """npm pack three@0.158.0, extract build/three.min.js, neutralise the leading console.warn line."""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["npm", "pack", f"three@{THREE_VERSION}", "--silent"], cwd=tmp, check=True,
                       stdout=subprocess.DEVNULL)
        tgz = [f for f in os.listdir(tmp) if f.endswith(".tgz")][0]
        with tarfile.open(os.path.join(tmp, tgz)) as t:
            src = t.extractfile("package/build/three.min.js").read().decode("utf-8")
    lines = src.split("\n")
    for i, ln in enumerate(lines[:5]):
        if ln.startswith("console.warn(") and ln.rstrip().endswith("),"):
            lines[i] = "0,"          # deleting the line outright breaks the comma expression
            break
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest, "w", encoding="utf-8").write("\n".join(lines))
    return dest


def check_inline(text, label):
    if re.search(r"</script", text, re.I):
        sys.exit(f"ERROR: {label} contains '</script' which would end the inline <script> early. "
                 "Split the string (e.g. '<\\/script') in the source.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--template", default="src/index.html")
    ap.add_argument("--out", default="dist/echo-sim.html")
    ap.add_argument("--three", default="vendor/three.min.js")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    rp = lambda p: p if os.path.isabs(p) else os.path.join(root, p)

    three_path = rp(a.three)
    if not os.path.exists(three_path):
        print(f"three.min.js not found at {three_path}; fetching three@{THREE_VERSION} via npm …")
        fetch_three(three_path)

    tpl = open(rp(a.template), encoding="utf-8").read()
    out_lines, used = [], []
    for line in tpl.split("\n"):
        m = re.match(r"\s*<!--@(THREE|CSS|JSON\??|JS)(?::([^>]*))?-->\s*$", line)
        if not m:
            out_lines.append(line); continue
        kind, arg = m.group(1), (m.group(2) or "")
        if kind == "THREE":
            js = open(three_path, encoding="utf-8").read(); check_inline(js, "three.min.js")
            out_lines.append(f"<script>{js}</script>"); used.append(("three", len(js)))
        elif kind == "CSS":
            css = open(rp(arg), encoding="utf-8").read()
            out_lines.append(f"<style>\n{css}\n</style>"); used.append((arg, len(css)))
        elif kind == "JS":
            js = open(rp(arg), encoding="utf-8").read(); check_inline(js, arg)
            out_lines.append(f"<script>\n{js}\n</script>"); used.append((arg, len(js)))
        else:  # JSON / JSON?
            jid, path = arg.split(":", 1)
            if not os.path.exists(rp(path)):
                if kind == "JSON?":
                    data = {}
                else:
                    sys.exit(f"ERROR: missing required JSON {path}")
            else:
                data = json.load(open(rp(path), encoding="utf-8"))   # also validates the JSON
            txt = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
            out_lines.append(f'<script type="application/json" id="{jid}">{txt}</script>')
            used.append((path, len(txt)))

    html = "\n".join(out_lines)
    for must in ("<!doctype html", 'charset="utf-8"', 'name="viewport"'):
        if must not in html.lower():
            print(f"WARNING: page is missing {must!r} (srcdoc pages need their own doctype/charset/viewport)")
    out = rp(a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(html)
    for name, n in used:
        print(f"  inlined {name:45s} {n/1024:8.1f} KB")
    print(f"Built {out}  ({len(html.encode('utf-8'))/1024:.0f} KB)")


if __name__ == "__main__":
    main()
