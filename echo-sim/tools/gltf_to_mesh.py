#!/usr/bin/env python3
"""Blender round trip: an edited heart surface (.glb) → pun-cvs heart mesh v1 JSON for the 3D-heart / MI / angiogram labs.

  python tools/gltf_to_mesh.py edited.glb export/heart-mesh.json OUT.json [--frame body|heart] [--node heart] [--max-shift 0.8]

- Reads the node/mesh named "heart" (or --node) from the .glb: positions (metres) and triangles. Normals are recomputed.
- Every per-vertex attribute (label, wall, AHA, territory, territoryModel, vessel, vesselT, motion) is transferred from the
  ORIGINAL export by nearest vertex (cm), so sculpt/smooth/remesh freely but keep the shape near the original: vertices that
  moved more than --max-shift cm from any original vertex are reported (their attributes may be wrong).
- Vessels, frames and names are copied from the original export unchanged (edit centrelines in phantom-normal.json, not here).
- The echo simulator does NOT read this file: anatomy that must show in the echo lives in data/phantom-normal.json
  (one source of truth). Use this path for display-only polish of the 3D labs' surface.
Needs numpy (scipy optional: faster nearest-vertex search)."""
import argparse, base64, json, struct
from pathlib import Path
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    b = Path(path).read_bytes(); assert b[:4] == b"glTF", "not a .glb file"
    jl = struct.unpack_from("<I", b, 12)[0]; js = json.loads(b[20:20 + jl]); bo = 20 + jl; bl = struct.unpack_from("<I", b, bo)[0]
    binc = b[bo + 8: bo + 8 + bl]
    def acc(i):
        a = js["accessors"][i]; v = js["bufferViews"][a["bufferView"]]; dt = np.dtype(CT[a["componentType"]]); k = NC[a["type"]]
        off = v.get("byteOffset", 0) + a.get("byteOffset", 0); stride = v.get("byteStride", dt.itemsize*k); cnt = a["count"]
        if stride == dt.itemsize*k: return np.frombuffer(binc, dt, cnt*k, off).reshape(cnt, k) if k > 1 else np.frombuffer(binc, dt, cnt, off)
        raw = np.frombuffer(binc, np.uint8, stride*(cnt - 1) + dt.itemsize*k, off)
        return np.stack([np.frombuffer(raw[i*stride:i*stride + dt.itemsize*k].tobytes(), dt) for i in range(cnt)])
    return js, acc


def node_world(js, name):
    """mesh index and world matrix of the node called name (Blender keeps object transforms on the node)."""
    def local(nd):
        if "matrix" in nd: return np.array(nd["matrix"]).reshape(4, 4).T
        T = np.eye(4); T[:3, 3] = nd.get("translation", [0, 0, 0]); x, y, z, w = nd.get("rotation", [0, 0, 0, 1])
        Rm = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
        S = np.diag(list(nd.get("scale", [1, 1, 1])) + [1]); Rm4 = np.eye(4); Rm4[:3, :3] = Rm; return T @ Rm4 @ S
    parent = {c: i for i, nd in enumerate(js["nodes"]) for c in nd.get("children", [])}
    for i, nd in enumerate(js["nodes"]):
        mname = js["meshes"][nd["mesh"]].get("name") if "mesh" in nd else None
        if "mesh" in nd and (nd.get("name") == name or mname == name):
            W = local(nd); p = parent.get(i)
            while p is not None: W = local(js["nodes"][p]) @ W; p = parent.get(p)
            return nd["mesh"], W
    raise SystemExit(f'no node or mesh named "{name}" in the .glb')


def nearest(src, q):
    try:
        from scipy.spatial import cKDTree
        d, i = cKDTree(src).query(q); return i, d
    except ImportError:
        I = np.empty(len(q), int); D = np.empty(len(q))
        for s in range(0, len(q), 2048):
            dd = ((q[s:s+2048, None, :] - src[None, :, :])**2).sum(-1); I[s:s+2048] = dd.argmin(1); D[s:s+2048] = np.sqrt(dd.min(1))
        return I, D


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("glb"); ap.add_argument("orig"); ap.add_argument("out")
    ap.add_argument("--frame", default="body", choices=["body", "heart"]); ap.add_argument("--node", default="heart")
    ap.add_argument("--max-shift", type=float, default=0.8)
    a = ap.parse_args(); J = json.loads(Path(a.orig).read_text(encoding="utf-8")); js, acc = read_glb(a.glb)
    mi, W = node_world(js, a.node); P = []; I = []; base = 0
    for prim in js["meshes"][mi]["primitives"]:
        p = acc(prim["attributes"]["POSITION"]).astype(float); p = (np.c_[p, np.ones(len(p))] @ W.T)[:, :3]*100.0   # m → cm
        ix = acc(prim["indices"]).astype(np.int64) if "indices" in prim else np.arange(len(p))
        P.append(p); I.append(ix + base); base += len(p)
    P = np.concatenate(P); I = np.concatenate(I)
    if a.frame == "body":   # body → heart frame
        M = np.array(J["frames"]["heartToBody"]).reshape(4, 4).T; P = (np.c_[P, np.ones(len(P))] @ np.linalg.inv(M).T)[:, :3]
    C0 = np.array(J["mesh"]["positionCentre"]); R0 = np.array(J["mesh"]["positionRange"])
    P0 = np.frombuffer(base64.b64decode(J["mesh"]["positions"]), np.int16).reshape(-1, 3)/32767*R0 + C0
    idx, dist = nearest(P0, P); far = int((dist > a.max_shift).sum())
    # normals: area-weighted from the triangles
    F = I.reshape(-1, 3); Nf = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]); N = np.zeros_like(P)
    for k in range(3): np.add.at(N, F[:, k], Nf)
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    cen = (P.max(0) + P.min(0))/2; rng = (P.max(0) - P.min(0))/2 + 1e-6
    enc = lambda arr: base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()
    out = dict(J); out["mesh"] = {"positions": enc(np.round((P - cen)/rng*32767).astype(np.int16)), "positionCentre": cen.round(5).tolist(),
        "positionRange": rng.round(5).tolist(), "normals": enc(np.round(N*127).astype(np.int8)),
        "index": enc(I.astype(np.uint16 if len(P) < 65536 else np.uint32)), "indexType": "uint16" if len(P) < 65536 else "uint32"}
    out["vertex"] = {k: enc(np.frombuffer(base64.b64decode(v), np.uint8)[idx]) for k, v in J["vertex"].items()}
    out["meta"] = dict(J["meta"], vertices=int(len(P)), triangles=int(len(F)),
                       notes=J["meta"].get("notes", []) + [f"Surface edited in a 3D tool ({Path(a.glb).name}); attributes transferred by nearest original vertex."])
    Path(a.out).write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {a.out}: {len(P)} vertices, {len(F)} triangles; {far} vertices further than {a.max_shift} cm from the original (check them)")


if __name__ == "__main__":
    main()
