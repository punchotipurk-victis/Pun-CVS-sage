#!/usr/bin/env python3
"""Put the two pages of the 3D Heart section into a site page (re-runnable).

  python heart3d/tools/integrate_heart3d.py <index.html> [--out OUT] [--no-build]

1. builds dist/heart3d.html and dist/pathology.html (tools/build_heart3d.py);
2. sets LABS.heart3d = "3D Heart" and adds/replaces LABS.pathology = "Pathology simulator";
3. puts a "Pathology simulator" tab (data-group="heart") right after the 3D Heart tab, so the
   top-right switcher of this section shows "3D Heart · Pathology simulator";
4. stores the refined heart's interior ONCE in the site page (<script id="pun-heart-interior">, lazy window.PUN_HEART_INTERIOR),
   next to the outer mesh that echo-sim/tools/integrate_heart_mesh.py stores (window.PUN_HEART_MESH); re-runnable;
5. patches the shell router once (marker /*HEART3D-ROUTE*/):
   - routes may carry a sub-path: #pathology/af opens LABS.pathology and passes "af" to it;
   - every lab iframe is told {pun:"lab", visible} when it is shown or hidden (labs pause when hidden),
     and the current lab also gets {sub}. Messages are re-sent when an iframe finishes loading.
Other labs ignore these messages. The refined heart mesh (window.PUN_HEART_MESH) is left as it is.
"""
import argparse, base64, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
PAGES = [("heart3d", "3D Heart", "dist/heart3d.html", "3D Heart", "3D"),
         ("pathology", "Pathology simulator", "dist/pathology.html", "Pathology simulator", "Pathology")]
MARK = "/*HEART3D-ROUTE*/"
INTERIOR = os.path.join(ROOT, "..", "echo-sim", "export", "heart-interior.json")
GETTER = ('<script>/* refined heart interior for the 3D Heart page (heart3d/tools/integrate_heart3d.py) */'
          'Object.defineProperty(window,"PUN_HEART_INTERIOR",{configurable:true,get(){if(this.__phi===undefined){'
          'try{this.__phi=JSON.parse(document.getElementById("pun-heart-interior").textContent)}catch(e){this.__phi=null}}return this.__phi}});</script>')


def set_interior(s, path):
    txt = open(path, encoding="utf-8").read()
    if "</script" in txt: sys.exit("interior JSON contains </script")
    block = f'<script id="pun-heart-interior" type="application/json">{txt}</script>\n{GETTER}'
    pat = re.compile(r'<script id="pun-heart-interior" type="application/json">.*?</script>\n<script>/\* refined heart interior.*?</script>', re.S)
    if pat.search(s): s = pat.sub(lambda m: block, s, count=1); act = "replaced"
    else:
        i = s.find('<script id="pun-heart-mesh"')
        if i < 0: sys.exit("run echo-sim/tools/integrate_heart_mesh.py first (no pun-heart-mesh in the page)")
        s = s[:i] + block + "\n" + s[i:]; act = "added"
    print(f"  interior {act} ({len(txt)/1024:.0f} KB, window.PUN_HEART_INTERIOR)")
    return s


def set_lab(s, key, title, html):
    b64 = base64.b64encode(html.encode("utf-8")).decode("ascii")
    i = s.find("const LABS = {"); j = s.find("\n};", i)
    if i < 0 or j < 0: sys.exit("could not find the LABS object")
    block = s[i:j]; entry = f'{key}: {{ title: "{title}", b64: "{b64}" }}'
    pat = re.compile(r'(\n\s*)' + key + r':\s*\{\s*title:\s*"[^"]*",\s*b64:\s*"[^"]*"\s*\}')
    if pat.search(block):
        block = pat.sub(lambda m: m.group(1) + entry, block, count=1); act = "replaced"
    else:  # insert right after heart3d so the object order matches the section order
        m = re.search(r'\n\s*heart3d:\s*\{[^}]*\}\s*,?', block)
        if not m: sys.exit("LABS.heart3d not found")
        seg = m.group(0); seg = seg if seg.rstrip().endswith(",") else seg.rstrip() + ","
        block = block[:m.start()] + seg + "\n  " + entry + "," + block[m.end():]; act = "added"
        block = re.sub(r",\s*,", ",", block)
    print(f"  LABS.{key} {act}: {title} ({len(html)/1024:.0f} KB html)")
    return s[:i] + block + s[j:]


