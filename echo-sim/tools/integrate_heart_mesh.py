#!/usr/bin/env python3
"""Put the refined heart (export/heart-mesh.json) into the site page and switch the Heart Conduction and MI labs to it.

  python tools/integrate_heart_mesh.py <site index.html> [--out OUT] [--mesh export/heart-mesh.json]
      [--adapter export/neo-heart-adapter.js] [--echo dist/echo-sim.html]

- The mesh JSON is stored ONCE in the site page (<script id="pun-heart-mesh" type="application/json">) behind a lazy
  window.PUN_HEART_MESH getter; the labs (same-origin srcdoc iframes) read it from their parent.
- Each of LABS.heart3d / LABS.mi gets NEO (export/neo-heart-adapter.js) right after its H3 module and five small hooks in
  HeartScene: intact heart → refined mesh + refined coronaries; cut / lesion views → legacy H3 heart.
- Re-runnable: an earlier injection is replaced, not duplicated. --echo also refreshes LABS.echo.
"""
import argparse, base64, json, re, sys
from pathlib import Path

MARK_A, MARK_B = "/* NEO-HEART:BEGIN */", "/* NEO-HEART:END */"
HOOKS = [
    ("root.add(m);vessels[k]=m}",
     "root.add(m);vessels[k]=m}\n  const NV=NEO?NEO.attach(T,root,vessels,vesselMat,patch):null;/*NEO-HOOK*/"),
    ("function buildHeart(o){const key=JSON.stringify(o);if(cache[key])return cache[key];",
     "function buildHeart(o){const key=JSON.stringify(o);if(cache[key])return cache[key];if(NEO&&NEO.plain(o))return cache[key]=NEO.mesh(T,myoMat);/*NEO-HOOK*/"),
    ("cur=buildHeart(o);root.add(cur);curKey=key;",
     "cur=buildHeart(o);if(NV)NV.use(!!cur.userData.neo);/*NEO-HOOK*/root.add(cur);curKey=key;"),
    ("for(const k in vessels){const m=vessels[k];m.material.color.set(down.includes(k)?0x5f5962:0xe2554a)}",
     "for(const k in vessels){const m=vessels[k];m.material.color.set(down.includes(k)?0x5f5962:0xe2554a)}if(NV)NV.culprit(down);/*NEO-HOOK*/"),
    ("tmp.copy(L.pos);root.localToWorld(tmp)", "tmp.copy(L.pos);if(NV)NV.lab(tmp);/*NEO-HOOK*/root.localToWorld(tmp)"),
]
CLASSIFY = ("function classifyOther(p){if(!p)return null;",
            "function classifyOther(p){if(!p)return null;if(NEO&&NEO.active){const nc=NEO.classify(p);if(nc!==undefined)return nc}/*NEO-HOOK*/")

GETTER = ('<script>/* refined heart mesh for the 3D labs (echo-sim/tools/integrate_heart_mesh.py) */'
          'Object.defineProperty(window,"PUN_HEART_MESH",{configurable:true,get(){if(this.__phm===undefined){'
          'try{this.__phm=JSON.parse(document.getElementById("pun-heart-mesh").textContent)}catch(e){this.__phm=null}}return this.__phm}});</script>')


CFG = {"heart3d": "const NEO_CFG={warpToLegacy:true};", "mi": "const NEO_CFG={};"}


def patch_lab(html, adapter, key):
    if MARK_A in html:   # strip an earlier injection
        a, b = html.index("\n" + MARK_A), html.index(MARK_B) + len(MARK_B)
        html = html[:a] + html[b:]
        html = re.sub(r"(if\(NV\)NV\.use\(!!cur\.userData\.neo\);|if\(NEO&&NEO\.plain\(o\)\)return cache\[key\]=NEO\.mesh\(T,myoMat\);|"
                      r"\n  const NV=NEO\?NEO\.attach\(T,root,vessels,vesselMat,patch\):null;|if\(NV\)NV\.culprit\(down\);|"
                      r"if\(NEO&&NEO\.active\)\{const nc=NEO\.classify\(p\);if\(nc!==undefined\)return nc\}|if\(NV\)NV\.lab\(tmp\);)/\*NEO-HOOK\*/", "", html)
    i = html.index("const H3=(()=>{")
    m = re.compile(r"\n\}\)\(\);").search(html, i)
    if not m: sys.exit(f"{key}: end of H3 module not found")
    html = html[:m.end()] + "\n" + MARK_A + "\n" + CFG[key] + "\n" + adapter.strip() + "\n" + MARK_B + html[m.end():]
    hooks = HOOKS + ([CLASSIFY] if CLASSIFY[0] in html else [])
    for old, new in hooks:
        n = html.count(old)
        if n != 1: sys.exit(f"{key}: hook anchor found {n}× (need 1): {old[:60]}")
        html = html.replace(old, new)
    if "</script" in adapter: sys.exit("adapter must not contain </script")
    return html


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("index"); ap.add_argument("--out")
    root = Path(__file__).resolve().parent.parent
    ap.add_argument("--mesh", default=str(root / "export/heart-mesh.json"))
    ap.add_argument("--adapter", default=str(root / "export/neo-heart-adapter.js"))
    ap.add_argument("--echo")
    a = ap.parse_args()
    s = Path(a.index).read_text(encoding="utf-8")
    adapter = Path(a.adapter).read_text(encoding="utf-8")
    mesh = json.dumps(json.loads(Path(a.mesh).read_text(encoding="utf-8")), separators=(",", ":"))
    if "</" in mesh: sys.exit("mesh JSON contains '</'")

    def swap(key, fn):
        nonlocal s
        m = re.search(r'(\b' + key + r'\s*:\s*\{[^}]*?b64:\s*")([A-Za-z0-9+/=]+)(")', s)
        if not m: sys.exit(f"LABS.{key} not found")
        html = fn(base64.b64decode(m.group(2)).decode("utf-8"))
        s = s[:m.start(2)] + base64.b64encode(html.encode("utf-8")).decode() + s[m.end(2):]
        print(f"  LABS.{key}: {len(html)/1024:.0f} KB")

    for key in ("heart3d", "mi"):   # only labs still built on the legacy H3 heart get the adapter (the reworked 3D Heart reads the mesh directly)
        swap(key, lambda h, k=key: patch_lab(h, adapter, k) if "const H3=(()=>{" in h else (print(f"  LABS.{k}: no legacy H3, left as is") or h))
    if a.echo:
        echo = Path(a.echo).read_text(encoding="utf-8")
        swap("echo", lambda h: echo)

    # mesh JSON once, before the page script
    s = re.sub(r'<script id="pun-heart-mesh" type="application/json">.*?</script>\s*<script>/\* refined heart mesh.*?</script>\n?', "", s, flags=re.S)
    tag = f'<script id="pun-heart-mesh" type="application/json">{mesh}</script>\n{GETTER}\n'
    j = s.index("const LABS")
    k = s.rfind("<script", 0, j)
    s = s[:k] + tag + s[k:]
    out = Path(a.out or a.index)
    out.write_text(s, encoding="utf-8")
    print(f"Wrote {out} ({len(s)/1024/1024:.2f} MB; mesh {len(mesh)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
