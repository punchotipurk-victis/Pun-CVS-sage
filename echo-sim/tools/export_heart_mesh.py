#!/usr/bin/env python3
"""Export the phantom heart as a mesh for the other Super App labs (3D heart, MI lab, later the coronary angiogram).
   python tools/export_heart_mesh.py [--voxel 0.2] [--out export/heart-mesh.json]
   Everything comes from the phantom (scene() bake + the coronary centrelines): no hand-made geometry.

   Output JSON (v1):
     meta        version, units ("cm", heart frame), source phantom version, counts, notes
     frames      heart frame definition; 4×4 matrices heartToBody (cm) and heartToH3 (heart-3d-model units/axes)
     mesh        positions (Int16, quantised: x = q/32767*range + centre), normals (Int8/127), index (Uint16 or Uint32), all base64
     vertex      label (Uint8: index into labelNames), aha (Uint8: 1–17 LV segments, 0 = not LV), territory (Uint8: 0 none, 1 LAD, 2 LCx, 3 RCA)
                 territoryModel (Uint8, same codes, from this model's own tree: nearest supplying branch), vessel (Uint8: nearest artery index+1, 0 = none),
                 vesselT (Uint8: position along that artery 0–255 → for "downstream of a clot"), motion (Uint8: 255 ventricle … 46 atria/vessels)
     wall (Uint8: 1 LV, 2 RV, 3 atria, 4 great vessels, 5 groove fat/vessel), labelNames, wallNames, ahaNames, territories
     vessels     arteries + veins: id, name, scct, parent, territory, label, points (heart cm), r0/r1 (true), displayR0/displayR1 (3D/MI lab)
"""
import asyncio, sys, os, json, math, base64, argparse, subprocess, tempfile
import numpy as np
from playwright.async_api import async_playwright
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.join(here, ".."); PJ = os.path.join(root, "data", "phantom-normal.json")
ap = argparse.ArgumentParser(); ap.add_argument("--voxel", type=float, default=0.2); ap.add_argument("--out", default=os.path.join(root, "export", "heart-mesh.json")); ap.add_argument("--lab", default=None)
A = ap.parse_args()
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
nz = lambda v: v/np.linalg.norm(v)
b64 = lambda arr: base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()
AHA_NAMES = {1: "basal anterior", 2: "basal anteroseptal", 3: "basal inferoseptal", 4: "basal inferior", 5: "basal inferolateral", 6: "basal anterolateral",
             7: "mid anterior", 8: "mid anteroseptal", 9: "mid inferoseptal", 10: "mid inferior", 11: "mid inferolateral", 12: "mid anterolateral",
             13: "apical anterior", 14: "apical septal", 15: "apical inferior", 16: "apical lateral", 17: "apex"}
# standard coronary territories of the AHA 17 segments (Cerqueira 2002; variable between patients, verify): 1 LAD, 2 LCx, 3 RCA
AHA_TERR = {1: 1, 2: 1, 7: 1, 8: 1, 13: 1, 14: 1, 17: 1, 3: 3, 4: 3, 9: 3, 10: 3, 15: 3, 5: 2, 6: 2, 11: 2, 12: 2, 16: 2}
TREE_TERR = {"LM": 1, "LAD": 1, "D1": 1, "D2": 1, "S1": 1, "S2": 1, "S3": 1, "LCx": 2, "OM1": 2, "OM2": 2,
             "RCA": 3, "CB": 3, "SAN": 3, "RVB1": 3, "RVB2": 3, "AM": 3, "PDA": 3, "AVN": 3, "PLB": 3}
