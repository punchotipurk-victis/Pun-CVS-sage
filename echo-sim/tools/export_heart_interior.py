#!/usr/bin/env python3
"""Export the INSIDE of the phantom heart for the 3D Heart page (cut planes, internal anatomy, conduction landmarks).
   python tools/export_heart_interior.py [--voxel 0.1] [--valve-voxel 0.05] [--tris 52000] [--out export/heart-interior.json] [--lab dist/echo-sim.html]

Companion of tools/export_heart_mesh.py (outer surface). Everything is baked from the phantom's scene(): nothing hand-made.
Needs: playwright, numpy, scipy, scikit-image, fast-simplification (pip install fast-simplification).

Output (format "pun-cvs heart interior v1"; heart frame, cm; encodings as heart-mesh.json):
  tissue      one closed surface of all heart tissue (myocardium, fibrous skeleton, vessel walls, groove fat) at end-diastole,
              so a clip plane shows the endocardium, septa, papillary muscles, trabeculae, crista, pectinate muscles…
              vertex.label  = tissue label under the vertex (index into labelNames)
              vertex.cavity = blood label the vertex faces (endocardium), 0 = epicardium / none
              vertex.wall   = 1 LV · 2 RV · 3 atria · 4 great vessels · 5 fat · 6 fibrous skeleton · 0 other
              vertex.motion = beat weight like heart-mesh.json (255 ventricles, 46 atria / vessels)
  capVolume   0.2 cm heart-frame labels for colouring the stencil cap, downsampled from the 0.1 cm bake.
  valves      MV (+ chordae), TV, AV, PV: leaflets/cusps meshed at a finer voxel at 8 phases of the cycle (flip-book keyframes);
              phases[] are fractions of the RR interval (0 = R wave / end-diastole), the same clock as the ECG.
  landmarks   points / paths for the conduction system and teaching (Koch's triangle, CFB, membranous septum, SA-node site,
              internodal routes, Bachmann's bundle, His, bundle branches, moderator band, CTI, PV ostia…), computed from the phantom
              (+ the bake to snap them onto the endocardium / into the wall). Also written to export/heart-landmarks.json.
"""
import argparse, asyncio, base64, json, math, os, subprocess, sys, tempfile, time
import numpy as np
from scipy import ndimage
from skimage import measure
import fast_simplification
from playwright.async_api import async_playwright

here = os.path.dirname(os.path.abspath(__file__)); root = os.path.join(here, "..")
ap = argparse.ArgumentParser()
ap.add_argument("--voxel", type=float, default=0.1); ap.add_argument("--valve-voxel", type=float, default=0.05)
ap.add_argument("--tris", type=int, default=52000, help="triangle budget of the tissue surface")
ap.add_argument("--valve-verts", type=int, default=360, help="vertex budget per valve per phase")
ap.add_argument("--out", default=os.path.join(root, "export", "heart-interior.json")); ap.add_argument("--lab")
ap.add_argument("--cache", help="reuse/save the raw bakes (npz) here")
A = ap.parse_args()
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
PH = json.load(open(os.path.join(root, "data", "phantom-normal.json")))
PHASES = [0.0, 0.09, 0.30, 0.36, 0.53, 0.62, 0.75, 0.93]   # ED · AV/PV wide open · late ejection · closing · E peak · E fall · diastasis · A peak
nz = lambda a: np.asarray(a, float)/np.linalg.norm(a)
b64 = lambda arr: base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()
L = {k: np.array(v, float) for k, v in PH["landmarks_heart"].items() if not k.startswith("_")}; S = PH["structures"]
TIS = {"none": 0, "blood": 1, "myocardium": 2, "valve": 3, "fibrous": 4, "pericardium": 5, "fat": 6, "vessel_wall": 10}
CAP_VOXEL = 0.2
# Anatomy overrides for the cap colour. The majority tissue class of a label is not always the right teaching colour:
# the SVC is a vein wall (its myocardial sleeve is thin), and both mitral leaflets are valve tissue.
CAP_CLASS_OVERRIDE = {"SVC": "vessel_wall", "MV_AML": "valve", "MV_PML": "valve"}

def boxes():
    """valve boxes (heart frame cm), generous enough for the open leaflets and the mitral chordae"""
    mv = [-2.3, -2.3, -1.4], [2.3, 2.3, 3.4]
    tc = L["TV_center"]; tv = (tc + [-2.4, -2.4, -1.2]).tolist(), (tc + [2.4, 2.4, 2.6]).tolist()
    ac = L["AV_center"]; av = (ac - 2.0).tolist(), (ac + 2.0).tolist()
    pc = L["PV_center"]; pv = (pc - 1.9).tolist(), (pc + 1.9).tolist()
    return {"MV": mv, "TV": tv, "AV": av, "PV": pv}
