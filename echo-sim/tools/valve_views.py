#!/usr/bin/env python3
"""Valve anatomy preview (dev): ray-cast the phantom's scene() through the blood pool.
   python tools/valve_views.py SLICE.html OUT.png   (SLICE = build of src/dev/slice.html)"""
import asyncio, sys, os, json, math
import numpy as np
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
here = os.path.dirname(os.path.abspath(__file__)); ph = json.load(open(os.path.join(here, "..", "data", "phantom-normal.json")))
L = {k: np.array(v, float) for k, v in ph["landmarks_heart"].items() if not k.startswith("_")}
nz = lambda v: v/np.linalg.norm(v)
aAx = nz(np.array(ph["axes_heart"]["aortic_root"])); pvAx = nz(L["PA_bifurcation"] - L["PV_center"])
H = ph["frames"]["heart"]; ant = nz(np.array([H["X_patient"][2], H["Y_patient"][2], H["Z_patient"][2]]))   # patient anterior in heart axes
def basis(z, up):
    z = nz(z); y = nz(up - z*(up@z)); x = np.cross(y, z); return x, y, z
n4 = nz(np.cross(L["TV_center"] - L["MV_center"], L["LV_apex_endo"] - L["MV_center"])); n4 = n4 if n4 @ ant < 0 else -n4   # look from the front into the back half
VIEWS = []
x, y, z = basis(n4, np.array([0, 0, 1.]))
VIEWS.append(("4-chamber (coronal) cut, front half removed — systole: valves closed", dict(o=list(np.array([1.6, 0, 2.6]) - z*0.05 - 0*x), x=list(-x), y=list(y), z=list(z), half=6.2, max=7, t=0.2)))
VIEWS.append(("4-chamber (coronal) cut — diastole: MV and TV open", dict(o=list(np.array([1.6, 0, 2.6]) - z*0.05), x=list(-x), y=list(y), z=list(z), half=6.2, max=7, t=0.62)))
x, y, z = basis(np.array([0, 0, 1.]), -ant)
cen = np.array([1.7, 0.0, -1.1])
VIEWS.append(("Axial at the atria, looking down into the ventricles — systole: MV + TV closed", dict(o=list(cen), x=list(x), y=list(-y), z=list(z), half=4.4, max=4.5, t=0.2)))
VIEWS.append(("Axial at the atria — diastole: MV + TV open (papillary muscles and chordae below)", dict(o=list(cen), x=list(x), y=list(-y), z=list(z), half=4.4, max=4.5, t=0.62)))
zz = nz(-(aAx + pvAx)); x, y, z = basis(zz, -ant)
cen = (L["AV_center"] + aAx*2.3 + L["PV_center"] + pvAx*1.4)/2
VIEWS.append(("Plane above the semilunar valves, looking down — diastole: AV + PV closed", dict(o=list(cen), x=list(x), y=list(y), z=list(z), half=4.2, max=4.5, t=0.62)))
VIEWS.append(("Plane above the semilunar valves — systole: AV + PV open", dict(o=list(cen), x=list(x), y=list(y), z=list(z), half=4.2, max=4.5, t=0.2)))
nA = nz(np.array(ph["structures"]["MV_annulus"]["normal"])); nT = nz(np.array(ph["structures"]["TV_annulus"]["normal"]))
x, y, z = basis(nA, -ant); VIEWS.append(("Mitral valve en face from the LA — systole (closed)", dict(o=list(-nA*1.2), x=list(x), y=list(y), z=list(z), half=2.6, max=3.5, t=0.2)))
x, y, z = basis(nT, -ant); VIEWS.append(("Tricuspid valve en face from the RA — systole (closed)", dict(o=list(L["TV_center"] - nT*1.2), x=list(x), y=list(y), z=list(z), half=2.8, max=3.5, t=0.2)))
if os.environ.get("ONLY"): VIEWS = [VIEWS[int(i)] for i in os.environ["ONLY"].split(",")]
TISS = ph["tissues"]; TN = ["none","blood","myocardium","valve","fibrous","pericardium","fat","chest_wall","liver","diaphragm","vessel_wall","cartilage","bone","lung","gas","fluid","soft"]
COL = {"myocardium": (.62, .2, .17), "valve": (.95, .9, .8), "fibrous": (.92, .86, .74), "fat": (.93, .78, .45), "vessel_wall": (.86, .74, .66), "pericardium": (.9, .88, .85), "liver": (.5, .2, .15), "bone": (.9, .9, .88), "cartilage": (.8, .85, .85)}
NAME = {"MV_AML": "AML", "MV_PML": "PML", "TV_septal": "TV septal", "TV_anterior": "TV anterior", "TV_posterior": "TV posterior", "AV_cusps.RCC": "RCC", "AV_cusps.LCC": "LCC", "AV_cusps.NCC": "NCC",
        "PV_cusps": "PV cusps", "chordae": "chordae", "papillary_muscles.ALPM": "ALPM", "papillary_muscles.PMPM": "PMPM", "moderator_band": "moderator band", "TV_annulus": "TV annulus", "IAS": "IAS", "IVS": "IVS", "crista_terminalis": "crista", "aortic_root": "Ao root"}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); pg = await b.new_page()
        await pg.goto("file://" + os.path.abspath(sys.argv[1])); await pg.wait_for_timeout(4000); await pg.wait_for_function("typeof SL !== 'undefined' && !!SL.raycast", timeout=120000)
        tiles = []
        for title, o in VIEWS:
            o = {k: (list(map(float, v)) if isinstance(v, (list, np.ndarray)) else v) for k, v in o.items()}; o["size"] = 440
            r = await pg.evaluate(f"(() => {{ const r = SL.raycast({json.dumps(o)}); return {{w: r.w, data: r.data, labels: r.labels}}; }})()")
            N = r["w"]; A = np.array(r["data"], dtype=np.uint8).reshape(N, N, 4)[::-1]; LB = r["labels"]
            lab, tis = A[..., 0].astype(int), A[..., 1].astype(int); dep = (A[..., 2].astype(float)*256 + A[..., 3])/65535*o["max"]; hit = (A[..., 1] > 0)
            dz = np.where(hit, dep, np.nan); gy, gx = np.gradient(np.nan_to_num(dz, nan=o["max"])); px = 2*o["half"]/N
            nrm = np.dstack([-gx/px, -gy/px, np.ones_like(gx)]); nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
            lam = np.clip(nrm @ nz(np.array([-.35, .45, 1.])), 0, 1); fog = 1 - 0.55*np.clip(dep/o["max"], 0, 1)
            img = np.zeros((N, N, 3)) + .05
            for ti in np.unique(tis[hit]):
                m = hit & (tis == ti); c = np.array(COL.get(TN[ti], (.6, .5, .5))); img[m] = c*(0.35 + 0.65*lam[m, None])*fog[m, None]
            im = Image.fromarray((np.clip(img, 0, 1)*255).astype(np.uint8)).resize((560, 560)); d = ImageDraw.Draw(im); s = 560/N; placed = []
            for i, nm in enumerate(LB):
                if nm not in NAME: continue
                m = hit & (lab == i)
                if m.sum() < 25: continue
                ys, xs = np.nonzero(m); k = np.argmin((xs - xs.mean())**2 + (ys - ys.mean())**2); cx, cy = int(xs[k]*s), int(ys[k]*s)
                while any(abs(cx-a) < 70 and abs(cy-b_) < 13 for a, b_ in placed): cy += 13
                t_ = NAME[nm]; d.rectangle((cx-2, cy-1, cx+6*len(t_)+2, cy+11), fill=(0, 0, 0)); d.text((cx, cy), t_, fill=(255, 255, 160)); placed.append((cx, cy))
            tl = Image.new("RGB", (560, 584), (20, 20, 22)); tl.paste(im, (0, 24)); ImageDraw.Draw(tl).text((6, 6), title, fill=(240, 240, 240)); tiles.append(tl)
        G = Image.new("RGB", (1120, 584*((len(tiles)+1)//2)), (20, 20, 22))
        for i, t in enumerate(tiles): G.paste(t, ((i % 2)*560, (i//2)*584))
        G.save(sys.argv[2]); await b.close()
asyncio.run(main())
