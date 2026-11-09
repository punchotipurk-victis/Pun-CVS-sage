"""Build heart3d/data/conduction.json (task T6.1): the conduction graph on the refined heart.

Sources (nothing is placed by hand):
  * geometry  : echo-sim/export/heart-landmarks.json (paths/points, heart frame, cm)
  * timings   : the legacy graph (heart3d/src/js/conduction.js) dumped by dump_legacy_conduction.js
  * snapping  : echo-sim/export/heart-interior.json (tissue vertices with label + wall class)
Nodes that the landmarks lack (LA posterior/inferior, accessory pathway, RV apex, ectopic foci) are the legacy
positions mapped into the heart frame by a similarity fit on paired landmarks, then snapped to the nearest vertex
of the right tissue. Edge times are the legacy edge times, so Dijkstra on this graph reproduces the legacy node times.

Run:  node heart3d/tools/dump_legacy_conduction.js heart3d/src/js > /tmp/legacy.json
      python heart3d/tools/make_conduction_spec.py /tmp/legacy.json
"""
import base64, json, math, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
LEG = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/legacy.json"))
LMJ = json.load(open(ROOT / "echo-sim/export/heart-landmarks.json"))
LM = LMJ["landmarks"]
INT = json.load(open(ROOT / "echo-sim/export/heart-interior.json"))
OUT = ROOT / "heart3d/data/conduction.json"
U = LEG["U"]  # legacy mm per H3 unit

r3 = lambda p: [round(float(x), 3) for x in p]
A = lambda p: np.asarray(p, float)

# ---------- tissue vertices for snapping ----------
m, vx = INT["tissue"]["mesh"], INT["tissue"]["vertex"]
P = np.frombuffer(base64.b64decode(m["positions"]), np.int16).reshape(-1, 3) / 32767 * A(m["positionRange"]) + A(m["positionCentre"])
LAB = np.frombuffer(base64.b64decode(vx["label"]), np.uint8)
NAMES = INT["labelNames"]

def snap(p, labels):
    ids = [NAMES.index(l) for l in labels]
    mask = np.isin(LAB, ids)
    q = P[mask]
    i = np.argmin(((q - p) ** 2).sum(1))
    return q[i], float(np.sqrt(((q[i] - p) ** 2).sum()))

# ---------- legacy → heart frame: similarity fit on paired points ----------
M = np.array(INT["frames"]["heartToH3"]).reshape(4, 4).T
Minv = np.linalg.inv(M)
h3_to_heart_raw = lambda p: (Minv @ np.r_[p, 1])[:3]
LN = {k: h3_to_heart_raw(v["pos"]) for k, v in LEG["nodes"].items()}
pairs = {"SA": LM["sa_node"]["p"], "AVN": LM["av_node"]["p"], "BIF": LM["his_bifurcation"]["p"],
         "LVAP": LM["lbb_septal_fascicle"]["points"][-1], "LAFPM": LM["lbb_anterior_fascicle"]["points"][-1],
         "LPFPM": LM["lbb_posterior_fascicle"]["points"][-1], "RB3": LM["rbb"]["points"][-1],
         "MODFW": LM["moderator_band"]["points"][-1], "LAA": LM["bachmann_bundle"]["points"][-1]}
X = np.array([LN[k] for k in pairs]); Y = np.array([pairs[k] for k in pairs], float)
mx, my = X.mean(0), Y.mean(0); Xc, Yc = X - mx, Y - my
Uu, S, Vt = np.linalg.svd(Yc.T @ Xc)
D = np.diag([1, 1, np.sign(np.linalg.det(Uu @ Vt))]); R = Uu @ D @ Vt
s = (S * np.diag(D)).sum() / (Xc ** 2).sum()
fit = lambda p: s * R @ (A(p) - mx) + my
resid = np.sqrt(((np.array([fit(x) for x in X]) - Y) ** 2).sum(1))
leg_to_heart = lambda h3p: fit(h3_to_heart_raw(h3p))

# ---------- path helpers ----------
def arclen(pts):
    pts = A(pts); d = np.sqrt(((pts[1:] - pts[:-1]) ** 2).sum(1)); return np.r_[0, np.cumsum(d)]
def at(pts, u):  # point at arc fraction u
    pts = A(pts); c = arclen(pts); s_ = u * c[-1]; i = min(max(np.searchsorted(c, s_) - 1, 0), len(pts) - 2)
    t = (s_ - c[i]) / max(c[i + 1] - c[i], 1e-9); return pts[i] + (pts[i + 1] - pts[i]) * t