VALVE_LABELS = {"MV": ["MV_AML", "MV_PML", "chordae"], "TV": ["TV_septal", "TV_anterior", "TV_posterior"],
                "AV": ["AV_cusps.RCC", "AV_cusps.LCC", "AV_cusps.NCC"], "PV": ["PV_cusps"]}

async def bake_all():
    lab = A.lab or os.path.join(tempfile.gettempdir(), "interior_lab.html")
    if not A.lab: subprocess.run([sys.executable, os.path.join(here, "build_lab.py"), root, "--out", lab], check=True, capture_output=True)
    js_enc = "const enc = a => { let s = ''; const u = new Uint8Array(a.buffer); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };"
    out = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); pg = await (await b.new_context(viewport={"width": 900, "height": 600})).new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + os.path.abspath(lab)); await pg.wait_for_function("window.ECHO && ECHO.ready", timeout=300000)
        names = await pg.evaluate("ECHO.labelsList()")
        async def vol(voxel, phase, box=None):
            r = await pg.evaluate(f"(() => {{ {js_enc} const V = ECHO.bakeVolume({voxel}, {phase}, {json.dumps(box) if box else 'undefined'}); return {{ l: enc(V.vol), t: enc(V.vol.tissue), lo: V.lo, n: V.n, v: V.v }}; }})()")
            n = r["n"]; sh = (n[2], n[1], n[0])
            return {"labels": np.frombuffer(base64.b64decode(r["l"]), np.uint8).reshape(sh), "tissue": np.frombuffer(base64.b64decode(r["t"]), np.uint8).reshape(sh), "lo": np.array(r["lo"]), "v": r["v"]}
        t0 = time.time(); out["heart"] = await vol(A.voxel, 0.0); print(f"  heart bake {A.voxel} cm: {out['heart']['labels'].shape} in {time.time()-t0:.1f} s")
        if A.voxel != CAP_VOXEL / 2: out["cap"] = await vol(CAP_VOXEL / 2, 0.0)
        for k, (lo, hi) in boxes().items():
            for ph in PHASES:
                out[(k, ph)] = await vol(A.valve_voxel, ph, {"lo": list(lo), "hi": list(hi)})
            print(f"  {k}: {len(PHASES)} phases at {A.valve_voxel} cm {out[(k, PHASES[0])]['labels'].shape}")
        await b.close()
    if errs: sys.exit("page errors: " + "; ".join(errs[:3]))
    return names, out

def sdf_mesh(mask, lo, v, sigma, target_tris=None, target_verts=None, min_tris=40):
    """mask → smooth signed distance → marching cubes → drop crumbs → quadric decimation. Returns P (cm), F, N (unit, outward)."""
    m = np.pad(mask, 2)
    d = (ndimage.distance_transform_edt(~m) - ndimage.distance_transform_edt(m)).astype(np.float32)
    if sigma: d = ndimage.gaussian_filter(d, sigma)
    P, F, _, _ = measure.marching_cubes(d, 0.0, spacing=(v, v, v), allow_degenerate=False)
    P = P[:, ::-1] + (lo - 2*v + v/2)                                         # (k, j, i) → (x, y, z), undo the pad, voxel centres
    lab, n = ndimage.label(np.zeros(1)) if False else (None, None)
    # connected components on the triangle graph: drop pieces smaller than min_tris
    import scipy.sparse as sp
    nV = len(P); e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    g = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(nV, nV)); nc, comp = sp.csgraph.connected_components(g, directed=False)
    sizes = np.bincount(comp[F[:, 0]], minlength=nc); keepF = sizes[comp[F[:, 0]]] >= min_tris; F = F[keepF]
    if target_verts: target_tris = target_verts*2
    if target_tris and len(F) > target_tris:
        P, F = fast_simplification.simplify(P.astype(np.float32), F.astype(np.int32), target_reduction=1 - target_tris/len(F), agg=5)
    used = np.unique(F); remap = -np.ones(len(P), np.int64); remap[used] = np.arange(len(used)); P = P[used]; F = remap[F]
    N = np.zeros_like(P); fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    for c in range(3): np.add.at(N, F[:, c], fn)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    # outward = toward increasing distance (out of the mask): check with a few samples
    return P.astype(np.float32), F.astype(np.int64), N.astype(np.float32)

