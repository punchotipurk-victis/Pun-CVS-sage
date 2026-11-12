#!/usr/bin/env python3
"""Coronary tree preview from the phantom (dev): anterior + inferior surface maps and angiographic projections (RAO 30, LAO 45/caudal-cranial).
   python tools/coronary_map.py OUT.png"""
import json, os, sys, math
import numpy as np, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
here = os.path.dirname(os.path.abspath(__file__)); ph = json.load(open(os.path.join(here, "..", "data", "phantom-normal.json")))
H = ph["frames"]["heart"]; O = np.array(H["origin_patient"]); M = np.stack([H["X_patient"], H["Y_patient"], H["Z_patient"]])
toB = lambda P: O + np.array(P) @ M
CA = ph["structures"]["coronary_arteries"]["arteries"]; CV = ph["structures"]["cardiac_veins"]["veins"]
def view(ax, R, title, angio=False, system=None, veins=True):
    for v in ([] if angio or not veins else CV):
        P = toB(v["points"]) @ R.T; ax.plot(P[:, 0], P[:, 1], color="#5a4fa0", lw=v["r0"]*14, alpha=.7, solid_capstyle="round")
    for a in CA:
        if system and a["label"] != system: continue
        P = toB(a["points"]) @ R.T; n = len(P)
        for i in range(n-1):
            r = a["r0"] + (a["r1"]-a["r0"])*i/(n-1)
            ax.plot(P[i:i+2, 0], P[i:i+2, 1], color=("#222" if angio else ("#c0392b" if a["label"] == "LCA" else "#e67e22")), lw=max(.6, r*(26 if angio else 18)), solid_capstyle="round")
        m = P[min(n-1, max(1, int(n*0.6)))]; lab = a["id"] + (f" ({a['scct']})" if a.get("scct") else "")
        if True: ax.text(m[0], m[1], lab, fontsize=7, color="k" if angio else "#111", bbox=dict(fc="white", ec="none", alpha=.6, pad=.6))
    ax.set_aspect("equal"); ax.set_title(title, fontsize=9); ax.axis("off")
    if angio: ax.set_facecolor("#d9d9d4")
def rotY(d): c, s = math.cos(math.radians(d)), math.sin(math.radians(d)); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def rotX(d): c, s = math.cos(math.radians(d)), math.sin(math.radians(d)); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
# screen: x = image right, y = up. Patient body frame: +x left, +y head, +z anterior. Viewer in front: image right = patient left.
front = np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1]], float)
inferior = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)    # from the feet
fig, axs = plt.subplots(2, 3, figsize=(15, 10))
view(axs[0, 0], front, "Anterior view, left system + veins (LM, LAD, D1/D2, septals, LCx, OMs; GCV)", system="LCA")
view(axs[0, 1], front, "Anterior view, right system (RCA, conus, SA nodal, RV branches, acute marginal)", system="RCA", veins=False)
view(axs[0, 2], inferior, "Inferior (diaphragmatic) view: PDA, posterolateral, AV nodal; middle cardiac vein")
for ax, R, t, sysm in ((axs[1, 0], rotX(-20) @ rotY(-30), "Angio preview, left injection: RAO 30° / caudal 20°", "LCA"), (axs[1, 1], rotX(25) @ rotY(45), "Angio preview, left injection: LAO 45° / cranial 25°", "LCA"), (axs[1, 2], rotY(45), "Angio preview, right injection: LAO 45°", "RCA")):
    view(ax, R, t, angio=True, system=sysm)
    P = np.vstack([toB(a["points"]) for a in CA]) @ R.T; c = P.mean(0); ax.set_xlim(c[0]-8, c[0]+8); ax.set_ylim(c[1]-8, c[1]+8); ax.set_facecolor("#d9d9d4"); ax.axis("on"); ax.set_xticks([]); ax.set_yticks([])
fig.suptitle("Coronary tree of phantom v0.4 (right-dominant; SCCT segment numbers in brackets; teaching model, verify against an expert)", fontsize=11)
plt.tight_layout(); plt.savefig(sys.argv[1], dpi=90)