def sub(pts, u0, u1):  # polyline between arc fractions
    pts = A(pts); c = arclen(pts) / arclen(pts)[-1]
    inner = [pts[i] for i in range(len(pts)) if u0 < c[i] < u1]
    return [at(pts, u0)] + inner + [at(pts, u1)]
def proj(pts, p):  # arc fraction of the nearest point on the path
    best = (9e9, 0); c = arclen(pts); pts = A(pts)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]; ab = b - a; t = np.clip(np.dot(A(p) - a, ab) / np.dot(ab, ab), 0, 1)
        d = np.linalg.norm(a + ab * t - p)
        if d < best[0]: best = (d, (c[i] + t * (c[i + 1] - c[i])) / c[-1])
    return best[1], best[0]
def plen(pts): return float(arclen(pts)[-1])
def wall_path(a, b, labels, n=8):  # straight line sampled and snapped onto a wall (never through blood)
    out = [A(a)]
    for k in range(1, n): out.append(snap(A(a) + (A(b) - A(a)) * k / n, labels)[0])
    return out + [A(b)]

TA = LEG["atrial"]["sinus"]; TV = LEG["vent"]["normal"]
legE = {e["id"]: e for e in LEG["edges"]}
nodes, edges = {}, []
def node(i, p, side, role, src, **kw):
    nodes[i] = dict(p=r3(p), side=side, role=role, src=src, **kw)
def edge(a, b, pts, kind, struct, tap, T=None, legacy_id=None, **kw):
    pts = [r3(p) for p in pts]; L = plen(pts)
    le = legE.get(legacy_id or f"{a}-{b}")
    Tm = T if T is not None else (le["T_ms"] if le else None)
    e = dict(id=f"{a}-{b}", a=a, b=b, kind=kind, struct=struct, tap=tap, lengthCm=round(L, 2),
             T_ms=Tm if not isinstance(Tm, float) else round(Tm, 1))
    if isinstance(e["T_ms"], (int, float)) and e["T_ms"] > 0:
        e["impliedVelocity_mps"] = round(L * 10 / e["T_ms"], 2)
    if le: e["legacy"] = dict(id=le["id"], lengthMm=le["L_mm"], T_ms=le["T_ms"])
    e.update(kw); e["points"] = pts; edges.append(e); return e

