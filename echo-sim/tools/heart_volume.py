#!/usr/bin/env python3
"""Dump the baked heart label volume (scene() at end-diastole, heart frame, cm) to a .npz for design tools.
   python tools/heart_volume.py [--voxel 0.13] [--out /tmp/heart-vol.npz] [--lab dist/echo-sim.html] [--phase 0]
   npz: labels (uint8, [nz, ny, nx] → index [k, j, i]), dist (float32 outer signed distance), tissue (uint8, PHANTOM.TISSUES index), lo (3), v, n (3), names
   Voxel (i, j, k) centre = lo + (i, j, k + 0.5)·v in the heart frame."""
import argparse, asyncio, base64, json, os, subprocess, sys, tempfile
import numpy as np
from playwright.async_api import async_playwright
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.join(here, "..")
ap = argparse.ArgumentParser(); ap.add_argument("--voxel", type=float, default=0.13); ap.add_argument("--out", default=os.path.join(tempfile.gettempdir(), "heart-vol.npz"))
ap.add_argument("--lab"); ap.add_argument("--phase", type=float, default=0.0)
ap.add_argument("--box", type=float, nargs=6, help="lo x y z, hi x y z (heart frame cm)"); A = ap.parse_args()
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]

async def main():
    lab = A.lab or os.path.join(tempfile.gettempdir(), "vol_lab.html")
    if not A.lab: subprocess.run([sys.executable, os.path.join(here, "build_lab.py"), root, "--out", lab], check=True, capture_output=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); pg = await (await b.new_context(viewport={"width": 1000, "height": 700})).new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + os.path.abspath(lab)); await pg.wait_for_function("window.ECHO && ECHO.ready", timeout=300000)
        r = await pg.evaluate(f"""(() => {{ const V = ECHO.bakeVolume({A.voxel}, {A.phase}, {json.dumps({"lo": A.box[:3], "hi": A.box[3:]}) if A.box else "undefined"}); const enc = a => {{ let s = ''; const u = new Uint8Array(a.buffer); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }};
            return {{ lab: enc(V.vol), dist: enc(V.vol.dist), tis: enc(V.vol.tissue), lo: V.lo, n: V.n, v: V.v, names: ECHO.labelsList() }}; }})()""")
        await b.close()
    if errs: sys.exit("page errors: " + "; ".join(errs[:3]))
    n = r["n"]; lab = np.frombuffer(base64.b64decode(r["lab"]), np.uint8).reshape(n[2], n[1], n[0])
    dist = np.frombuffer(base64.b64decode(r["dist"]), np.float32).reshape(n[2], n[1], n[0])
    tis = np.frombuffer(base64.b64decode(r["tis"]), np.uint8).reshape(n[2], n[1], n[0])
    np.savez_compressed(A.out, labels=lab, dist=dist, tissue=tis, lo=np.array(r["lo"]), v=r["v"], n=np.array(n), names=np.array(r["names"]))
    cnt = np.bincount(lab.ravel(), minlength=len(r["names"]))
    print(f"wrote {A.out}: {n} voxels at {r['v']} cm;", ", ".join(f"{r['names'][i]}={c}" for i, c in enumerate(cnt) if c and i))

asyncio.run(main())
