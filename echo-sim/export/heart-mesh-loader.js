/* Pun CVS heart mesh loader (export format v1, tools/export_heart_mesh.py). For the 3D-heart lab, the MI lab and the angiogram lab.
   const H = HeartMesh.load(json, THREE, { frame: "H3" | "body" | "heart" })
   → { mesh, vessels (Group of tappable tubes), attr: {label, wall, aha, territory, territoryModel, vessel, vesselT, motion}, json,
       colourBy(mode), pick(raycaster) → {kind:'wall', aha, ahaName, territory, wall, label} | {kind:'vessel', id, name, scct, territory},
       infarctDownstream(vesselId, t) → Uint8Array mask (vertices supplied beyond fraction t of that artery, incl. its branches) } */
const HeartMesh = (() => {
  const dec = (s, T) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new T(u.buffer); };
  const TERR_COL = { 0: [.55, .5, .5], 1: [.86, .33, .25], 2: [.25, .55, .85], 3: [.3, .7, .38] };   // LAD red, LCx blue, RCA green
  const AHA_COL = i => { if (!i) return [.5, .45, .45]; const h = ((i*0.381966) % 1)*6, c = .62, x = c*(1 - Math.abs(h % 2 - 1)), m = .25; const k = Math.floor(h);
    const t = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][k]; return t.map(v => v + m); };
  const REAL = { 1: [.62, .2, .17], 2: [.6, .22, .2], 3: [.5, .2, .32], 4: [.86, .74, .66], 5: [.9, .76, .45], 0: [.6, .4, .4] };
  function load(J, T, opt = {}){
    const n = J.meta.vertices, C = J.mesh.positionCentre, R = J.mesh.positionRange, Pq = dec(J.mesh.positions, Int16Array), Nq = dec(J.mesh.normals, Int8Array);
    const P = new Float32Array(n*3), N = new Float32Array(n*3);
    for (let i = 0; i < n*3; i++){ P[i] = Pq[i]/32767*R[i % 3] + C[i % 3]; N[i] = Nq[i]/127; }
    const I = J.mesh.indexType === "uint16" ? dec(J.mesh.index, Uint16Array) : dec(J.mesh.index, Uint32Array);
    const A = {}; for (const k in J.vertex) A[k] = dec(J.vertex[k], Uint8Array);
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(P, 3)); g.setAttribute("normal", new T.BufferAttribute(N, 3)); g.setIndex(new T.BufferAttribute(I, 1));
    const col = new Float32Array(n*3); g.setAttribute("color", new T.BufferAttribute(col, 3));
    const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .02 }), mesh = new T.Mesh(g, mat);
    const M = new T.Matrix4(); if (opt.frame === "H3") M.fromArray(J.frames.heartToH3); else if (opt.frame === "body") M.fromArray(J.frames.heartToBody);
    const root = new T.Group(); root.matrixAutoUpdate = false; root.matrix.copy(M); root.add(mesh);
    /* vessels: tapered tubes from the centrelines at display radius (tappable) */
    const vessels = new T.Group(); root.add(vessels); const all = [...J.vessels.arteries.map(a => ({ ...a, kind: "artery" })), ...J.vessels.veins.map(v => ({ ...v, kind: "vein" }))];
    for (const v of all){ const curve = new T.CatmullRomCurve3(v.points.map(p => new T.Vector3(...p)), false, "centripetal"), segs = Math.max(8, v.points.length*6), rad = 10;
      const tg = new T.TubeGeometry(curve, segs, 1, rad, false), Pp = tg.attributes.position, c = new T.Vector3();
      for (let i = 0; i <= segs; i++){ curve.getPointAt(i/segs, c); const r = v.displayR0 + (v.displayR1 - v.displayR0)*i/segs;
        for (let j = 0; j <= rad; j++){ const k = i*(rad+1) + j; Pp.setXYZ(k, c.x + (Pp.getX(k)-c.x)*r, c.y + (Pp.getY(k)-c.y)*r, c.z + (Pp.getZ(k)-c.z)*r); } }
      tg.computeVertexNormals(); const m = new T.Mesh(tg, new T.MeshStandardMaterial({ color: v.kind === "artery" ? 0xc62a1e : 0x4a3d86, roughness: .35 })); m.userData = v; vessels.add(m); }
    function colourBy(mode){ for (let i = 0; i < n; i++){ let c;
        if (mode === "aha") c = AHA_COL(A.aha[i]); else if (mode === "territory") c = TERR_COL[A.territory[i]]; else if (mode === "territoryModel") c = TERR_COL[A.territoryModel[i]]; else c = REAL[A.wall[i]];
        col[i*3] = c[0]; col[i*3+1] = c[1]; col[i*3+2] = c[2]; } g.attributes.color.needsUpdate = true; }
    colourBy(opt.colour || "real");
    const TN = J.territories;
    function pick(ray){ const hv = ray.intersectObjects(vessels.children, false)[0], hm = ray.intersectObject(mesh, false)[0];
      if (hv && (!hm || hv.distance < hm.distance + 0.05)){ const v = hv.object.userData; return { kind: "vessel", id: v.id, name: v.name, scct: v.scct, territory: TN[v.territoryCode] || "vein" }; }
      if (hm){ const f = hm.face, cand = [f.a, f.b, f.c], i = cand.find(k => A.aha[k]) ?? f.a;
        return { kind: "wall", aha: A.aha[i], ahaName: J.ahaNames[A.aha[i]] || null, territory: TN[A.territory[i]], territoryModel: TN[A.territoryModel[i]], wall: J.wallNames[A.wall[i]], label: J.labelNames[A.label[i]] }; }
      return null; }
    const ids = J.vessels.arteries.map(a => a.id), parent = Object.fromEntries(J.vessels.arteries.map(a => [a.id, a.parent]));
    const inSubtree = (id, root_) => { for (let x = id; x; x = parent[x]) if (x === root_) return true; return false; };
    function infarctDownstream(vid, t = 0){ const m = new Uint8Array(n);
      for (let i = 0; i < n; i++){ const v = A.vessel[i]; if (!v) continue; const id = ids[v-1];
        if (id === vid ? A.vesselT[i]/255 >= t : inSubtree(id, vid)) m[i] = 1; } return m; }
    return { root, mesh, vessels, attr: A, json: J, colourBy, pick, infarctDownstream };
  }
  return { load };
})();
if (typeof module !== "undefined") module.exports = HeartMesh;
