/* ===== HeartInterior: loader for export/heart-interior.json ("pun-cvs heart interior v1") =====
   const I = HeartInterior.load(json, THREE, { clippingPlanes: [plane], frame: "heart" | "body" | "H3" })
   I.group                  root THREE.Group (heart frame cm, or the requested frame via frames.heartToBody / heartToH3)
   I.tissue                 THREE.Mesh: all heart tissue (myocardium, fibrous skeleton, vessel walls, fat), vertex colours
   I.valves                 THREE.Group; I.setPhase(t) shows each valve's keyframe for t ∈ [0,1) of the RR interval (0 = R wave)
   I.colourBy("real" | "labels" | "wall")
   I.pick(raycaster)        → { kind: "tissue" | "valve", label, labelName, cavity, cavityName, point } or null
   I.landmarks              the JSON landmarks; I.landmarkObject(ids?, opts) → THREE.Group of tubes / spheres in the same frame
   Every vertex keeps attributes aLabel, aCavity, aWall, aMotion (for beat deformation or highlighting in a custom shader). */
const HeartInterior = (() => {
  const dec = (s, T) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new T(u.buffer); };
  const REAL = { myo: [.62, .16, .14], rv: [.66, .2, .17], atr: [.68, .3, .3], vessel: [.86, .66, .58], fat: [.92, .78, .45], fib: [.93, .88, .76], valve: [.95, .9, .8] };
  const realOf = (name, wall) => {
    if (/^(MV_|TV_|AV_|PV_|chordae)/.test(name)) return REAL.valve;
    if (wall === 6) return REAL.fib; if (wall === 5) return REAL.fat; if (wall === 4) return REAL.vessel; if (wall === 3) return REAL.atr; if (wall === 2) return REAL.rv;
    return REAL.myo; };
  /* label colours: one hue per structure family, fixed so the page and its legend agree */
  const FAMILY = [[/^(PW|IVS|LV_myocardium)$/, [.78, .22, .2]], [/^papillary/, [.95, .45, .3]], [/^(RV_free_wall|RVOT)$/, [.25, .45, .85]], [/^moderator_band$/, [.4, .8, 1]],
    [/^(LA_wall|LAA|pulmonary_veins)$/, [.95, .6, .45]], [/^(RA_wall|SVC)$/, [.5, .65, .95]], [/^IAS$/, [.95, .8, .3]], [/^crista_terminalis$/, [.85, .3, .85]], [/^pectinate_muscles$/, [1, .55, 1]],
    [/^(aortic_root|aortic_root\.ascending|aortic_arch|arch_branches)$/, [.95, .75, .35]], [/^(PA_main|RPA|LPA)$/, [.6, .5, .95]], [/^epicardial_fat$/, [.95, .85, .45]],
    [/^(central_fibrous_body|membranous_septum|TV_annulus|MV_AML)$/, [1, 1, 1]], [/^todaro_tendon$/, [0, 1, 1]], [/^eustachian_valve$/, [.3, 1, .4]], [/^thebesian_valve$/, [1, 1, .2]],
    [/^(MV_|TV_|AV_|PV_)/, [.98, .96, .88]], [/^chordae$/, [.98, .96, .88]]];
  const labelColour = name => { for (const [re, c] of FAMILY) if (re.test(name)) return c; return [.6, .6, .6]; };
  function geom(T, m, extra){
    const P = dec(m.positions, Int16Array), N = dec(m.normals, Int8Array), I = m.indexType === "uint32" ? dec(m.index, Uint32Array) : dec(m.index, Uint16Array);
    const n = P.length/3, pos = new Float32Array(n*3), nor = new Float32Array(n*3);
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++){ pos[i*3+a] = P[i*3+a]/32767*m.positionRange[a] + m.positionCentre[a]; nor[i*3+a] = N[i*3+a]/127; }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setAttribute("normal", new T.BufferAttribute(nor, 3)); g.setIndex(new T.BufferAttribute(I, 1));
    g.setAttribute("color", new T.BufferAttribute(new Float32Array(n*3), 3));
    for (const k in extra || {}) g.setAttribute(k, new T.BufferAttribute(extra[k], 1));
    g.computeBoundingSphere(); return g; }
  function load(J, T, opt = {}){
    if (!J || !/heart interior v1/.test(J.meta && J.meta.format)) throw new Error("not a pun-cvs heart interior v1 file");
    const names = J.labelNames, clips = opt.clippingPlanes || [];
    const group = new T.Group(); group.name = "heartInterior";
    if (opt.frame === "body" || opt.frame === "H3"){ group.matrixAutoUpdate = false; group.matrix.fromArray(opt.frame === "body" ? J.frames.heartToBody : J.frames.heartToH3); }
    const tv = J.tissue.vertex, lab = dec(tv.label, Uint8Array), cav = dec(tv.cavity, Uint8Array), wall = dec(tv.wall, Uint8Array), mot = dec(tv.motion, Uint8Array);
    const tg = geom(T, J.tissue.mesh, { aLabel: Float32Array.from(lab), aCavity: Float32Array.from(cav), aWall: Float32Array.from(wall), aMotion: Float32Array.from(mot, x => x/255) });
    const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: 0, side: T.DoubleSide, clippingPlanes: clips });
    const tissue = new T.Mesh(tg, mat); tissue.name = "tissue"; group.add(tissue);
    const valves = new T.Group(); valves.name = "valves"; group.add(valves);
    const vmat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .45, side: T.DoubleSide, clippingPlanes: clips });
    const items = J.valves.items.map(it => { const fr = it.frames.map(f => { if (!f) return null; const l = dec(f.label, Uint8Array);
        const m = new T.Mesh(geom(T, f.mesh, { aLabel: Float32Array.from(l) }), vmat); m.visible = false; m.userData = { valve: it.id, labels: l }; valves.add(m); return m; });
      return { id: it.id, frames: fr }; });
    const phases = J.valves.phases;
    function setPhase(t){ t = ((t % 1) + 1) % 1; let k = 0; for (let i = 0; i < phases.length; i++) if (phases[i] <= t) k = i;
      for (const it of items) it.frames.forEach((m, i) => { if (m) m.visible = i === k; }); return k; }
    setPhase(0);
    function paint(g, labels, walls, mode){ const c = g.attributes.color.array;
      for (let i = 0; i < labels.length; i++){ const nm = names[labels[i]] || ""; const col = mode === "labels" ? labelColour(nm) : mode === "wall" ? [[.6,.6,.6],[.78,.22,.2],[.25,.45,.85],[.95,.6,.45],[.95,.75,.35],[.95,.85,.45],[1,1,1]][walls ? walls[i] : 0] : realOf(nm, walls ? walls[i] : 0);
        c[i*3] = col[0]; c[i*3+1] = col[1]; c[i*3+2] = col[2]; }
      g.attributes.color.needsUpdate = true; }
    function colourBy(mode){ paint(tg, lab, wall, mode); for (const it of items) for (const m of it.frames) if (m) paint(m.geometry, m.userData.labels, null, mode); }
    colourBy(opt.colour || "real");
    function pick(ray){
      const vis = valves.children.filter(m => m.visible), hv = ray.intersectObjects(vis, false)[0], ht = ray.intersectObject(tissue, false)[0];
      const h = hv && (!ht || hv.distance <= ht.distance) ? hv : ht; if (!h) return null;
      const g = h.object.geometry, idx = [h.face.a, h.face.b, h.face.c], bary = h.barycoord || null;
      const vi = bary ? idx[[bary.x, bary.y, bary.z].indexOf(Math.max(bary.x, bary.y, bary.z))] : h.face.a;
      const L = g.attributes.aLabel.array[vi], C = g.attributes.aCavity ? g.attributes.aCavity.array[vi] : 0;
      return { kind: h.object === tissue ? "tissue" : "valve", label: L, labelName: names[L], cavity: C, cavityName: C ? names[C] : "", point: h.point, object: h.object }; }
    function landmarkObject(ids, o = {}){
      const out = new T.Group(), r = o.radius || .07, col = o.colour || 0x22c3ab;
      const m = new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: .35, roughness: .4, clippingPlanes: o.clip ? clips : [] });
      for (const [id, L] of Object.entries(J.landmarks)){ if (ids && !ids.includes(id)) continue;
        if (L.kind === "point"){ const s = new T.Mesh(new T.SphereGeometry(o.pointRadius || r*2.2, 16, 12), m); s.position.fromArray(L.p); s.userData = { landmark: id }; out.add(s); }
        else if (L.kind === "path" && L.points.length > 1){ const c = new T.CatmullRomCurve3(L.points.map(p => new T.Vector3(...p)));
          const t = new T.Mesh(new T.TubeGeometry(c, L.points.length*6, r, 8, false), m); t.userData = { landmark: id }; out.add(t); }
        else if (L.kind === "polygon"){ const c = new T.CatmullRomCurve3(L.points.map(p => new T.Vector3(...p)), true);
          const t = new T.Mesh(new T.TubeGeometry(c, L.points.length*6, r*0.6, 6, true), new T.MeshBasicMaterial({ color: o.polygonColour || 0xffd34d })); t.userData = { landmark: id }; out.add(t); } }
      return out; }
    return { group, tissue, valves, setPhase, phases, colourBy, pick, landmarks: J.landmarks, landmarkObject, labelNames: names, labelColour, items }; }
  return { load };
})();
if (typeof module !== "undefined") module.exports = HeartInterior;
