#!/usr/bin/env python3
"""Build export/interior-preview.html (self-contained: three.js + both loaders + heart-mesh.json + heart-interior.json).
   python tools/build_interior_preview.py [--out export/interior-preview.html]
   Cut planes (body + cardiac), stencil-capped cut, valve flip-book on the beat, conduction landmarks, tap to identify."""
import os, re, sys
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.join(here, ".."); ex = os.path.join(root, "export")
out = sys.argv[sys.argv.index("--out")+1] if "--out" in sys.argv else os.path.join(ex, "interior-preview.html")
s = open(os.path.join(ex, "interior-preview.src.html")).read()
three = re.sub(r"^console\.warn\([^\n]*?\),", "0,", open(os.path.join(root, "vendor", "three.min.js")).read(), count=1)
parts = {"/*THREE*/": three, "/*LOADER*/": open(os.path.join(ex, "heart-mesh-loader.js")).read(), "/*ILOADER*/": open(os.path.join(ex, "heart-interior-loader.js")).read(),
         "/*EXT*/": open(os.path.join(ex, "heart-mesh.json")).read(), "/*INT*/": open(os.path.join(ex, "heart-interior.json")).read()}
for k, v in parts.items():
    if "</script" in v: sys.exit(f"{k} contains </script")
    s = s.replace(k, v)
open(out, "w").write(s); print("wrote", out, os.path.getsize(out)//1024, "KB")
