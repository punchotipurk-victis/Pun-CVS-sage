#!/usr/bin/env python3
"""Design the fine right-heart landmarks of phantom 0.5 from the phantom itself (step 3a of the 3D Heart rework).
   python tools/landmark_design.py [--vol /tmp/heart-vol.npz] [--write]      (make the volume with tools/heart_volume.py)

Every position is computed from structures already in phantom-normal.json (annuli, aortic root, cusp directions, CS, IVC,
crista, RA appendage, IAS fossa) and from the baked label volume (to snap onto the endocardium or into tissue).
Nothing is typed in by hand. With --write the results go into the phantom JSON:
  structures.central_fibrous_body   right fibrous trigone: tissue between the MV, TV and aortic annuli
  structures.membranous_septum      under the RCC–NCC commissure, between the LVOT and the right heart
  structures.RA.detail.svc_label    SVC = the svc capsule outside the RA body (label only)
  structures.RA.detail.pectinate    ridges from the crista terminalis across the anterior RA wall to the appendage
  structures.RA.detail.eustachian   fold on the anterior rim of the IVC orifice, toward the CS ostium / fossa limbus
  structures.RA.detail.thebesian    semilunar fold over the inferior-posterior half of the CS ostium
  structures.RA.detail.todaro       tendon of Todaro: subendocardial cord, Eustachian–Thebesian commissure → CFB
Sources: Netter 218/224/226 (RA interior, fibrous skeleton), Anderson's cardiac anatomy (Koch's triangle), lecture; teaching (verify).
"""
import argparse, json, os, sys
import numpy as np
from scipy import ndimage

here = os.path.dirname(os.path.abspath(__file__)); PJ = os.path.join(here, "..", "data", "phantom-normal.json")
ap = argparse.ArgumentParser(); ap.add_argument("--vol", default="/tmp/heart-vol.npz"); ap.add_argument("--write", action="store_true"); A = ap.parse_args()
ph = json.load(open(PJ)); S = ph["structures"]
L = {k: np.array(v, float) for k, v in ph["landmarks_heart"].items() if not k.startswith("_")}
Z = np.load(A.vol); LAB = Z["labels"]; lo = Z["lo"]; v = float(Z["v"]); names = list(Z["names"])
nz = lambda a: np.asarray(a, float)/np.linalg.norm(a)
k_, j_, i_ = np.indices(LAB.shape); C = np.stack([lo[0] + (i_ + .5)*v, lo[1] + (j_ + .5)*v, lo[2] + (k_ + .5)*v], -1); del k_, j_, i_
ID = lambda *ns: [names.index(n) for n in ns]
BLOOD = np.isin(LAB, ID("LV_cavity", "RV_cavity", "LA", "RA", "LVOT", "RVOT", "aortic_root", "aortic_root.ascending", "PA_main", "LAA", "coronary_sinus", "pulmonary_veins"))
OUT = np.isin(LAB, ID("", "lungs", "liver", "pericardium", "diaphragm"))
TISSUE = ~BLOOD & ~OUT
DTB = ndimage.distance_transform_edt(~BLOOD)*v          # tissue → nearest blood (cm)
RA = LAB == names.index("RA")
RA_SURF = RA & ndimage.binary_dilation(TISSUE)          # RA blood voxels touching tissue = endocardium
r3 = lambda p: [round(float(x), 3) for x in p]

def ring(c, nrm, R, m=144):
    nrm = nz(nrm); a = nz(np.cross(nrm, [1, 0, 0] if abs(nrm[0]) < .9 else [0, 1, 0])); b = np.cross(nrm, a)
    t = np.linspace(0, 2*np.pi, m, endpoint=False); return np.array(c) + R*(np.cos(t)[:, None]*a + np.sin(t)[:, None]*b)
dset = lambda p, R: np.min(np.linalg.norm(R - p, axis=1))
def nearest(mask, p, maxr=3.0):
    P = C[mask]; d = np.linalg.norm(P - p, axis=1); i = d.argmin()
    if d[i] > maxr: sys.exit(f"nothing within {maxr} cm of {p}")
    return P[i]
def into_tissue(p, r=1.0, depth=0.3, w=1.5):
    """tissue voxel near p that is about `depth` cm from blood (keeps fibrous parts out of the cavities)"""
    m = TISSUE & (np.linalg.norm(C - p, axis=-1) < r); P = C[m]; d = DTB[m]
    s = np.linalg.norm(P - p, axis=1) - w*np.minimum(d, depth); return P[s.argmin()]

MV = ring([0, 0, 0], S["MV_annulus"]["normal"], S["MV_annulus"]["R"])
TV = ring(L["TV_center"], S["TV_annulus"]["normal"], S["TV_annulus"]["R"])
AOX = nz(ph["axes_heart"]["aortic_root"]); AOC = L["AV_center"]; AOR = S["aortic_root"]["profile"][0][1]
CD = {k: nz(d) for k, d in ph["axes_heart"]["AV_cusp_dirs"].items() if not k.startswith("_")}
perp = lambda d: nz(d - AOX*(d @ AOX))