# ---------- atrial side ----------
ant, mid, post = LM["internodal_anterior"]["points"], LM["internodal_middle"]["points"], LM["internodal_posterior"]["points"]
bach = LM["bachmann_bundle"]["points"]
node("SA", LM["sa_node"]["p"], "A", "SA node (pacemaker, t = 0)", "landmark sa_node", big="sa", tapTarget="sa")
uIAG, dIAG = proj(ant, bach[0])
uINE, dINE = proj(post, LM["cs_ostium"]["p"])
# anterior route: SA → SA_H → ANT1 → IAG (Bachmann origin); times as fractions of the route to IAG
uSAH = TA["SA_H"] / TA["IAG"] * uIAG; uANT1 = TA["ANT1"] / TA["IAG"] * uIAG
node("SA_H", at(ant, uSAH), "A", "SA node head (superior exit)", f"internodal_anterior @{uSAH:.2f}", tapTarget="sa")
node("ANT1", at(ant, uANT1), "A", "anterior internodal route", f"internodal_anterior @{uANT1:.2f}")
node("IAG", at(ant, uIAG), "A", "Bachmann origin on the anterior route", f"internodal_anterior @{uIAG:.2f} (nearest to bachmann_bundle[0], {dIAG:.2f} cm)")
# middle route: MID1, IAS (fossa limbus) at time fractions of SA→AVN
uMID1, uIAS = TA["MID1"] / TA["AVN"], TA["IAS"] / TA["AVN"]
node("MID1", at(mid, uMID1), "A", "middle (Wenckebach) route", f"internodal_middle @{uMID1:.2f}")
node("IAS", at(mid, uIAS), "A", "septal (fast-pathway) input, fossa limbus", f"internodal_middle @{uIAS:.2f}")
# posterior route: SA_T, CT1, CT2, ISTH, INE (CS-ostium level) at time fractions of SA→INE
pf = {k: TA[k] / TA["INE"] * uINE for k in ["SA_T", "CT1", "CT2", "ISTH"]}
node("SA_T", at(post, pf["SA_T"]), "A", "SA node tail (inferior exit)", f"internodal_posterior @{pf['SA_T']:.2f}", tapTarget="sa")
node("CT1", at(post, pf["CT1"]), "A", "crista terminalis, upper", f"internodal_posterior @{pf['CT1']:.2f}")
node("CT2", at(post, pf["CT2"]), "A", "crista terminalis, lower", f"internodal_posterior @{pf['CT2']:.2f}")
node("ISTH", at(post, pf["ISTH"]), "A", "Eustachian ridge / septal isthmus (NOT the CTI)", f"internodal_posterior @{pf['ISTH']:.2f}")
node("INE", at(post, uINE), "A", "inferior nodal extension (slow-pathway entry), CS-ostium level", f"internodal_posterior @{uINE:.2f} (nearest to cs_ostium, {dINE:.2f} cm)")
node("AVN", LM["av_node"]["p"], "A", "compact AV node (apex of Koch's triangle)", "landmark av_node", big="avn", tapTarget="avn")
# Bachmann: IAG → BB1 → BB2 → LAA (base)
bt = lambda k: (TA[k] - TA["IAG"]) / (TA["LAA"] - TA["IAG"])
node("BB1", at(bach, bt("BB1")), "A", "Bachmann's bundle", f"bachmann_bundle @{bt('BB1'):.2f}")
node("BB2", at(bach, bt("BB2")), "A", "Bachmann's bundle, LA roof", f"bachmann_bundle @{bt('BB2'):.2f}")
node("LAA", bach[-1], "A", "LA appendage base", "bachmann_bundle end")
snaps = {}
# accessory pathway: the most lateral (−X, away from the septum) place where LA wall and LV wall face each other across
# the AV groove (≤ 0.6 cm apart) = left lateral mitral annulus. Derived from the bake, not from the legacy heart.
la_v, lv_v = P[LAB == NAMES.index("LA_wall")], P[LAB == NAMES.index("PW")]
gap = np.sqrt(((la_v[:, None, :] - lv_v[None, ::4, :]) ** 2).sum(2)); jj = gap.argmin(1) * 4; dd = gap.min(1)
cand = np.where(dd < 0.6)[0]; lat = cand[la_v[cand, 0] < la_v[cand, 0].min() + 0.25]; best = lat[dd[lat].argmin()]
AP_A, AP_V, AP_GAP = la_v[best], lv_v[jj[best]], float(dd[best])
node("AP_A", AP_A, "A", "accessory pathway, atrial end (left lateral mitral annulus)", f"LA_wall vertex at the lateral mitral annulus (LV wall {AP_GAP:.2f} cm across the AV groove)")
for k, lab_, role in [("LAP", ["LA_wall"], "LA posterior wall"), ("LAI", ["LA_wall"], "LA inferior wall (CS connection)"),
                      ]:
    q, d = snap(leg_to_heart(LEG["nodes"][k]["pos"]), lab_); snaps[k] = round(d, 2)
    node(k, q, "A", role, f"legacy {k} mapped (similarity fit) + snapped to {lab_[0]} ({d:.2f} cm)")

i0 = lambda pts, u0, u1: sub(pts, u0, u1)
edge("SA", "SA_H", [nodes["SA"]["p"], nodes["SA_H"]["p"]], "sa", "sa", "sa")
edge("SA", "SA_T", i0(post, 0, pf["SA_T"]), "sa", "sa", "sa")
edge("SA_H", "ANT1", i0(ant, uSAH, uANT1), "tract", "tracts", "tracts")
edge("ANT1", "IAG", i0(ant, uANT1, uIAG), "tract", "tracts", "tracts")
edge("IAG", "AVN", i0(ant, uIAG, 1), "tract", "tracts", "tracts",
     T=round(legE["IAG-IAS"]["T_ms"] + legE["IAS-AVN"]["T_ms"], 1), legacy_id="IAG-IAS",
     note="Legacy joined the anterior route to the middle one (IAG→IAS→AVN, 14.7+16.9 ms); the landmarks run it to the AV node on its own, so it keeps the sum. Never the fastest route in sinus rhythm.")
edge("SA_H", "MID1", [nodes["SA_H"]["p"]] + i0(mid, 0.06, uMID1)[0:], "tract", "tracts", "tracts")
edge("MID1", "IAS", i0(mid, uMID1, uIAS), "tract", "tracts", "tracts")
edge("IAS", "AVN", i0(mid, uIAS, 1), "tract", "tracts", "avn_fast", fast=True,
     note="Fast pathway: superior (anterior) approach to the compact node along the tendon-of-Todaro side.")
