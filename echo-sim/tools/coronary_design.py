#!/usr/bin/env python3
"""Design the coronary arteries and cardiac veins on the baked heart (dev, run after any change to the heart's outer shape).
   python tools/coronary_design.py            → writes structures.coronary_arteries / cardiac_veins / epicardial_fat into data/phantom-normal.json
   Grooves are found on the baked heart: the interventricular grooves where LV and RV walls meet on the surface, the AV groove where atrial and
   ventricular walls meet. Vessels follow them (Netter plates 216/218/223, BP52: right-dominant pattern) and are snapped onto the surface."""
import asyncio, sys, os, json, math
import numpy as np
from playwright.async_api import async_playwright
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
here = os.path.dirname(os.path.abspath(__file__)); PJ = os.path.join(here, "..", "data", "phantom-normal.json")
INJECT = r"""
window.CD = (() => {
  const V = ECHO.heartVol(), LB = ECHO.labelsList(), vol = V.vol, d = vol.dist, [nx, ny, nz] = V.n, v = V.v, lo = V.lo;
  const id = (i, j, k) => i + nx*(j + ny*k), cls = {};
  for (const nm of ["IVS", "PW", "LV_myocardium"]) cls[LB.indexOf(nm)] = "L";
  for (const nm of ["RV_free_wall"]) cls[LB.indexOf(nm)] = "R";
  for (const nm of ["LA_wall", "RA_wall", "IAS", "crista_terminalis"]) cls[LB.indexOf(nm)] = "A";
  function sample(p){ const x = (p[0]-lo[0])/v - .5, y = (p[1]-lo[1])/v - .5, z = (p[2]-lo[2])/v - .5, i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    if (i < 0 || j < 0 || k < 0 || i >= nx-1 || j >= ny-1 || k >= nz-1) return 4; const fx = x-i, fy = y-j, fz = z-k; let s = 0;
    for (let c = 0; c < 8; c++){ const a = c & 1, b = (c >> 1) & 1, e = c >> 2; s += d[id(i+a, j+b, k+e)]*(a ? fx : 1-fx)*(b ? fy : 1-fy)*(e ? fz : 1-fz); } return s; }
  function grad(p){ const e = v; return [0,1,2].map(a => { const q1 = p.slice(), q0 = p.slice(); q1[a] += e; q0[a] -= e; return (sample(q1) - sample(q0))/(2*e); }); }
  function snap(pts, target){ return pts.map(p0 => { let p = p0.slice(); for (let it = 0; it < 30; it++){ const s = sample(p) - target, g = grad(p), gl = Math.hypot(...g) || 1; p = p.map((x, a) => x - s*g[a]/gl/gl*0.8); if (Math.abs(s) < .005) break; } return p; }); }
  function grooves(){ const out = { LR: [], AV: [] }, R = 2;
    for (let k = R; k < nz-R; k++) for (let j = R; j < ny-R; j++) for (let i = R; i < nx-R; i++){ const c = id(i, j, k); if (!(d[c] > 0.02 && d[c] < 0.22)) continue;
      let L = 0, Rv = 0, A = 0; for (let dk = -R; dk <= R; dk++) for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++){ const q = id(i+di, j+dj, k+dk); if (d[q] >= 0) continue; const t = cls[vol[q]]; if (t === "L") L++; else if (t === "R") Rv++; else if (t === "A") A++; }
      const p = [lo[0] + (i+.5)*v, lo[1] + (j+.5)*v, lo[2] + (k+.5)*v];
      if (L > 2 && Rv > 2) out.LR.push(p); if (A > 2 && (L + Rv) > 2) out.AV.push(p); }
    return out; }
  return { grooves, snap, sample };
})(); true;
"""
nz_ = lambda a: a/np.linalg.norm(a)
def resample(P, step):
    P = np.array(P, float); seg = np.linalg.norm(np.diff(P, axis=0), axis=1); s = np.concatenate([[0], np.cumsum(seg)]); n = max(2, int(round(s[-1]/step)) + 1)
    t = np.linspace(0, s[-1], n); return np.stack([np.interp(t, s, P[:, a]) for a in range(3)], 1)