def sample_nearest(mask, labels, lo, v, P, maxd=None, return_d=False):
    """label of the nearest voxel in `mask` for each point P"""
    d, ind = ndimage.distance_transform_edt(~mask, return_indices=True)
    ijk = np.clip(np.floor((P - lo)/v).astype(int), 0, np.array(mask.shape[::-1]) - 1)
    k, j, i = ijk[:, 2], ijk[:, 1], ijk[:, 0]
    src = labels[ind[0][k, j, i], ind[1][k, j, i], ind[2][k, j, i]]; dist = d[k, j, i]*v
    if maxd is not None: src = np.where(dist <= maxd, src, 0)
    return (src, dist) if return_d else src

def quant(P, N, F):
    cen = (P.max(0) + P.min(0))/2; rng = (P.max(0) - P.min(0))/2 + 1e-6
    Pq = np.round((P - cen)/rng*32767).astype(np.int16); Nq = np.round(N*127).astype(np.int8)
    It = np.uint16 if len(P) < 65536 else np.uint32
    return {"positions": b64(Pq), "positionCentre": cen.round(4).tolist(), "positionRange": rng.round(4).tolist(), "normals": b64(Nq),
            "index": b64(F.astype(It).ravel()), "indexType": "uint16" if It == np.uint16 else "uint32", "vertices": int(len(P)), "triangles": int(len(F))}