edge("SA_T", "CT1", i0(post, pf["SA_T"], pf["CT1"]), "tract", "tracts", "tracts")
edge("CT1", "CT2", i0(post, pf["CT1"], pf["CT2"]), "tract", "tracts", "tracts")
edge("CT2", "ISTH", i0(post, pf["CT2"], pf["ISTH"]), "tract", "tracts", "tracts")
edge("ISTH", "INE", i0(post, pf["ISTH"], uINE), "tract", "tracts", "tracts")
edge("INE", "AVN", i0(post, uINE, 1), "ine", "avn", "avn_slow", slow=True,
     note="Slow pathway (inferior nodal extension) along the floor of Koch's triangle between the CS ostium and the TV septal hinge. 0.12 m/s in legacy.")
edge("IAG", "BB1", [nodes["IAG"]["p"]] + i0(bach, 0, bt("BB1"))[1:], "bach", "bach", "bach")
edge("BB1", "BB2", i0(bach, bt("BB1"), bt("BB2")), "bach", "bach", "bach")
edge("BB2", "LAA", i0(bach, bt("BB2"), 1), "bach", "bach", "bach")
edge("INE", "LAI", wall_path(nodes["INE"]["p"], nodes["LAI"]["p"], ["LA_wall", "PW"]), "cs", "tracts", "la",
     note="Coronary-sinus musculature: inferior interatrial connection (snapped along the posterior AV groove).")
edge("LAI", "LAP", wall_path(nodes["LAI"]["p"], nodes["LAP"]["p"], ["LA_wall"]), "tract", "la", "la")
edge("BB2", "LAP", wall_path(nodes["BB2"]["p"], nodes["LAP"]["p"], ["LA_wall"]), "tract", "la", "la")
edge("LAP", "AP_A", wall_path(nodes["LAP"]["p"], nodes["AP_A"]["p"], ["LA_wall"]), "tract", "la", "la")
edge("LAA", "AP_A", wall_path(nodes["LAA"]["p"], nodes["AP_A"]["p"], ["LA_wall"]), "tract", "la", "la")

# ---------- AV junction + ventricular side ----------
his = LM["his_bundle"]["points"]
node("HIS", his[1], "V", "penetrating His bundle (through the central fibrous body); V-clock t = 0", "his_bundle[1] = central_fibrous_body", tapTarget="his")
node("BIF", LM["his_bifurcation"]["p"], "V", "His bifurcation, crest of the muscular septum", "landmark his_bifurcation", tapTarget="his")
edge("AVN", "HIS", his[:2], "avn", "avn", "avn", T="avDelay", side="A",
     note="AV-node delay: set per beat by the rhythm (default D0 below; Wenckebach adds to it). Not a velocity.")
edge("HIS", "BIF", his[1:], "his", "his", "his")
lsf, laf, lpf, rbb, mb = (LM[k]["points"] for k in ["lbb_septal_fascicle", "lbb_anterior_fascicle", "lbb_posterior_fascicle", "rbb", "moderator_band"])
node("LB1", lsf[0], "V", "left bundle branch origin (fascicles diverge here)", "lbb_*_fascicle[0]", tapTarget="lbb")
edge("BIF", "LB1", [LM["his_bifurcation"]["p"], lsf[0]], "bb", "lbb", "lbb")
def chain(pts, ids, t0id, struct, kind, tap, roles, purkEnd):
    tt = [TV[i] for i in ids]; u = [(t - TV[t0id]) / (tt[-1] - TV[t0id]) for t in tt]
    prev, pu = t0id, 0.0
    for i, (nid, uu) in enumerate(zip(ids, u)):
        if nid not in nodes:
            node(nid, at(pts, uu), "V", roles[i], f"{struct} path @{uu:.2f}", tapTarget=tap)
        edge(prev, nid, sub(pts, pu, uu), kind, struct, tap); prev, pu = nid, uu
    for k in purkEnd: nodes[k]["purkinje"] = True