# ---- central fibrous body: centroid of three annulus points, moved into tissue
comm = perp(CD["RCC"] + CD["NCC"]); Pcomm = AOC + AOR*comm - 0.4*AOX      # RCC–NCC commissure, 0.4 cm below the annulus
mvP = MV[np.argmin([dset(p, TV) for p in MV])]; tvP = TV[np.argmin([dset(p, MV) for p in TV])]
CFB = into_tissue((Pcomm + mvP + tvP)/3, depth=0.3)
# ---- membranous septum: under the RCC–NCC commissure, in the wall between the LVOT and the right heart
MS = into_tissue(Pcomm, r=0.8, depth=0.15)
# ---- Koch's triangle apex = RA endocardium nearest the CFB (the compact AV node lies here)
KOCH_APEX = nearest(RA_SURF, CFB)
CSO = nearest(RA_SURF, L["CS_ostium"])
# ---- IVC orifice (RA end of the IVC capsule) and its rim
ivc = S["RA"]["detail"]["ivc"]; ivcA, ivcB = np.array(ivc["a"]), np.array(ivc["b"]); ivcD = nz(ivcB - ivcA)
raC = L["RA_center"]; raS = np.array([q["ed"] if isinstance(q, dict) else q for q in S["RA"]["semi"]])
ell = lambda p: np.linalg.norm((p - raC)/raS)                           # 1 on the RA ellipsoid
tt = np.linspace(0, 1, 400); IVC_O = next(ivcA + (ivcB - ivcA)*t for t in tt if ell(ivcA + (ivcB - ivcA)*t) <= 1.0)   # orifice: the IVC axis enters the RA body
fo = np.array(S["IAS"]["fossaOvalis"]["center"])
uEu = perp_ivc = nz((nz(CSO - IVC_O) + nz(fo - IVC_O)) - ivcD*((nz(CSO - IVC_O) + nz(fo - IVC_O)) @ ivcD))   # toward the CS ostium and the fossa
EU_R = nearest(RA_SURF, IVC_O + uEu*ivc["r"])                             # anterior-medial rim of the orifice, on the endocardium
EU_T = nz(np.cross(ivcD, uEu))                                          # along the rim
EU_B = nz(-uEu + 0.6*ivcD); EU_B = nz(EU_B - EU_T*(EU_B @ EU_T))        # from the rim across the orifice and up into the RA
EU_N = nz(np.cross(EU_T, EU_B))
EU_C = EU_R
# ---- Eustachian–Thebesian commissure: RA endocardium between the CS ostium and the fossa limbus → tendon of Todaro to the Koch apex
csD = nz(np.array(S["coronary_sinus"]["points"][-1]) - L["CS_ostium"])
ET = nearest(RA_SURF, CSO + 0.45*nz(fo - CSO))
def surf_path(a, b, n=6, depth=0.0):
    pts = [nearest(RA_SURF, a + (b - a)*t) for t in np.linspace(0, 1, n)]
    return pts
TOD = surf_path(ET, KOCH_APEX, 6)
# subendocardial: push 0.1 cm from the RA blood into the septal tissue (direction = away from the RA centre)
TOD = [p + 0.12*nz(p - L["RA_center"]) for p in TOD]
# ---- Thebesian valve: half-disc over the inferior-posterior part of the CS ostium
inf = nz(np.array([0, 1, 0]) - csD*csD[1])                              # heart +Y = inferior-posterior, ⟂ the CS axis
TB_C = CSO + 0.05*csD + 0.18*inf
# ---- pectinate muscles: ridges on the anterior RA wall from the crista to the appendage, snapped onto the endocardium
cr = [np.array(p) for p in S["RA"]["detail"]["crista"]["points"]]
raa = S["RA"]["detail"]["raa"]; rb, rt, rc = np.array(raa["base"]), np.array(raa["tip"]), np.array(raa["corner"])
def crista_at(f):
    seg = np.linalg.norm(np.diff(cr, axis=0), axis=1); s = f*seg.sum(); i = 0
    while i < len(seg) - 1 and s > seg[i]: s -= seg[i]; i += 1
    return cr[i] + (cr[i+1] - cr[i])*s/seg[i]
PECT = []
for f in np.linspace(0.12, 0.88, 6):
    a = crista_at(f); b = rb + (rc - rb)*f*0.9 + (rt - rb)*(1 - f)*0.35      # fan from the crista toward the appendage lobes
    PECT.append([nearest(RA_SURF, a + (b - a)*t) for t in (0.08, 0.36, 0.64, 0.92)])
# ---- SVC: the svc capsule outside the RA body
svc = S["RA"]["detail"]["svc"]

