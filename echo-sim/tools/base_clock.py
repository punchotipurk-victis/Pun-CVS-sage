import json, numpy as np, math, sys
ph = json.load(open(sys.argv[1] if len(sys.argv) > 1 else '/home/claude/pun-cvs-sage/echo-sim/data/phantom-normal.json'))
H = ph['frames']['heart']; X, Y, Z = map(np.array, (H['X_patient'], H['Y_patient'], H['Z_patient']))
toH = lambda v: np.array([v @ X, v @ Y, v @ Z])          # patient dir -> heart dir
toP = lambda h: h[0]*X + h[1]*Y + h[2]*Z
L = {k: np.array(v) for k, v in ph['landmarks_heart'].items() if not k.startswith('_')}
a = np.array(ph['axes_heart']['aortic_root']); a /= np.linalg.norm(a)
ant = toH(np.array([0, 0, 1.])); ant -= a*(ant @ a); ant /= np.linalg.norm(ant)
left = np.cross(a, ant); 
if toP(left)[0] < 0: left = -left
AV = L['AV_center']
def clock(p):
    q = p - AV; up = q @ a; q2 = q - a*up; ang = math.degrees(math.atan2(q2 @ left, q2 @ ant)) % 360
    return f"{ang/30 if ang/30>=0.5 else ang/30+12:4.1f} o'clock  r {np.linalg.norm(q2):4.1f}  along-aorta {up:+4.1f}"
print("aorta axis in patient:", np.round(toP(a), 3), " angle to -Z", round(math.degrees(math.acos(-a[2])), 1))
for k in ['MV_center', 'TV_center', 'PV_center', 'LA_center', 'RA_center', 'LAA_tip', 'CS_ostium', 'crux', 'PVein_RU', 'PVein_LU']: print(f"{k:12}", clock(L[k]))
S = ph['structures']
if 'a' in S['RVOT']: print("RVOT a", clock(np.array(S['RVOT']['a'])))
print("RA svc a/b", clock(np.array(S['RA']['detail']['svc']['a'])), '|', clock(np.array(S['RA']['detail']['svc']['b'])))
print("RAA tip", clock(np.array(S['RA']['detail']['raa'].get('tip') or S['RA']['detail']['raa']['b'])))

def P(clk, r, along):
    t = math.radians(clk*30); return AV + along*a + r*(math.cos(t)*ant + math.sin(t)*left)
if __name__ == "__main__" and len(sys.argv) > 2:
    for s in sys.argv[2:]:
        c, r, al = map(float, s.split(':')); print(s, np.round(P(c, r, al), 2))
