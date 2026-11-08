#!/usr/bin/env python3
"""Build export/preview.html (self-contained: three.js + loader + heart-mesh.json) to check an export by eye.
   python tools/build_export_preview.py [--out export/preview.html]"""
import os, re, sys
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.join(here, ".."); out = sys.argv[sys.argv.index("--out")+1] if "--out" in sys.argv else os.path.join(root, "export", "preview.html")
s = open(os.path.join(root, "export", "preview.src.html")).read(); three = re.sub(r"^console\.warn\([^\n]*?\),", "0,", open(os.path.join(root, "vendor", "three.min.js")).read(), count=1)
loader = open(os.path.join(root, "export", "heart-mesh-loader.js")).read(); js = open(os.path.join(root, "export", "heart-mesh.json")).read()
assert "</script" not in loader and "</script" not in js
open(out, "w").write(s.replace("/*THREE*/", three).replace("/*LOADER*/", loader).replace("/*JSON*/", js)); print("wrote", out, os.path.getsize(out)//1024, "KB")
