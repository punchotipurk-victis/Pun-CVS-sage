#!/usr/bin/env python3
"""Labelled internal-anatomy preview of the baked 3D heart (dev): python tools/anatomy_shots.py LAB.html OUTDIR
   Each view: realistic colours | distinct label colours with structure names (names placed at each region's centroid)."""
import asyncio, sys, os, base64, io, colorsys
import numpy as np
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
lab, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
VIEWS = [("frontal", "Coronal cut, front half removed", "{n:[0,0,-1]}"),
         ("a4c", "4-chamber cut (A4C plane)", "{fan:true, view:'a4c'}"),
         ("ra_open", "RA opened from the front (coronal cut through SVC, IVC, CS ostium, crista)", "{n:[0,0,-1], at:'RA_center', offset:0.6, zoom:1.6}"),
         ("ias", "Deeper coronal cut: interatrial septum with the thin fossa ovalis and its rim", "{n:[0,0,-1], at:'RA_center', offset:1.9, zoom:1.6}"),
         ("la_open", "LA opened from behind (cut through the four pulmonary-vein ostia)", "{n:[0,0,1], at:'LA_center', offset:-2.1, zoom:1.6}"),
         ("plax", "Long-axis cut (PLAX plane)", "{fan:true, view:'plax'}"),
         ("psax_av", "Short-axis cut at the aortic valve", "{fan:true, view:'psax_av'}")]
SKIP = {"", "chest_wall", "lungs", "ribs", "sternum", "pericardium", "diaphragm"}
def img(d): return Image.open(io.BytesIO(base64.b64decode(d.split(",")[1]))).convert("RGB")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); pg = await (await b.new_context(viewport={"width": 1440, "height": 860})).new_page()
        await pg.goto("file://" + os.path.abspath(lab)); await pg.wait_for_function("window.ECHO && ECHO.ready", timeout=240000)
        await pg.evaluate("ECHO.freeze(true); ECHO.setLandmarks(false); ECHO.setPhase(0)")
        L = await pg.evaluate("PHANTOM.LABELS"); TXT = await pg.evaluate("PHANTOM.LABEL_TEXT")
        pal = [np.array(colorsys.hls_to_rgb((i*0.381966) % 1, .5, .75))*255 for i in range(64)]
        tiles = []
        for key, title, arg in VIEWS:
            if "view:" in arg: await pg.evaluate(f"ECHO.goToView('{arg.split(chr(39))[1]}', true); ECHO.renderOnce()")
            a = arg.replace("view:'" + arg.split("'")[1] + "'", "") if "view:" in arg else arg
            real = img(await pg.evaluate(f"ECHO.heartShot({a.replace(', }','}')}, 560, 560)"))
            dbg = img(await pg.evaluate(f"ECHO.heartShot(Object.assign({a.replace(', }','}')}, {{debugPalette:true}}), 560, 560)"))
            A = np.asarray(dbg).astype(int); R_, G_, B_ = A[..., 0], A[..., 1], A[..., 2]
            blood = (abs(G_ - 70) <= 3) & (B_ <= 3); tis = (abs(G_ - 166) <= 4) & (abs(B_ - 76) <= 4)
            idx = np.full(R_.shape, -1); idx[blood] = np.round(R_[blood]/2.75); idx[tis] = np.round((R_[tis] - 76.5)/3.5)
            LA_ = np.asarray(real).copy(); dr = None; placed = []; texts = []
            for i, nm in enumerate(L):
                m = idx == i
                if nm in SKIP or m.sum() < 150: continue
                col = np.array(colorsys.hls_to_rgb((i*0.381966) % 1, .55 if m[blood].any() or True else .6, .65))*255
                LA_[m] = (0.35*LA_[m] + 0.65*col).astype(np.uint8)
                ys, xs = np.nonzero(m); k = np.argmin((xs - xs.mean())**2 + (ys - ys.mean())**2); texts.append((int(xs[k]), int(ys[k]), TXT.get(nm, nm)))
            labImg = Image.fromarray(LA_); dr = ImageDraw.Draw(labImg)
            for cx, cy, t in texts:
                while any(abs(cx-px) < 60 and abs(cy-py) < 13 for px, py in placed): cy += 13
                dr.rectangle((cx-2, cy-1, cx+6*len(t)+2, cy+11), fill=(0, 0, 0)); dr.text((cx, cy), t, fill=(255, 255, 255)); placed.append((cx, cy))
            dbg = labImg
            t = Image.new("RGB", (1120, 584), (20, 20, 22)); t.paste(real, (0, 24)); t.paste(dbg, (560, 24))
            ImageDraw.Draw(t).text((6, 6), title + "  —  realistic colours | label colours", fill=(240, 240, 240)); tiles.append(t)
            t.save(os.path.join(out, f"internal_{key}.png"))
        G = Image.new("RGB", (1120, 584*len(tiles)), (20, 20, 22))
        for i, t in enumerate(tiles): G.paste(t, (0, i*584))
        G.save(os.path.join(out, "internal_all.png")); await b.close()
asyncio.run(main())