def set_tabs(s):
    for key, _, _, long, short in PAGES:
        tab = (f'<a href="#{key}" data-topic="{key}" data-group="heart"><span class="long">{long}</span>'
               f'<span class="short">{short}</span></a>')
        pat = re.compile(r'<a href="#' + key + r'" data-topic="' + key + r'"[^>]*>.*?</a>', re.S)
        if pat.search(s):
            s = pat.sub(tab, s, count=1)
        else:
            m = re.search(r'<a href="#heart3d" data-topic="heart3d"[^>]*>.*?</a>', s, re.S)
            if not m: sys.exit("3D Heart tab not found")
            s = s[:m.end()] + "\n      " + tab + s[m.end():]
    print("  tabs: 3D Heart · Pathology simulator (data-group=heart)")
    return s


ROUTE_OLD_HEAD = 'function route(){\n  const key = location.hash.slice(1);\n'
ROUTE_NEW_HEAD = ('/*HEART3D-ROUTE*/\n'
                  '// Tell a lab iframe it is shown / hidden (it pauses when hidden) and, for routes like #pathology/af, the sub-path.\n'
                  'function tellLab(k, msg){\n'
                  '  const L = LABS[k]; if (!L || !L.frame) return;\n'
                  '  L.msg = Object.assign(L.msg || {}, msg);\n'
                  '  try { L.frame.contentWindow.postMessage(Object.assign({ pun: "lab" }, msg), "*"); } catch (e) {}\n'
                  '}\n'
                  'function route(){\n  const [key, sub = ""] = location.hash.slice(1).split("/");\n')
FRAME_OLD = '    f.srcdoc = decode(L.b64);\n'
FRAME_NEW = ('    f.addEventListener("load", () => { if (L.msg) try { f.contentWindow.postMessage(Object.assign({ pun: "lab" }, L.msg), "*"); } catch (e) {} });\n'
             '    f.srcdoc = decode(L.b64);\n')
HIDE_OLD = '    for (const k in LABS) if (LABS[k].frame) LABS[k].frame.hidden = LABS[k].frame !== f;\n'
HIDE_NEW = ('    for (const k in LABS) if (LABS[k].frame) { LABS[k].frame.hidden = LABS[k].frame !== f; tellLab(k, { visible: LABS[k].frame === f }); }\n'
            '    tellLab(key, { visible: true, sub });\n')
HOME_OLD = '  } else {\n    lab.hidden = true;\n'
HOME_NEW = '  } else {\n    for (const k in LABS) tellLab(k, { visible: false });\n    lab.hidden = true;\n'


def patch_route(s):
    if MARK in s: print("  router: already patched"); return s
    for old, new in [(ROUTE_OLD_HEAD, ROUTE_NEW_HEAD), (FRAME_OLD, FRAME_NEW), (HIDE_OLD, HIDE_NEW), (HOME_OLD, HOME_NEW)]:
        if s.count(old) != 1: sys.exit(f"router patch: expected exactly one match for {old.strip()[:60]!r}")
        s = s.replace(old, new)
    print("  router: sub-paths (#pathology/<scenario>) + show/hide messages to labs")
    return s


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("index"); ap.add_argument("--out"); ap.add_argument("--no-build", action="store_true"); ap.add_argument("--interior", default=INTERIOR)
    a = ap.parse_args()
    if not a.no_build:
        subprocess.run([sys.executable, os.path.join(HERE, "build_heart3d.py")], check=True)
    s = open(a.index, encoding="utf-8").read()
    for key, title, path, _, _ in PAGES:
        s = set_lab(s, key, title, open(os.path.join(ROOT, path), encoding="utf-8").read())
    s = set_tabs(s); s = set_interior(s, a.interior); s = patch_route(s)
    out = a.out or a.index
    open(out, "w", encoding="utf-8").write(s); print(f"Wrote {out} ({len(s.encode('utf-8'))/1024/1024:.2f} MB)")


if __name__ == "__main__":
    main()