chain(lsf, ["LSF1", "LSF2", "LVAP"], "LB1", "lbb", "fasc", "lsf", ["septal fascicle, upper", "septal fascicle, mid", "LV apex (septal)"], ["LSF1", "LSF2", "LVAP"])
chain(laf, ["LAF1", "LAF2", "LAF3", "LAFPM"], "LB1", "laf", "fasc", "laf", ["LAF", "LAF", "LAF", "LAF → anterolateral papillary base"], ["LAF2", "LAF3", "LAFPM"])
chain(lpf, ["LPF1", "LPF2", "LPFPM"], "LB1", "lpf", "fasc", "lpf", ["LPF", "LPF", "LPF → posteromedial papillary base"], ["LPF2", "LPFPM"])
# RBB: starts at BIF
tt = [TV[k] for k in ["RB1", "RB2", "RB3"]]; u = [(t - TV["BIF"]) / (tt[-1] - TV["BIF"]) for t in tt]
node("RB1", at(rbb, u[0]), "V", "right bundle, upper", f"rbb @{u[0]:.2f}", tapTarget="rbb")
node("RB2", at(rbb, u[1]), "V", "right bundle, mid", f"rbb @{u[1]:.2f}", tapTarget="rbb")
node("RB3", rbb[-1], "V", "right bundle → septal end of the moderator band", "rbb end", tapTarget="rbb", purkinje=True)
edge("BIF", "RB1", [LM["his_bifurcation"]["p"]] + sub(rbb, 0, u[0]), "bb", "rbb", "rbb")
edge("RB1", "RB2", sub(rbb, u[0], u[1]), "bb", "rbb", "rbb")
edge("RB2", "RB3", sub(rbb, u[1], 1), "bb", "rbb", "rbb")
node("MODFW", mb[-1], "V", "moderator band → anterior papillary muscle (RV free wall)", "moderator_band end", tapTarget="rbb", purkinje=True)
edge("RB3", "MODFW", [rbb[-1]] + mb, "mod", "rbb", "moderator")
for k, lab_, role in [("RBAP", ["IVS", "RV_free_wall"], "RV apex (septal surface)"),
                      ]:
    q, d = snap(leg_to_heart(LEG["nodes"][k]["pos"]), lab_); snaps[k] = round(d, 2)
    node(k, q, "V", role, f"legacy {k} mapped (similarity fit) + snapped to {'/'.join(lab_)} ({d:.2f} cm)")
node("AP_V", AP_V, "V", "accessory pathway, ventricular end (left lateral mitral annulus)", "PW (LV) vertex facing AP_A across the AV groove")
nodes["RBAP"]["purkinje"] = True; nodes["RBAP"]["tapTarget"] = "rbb"
edge("RB3", "RBAP", [nodes["RB3"]["p"], nodes["RBAP"]["p"]], "purk", "purk", "purk")
edge("AP_A", "AP_V", [nodes["AP_A"]["p"], nodes["AP_V"]["p"]], "ap", "ap", "ap", side="AP",
     note="Kent bundle across the left lateral mitral annulus. Only exists in modes with ap:true. Fixed 12 ms, no decrement.")
for e in edges:
    e.setdefault("side", "V" if (nodes[e["a"]]["side"] == "V" or nodes[e["b"]]["side"] == "V") else "A")

# foci + flutter isthmus geometry
foci = {}
for k, lab_ in [("vesc", ["PW", "papillary_muscles.PMPM"]), ("pvc", ["PW", "papillary_muscles.PMPM"]), ("rvot", ["RV_free_wall"])]:
    q, d = snap(leg_to_heart(LEG["foci"][k]["pos"]), lab_)
    foci[k] = dict(p=r3(q), retro_ms=LEG["foci"][k]["retro"], src=f"legacy focus mapped + snapped to {'/'.join(lab_)} ({d:.2f} cm)")
cti = A(LM["cti"]["points"]); csos = A(LM["cs_ostium"]["p"]); mcti = at(cti, 0.5)
ctiS = snap(mcti + (csos - mcti) * 0.6, ["RA_wall", "IAS"])[0]
ctiL = snap(mcti - (csos - mcti) * 0.6, ["RA_wall", "pectinate_muscles"])[0]
node("CTI_S", ctiS, "A", "septal side of the cavotricuspid isthmus (flutter exit, next to the CS ostium)", "CTI midpoint shifted 0.6× toward cs_ostium, snapped to RA wall (provisional)", tapTarget="cti", circuitOnly=True)
node("CTI_L", ctiL, "A", "lateral side of the cavotricuspid isthmus (flutter entry, low lateral RA)", "CTI midpoint shifted 0.6× away from cs_ostium, snapped to RA wall (provisional)", tapTarget="cti", circuitOnly=True)
edge("CT2", "CTI_L", wall_path(nodes["CT2"]["p"], ctiL, ["RA_wall", "pectinate_muscles", "crista_terminalis"]), "tract", "flutter", "tracts", T=None, circuitOnly=True)
edge("CTI_L", "CTI_S", [ctiL, mcti, ctiS], "cti", "flutter", "cti", T=None, circuitOnly=True, slow=True,
     note="Crosses the CTI ablation line at its midpoint. Slow zone of typical flutter.")
