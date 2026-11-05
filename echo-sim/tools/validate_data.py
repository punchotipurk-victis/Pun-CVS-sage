#!/usr/bin/env python3
"""Validate echo-sim data files before building: views.json ↔ phantom-normal.json.

Checks
  1. Both files parse; required view fields exist; ids unique; v1Sequence matches views.
  2. Every id a view references (derivation landmarks, labels, content checks, pitfalls)
     resolves to a phantom landmark, axis, structure, extracardiac structure or label alias.
  3. Heart frame is orthonormal and right-handed.
  4. Anatomy sanity in patient coordinates (depths, A5C/CS tilt, PSAX obliquity, PLAX beam angle).
     These print as INFO with expected ranges; values outside the range print WARN.
Exit code 1 on any ERROR (WARN does not fail).

Usage: python validate_data.py <data-dir>   (expects views.json + phantom-normal.json [+ views.overrides.json])
"""
import json, math, os, re, sys

ERR, WARN = [], []
def err(m): ERR.append(m); print("ERROR", m)
def warn(m): WARN.append(m); print("WARN ", m)
def info(m): print("INFO ", m)

V3 = lambda a: [float(x) for x in a]
dot = lambda a, b: sum(x*y for x, y in zip(a, b))
sub = lambda a, b: [x-y for x, y in zip(a, b)]
add = lambda a, b: [x+y for x, y in zip(a, b)]
mul = lambda a, s: [x*s for x in a]
norm = lambda a: mul(a, 1/math.sqrt(dot(a, a)))
cross = lambda a, b: [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
deg = lambda r: r*180/math.pi

REQUIRED_VIEW = ["id", "name", "shortName", "family", "patientPosition", "window", "derivation",
                 "seedPose", "tolerance", "image", "contentChecks", "labels", "pitfalls",
                 "maneuverFromPrevious", "teaching"]
REQUIRED_TEACH = {"core": ["whatYouSee", "howToKnowYoureThere", "handMove"],
                  "deeper": ["uses", "measurements"], "fellowPearl": None, "whyItLooksLikeThis": None}


def known_ids(P):
    ids = set(P["landmarks_heart"]) | set(P["axes_heart"]) | set(P["structures"]) | set(P["extracardiac_patient"])
    ids |= set(P["extracardiac_patient"].get("lungs", {}).keys())
    for s in list(P["structures"].values()) + list(P["extracardiac_patient"].values()):
        if isinstance(s, dict):
            for k in ("labels",):
                if isinstance(s.get(k), dict): ids |= set(s[k].keys())
    ids |= {"crux", "PW", "IVS"}
    return {i for i in ids if not i.startswith("_")}


def refs_of(view):
    out = []
    d = view["derivation"]
    for k in ("through",):
        out += d.get(k, [])
    for k in ("aimAt", "notchSideLandmark", "levelCenter", "throughLandmark", "axisRef"):
        if d.get(k): out.append(d[k])
    out += view.get("labels", [])
    cc = view.get("contentChecks", {})
    for k in ("mustSee", "mustNotSee"):
        out += [c["id"] for c in cc.get(k, [])]
    for p in view.get("pitfalls", []):
        if p.get("throughLandmark"): out.append(p["throughLandmark"])
    res = []
    for r in out:
        m = re.match(r"midpoint\(([^,]+),\s*([^)]+)\)", r)
        res += [m.group(1).strip(), m.group(2).strip()] if m else [r]
    return res


def main():
    if len(sys.argv) != 2: sys.exit(__doc__)
    d = sys.argv[1]
    P = json.load(open(os.path.join(d, "phantom-normal.json"), encoding="utf-8"))
    VJ = json.load(open(os.path.join(d, "views.json"), encoding="utf-8"))
    ov = os.path.join(d, "views.overrides.json")
    if os.path.exists(ov): json.load(open(ov, encoding="utf-8")); info("views.overrides.json parses")
    views = VJ["views"]

    # 1. structure
    ids = [v.get("id") for v in views]
    if len(ids) != len(set(ids)): err(f"duplicate view ids: {ids}")
    seq = VJ.get("_meta", {}).get("v1Sequence", [])
    if seq and seq != ids: warn(f"_meta.v1Sequence {seq} differs from view order {ids}")
    for v in views:
        for f in REQUIRED_VIEW:
            if f not in v: err(f"{v.get('id')}: missing field '{f}'")
        t = v.get("teaching", {})
        for sec, subs in REQUIRED_TEACH.items():
            if sec not in t: err(f"{v['id']}: teaching.{sec} missing"); continue
            for s in subs or []:
                if s not in t[sec]: err(f"{v['id']}: teaching.{sec}.{s} missing")
        for m in t.get("deeper", {}).get("measurements", []):
            if "source" not in m: warn(f"{v['id']}: measurement '{m.get('name')}' has no source tag")
        if v.get("window") not in VJ["windows"]: err(f"{v['id']}: unknown window {v.get('window')}")
        nd = v.get("seedPose", {}).get("notchDeg_ASE")
        if nd is None or not -180 <= nd <= 180: err(f"{v['id']}: seedPose.notchDeg_ASE missing/out of range")
        if v["derivation"].get("method") not in VJ["derivationMethods"]:
            err(f"{v['id']}: unknown derivation method {v['derivation'].get('method')}")
        if v["derivation"].get("method") == "tiltFrom" and v["derivation"].get("base") not in ids:
            err(f"{v['id']}: tiltFrom base view not found")

    # 2. references
    K = known_ids(P)
    for v in views:
        for r in refs_of(v):
            base = r.split(".")[0].split("[")[0]
            if base not in K: err(f"{v['id']}: reference '{r}' does not resolve in phantom-normal.json")

    # 3. frame
    h = P["frames"]["heart"]; O = V3(h["origin_patient"])
    X, Y, Z = (V3(h[k]) for k in ("X_patient", "Y_patient", "Z_patient"))
    for nm, a in (("X", X), ("Y", Y), ("Z", Z)):
        if abs(math.sqrt(dot(a, a)) - 1) > 0.01: err(f"heart axis {nm} not unit length")
    for nm, (a, b) in {"X·Y": (X, Y), "X·Z": (X, Z), "Y·Z": (Y, Z)}.items():
        if abs(dot(a, b)) > 0.01: err(f"heart axes not orthogonal ({nm}={dot(a,b):.3f})")
    if dot(cross(X, Y), Z) < 0.99: err("heart frame is not right-handed (X×Y should equal Z)")

    # 4. anatomy sanity
    L = P["landmarks_heart"]
    tp = lambda k: add(O, add(mul(X, L[k][0]), add(mul(Y, L[k][1]), mul(Z, L[k][2]))))
    t = P["extracardiac_patient"]["torso"]; hw, hd, cz = t["halfWidthX"], t["halfDepthZ"], t["center_xz"][1]
    skin = lambda x: cz + hd*math.sqrt(max(0, 1-(x/hw)**2))
    def rng(name, val, lo, hi, unit=""):
        (info if lo <= val <= hi else warn)(f"{name} = {val:.1f}{unit}  (expected {lo}–{hi}{unit})")
    for k, lo, hi in [("AV_center", 3.5, 7), ("MV_center", 5, 9), ("LV_apex_epi", 1.5, 4.5), ("LA_center", 6.5, 11)]:
        p = tp(k); rng(f"depth of {k} below skin", skin(p[0]) - p[2], lo, hi, " cm")
    ap = V3(L["LV_apex_endo"])
    for nm, k, lo, hi in [("A4C→A5C tilt", "AV_center", 5, 10), ("A4C→CS-view tilt", "CS_mid", 8, 20)]:
        n = norm(cross([1, 0, 0], sub(V3(L[k]), ap))); rng(nm, deg(math.acos(min(1, abs(n[1])))), lo, hi, "°")
    n = norm(cross(sub(V3(L["AV_center"]), V3(L["MV_center"])), sub(ap, V3(L["MV_center"]))))
    npat = add(mul(X, n[0]), add(mul(Y, n[1]), mul(Z, n[2])))
    rng("PLAX: smallest beam angle from skin normal", deg(math.asin(abs(npat[2]))), 0, 25, "°")
    W = VJ["windows"]["parasternal_left"]
    for nm, seed, lvl, lim in [("PSAX-PM", W["seedICS4"], "LV_level_papillary", 15), ("PSAX-MV", W["seedICS3"], "LV_level_MV", 25)]:
        P0 = [seed[0], seed[1], skin(seed[0])]; b = norm(sub(tp(lvl), P0))
        rng(f"{nm} obliquity vs LV axis", abs(90 - deg(math.acos(dot(b, Z)))), 0, lim, "°")
    da = P["extracardiac_patient"]["descending_aorta"]
    la_post = tp("LA_center")[2] - 1.6; da_front = da["points"][1][2] + da["r"]
    rng("gap LA posterior wall → descending aorta", la_post - da_front, 0, 2.5, " cm")

    print(f"\n{len(ERR)} error(s), {len(WARN)} warning(s)")
    sys.exit(1 if ERR else 0)


if __name__ == "__main__":
    main()