async def main():
    ph = json.load(open(PJ)); L = {k: np.array(v, float) for k, v in ph["landmarks_heart"].items() if not k.startswith("_")}; S = ph["structures"]
    lab = A.lab or os.path.join(tempfile.gettempdir(), "export_lab.html")
    if not A.lab: subprocess.run([sys.executable, os.path.join(here, "build_lab.py"), root, "--out", lab], check=True, capture_output=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); pg = await (await b.new_context(viewport={"width": 1200, "height": 800})).new_page()
        await pg.goto("file://" + os.path.abspath(lab)); await pg.wait_for_function("window.ECHO && ECHO.ready", timeout=300000)
        R = await pg.evaluate(f"ECHO.exportHeart({A.voxel})"); await b.close()
    P = np.array(R["positions"], np.float32).reshape(-1, 3); N = np.array(R["normals"], np.float32).reshape(-1, 3); I = np.array(R["index"], np.uint32)
    LBL = np.array(R["labels"], np.uint8); names = R["labelNames"]; nV = len(P)
    # ---- AHA 17 segments on the LV (heart frame: Z = LV long axis base → apex, X = toward the RV/septum, Y = inferior-posterior)
    LVL = {names.index(k) for k in ("IVS", "PW", "LV_myocardium") if k in names}
    z0 = 0.0; z1 = float(L["LV_apex_epi"][2]); f = (P[:, 2] - z0)/(z1 - z0)
    ang = (np.degrees(np.arctan2(P[:, 0], -P[:, 1])) + 360) % 360          # 0° = anterior (−Y), 90° = septal (+X), 180° = inferior (+Y), 270° = lateral (−X)
    isLV = np.isin(LBL, list(LVL)) & (f > -0.05)
    aha = np.zeros(nV, np.uint8)
    six = ((ang + 30) % 360 // 60).astype(int)                             # 0 anterior, 1 anteroseptal, 2 inferoseptal, 3 inferior, 4 inferolateral, 5 anterolateral
    four = ((ang + 45) % 360 // 90).astype(int)                            # 0 anterior, 1 septal, 2 inferior, 3 lateral
    aha[isLV & (f < 1/3)] = 1 + six[isLV & (f < 1/3)]
    m = isLV & (f >= 1/3) & (f < 2/3); aha[m] = 7 + six[m]
    m = isLV & (f >= 2/3) & (f < 0.9); aha[m] = 13 + four[m]
    aha[isLV & (f >= 0.9)] = 17
    # fat / coronary vertices lying on the LV take the segment of the nearest LV muscle vertex (≤ 0.8 cm), so the grooves are pickable too
    onTop = np.isin(LBL, [names.index(k) for k in ("epicardial_fat", "LCA", "RCA", "cardiac_veins") if k in names])
    lvIdx = np.nonzero(aha > 0)[0]; top = np.nonzero(onTop)[0]
    for c0 in range(0, len(top), 3000):
        ii = top[c0:c0+3000]; d2 = ((P[ii][:, None, :] - P[lvIdx][None])**2).sum(2); k = d2.argmin(1); ok = d2[np.arange(len(ii)), k] < 0.64
        aha[ii[ok]] = aha[lvIdx[k[ok]]]
    # wall class: 1 LV, 2 RV, 3 atria, 4 great vessels, 5 groove fat / surface vessels over the RV or atria, 0 other
    def cls(ns): return np.isin(LBL, [names.index(k) for k in ns if k in names])
    wall = np.zeros(nV, np.uint8)
    wall[cls(("RV_free_wall", "RVOT"))] = 2; wall[cls(("LA_wall", "RA_wall", "IAS", "crista_terminalis", "LA", "RA", "LAA", "pulmonary_veins", "coronary_sinus"))] = 3
    wall[cls(("aortic_root", "aortic_arch", "arch_branches", "PA_main", "RPA", "LPA", "SVC", "IVC"))] = 4; wall[onTop] = 5; wall[aha > 0] = 1
    terrAHA = np.array([AHA_TERR.get(int(a), 0) for a in aha], np.uint8)
    # ---- this model's own territories: nearest artery (surface vessels) for every ventricular vertex
    arts = S["coronary_arteries"]["arteries"]; veins = S["cardiac_veins"]["veins"]
    segs = []   # (artery index, a, b, t0, t1)
    for ai, a in enumerate(arts):
        Q = np.array(a["points"]); s_ = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))]); s_ /= s_[-1]
        for k in range(len(Q)-1): segs.append((ai, Q[k], Q[k+1], s_[k], s_[k+1]))
    SA = np.array([s[1] for s in segs]); SB = np.array([s[2] for s in segs]); D = SB - SA; DD = (D*D).sum(1) + 1e-9
    vent = (aha > 0) | np.isin(LBL, [names.index("RV_free_wall")])
    vessel = np.zeros(nV, np.uint8); vesselT = np.zeros(nV, np.uint8)
    idx = np.nonzero(vent)[0]
    for c0 in range(0, len(idx), 4000):
        ii = idx[c0:c0+4000]; X = P[ii][:, None, :]
        t = np.clip(((X - SA[None])*D[None]).sum(2)/DD[None], 0, 1); C = SA[None] + t[..., None]*D[None]; d2 = ((X - C)**2).sum(2)
        # LM and the proximal RCA run over the base: they supply through their branches, so weight trunk segments down
        k = d2.argmin(1); vessel[ii] = [segs[j][0] + 1 for j in k]
        vesselT[ii] = np.clip([(segs[j][3] + (segs[j][4]-segs[j][3])*t[n, j])*255 for n, j in enumerate(k)], 0, 255).astype(np.uint8)
    terrModel = np.array([TREE_TERR.get(arts[v-1]["id"], 0) if v else 0 for v in vessel], np.uint8)
    # ---- beating weight (as the heart-3d-model aMot): ventricles move most
    motion = np.where(vent, 255, 46).astype(np.uint8)
    # ---- transforms
    H = ph["frames"]["heart"]; O = np.array(H["origin_patient"]); M = np.stack([H["X_patient"], H["Y_patient"], H["Z_patient"]])   # rows: heart axes in body
    h2b = np.eye(4); h2b[:3, :3] = M.T; h2b[:3, 3] = O
    # heart-3d-model (H3) frame: arbitrary units, +x left, +y cranial, +z anterior; LV_B → LV_A long axis, SEPT toward the RV
    LV_B = np.array([.2, .36, -.2]); LV_A = np.array([.66, -.72, .26]); RV_B = np.array([-.4, .2, .22]); AX = nz(LV_A - LV_B)
    CUTN = nz(np.array([.46, .42, .78])); SEPT = nz(np.cross(CUTN, AX)); SEPT = SEPT if SEPT @ (RV_B - LV_B) > 0 else -SEPT
    sc = np.linalg.norm(LV_A - LV_B)/(z1*0.95)                                 # their LV base→apex length ↔ our MV centre → apex
    # H3 axes = body axes (+x left, +y head, +z anterior). Keep our body orientation and tilt it by the smallest rotation that
    # lays our LV long axis on theirs (≈27°). (v1 used their cut-plane septum for the roll: ≈22° off, the arch swung right.)
    Zb = M[2]; v = np.cross(Zb, AX); sn, cs = np.linalg.norm(v), Zb @ AX
    Kx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]]); Rmin = np.eye(3) + Kx + Kx @ Kx*((1 - cs)/sn**2)
    Rm = Rmin @ M.T                                                            # columns: images of our X, Y, Z
    h2h3 = np.eye(4); h2h3[:3, :3] = Rm*sc; h2h3[:3, 3] = LV_B
    # ---- quantise
    cen = (P.max(0) + P.min(0))/2; rngv = (P.max(0) - P.min(0))/2 + 1e-6
    Pq = np.round((P - cen)/rngv*32767).astype(np.int16); Nq = np.round(N/np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-6)*127).astype(np.int8)
    Iq = I.astype(np.uint16 if nV < 65536 else np.uint32)
    DISP = S["coronary_arteries"]["display"]
    vessels = {"arteries": [{k: a[k] for k in ("id", "name", "scct", "parent", "territory", "label", "r0", "r1", "points") if k in a} | {"deep": bool(a.get("deep")),
                  "displayR0": max(a["r0"]*DISP["arteryScale"], DISP["arteryMin"]), "displayR1": max(a["r1"]*DISP["arteryScale"], DISP["arteryMin"]*0.7), "territoryCode": TREE_TERR.get(a["id"], 0)} for a in arts],
               "veins": [{k: v[k] for k in ("id", "name", "r0", "r1", "points")} | {"displayR0": max(v["r0"]*DISP["veinScale"], DISP["veinMin"]), "displayR1": max(v["r1"]*DISP["veinScale"], DISP["veinMin"])} for v in veins]}
    out = {"meta": {"format": "pun-cvs heart mesh v1", "phantom": ph["_meta"]["version"], "units": "cm, heart frame (origin MV centre, Z = LV long axis base→apex, X = toward the RV/septum, Y = inferior-posterior)",
                    "voxelCm": A.voxel, "vertices": int(nV), "triangles": int(len(I)//3), "dominance": S["coronary_arteries"]["dominance"],
                    "notes": ["Outer surface only (epicardium + great vessels); septal AHA segments appear only where the septum reaches the surface (IV grooves). A 4-chamber cut needs its own export or a clip plane + cap.",
                              "territory = standard AHA map (Cerqueira 2002); territoryModel = nearest branch of this model's own right-dominant tree; vessel/vesselT let a lab infarct everything downstream of a clot (vessel in the clot's subtree and vesselT > clot position).",
                              "Vessels: draw tubes from the centrelines with displayR (thicker than life, tappable); r0/r1 are the true radii (angiography).",
                              "Teaching model: verify territories and branch positions against an expert."]},
           "frames": {"heart": H, "heartToBody": h2b.T.flatten().round(5).tolist(), "heartToH3": h2h3.T.flatten().round(6).tolist(),
                      "_matrixNote": "column-major 4×4 (three.js Matrix4.fromArray): p_body = heartToBody · p_heart (cm); p_H3 = heartToH3 · p_heart (heart-3d-model units, 1 unit ≈ " + f"{1/sc:.2f} cm)"},
           "mesh": {"positions": b64(Pq), "positionCentre": cen.round(4).tolist(), "positionRange": rngv.round(4).tolist(), "normals": b64(Nq), "index": b64(Iq), "indexType": "uint16" if Iq.dtype == np.uint16 else "uint32"},
           "vertex": {"label": b64(LBL), "wall": b64(wall), "aha": b64(aha), "territory": b64(terrAHA), "territoryModel": b64(terrModel), "vessel": b64(vessel), "vesselT": b64(vesselT), "motion": b64(motion)},
           "labelNames": names, "wallNames": {"0": "other", "1": "LV", "2": "RV", "3": "atria", "4": "great vessels", "5": "groove fat / surface vessel"}, "ahaNames": AHA_NAMES, "territories": {"0": "none", "1": "LAD", "2": "LCx", "3": "RCA"}, "vessels": vessels}
    os.makedirs(os.path.dirname(A.out), exist_ok=True); json.dump(out, open(A.out, "w"))
    kb = os.path.getsize(A.out)/1024
    agree = (terrAHA[isLV] == terrModel[isLV]).mean()
    print(f"wrote {A.out}: {nV} verts, {len(I)//3} tris, {kb:.0f} KB; LV verts {isLV.sum()}, AHA counts", np.bincount(aha, minlength=18)[1:].tolist(), f"; standard vs model territory agree {agree*100:.0f} %")
asyncio.run(main())