edge("CTI_S", "INE", [ctiS, nodes["INE"]["p"]], "tract", "flutter", "tracts", T=None, circuitOnly=True)
edge("INE", "IAS", wall_path(nodes["INE"]["p"], nodes["IAS"]["p"], ["IAS", "RA_wall"]), "tract", "septum", "tracts", T=None, circuitOnly=True,
     note="Atrial septal myocardium between the slow- and fast-pathway inputs: the upper/lower turning point of AVNRT and the septal limb of flutter.")

# ---------- length check vs real anatomy (flag only, never change) ----------
def L(ids): return round(sum(next(e for e in edges if e["id"] == i)["lengthCm"] for i in ids), 2)
review = [
    dict(item="His bundle (AV node → bifurcation)", modelCm=round(plen(his), 2), realCm="≈1–2", status="SHORT",
         effect="Kept the legacy 9.4 ms HIS→BIF, so the implied His velocity is low. Lengthen in the phantom only if staff agree; times stay."),
    dict(item="Cavotricuspid isthmus (TV annulus → IVC, ablation line)", modelCm=round(plen(LM["cti"]["points"]), 2), realCm="≈2.5–3.5", status="SHORT",
         effect="Flutter circuit timing is set by its own cycle length, so a short CTI only changes how long the slow zone looks."),
    dict(item="Internodal routes SA → AV node (anterior / middle / posterior)", modelCm=[round(plen(ant), 2), round(plen(mid), 2), round(plen(post), 2)], realCm="teaching layout (verify)", status="CHECK"),
    dict(item="Bachmann's bundle (RA → LAA base)", modelCm=round(plen(bach), 2), realCm="teaching (verify)", status="CHECK"),
    dict(item="Right bundle branch (bifurcation → moderator band)", modelCm=round(plen(rbb), 2), realCm="≈4–5 (verify)", status="CHECK"),
    dict(item="Left bundle stem (bifurcation → fascicles)", modelCm=round(float(np.linalg.norm(A(lsf[0]) - A(LM['his_bifurcation']['p']))), 2), realCm="≈1–2 (verify)", status="SHORT",
         effect="Fascicles fan out almost at once; the 6 ms BIF→LB1 is kept."),
    dict(item="Positions mapped from the legacy heart (LA posterior/inferior, RV apex, foci)", modelCm=snaps,
         realCm="snap distance (cm)", status="CHECK", effect=f"Similarity fit on 9 landmark pairs, residual {resid.mean():.2f} cm mean / {resid.max():.2f} cm max."),
    dict(item="Accessory pathway site (left lateral mitral annulus)", modelCm=dict(AP_A=r3(AP_A), AP_V=r3(AP_V), gap=round(AP_GAP, 2)), status="CHECK",
         effect="Teaching default (most common AP site). Other sites (posteroseptal, right free wall) can be added the same way."),
    dict(item="Flutter isthmus entry/exit points CTI_L / CTI_S", status="CHECK", effect="Derived from the CTI line and the CS ostium; confirm on the 4C / RA-opened views."),
]

doc = json.load(open(ROOT / "heart3d/tools/conduction_spec_text.json"))
doc["meta"].update(phantom=LMJ["meta"]["phantom"], landmarks="echo-sim/export/heart-landmarks.json",
                   fitResidualCm=dict(mean=round(float(resid.mean()), 2), max=round(float(resid.max()), 2)))
doc["timing"]["legacy"] = dict(TA_AVN_ms=round(LEG["TA_AVN"], 1), D0_ms=LEG["D0"], WPW_LEAD_ms=LEG["WPW_LEAD"], qrsOnset_ms=LEG["onset"],
                               atrialNodeTimes={m_: LEG["atrial"][m_] for m_ in ["sinus", "iab"]},
                               ventricularNodeTimes=LEG["vent"])
doc["nodes"] = nodes; doc["edges"] = edges; doc["foci"] = foci; doc["expertReview"] = review
OUT.parent.mkdir(exist_ok=True)
txt = json.dumps(doc, indent=1, ensure_ascii=False)
OUT.write_text(txt + "\n")
print(f"wrote {OUT} ({len(txt)//1024} KB): {len(nodes)} nodes, {len(edges)} edges; fit residual {resid.mean():.2f}/{resid.max():.2f} cm; snaps {snaps}")
