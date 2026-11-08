#!/usr/bin/env python3
"""Heart mesh export (pun-cvs heart mesh v1) → binary glTF (.glb) for Blender / any 3D tool.

  python tools/mesh_to_gltf.py export/heart-mesh.json export/heart.glb [--frame body|heart] [--no-vessels]

- Units: metres (glTF); 1 cm in the echo phantom = 0.01 m.
- Frame "body" (default): glTF axes = the echo body frame (+X patient's LEFT, +Y HEAD, +Z ANTERIOR), so a Front view in a
  glTF viewer is the anatomical anterior view. Blender's importer turns glTF +Y-up into its Z-up: anterior = Blender −Y.
- Heart surface: one mesh "heart" with COLOR_0 (realistic colours by wall) and custom vertex attributes _LABEL, _WALL, _AHA,
  _TERRITORY, _TERRITORYMODEL, _VESSEL, _VESSELT, _MOTION (Blender ≥3.x imports them as generic attributes; keep them if you
  remesh only by "Data Transfer" from the original, see tools/gltf_to_mesh.py).
- Vessels: one mesh per artery/vein ("artery_LAD", "vein_GCV" …), tapered tubes at the DISPLAY radius (tappable size).
Needs numpy only."""
import argparse, base64, json, struct
from pathlib import Path
import numpy as np

REAL = {0: (.6, .4, .4), 1: (.62, .2, .17), 2: (.6, .22, .2), 3: (.5, .2, .32), 4: (.86, .74, .66), 5: (.9, .76, .45)}


def dec(s, dt): return np.frombuffer(base64.b64decode(s), dtype=dt)