def smooth(P, it=2):
    P = np.array(P, float)
    for _ in range(it): Q = P.copy(); Q[1:-1] = 0.25*P[:-2] + 0.5*P[1:-1] + 0.25*P[2:]; P = Q
    return P
async def main():
    ph = json.load(open(PJ))
    # design on the heart WITHOUT existing vessels/fat (they would fill the grooves): build a temporary lab from a stripped copy
    import subprocess, shutil, tempfile
    prev = {k: ph["structures"].pop(k, None) or {} for k in ("coronary_arteries", "cardiac_veins", "epicardial_fat")}   # keep hand-set keys (e.g. coronary_arteries.display)
    root = os.path.join(here, ".."); bak = PJ + ".bak"; shutil.copy(PJ, bak); json.dump(ph, open(PJ, "w"), indent=2, ensure_ascii=False)
    lab = os.path.join(tempfile.gettempdir(), "coronary_design_lab.html")
    try: subprocess.run([sys.executable, os.path.join(here, "build_lab.py"), root, "--out", lab], check=True, capture_output=True)
    finally: shutil.copy(bak, PJ); os.remove(bak)
    sys.argv = [sys.argv[0], lab]
    L = {k: np.array(v, float) for k, v in ph["landmarks_heart"].items() if not k.startswith("_")}; S = ph["structures"]
    a = nz_(np.array(ph["axes_heart"]["aortic_root"])); AVc = L["AV_center"]; dirs = {k: np.array(v) for k, v in ph["axes_heart"]["AV_cusp_dirs"].items() if not k.startswith("_")}
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); pg = await (await b.new_context(viewport={"width": 1200, "height": 800})).new_page()
        await pg.goto("file://" + os.path.abspath(sys.argv[1])); await pg.wait_for_function("window.ECHO && ECHO.ready", timeout=240000)
        await pg.evaluate(INJECT); G = await pg.evaluate("CD.grooves()")
        snap = lambda pts, t: pg.evaluate(f"CD.snap({json.dumps([list(map(float, q)) for q in pts])}, {t})")
        LR = np.array(G["LR"]); AV = np.array(G["AV"]); print("groove voxels", len(LR), len(AV))
        # ---- interventricular grooves: anterior (heart −Y side) and inferior (+Y), median point per 0.5 cm of the long axis
        def ivpath(sel):
            P = LR[sel]; out = []
            for z in np.arange(P[:, 2].min(), P[:, 2].max(), 0.5):
                m = (P[:, 2] >= z) & (P[:, 2] < z + 0.5)
                if m.sum() > 3: out.append(np.median(P[m], 0))
            return np.array(out)
        antIV = ivpath(LR[:, 1] < -0.3); infIV = ivpath(LR[:, 1] > 0.3)
        # near the base the RVOT covers the anterior groove: extend it up to the base along its own direction, then snap
        def extendUp(P, zTop):
            if P[0, 2] <= zTop + 0.3: return P
            d0 = nz_(P[0] - P[min(3, len(P)-1)]); ext = [P[0] + d0*s for s in np.arange((P[0, 2] - zTop)/max(d0[2]*-1, .3), 0, -0.5)]
            return np.vstack([np.array(ext), P]) if ext else P
        # bifurcation of the LM: on the surface between the pulmonary trunk root and the left auricle (where the LAD emerges, Netter 216/223);
        # the LAD then runs from there into the anterior IV groove (detected only below the RVOT)
        laa0 = np.array(S["LAA"]["points"][0], float) if isinstance(S["LAA"]["points"][0], list) else L["LAA_tip"]
        B = np.array((await snap([0.5*(laa0 + L["PV_center"]) + np.array([0, -0.2, 0.6])], 0.15))[0])
        bridge = np.array(await snap([B + (antIV[0] - B)*f for f in (0.33, 0.66)], 0.0))
        antIV = np.vstack([B, bridge, antIV])
        # ---- AV groove: median point per 12° round an axis through the base
        c0 = np.array([1.7, 0.2, 0.3]); ang = np.degrees(np.arctan2(AV[:, 1] - c0[1], AV[:, 0] - c0[0])); ring = []
        for t in range(-180, 180, 12):
            m = (ang >= t) & (ang < t + 12)
            if m.sum() > 3: ring.append((t + 6, np.median(AV[m], 0)))
        ringA = np.array([r[0] for r in ring]); ringP = np.array([r[1] for r in ring])
        print("antIV z", antIV[0, 2].round(1), "→", antIV[-1, 2].round(1), " infIV", infIV[0, 2].round(1), "→", infIV[-1, 2].round(1), " AV ring bins", len(ring))
        def ringArc(a0, a1):   # points of the AV groove from angle a0 to a1 (degrees, going the short way given by sign)
            step = 12 if a1 > a0 else -12; out = []
            for t in np.arange(a0, a1 + step/2, step):
                k = np.argmin(np.abs(((ringA - t + 180) % 360) - 180)); out.append(ringP[k])
            return np.array(out)
        angOf = lambda q: math.degrees(math.atan2(q[1] - c0[1], q[0] - c0[0]))
        top = antIV[0]; crux = infIV[0]; aTop, aCrux = angOf(top), angOf(crux)
        # left side of the ring = LV lateral (heart −X); right side = RV / RA side (+X)
        print("bifurcation (top of anterior IV groove) angle", round(aTop), " crux angle", round(aCrux))
        lad = np.vstack([top, antIV[1:], ])
        apex = L["LV_apex_epi"]; wrap = await snap([apex + np.array([0.3, 0.9, 0.2]), apex + np.array([0.4, 1.8, -0.6])], 0.0)
        lad = np.vstack([lad, wrap])
        # left AV groove from the bifurcation backwards round the LV lateral side (angles decreasing past ±180 toward the crux)
        leftArc = ringArc(aTop, aTop - ((aTop - aCrux) % 360))
        rightArc = ringArc(aTop, aTop + ((aCrux - aTop) % 360))
        if np.mean(leftArc[:, 0]) > np.mean(rightArc[:, 0]): leftArc, rightArc = rightArc, leftArc
        lcx = leftArc[: int(len(leftArc)*0.55)]   # right-dominant: the LCx ends past the obtuse margin
        # ostia: left coronary in the left sinus, right coronary in the right sinus, below the sinotubular junction
        R0 = 1.3; ostL = AVc + a*0.95 + nz_(dirs["LCC"])*R0*1.05; ostR = AVc + a*0.95 + nz_(dirs["RCC"])*R0*1.05
        bif = top + (ostL - top)*0.0
        lm = np.array([ostL, ostL + (top - ostL)*0.5 + np.array([0, 0, 0.1]), top])
        # RCA: right ostium → right AV groove (from its anterior end) → crux
        rStart = rightArc[np.argmin(np.linalg.norm(rightArc - ostR, axis=1))]; iS = int(np.argmin(np.linalg.norm(rightArc - ostR, axis=1)))
        rca = np.vstack([ostR, ostR + (rStart - ostR)*0.55, rightArc[iS:], crux])
        def along(P, f):  # point and tangent at fraction f of a polyline
            P = resample(P, 0.1); i = min(len(P) - 2, int(f*(len(P) - 1))); return P[i], nz_(P[i+1] - P[i])
        out = []
        def branch(P0, dirn, length, n=5, down=None, curve=0.0):
            pts = [P0]; dv = nz_(dirn)
            for k in range(1, n): pts.append(P0 + dv*length*k/(n-1) + (down if down is not None else 0)*(k/(n-1))**2*curve)
            return np.array(pts)
        lateral = np.array([-1.0, 0.0, 0.0]); towardApex = np.array([0, 0, 1.0])
        V = []   # (id, name, scct, parent, territory, label, pts, r0, r1, snapTarget)
        V.append(("LM", "Left main", 5, None, "LAD+LCx", "LCA", lm, 0.23, 0.21, None))
        V.append(("LAD", "Left anterior descending (proximal → mid → distal, wraps the apex)", "6-8", "LM", "anterior wall, anterior septum, apex", "LCA", lad, 0.19, 0.07, 0.05))
        for k, (f, ln, nm, sc) in enumerate([(0.3, 5.0, "D1", 9), (0.5, 4.0, "D2", 10)]):
            p0, t = along(lad, f); V.append((nm, f"Diagonal {k+1}", sc, "LAD", "anterolateral wall", "LCA", branch(p0, lateral*0.85 + towardApex*0.55 + np.array([0, -0.25, 0]), ln), 0.11, 0.05, 0.05))   # over the LV anterolateral wall toward the apex
        for k, f in enumerate([0.12, 0.28, 0.45]):
            p0, t = along(lad, f); V.append((f"S{k+1}", f"Septal perforator {k+1}", None, "LAD", "anterior 2/3 of the septum", "LCA", branch(p0, np.array([0.55, 0.85, 0.1]), 2.4 - 0.4*k, 4), 0.07, 0.04, "inside"))
        V.append(("LCx", "Left circumflex (proximal → distal, in the left AV groove)", "11,13", "LM", "lateral and posterolateral wall", "LCA", np.vstack([top, lcx]), 0.17, 0.09, 0.05))
        for k, (f, ln, nm, sc) in enumerate([(0.35, 5.2, "OM1", 12), (0.72, 4.4, "OM2", 14)]):
            p0, t = along(np.vstack([top, lcx]), f); V.append((nm, f"Obtuse marginal {k+1}", sc, "LCx", "lateral wall", "LCA", branch(p0, towardApex*1.0 + t*0.25, ln), 0.11, 0.05, 0.05))
        V.append(("RCA", "Right coronary (proximal → mid → distal, in the right AV groove to the crux)", "1-3", None, "RV, inferior wall, inferior septum", "RCA", rca, 0.2, 0.15, 0.05))
        p0, t = along(rca, 0.06); V.append(("CB", "Conus branch", None, "RCA", "RV outflow tract", "RCA", branch(p0, np.array([0.2, -1.0, 0.5]), 2.0, 4), 0.07, 0.04, 0.05))
        p0, t = along(rca, 0.04); svcB = np.array(S["RA"]["detail"]["svc"]["a"]); V.append(("SAN", "Sinuatrial nodal branch", None, "RCA", "SA node (RA–SVC junction)", "RCA", np.array([p0, p0 + (svcB - p0)*0.5 + np.array([0, -0.3, -0.4]), svcB + np.array([0, -0.6, -1.4])]), 0.06, 0.04, 0.05))
        for k, f in enumerate([0.22, 0.36]):
            p0, t = along(rca, f); V.append((f"RVB{k+1}", f"RV branch {k+1}", None, "RCA", "RV free wall", "RCA", branch(p0, towardApex + np.array([0.3, -0.4, 0]), 3.0, 4), 0.08, 0.04, 0.05))
        p0, t = along(rca, 0.52); V.append(("AM", "Acute marginal", None, "RCA", "RV free wall (acute margin)", "RCA", branch(p0, towardApex + np.array([0.1, 0.4, 0]), 5.0, 5), 0.1, 0.05, 0.05))
        pda = np.vstack([crux, infIV[1: int(len(infIV)*0.75)]]); V.append(("PDA", "Posterior descending (inferior interventricular)", 4, "RCA", "inferior wall, inferior 1/3 of the septum", "RCA", pda, 0.12, 0.06, 0.05))
        V.append(("AVN", "AV nodal branch", None, "RCA", "AV node (base of the atrial septum)", "RCA", np.array([crux, crux + np.array([0.6, 0.2, -1.0])]), 0.05, 0.04, "inside"))
        plb0 = leftArc[int(len(leftArc)*0.6):][::-1]; plb = np.vstack([crux, plb0[1:4]]) if len(plb0) > 3 else np.array([crux, crux + np.array([-1.5, 0.3, 0.3])])
        p0, t = along(plb, 0.6); V.append(("PLB", "Right posterolateral branch", 16, "RCA", "inferolateral wall", "RCA", np.vstack([plb, branch(plb[-1], towardApex + lateral*0.3, 2.5, 3)[1:]]), 0.1, 0.05, 0.05))
        # ---- veins: great cardiac vein beside the LAD up the anterior groove, then the left AV groove (with the LCx) into the coronary sinus;
        #      middle cardiac vein up the inferior groove to the CS ostium; small cardiac vein along the right AV groove
        offs = lambda P, dx: np.array([q + np.array([dx, 0.15, 0]) for q in P])
        csL = L["CS_lateral"]; gcv = np.vstack([offs(antIV[int(len(antIV)*0.6)::-1], -0.45), offs(lcx, 0.0)[1:], csL])
        mcv = np.vstack([offs(infIV[int(len(infIV)*0.7)::-1], 0.45), L["CS_ostium"]])
        scv = np.vstack([offs(rightArc[int(len(rightArc)*0.45):], 0.0), L["CS_ostium"]])
        VV = [("GCV", "Great cardiac vein", gcv, 0.16, 0.24), ("MCV", "Middle cardiac vein", mcv, 0.12, 0.2), ("SCV", "Small cardiac vein", scv, 0.08, 0.1)]
        arts = []
        for (vid, name, sc, par, terr, lab, pts, r0, r1, tgt) in V:
            P = resample(pts, 0.35)
            if tgt is not None and tgt != "inside": t_ = r0*0.7 + 0.05; P = np.array(await snap(P, t_)); P = smooth(P, 2); P = np.array(await snap(P, t_))
            P = resample(P, 0.6 if len(P) > 6 else 0.4)
            arts.append({"id": vid, "name": name, "scct": sc, "parent": par, "territory": terr, "label": lab, "r0": r0, "r1": r1, **({"deep": True} if tgt == "inside" else {}), "points": [[round(float(x), 2) for x in q] for q in P]})
        veins = []
        for (vid, name, pts, r0, r1) in VV:
            P = resample(pts, 0.35); P = np.array(await snap(P, r0*0.7 + 0.05)); P = smooth(P, 2); P = resample(np.array(await snap(P, r0*0.7 + 0.05)), 0.6)
            veins.append({"id": vid, "name": name, "r0": r0, "r1": r1, "points": [[round(float(x), 2) for x in q] for q in P]})
        fat = []
        for nm, P in (("AV_groove", np.vstack([rightArc[::-1], leftArc[1:]])), ("anterior_IV_groove", antIV), ("inferior_IV_groove", infIV)):
            P = resample(smooth(np.array(await snap(resample(P, 0.4), -0.08)), 3), 0.8); fat.append({"id": nm, "r": 0.32, "points": [[round(float(x), 2) for x in q] for q in P]})
        await b.close()
    ph["structures"]["coronary_arteries"] = {"type": "tubes", "tissue": "vessel_wall", "dominance": "right", "arteries": arts,
        "_note": "Designed on the baked heart by tools/coronary_design.py (run again after any change to the outer shape). Right-dominant pattern (Netter 223, BP52): LM → LAD (diagonals, septal perforators, wraps the apex) + LCx (OMs, in the left AV groove); RCA (conus, SA nodal, RV branches, acute marginal, AV nodal, PDA, posterolateral). 'scct' = SCCT/AHA segment number(s); 'territory' = the myocardium it supplies (for the MI lab). Radii (cm) teaching values after Dodge 1992 (verify): LM 0.23, proximal LAD 0.19, LCx 0.17, RCA 0.20."}
    ph["structures"]["cardiac_veins"] = {"type": "tubes", "tissue": "vessel_wall", "veins": veins, "_note": "Great cardiac vein (anterior IV groove → left AV groove), middle cardiac vein (inferior IV groove), small cardiac vein (right AV groove), all draining into the coronary sinus → RA (Netter 218/222; lecture)."}
    ph["structures"]["epicardial_fat"] = {"type": "tubes", "tissue": "fat", "grooves": fat, "_note": "Fat filling the AV and interventricular grooves (vessels run inside it). Echo: faint, mid-grey; 3D: yellow in the grooves."}
    for k, old in prev.items():
        for kk, vv in old.items(): ph["structures"][k].setdefault(kk, vv)
    for a_ in ph["structures"]["coronary_arteries"]["arteries"]:
        n_ = {"LM": 99, "LAD": 4, "LCx": 3, "RCA": 5}.get(a_["id"])
        if n_: a_["echoPts"] = min(n_, len(a_["points"]))
        if a_["id"] in ("S1", "S2", "S3", "AVN"): a_["deep"] = True
    for g_ in ph["structures"]["epicardial_fat"]["grooves"]:
        if g_["id"] == "AV_groove": g_["echo"] = True
    json.dump(ph, open(PJ, "w"), indent=2, ensure_ascii=False); print("arteries", len(arts), "veins", len(veins), "fat", len(fat))
asyncio.run(main())