res = {
  "central_fibrous_body": {"type": "derived_sphere", "center": r3(CFB), "r": 0.38, "tissue": "fibrous", "label": "central_fibrous_body",
     "_note": "Right fibrous trigone: where the MV, TV and aortic annuli meet; pierced by the His bundle (Netter 226; Anderson). Designed by tools/landmark_design.py: "
              "centroid of the RCC–NCC commissure (0.4 cm below the annulus), the MV-ring point nearest the TV and the TV-ring point nearest the MV, moved 0.3 cm into tissue. Relabels wall tissue only. teaching (verify)."},
  "membranous_septum": {"type": "derived_sphere", "center": r3(MS), "r": 0.42, "tissue": "fibrous", "label": "membranous_septum",
     "_note": "Thin fibrous septum under the RCC–NCC commissure; the TV septal leaflet hinge divides it into AV and interventricular parts; the His bundle runs along its lower edge (Netter 226). "
              "Designed by tools/landmark_design.py: wall tissue nearest the RCC–NCC commissure 0.4 cm below the annulus. Relabels wall tissue only. teaching (verify)."},
  "RA_detail": {
    "svc_label": {"insideEllipsoidMargin": 0.25, "_note": "SVC = the svc capsule where it lies outside the RA ellipsoid by > 0.25 cm (label only; geometry unchanged)."},
    "pectinate": {"ridges": [[r3(p) for p in rd] for rd in PECT], "r": 0.16, "wallBand": 0.45,
       "_note": "Pectinate muscles: parallel ridges from the crista terminalis across the anterior RA wall into the appendage (Netter 224). Snapped onto the RA endocardium by tools/landmark_design.py; kept within 0.45 cm of the wall. teaching (verify)."},
    "eustachian": {"center": r3(EU_C), "u": r3(EU_N), "t": r3(EU_T), "axis": r3(EU_B), "semi": [1.1, 0.7, 0.07],
       "_note": "Eustachian valve: crescentic fold on the anterior-medial rim of the IVC orifice (where the IVC axis enters the RA body), shelving across the orifice toward the CS ostium and the fossa limbus (Netter 224). "
                "Centre on the rim (RA endocardium); half-ellipsoid spanned by t (along the rim) and axis (rim → across the orifice, tilted into the RA); RA side only. Designed by tools/landmark_design.py. teaching (verify)."},
    "thebesian": {"center": r3(TB_C), "normal": r3(csD), "down": r3(inf), "semi": [0.5, 0.45, 0.06],
       "_note": "Thebesian valve: thin semilunar fold over the inferior-posterior half of the CS ostium (Netter 224). Designed by tools/landmark_design.py. teaching (verify)."},
    "todaro": {"points": [r3(p) for p in TOD], "r": 0.09,
       "_note": "Tendon of Todaro: subendocardial fibrous cord from the Eustachian–Thebesian commissure to the central fibrous body; with the CS ostium and the TV septal hinge it bounds Koch's triangle, whose apex holds the compact AV node (Anderson; Netter 224). Snapped 0.12 cm under the RA septal endocardium. teaching (verify)."}},
  "_design": {"koch_apex": r3(KOCH_APEX), "cs_ostium_endo": r3(CSO), "et_commissure": r3(ET), "ivc_orifice": r3(IVC_O), "rcc_ncc_commissure": r3(Pcomm)}}

def lab_at(p):
    i, j, k = np.floor((np.array(p) - lo)/v).astype(int); return names[LAB[k, j, i]]
print("CFB", res["central_fibrous_body"]["center"], lab_at(CFB), f"{DTB[tuple(np.floor((CFB-lo)/v).astype(int)[::-1])]:.2f} cm to blood")
print("membranous septum", res["membranous_septum"]["center"], lab_at(MS))
print("Koch apex", r3(KOCH_APEX), "| CS ostium", r3(CSO), "| E–T commissure", r3(ET), "| Koch apex→CFB", round(float(np.linalg.norm(KOCH_APEX - CFB)), 2), "cm")
print("Koch triangle sides: CSo→apex", round(float(np.linalg.norm(CSO - KOCH_APEX)), 2), "cm; tendon length", round(float(sum(np.linalg.norm(np.diff(TOD, axis=0), axis=1))), 2), "cm")
print("Eustachian centre", r3(EU_C), lab_at(EU_C), "| Thebesian centre", r3(TB_C), lab_at(TB_C))
print("pectinate ridges", len(PECT), "first", [r3(p) for p in PECT[0]])
if A.write:
    S["central_fibrous_body"] = res["central_fibrous_body"]; S["membranous_septum"] = res["membranous_septum"]
    for k, val in res["RA_detail"].items(): S["RA"]["detail"][k] = val
    ph.setdefault("_design", {})["right_heart_landmarks"] = res["_design"] | {"_note": "Reference points from tools/landmark_design.py (exported landmarks are recomputed by export_heart_mesh.py --interior)."}
    open(PJ, "w").write(json.dumps(ph, indent=2, ensure_ascii=False) + "\n"); print("wrote", PJ)