def cap_volume(bake, names, excluded):
    labels, classes = bake["labels"], bake["tissue"]
    cap_classes = ("myocardium", "fibrous", "valve", "fat", "vessel_wall")
    tissue = np.isin(classes, [TIS[k] for k in cap_classes]) & ~np.isin(labels, excluded)
    kept = np.where(tissue, labels, 0)
    # C-order (z, y, x) becomes x-fastest texture data. Ignore empty and blood voxels
    # in each 2³ block since the stencil already defines where the cap has tissue.
    kept = np.pad(kept, [(0, size % 2) for size in kept.shape])
    nz, ny, nx = (size // 2 for size in kept.shape)
    blocks = kept.reshape(nz, 2, ny, 2, nx, 2)
    winner = np.zeros((nz, ny, nx), np.uint8)
    votes = np.zeros_like(winner)
    tissue_by_label = [None] * len(names)
    for label in np.unique(labels[tissue]):
        counts = (blocks == label).sum(axis=(1, 3, 5), dtype=np.uint8)
        better = counts > votes  # tied blocks keep the lower label index
        winner[better] = label
        votes[better] = counts[better]
        tissue_by_label[label] = max(cap_classes, key=lambda key: np.count_nonzero((labels == label) & (classes == TIS[key])))

    for name, cls in CAP_CLASS_OVERRIDE.items():
        if name in names: tissue_by_label[names.index(name)] = cls

    flat = winner.ravel()
    starts = np.r_[0, np.flatnonzero(flat[1:] != flat[:-1]) + 1]
    runs = bytearray()
    for label, count in zip(flat[starts], np.diff(np.r_[starts, flat.size])):
        while count > 256:
            runs.extend((255, label))
            count -= 256
        runs.extend((count - 1, label))
    return {"lo": bake["lo"].tolist(), "n": [nx, ny, nz], "v": CAP_VOXEL,
            "rle": base64.b64encode(runs).decode(), "tissueByLabel": tissue_by_label}

# ------------------------------------------------------------------ label anchors (T6.2-B)
# Where a chamber's NAME points on the 3D Heart page.
#   label_<id>_cav: the deepest point of the chamber's blood (largest distance to any wall), so it is always inside the cavity,
#                   even for the crescent-shaped RV, whose centroid lies in the septum / LV.
#   label_<id>_ext: just under the epicardium of the chamber's own wall, on the side a student sees it from
#                   (RA: right heart border; RV: anterior surface; LA: posterior surface; LV: left heart border).
LABEL_CHAMBERS = {  # id: (blood labels, outer-wall labels, body directions (patient frame: +x left, +y head, +z anterior) with weights)
    "RA": (("RA",), ("RA_wall",), {(-1, 0, 0): 1.0, (0, 0, 1): 0.3}),
    "RV_cavity": (("RV_cavity",), ("RV_free_wall",), {(0, 0, 1): 1.0}),
    "LA": (("LA",), ("LA_wall",), {(0, 0, -1): 1.0, (0, -1, 0): 0.4}),
    "LV_cavity": (("LV_cavity",), ("LV_myocardium", "PW"), {(1, 0, 0): 1.0, (0, 0, 1): 0.2}),
}
def label_anchors(LAB, BLOOD, HEART_T, DTO, C, v, ID, near, r3):
    fr = json.load(open(os.path.join(root, "export", "heart-mesh.json")))["frames"]["heart"]
    R = np.array([fr["X_patient"], fr["Y_patient"], fr["Z_patient"]])        # rows: heart axes in the patient frame → R @ body = heart
    EPI = HEART_T & (DTO >= 0.03) & (DTO <= 0.25)
    out = {}
    for cid, (blood, wall, dirs) in LABEL_CHAMBERS.items():
        m = np.isin(LAB, ID(*blood)) & BLOOD
        if not m.any(): continue
        d = ndimage.distance_transform_edt(m)
        cav = C[np.unravel_index(np.argmax(d), d.shape)]
        out[f"label_{cid}_cav"] = {"kind": "point", "p": r3(cav), "note": f"{cid} name anchor: deepest point of the cavity"}
        h = sum(w*(R @ np.array(b, float)) for b, w in dirs.items())
        if cid == "LV_cavity": h[2] = 0      # LV: the lateral wall at mid level, not the apex
        h = h/np.linalg.norm(h)
        ext = near(EPI & np.isin(LAB, ID(*wall)), C[m].mean(axis=0) + 6.0*h, maxr=9.0)   # from the blood centroid (mid-chamber), not the deepest point
        out[f"label_{cid}_ext"] = {"kind": "point", "p": r3(ext), "note": f"{cid} name anchor on its outer wall (the side students see it from)"}
    return out

# ------------------------------------------------------------------ landmarks
def landmarks(H, names):
    LAB, TISv, lo, v = H["labels"], H["tissue"], H["lo"], H["v"]
    ID = lambda *ns: [names.index(n) for n in ns if n in names]
    k_, j_, i_ = np.indices(LAB.shape); C = np.stack([lo[0] + (i_ + .5)*v, lo[1] + (j_ + .5)*v, lo[2] + (k_ + .5)*v], -1); del k_, j_, i_
    BLOOD = TISv == TIS["blood"]
    HEART_T = np.isin(TISv, [TIS["myocardium"], TIS["fibrous"], TIS["vessel_wall"], TIS["valve"]]) & ~np.isin(LAB, ID("descending_aorta", "IVC", "liver", "diaphragm", "pericardium"))
    OUTSIDE = ~(BLOOD | HEART_T | (TISv == TIS["fat"]))
    DTB = ndimage.distance_transform_edt(~BLOOD)*v; DTO = ndimage.distance_transform_edt(~OUTSIDE)*v
    def in_heart(p):
        i, j, k = np.clip(np.floor((np.array(p) - lo)/v).astype(int), 0, np.array(LAB.shape[::-1]) - 1); return bool(HEART_T[k, j, i] or BLOOD[k, j, i])
    def lab_at(p):
        i, j, k = np.clip(np.floor((np.array(p) - lo)/v).astype(int), 0, np.array(LAB.shape[::-1]) - 1); return names[LAB[k, j, i]]
    def near(mask, p, maxr=3.0):
        m = mask & (np.linalg.norm(C - p, axis=-1) < maxr); P = C[m]
        if not len(P): raise ValueError(f"nothing near {p}")
        return P[np.linalg.norm(P - p, axis=1).argmin()]
    def subendo(p, cav, depth=(0.04, 0.22), maxr=2.5):
        """wall voxel nearest p that lies just under the endocardium of cavity `cav` (labels)"""
        cm = np.isin(LAB, ID(*cav)); dcav = ndimage.distance_transform_edt(~cm)*v if cav else DTB
        m = HEART_T & (dcav >= depth[0]) & (dcav <= depth[1]); return near(m, p, maxr)
    def subepi(p, depth=(0.03, 0.2), maxr=2.5):
        m = HEART_T & (DTO >= depth[0]) & (DTO <= depth[1]); return near(m, p, maxr)
    def path(ctrl, snap, n=10):
        """polyline through control points, resampled, every point snapped by `snap`, then lightly smoothed"""
        ctrl = [np.array(c, float) for c in ctrl]; seg = [np.linalg.norm(b - a) for a, b in zip(ctrl, ctrl[1:])]; tot = sum(seg)
        pts = []
        for s in np.linspace(0, tot, n):
            acc = 0
            for a, b, l in zip(ctrl, ctrl[1:], seg):
                if s <= acc + l or b is ctrl[-1]: pts.append(a + (b - a)*min(1, (s - acc)/max(l, 1e-9))); break
                acc += l
        pts = [snap(p) for p in pts]
        for _ in range(2): pts = [pts[0]] + [(pts[i-1] + 2*pts[i] + pts[i+1])/4 for i in range(1, len(pts)-1)] + [pts[-1]]
        return [p if in_heart(p) else snap(p) for p in pts]      # smoothing can cut a corner out of the wall: snap those back
    r3 = lambda p: [round(float(x), 3) for x in p]
    RD = S["RA"]["detail"]; D = PH.get("_design", {}).get("right_heart_landmarks", {})
    cfb = np.array(S["central_fibrous_body"]["center"]); ms = np.array(S["membranous_septum"]["center"])
    koch_apex = np.array(D["koch_apex"]); cso = np.array(D["cs_ostium_endo"]); et = np.array(D["et_commissure"])
    RAc = ("RA", "SVC"); LAc = ("LA", "LAA"); LVc = ("LV_cavity", "LVOT"); RVc = ("RV_cavity", "RVOT")
    # nodes
    crista = [np.array(p) for p in RD["crista"]["points"]]
    sa = subepi(crista[0] + 0.25*nz(crista[0] - L["RA_center"]))                # SVC–RA junction, top of the crista, under the epicardium
    avn = subendo(koch_apex + 0.1*nz(cfb - koch_apex), RAc, (0.08, 0.3))        # compact AV node: apex of Koch's triangle, just in front of the CFB
    # His: AV node → through the CFB → along the lower edge of the membranous septum → crest of the muscular septum (LV side)
    crest = subendo(ms + 0.6*np.array([0, 0, 1.0]), LVc, (0.1, 0.35))            # just below the membranous septum, toward the apex, LV side
    his = [avn, cfb, (cfb + crest)/2 + 0.0, crest]
    bif = crest
    # left bundle: fan down the LV septal surface; fascicles to the bases of the papillary muscles
    lv_sep_mid = subendo(np.array([1.1, 0.1, 3.6]), LVc)
    laf = path([bif, subendo((bif + L["ALPM_base"])/2, LVc), subendo(L["ALPM_base"], LVc)], lambda p: subendo(p, LVc), 9)
    lpf = path([bif, subendo((bif + L["PMPM_base"])/2, LVc), subendo(L["PMPM_base"], LVc)], lambda p: subendo(p, LVc), 9)
    lsf = path([bif, lv_sep_mid, subendo(np.array([0.8, 0.0, 6.6]), LVc)], lambda p: subendo(p, LVc), 8)   # septal fascicle → apex
    # right bundle: down the RV septal surface to the moderator band, across it to the anterior papillary muscle
    rbb = path([bif, subendo((bif + L["moderator_band_septal"])/2, RVc), subendo(L["moderator_band_septal"], RVc)], lambda p: subendo(p, RVc), 9)
    mb = [np.array(L["moderator_band_septal"]), (L["moderator_band_septal"] + L["moderator_band_free"])/2, np.array(L["moderator_band_free"])]
    # internodal routes through the RA wall (subendocardial), all ending at the AV node
    fo = np.array(S["IAS"]["fossaOvalis"]["center"]); for_ = S["IAS"]["fossaOvalis"]["r"]
    svcA = np.array(RD["svc"]["a"]); svcDir = nz(np.array(RD["svc"]["b"]) - svcA)
    ant_ra = subendo(svcA + 1.0*nz(np.array([0, -1.0, 0]) - svcDir*(-svcDir[1])) , RAc)   # anterior RA, in front of the SVC
    limbus_sup = subendo(fo + for_*1.15*nz(np.array([0, -1.0, -0.6])), RAc)              # superior-anterior limbus of the fossa
    limbus_post = subendo(fo + for_*1.15*nz(np.array([0.3, 1.0, 0.3])), RAc)
    snapRA = lambda p: subendo(p, RAc)
    tr_ant = path([sa, ant_ra, limbus_sup, avn], snapRA, 12)                     # anterior (Bachmann branch leaves at ant_ra)
    tr_mid = path([sa, subendo(svcA + 0.9*nz(np.array([-0.8, 0.6, 0.1])), RAc), limbus_post, avn], snapRA, 12)   # middle (Wenckebach), behind the SVC
    tr_post = path([sa, subendo(crista[1], RAc), subendo(crista[2], RAc), et, avn], snapRA, 12)                  # posterior (Thorel): crista → Eustachian ridge
    # Bachmann's bundle: anterior RA → over the LA roof (anterior) → LAA base
    laa_base = subendo(L["LA_center"] + 0.65*(L["LAA_tip"] - L["LA_center"]), LAc)
    la_roof = subendo(L["LA_center"] + np.array([0.6, -1.2, -1.3]), LAc)
    bach = path([ant_ra, subendo((ant_ra + la_roof)/2 + np.array([0, -0.3, -0.4]), ("RA", "LA", "SVC")), la_roof, laa_base], lambda p: near(HEART_T & (DTB < 0.35), p), 12)
    # Koch's triangle: CS ostium, AV-node apex, TV septal hinge line
    tvc = L["TV_center"]; tvn = nz(S["TV_annulus"]["normal"]); a = nz(np.cross(tvn, [1, 0, 0])); b = np.cross(tvn, a)
    ring = [tvc + S["TV_annulus"]["R"]*(math.cos(t)*a + math.sin(t)*b) for t in np.linspace(0, 2*math.pi, 96, endpoint=False)]
    i_apex = int(np.argmin([np.linalg.norm(p - avn) for p in ring])); i_cs = int(np.argmin([np.linalg.norm(p - cso) for p in ring]))
    step = 1 if (i_cs - i_apex) % 96 < 48 else -1; hinge = [ring[(i_apex + step*q) % 96] for q in range(((i_cs - i_apex)*step) % 96 + 1)]
    hinge = [subendo(p, RAc, (0.02, 0.25)) for p in hinge[::max(1, len(hinge)//6)]]
    # CTI: inferior TV annulus → IVC orifice (the flutter isthmus)
    tv_inf = ring[int(np.argmax([p[1] for p in ring]))]; ivc_o = np.array(D["ivc_orifice"])
    cti = path([subendo(tv_inf, RAc), subendo((tv_inf + ivc_o)/2 + np.array([0, 0.3, 0]), RAc), subendo(ivc_o + 0.6*nz(tv_inf - ivc_o), RAc)], snapRA, 8)
    lm = {
      "sa_node": {"kind": "point", "p": r3(sa), "note": "Sinoatrial node site: SVC–RA junction at the top of the crista terminalis, subepicardial.", "src": "Dobrzynski 2013; Netter 224"},
      "av_node": {"kind": "point", "p": r3(avn), "note": "Compact AV node: apex of Koch's triangle, just in front of the central fibrous body.", "src": "Anderson; Netter 224"},
      "central_fibrous_body": {"kind": "point", "p": r3(cfb), "r": S["central_fibrous_body"]["r"], "note": "Right fibrous trigone, pierced by the His bundle."},
      "membranous_septum": {"kind": "point", "p": r3(ms), "r": S["membranous_septum"]["r"], "note": "Under the RCC–NCC commissure; His runs along its lower edge."},
      "his_bundle": {"kind": "path", "points": [r3(p) for p in his], "note": "AV node → through the CFB → along the lower edge of the membranous septum → crest of the muscular septum."},
      "his_bifurcation": {"kind": "point", "p": r3(bif), "note": "Crest of the muscular septum, LV side, below the membranous septum."},
      "lbb_anterior_fascicle": {"kind": "path", "points": [r3(p) for p in laf], "note": "Left anterior fascicle → base of the anterolateral papillary muscle."},
      "lbb_posterior_fascicle": {"kind": "path", "points": [r3(p) for p in lpf], "note": "Left posterior fascicle → base of the posteromedial papillary muscle."},
      "lbb_septal_fascicle": {"kind": "path", "points": [r3(p) for p in lsf], "note": "Septal fibres down the LV septal surface toward the apex."},
      "rbb": {"kind": "path", "points": [r3(p) for p in rbb], "note": "Right bundle branch down the RV septal surface to the septal end of the moderator band."},
      "moderator_band": {"kind": "path", "points": [r3(p) for p in mb], "note": "Carries the RBB to the anterior papillary muscle of the RV."},
      "internodal_anterior": {"kind": "path", "points": [r3(p) for p in tr_ant], "note": "Anterior internodal route (gives off Bachmann's bundle)."},
      "internodal_middle": {"kind": "path", "points": [r3(p) for p in tr_mid], "note": "Middle (Wenckebach) route, behind the SVC, along the fossa limbus."},
      "internodal_posterior": {"kind": "path", "points": [r3(p) for p in tr_post], "note": "Posterior (Thorel) route along the crista terminalis and the Eustachian ridge."},
      "bachmann_bundle": {"kind": "path", "points": [r3(p) for p in bach], "note": "Interatrial band: anterior RA → LA roof → LAA base."},
      "koch_triangle": {"kind": "polygon", "points": [r3(cso)] + [r3(p) for p in RD["todaro"]["points"]] + [r3(avn)] + [r3(p) for p in reversed(hinge)],
                        "note": "Bounded by the CS ostium, the tendon of Todaro and the TV septal hinge; the compact AV node lies at its apex."},
      "tendon_of_todaro": {"kind": "path", "points": RD["todaro"]["points"]},
      "tv_septal_hinge": {"kind": "path", "points": [r3(p) for p in hinge]},
      "cs_ostium": {"kind": "point", "p": r3(cso)}, "ivc_orifice": {"kind": "point", "p": r3(ivc_o)},
      "cti": {"kind": "path", "points": [r3(p) for p in cti], "note": "Cavotricuspid isthmus: the slow zone of typical flutter, ablation line."},
      "crista_terminalis": {"kind": "path", "points": [r3(p) for p in crista]},
      "fossa_ovalis": {"kind": "point", "p": r3(fo), "r": for_},
      "svc_junction": {"kind": "point", "p": r3(svcA)},
      "pv_ostia": {"kind": "points", "points": {k: r3(L[k]) for k in ("PVein_LU", "PVein_LL", "PVein_RU", "PVein_RL")}},
      "laa_tip": {"kind": "point", "p": r3(L["LAA_tip"])},
      **label_anchors(LAB, BLOOD, HEART_T, DTO, C, v, ID, near, r3),
      "papillary": {"kind": "points", "points": {k: r3(L[k]) for k in ("ALPM_base", "ALPM_tip", "PMPM_base", "PMPM_tip")}},
    }
    # checks: every conduction point sits in (or on) heart tissue
    bad = []
    for k, o in lm.items():
        pts = [o["p"]] if o["kind"] == "point" else (o["points"] if o["kind"] in ("path", "polygon") else [])
        for p in pts:
            l = lab_at(p)
            if k.startswith(("his", "lbb", "rbb", "internodal", "bachmann", "av_node", "sa_node")) and (l == "" or names.index(l) in ID("lungs", "liver", "pericardium")): bad.append((k, l))
    lens = {k: round(float(sum(np.linalg.norm(np.diff(np.array(o["points"]), axis=0), axis=1))), 2) for k, o in lm.items() if o["kind"] == "path"}
    return lm, bad, lens, lab_at

def main():
    t0 = time.time()
    if A.cache and os.path.exists(A.cache):
        Z = np.load(A.cache, allow_pickle=True); names = list(Z["names"]); out = Z["out"].item(); print("  using cached bakes", A.cache)
    else: out = None
    if out is None or (out["heart"]["v"] != CAP_VOXEL / 2 and "cap" not in out):
        names, out = asyncio.run(bake_all())
        if A.cache: np.savez_compressed(A.cache, names=np.array(names), out=np.array(out, dtype=object))
    ID = lambda *ns: [names.index(n) for n in ns if n in names]
    H = out["heart"]; LAB, TISv, lo, v = H["labels"], H["tissue"], H["lo"], H["v"]
    NOT_HEART = ID("", "pericardium", "liver", "diaphragm", "IVC", "hepatic_veins", "descending_aorta", "descending_aorta.abdominal", "ribs", "sternum", "lungs", "stomach_gas", "chest_wall", "chordae")
    cap_out = cap_volume(out.get("cap", H), names, NOT_HEART)
    VESSELS = ID("LCA", "RCA", "cardiac_veins")
    tissue = np.isin(TISv, [TIS["myocardium"], TIS["fibrous"], TIS["vessel_wall"], TIS["fat"]]) & ~np.isin(LAB, NOT_HEART)
    lab_tissue = tissue & ~np.isin(LAB, VESSELS)     # coronaries fill their grooves in the mesh (no notch in the cut contour) but never name a wall vertex
    LAB = LAB.copy(); blood = TISv == TIS["blood"]
    # seal: where right-heart blood touches left-heart blood (sub-voxel fossa ovalis, thin walls) the bake leaves a hole → a 0.2 cm wall
    # (the fossa is a thin depression, not an ASD). RA|LA contact becomes IAS; any other contact takes the nearest wall's label.
    RIGHT = np.isin(LAB, ID("RA", "RV_cavity", "RVOT", "PA_main", "RPA", "LPA", "SVC", "coronary_sinus")) & blood
    LEFT = np.isin(LAB, ID("LA", "LV_cavity", "LVOT", "LAA", "pulmonary_veins", "aortic_root", "aortic_root.ascending", "aortic_arch", "arch_branches")) & blood
    seal = (RIGHT & ndimage.binary_dilation(LEFT, iterations=1)) | (LEFT & ndimage.binary_dilation(RIGHT, iterations=1))
    if seal.any():
        ias = (np.isin(LAB, ID("RA", "LA")) & seal) & ndimage.binary_dilation(np.isin(LAB, ID("RA")) & blood, iterations=2) & ndimage.binary_dilation(np.isin(LAB, ID("LA")) & blood, iterations=2)
        _, ind = ndimage.distance_transform_edt(~lab_tissue, return_indices=True)
        LAB[seal] = LAB[ind[0][seal], ind[1][seal], ind[2][seal]]
        if ID("IAS"): LAB[ias] = ID("IAS")[0]
        tissue |= seal; lab_tissue |= seal; blood &= ~seal
    print(f"  tissue voxels {tissue.sum()}  (sealed {int(seal.sum())} blood voxels at right|left contacts)")
    P, F, N = sdf_mesh(tissue, lo, v, sigma=0.7, target_tris=A.tris, min_tris=60)
    vl = sample_nearest(lab_tissue, LAB, lo, v, P)
    cav, dcav = sample_nearest(blood, LAB, lo, v, P + N*0.06, return_d=True)
    cav = np.where(dcav <= 0.2, cav, 0).astype(np.uint8)
    WALL = {1: ("LV_myocardium", "IVS", "PW", "papillary_muscles.ALPM", "papillary_muscles.PMPM"), 2: ("RV_free_wall", "moderator_band", "RVOT"),
            3: ("LA_wall", "RA_wall", "IAS", "crista_terminalis", "pectinate_muscles", "SVC", "LAA", "pulmonary_veins", "coronary_sinus"),
            4: ("aortic_root", "aortic_root.ascending", "aortic_arch", "arch_branches", "PA_main", "RPA", "LPA"), 5: ("epicardial_fat",),
            6: ("MV_AML", "TV_annulus", "central_fibrous_body", "membranous_septum", "todaro_tendon", "eustachian_valve", "thebesian_valve")}
    wall = np.zeros(len(P), np.uint8)
    for w, ns in WALL.items(): wall[np.isin(vl, ID(*ns))] = w
    motion = np.where(np.isin(wall, [1, 2]), 255, 46).astype(np.uint8)
    tissue_out = {"mesh": quant(P, N, F), "vertex": {"label": b64(vl.astype(np.uint8)), "cavity": b64(cav), "wall": b64(wall), "motion": b64(motion)}}
    print(f"  tissue surface: {len(P)} verts, {len(F)} tris; labels {len(np.unique(vl))}; endocardial vertices {int((cav > 0).sum())}")
    # valves
    vout = []
    for k, labs in VALVE_LABELS.items():
        frames = []
        for ph in PHASES:
            V = out[(k, ph)]; Lv, Tv = V["labels"], V["tissue"]
            m = np.isin(Lv, ID(*labs)) & ((Tv == TIS["valve"]) | np.isin(Lv, ID("chordae")))
            if m.sum() < 20: frames.append(None); continue
            Pv, Fv, Nv = sdf_mesh(m, V["lo"], V["v"], sigma=0.55, target_verts=A.valve_verts*(1.6 if k == "MV" else 1.0), min_tris=12)
            lv = sample_nearest(m, Lv, V["lo"], V["v"], Pv).astype(np.uint8)
            frames.append({"mesh": quant(Pv, Nv, Fv), "label": b64(lv)})
        vout.append({"id": k, "labels": labs, "frames": frames})
        print(f"  valve {k}: verts per phase", [f["mesh"]["vertices"] if f else 0 for f in frames])
    lm, bad, lens, lab_at = landmarks(H, names)
    print("  landmark path lengths (cm):", lens)
    if bad: print("  WARNING landmarks outside heart tissue:", bad)
    ext = json.load(open(os.path.join(root, "export", "heart-mesh.json")))
    res = {"meta": {"format": "pun-cvs heart interior v1", "phantom": PH["_meta"]["version"], "units": ext["meta"]["units"], "voxelCm": A.voxel, "valveVoxelCm": A.valve_voxel,
                    "notes": ["Baked from the phantom's scene() at end-diastole (tissue) and at the valve phases; companion of heart-mesh.json (outer surface, coronaries).",
                              "tissue: one closed surface; clip it with a plane and cap the cut by sampling the phantom (or the label colours) to show internal anatomy.",
                              "valves: flip-book keyframes on the ECG clock (phases = fraction of RR, 0 = R wave). Chordae are part of the MV frames.",
                              "landmarks: placed from the phantom; conduction paths are teaching layouts (verify with an expert)."]},
           "frames": ext["frames"], "labelNames": names,
           "wallNames": {"0": "other", "1": "LV", "2": "RV", "3": "atria", "4": "great vessels", "5": "fat", "6": "fibrous skeleton"},
           "tissue": tissue_out, "valves": {"phases": PHASES, "items": vout}, "landmarks": lm, "capVolume": cap_out}
    os.makedirs(os.path.dirname(A.out), exist_ok=True); json.dump(res, open(A.out, "w"), separators=(",", ":"))
    json.dump({"meta": {"format": "pun-cvs heart landmarks v1", "phantom": PH["_meta"]["version"], "units": ext["meta"]["units"]}, "landmarks": lm},
              open(os.path.join(os.path.dirname(A.out), "heart-landmarks.json"), "w"), indent=1)
    print(f"wrote {A.out} ({os.path.getsize(A.out)/1024:.0f} KB) in {time.time()-t0:.0f} s")

if __name__ == "__main__":
    main()