def tube(points, r0, r1, sides=12, per=6):
    P = np.asarray(points, float)
    # resample the polyline (Catmull-Rom-ish smoothing by linear upsampling + Chaikin)
    for _ in range(2):
        Q = [P[0]]
        for a, b in zip(P[:-1], P[1:]): Q += [a*.75 + b*.25, a*.25 + b*.75]
        Q.append(P[-1]); P = np.array(Q)
    n = len(P); T = np.gradient(P, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9
    ref = np.array([0, 0, 1.]) if abs(T[0][2]) < .9 else np.array([1., 0, 0])
    N = np.cross(T[0], ref); N /= np.linalg.norm(N); V, F, NR = [], [], []
    for i in range(n):
        N = N - T[i]*(N @ T[i]); N /= np.linalg.norm(N) + 1e-9; B = np.cross(T[i], N); r = r0 + (r1 - r0)*i/(n - 1)
        for j in range(sides):
            a = 2*np.pi*j/sides; d = np.cos(a)*N + np.sin(a)*B; V.append(P[i] + d*r); NR.append(d)
    for i in range(n - 1):
        for j in range(sides):
            a, b, c, d = i*sides + j, i*sides + (j + 1) % sides, (i + 1)*sides + j, (i + 1)*sides + (j + 1) % sides
            F += [a, c, b, b, c, d]
    return np.array(V, np.float32), np.array(NR, np.float32), np.array(F, np.uint32)


class GLB:
    def __init__(self): self.bin = bytearray(); self.views = []; self.acc = []; self.meshes = []; self.nodes = []
    def _view(self, data, target=None):
        while len(self.bin) % 4: self.bin += b"\0"
        off = len(self.bin); self.bin += data; v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target: v["target"] = target
        self.views.append(v); return len(self.views) - 1
    def accessor(self, arr, typ, target=None, minmax=False):
        arr = np.ascontiguousarray(arr); ct = {np.dtype(np.float32): 5126, np.dtype(np.uint32): 5125, np.dtype(np.uint16): 5123}[arr.dtype]
        a = {"bufferView": self._view(arr.tobytes(), target), "componentType": ct, "count": int(arr.shape[0]), "type": typ}
        if minmax: a["min"] = arr.min(0).tolist(); a["max"] = arr.max(0).tolist()
        self.acc.append(a); return len(self.acc) - 1
    def mesh(self, name, P, N, I, extra=None, colour=None, material=0):
        attrs = {"POSITION": self.accessor(P, "VEC3", 34962, True), "NORMAL": self.accessor(N, "VEC3", 34962)}
        if colour is not None: attrs["COLOR_0"] = self.accessor(colour, "VEC3", 34962)
        for k, v in (extra or {}).items(): attrs[k] = self.accessor(v.astype(np.float32), "SCALAR", 34962)
        self.meshes.append({"name": name, "primitives": [{"attributes": attrs, "indices": self.accessor(I, "SCALAR", 34963), "material": material}]})
        self.nodes.append({"name": name, "mesh": len(self.meshes) - 1})
    def write(self, path, materials):
        js = {"asset": {"version": "2.0", "generator": "pun-cvs echo-sim mesh_to_gltf.py"}, "scene": 0,
              "scenes": [{"nodes": list(range(len(self.nodes)))}], "nodes": self.nodes, "meshes": self.meshes,
              "materials": materials, "accessors": self.acc, "bufferViews": self.views, "buffers": [{"byteLength": len(self.bin)}]}
        j = json.dumps(js, separators=(",", ":")).encode()
        while len(j) % 4: j += b" "
        while len(self.bin) % 4: self.bin += b"\0"
        out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(self.bin)) + struct.pack("<II", len(j), 0x4E4F534A) + j \
              + struct.pack("<II", len(self.bin), 0x004E4942) + bytes(self.bin)
        Path(path).write_bytes(out)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("mesh"); ap.add_argument("out")
    ap.add_argument("--frame", default="body", choices=["body", "heart"]); ap.add_argument("--no-vessels", action="store_true")
    a = ap.parse_args(); J = json.loads(Path(a.mesh).read_text(encoding="utf-8"))
    n = J["meta"]["vertices"]; C = np.array(J["mesh"]["positionCentre"]); R = np.array(J["mesh"]["positionRange"])
    P = dec(J["mesh"]["positions"], np.int16).reshape(-1, 3)/32767*R + C
    Nn = dec(J["mesh"]["normals"], np.int8).reshape(-1, 3)/127.0
    I = dec(J["mesh"]["index"], np.uint16 if J["mesh"]["indexType"] == "uint16" else np.uint32).astype(np.uint32)
    A = {k: dec(v, np.uint8) for k, v in J["vertex"].items()}
    M = np.eye(4)
    if a.frame == "body": M = np.array(J["frames"]["heartToBody"]).reshape(4, 4).T
    tr = lambda X: ((np.c_[X, np.ones(len(X))] @ M.T)[:, :3]*0.01).astype(np.float32)
    rot = lambda X: (X @ M[:3, :3].T).astype(np.float32)
    g = GLB(); col = np.array([REAL[w] for w in A["wall"]], np.float32)
    g.mesh("heart", tr(P), rot(Nn), I, {"_" + k.upper(): v for k, v in A.items()}, col, 0)
    if not a.no_vessels:
        for kind, lst, mat in (("artery", J["vessels"]["arteries"], 1), ("vein", J["vessels"]["veins"], 2)):
            for v in lst:
                Vp, Vn, F = tube(v["points"], v.get("displayR0", .2), v.get("displayR1", .12))
                g.mesh(f"{kind}_{v['id']}", tr(Vp), rot(Vn), F, None, None, mat)
    mats = [{"name": "myocardium", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "roughnessFactor": .6, "metallicFactor": 0}},
            {"name": "artery", "pbrMetallicRoughness": {"baseColorFactor": [.78, .17, .12, 1], "roughnessFactor": .4, "metallicFactor": 0}},
            {"name": "vein", "pbrMetallicRoughness": {"baseColorFactor": [.29, .24, .53, 1], "roughnessFactor": .4, "metallicFactor": 0}}]
    g.write(a.out, mats); print(f"Wrote {a.out}: {n} heart vertices, {len(g.meshes)} meshes, frame {a.frame}, metres")


if __name__ == "__main__":
    main()
