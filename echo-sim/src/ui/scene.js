/* ===== SCENE: one shared scene graph (patient + skeleton + heart + probe + fan), drawn by every viewport =====
   Everything is in centimetres inside patientGroup (BODY frame). LLD only rolls patientGroup for display, so the pose never changes.
   Layers: 0 shared (heart, ribs, probe, fan) · 1 main view only (skin, muscle, landmarks, probe gizmo) · 2 torso-map overlays · 3 cut-face quad.
   The heart, lungs and liver are meshed from the phantom's scene() (GPU label volume → surface nets → Taubin smoothing): never hand-copied anatomy. */
function makeScene(APP){
  const T = THREE, { ph, eng, renderer } = APP, L = PHANTOM.LABELS, K = MESHKIT;
  const scene = new T.Scene(), patient = new T.Group(); scene.add(patient);
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;      // only affects lit materials; the echo and blits are raw shaders
  const hemi = new T.HemisphereLight(0xfff3ea, 0x3d454e, 1.05), key = new T.DirectionalLight(0xfff4ea, 2.1), fill = new T.DirectionalLight(0xd6e4ff, .6), rim = new T.DirectionalLight(0xffffff, .9);
  key.position.set(22, 34, 48); fill.position.set(-36, -6, 24); rim.position.set(-10, 25, -50);
  for (const l of [hemi, key, fill, rim]){ l.layers.enableAll(); scene.add(l); }
  const onLayer = (o, n) => { o.traverse(c => c.layers.set(n)); return o; };

  /* World clip plane shared by heart/ribs/lungs/liver: on in the cutaway's Section mode, pushed out of the way elsewhere. */
  const clip = new T.Plane(new T.Vector3(0, 0, 1), 1e5), clips = [clip];
  renderer.localClippingEnabled = true;

  /* ---- the visible body (skin, muscle, skeleton, landmarks): body.js ---- */
  const body = makeBody(APP, clips);
  patient.add(onLayer(body.skinGroup, 1), onLayer(body.musGroup, 1), body.skeleton, onLayer(body.landmarks, 1));
  const onSkin = (x, y, o = .06) => body.surfaceAt(x, y, o).p;

  /* ---- bake: scene() → label volume on the GPU (2D atlas of slices), read back once ---- */
  const bakeU = { ...eng.uniforms, uBox: { value: new T.Matrix4() }, uO: { value: new T.Vector3() }, uV: { value: .2 }, uN: { value: new T.Vector3() }, uTX: { value: 1 }, uSkipBody: { value: 0 } };
  const bakeMat = new T.RawShaderMaterial({ glslVersion: T.GLSL3, uniforms: bakeU,
    vertexShader: `in vec3 position; void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `precision highp float; precision highp int; uniform mat4 uBox; uniform vec3 uO, uN; uniform float uV, uTX;
${PHANTOM.compile(ph, { detail: "bake" }).glsl}
out vec4 o; void main(){ ivec2 f = ivec2(gl_FragCoord.xy), n = ivec2(uN.xy);
  int ix = f.x % n.x, iy = f.y % n.y, iz = (f.x / n.x) + (f.y / n.y)*int(uTX);
  if (iz >= int(uN.z)) { o = vec4(0.0); return; }
  vec3 b = (uBox*vec4(uO + (vec3(float(ix), float(iy), float(iz)) + 0.5)*uV, 1.0)).xyz; int t, l; scene(b, t, l);
  float e = floor(clamp((gHeartD + 4.0)/8.0, 0.0, 1.0)*65535.0);          // 16-bit signed distance in B,A (±4 cm)
  o = vec4(float(l)/255.0, float(t)/255.0, floor(e/256.0)/255.0, mod(e, 256.0)/255.0); }` });
  function bake(boxToBody, o, n, v){
    const tx = Math.ceil(Math.sqrt(n[2])), ty = Math.ceil(n[2]/tx), W = n[0]*tx, H = n[1]*ty;
    const rt = new T.WebGLRenderTarget(W, H, { minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: false });
    bakeU.uBox.value.copy(boxToBody); bakeU.uO.value.set(...o); bakeU.uV.value = v; bakeU.uN.value.set(...n); bakeU.uTX.value = tx;
    eng.uniforms.uP.value.set(APP.paramEval(0, 0));      // end-diastole
    const s = new T.Scene(), q = new T.Mesh(new T.PlaneGeometry(2, 2), bakeMat), c = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1); q.frustumCulled = false; s.add(q);
    const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.render(s, c);
    const buf = new Uint8Array(W*H*4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf); renderer.setRenderTarget(prev); rt.dispose(); q.geometry.dispose();
    const out = new Uint8Array(n[0]*n[1]*n[2]), dist = new Float32Array(out.length);
    for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++){
      const X = i + (k % tx)*n[0], Y = j + Math.floor(k/tx)*n[1], b = (Y*W + X)*4, c = i + n[0]*(j + n[1]*k);
      out[c] = buf[b]; dist[c] = (buf[b+2]*256 + buf[b+3])/65535*8 - 4; }
    out.dist = dist; return out;
  }
  /* occupancy of a label set → twice box-blurred (smooth signed-ish field) → surface nets → Taubin smoothing */
  function meshLabels(vol, o, n, v, set, iters = 6){
    const [nx, ny, nz] = n, id = (i, j, k) => i + nx*(j + ny*k); let a = new Float32Array(nx*ny*nz), b = new Float32Array(nx*ny*nz);
    for (let i = 0; i < a.length; i++) a[i] = set[vol[i]] ? 1 : 0;
    for (let pass = 0; pass < 2; pass++) for (const [dx, dy, dz] of [[1,0,0],[0,1,0],[0,0,1]]){
      const st = id(dx, dy, dz) - id(0, 0, 0);
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
        const c = id(i, j, k), edge = (dx && (i === 0 || i === nx-1)) || (dy && (j === 0 || j === ny-1)) || (dz && (k === 0 || k === nz-1));
        b[c] = edge ? 0 : (a[c-st] + a[c] + a[c+st])/3; }
      [a, b] = [b, a]; }
    for (let i = 0; i < a.length; i++) a[i] = .5 - a[i];
    const m = K.nets(a, n, [o[0]+v/2, o[1]+v/2, o[2]+v/2], v), adj = K.smooth(m.pos, m.idx, iters);
    const g = K.geometry(m.pos, m.idx); g.userData.adj = adj; return g;
  }
  /* heart: mesh the baked signed distance (crisp grooves, thin walls kept), not blurred occupancy.
     Where the label and the distance disagree (priority overrides in scene()), the label wins with a half-voxel offset. */
  function meshDistance(vol, o, n, v, set, iters = 3){
    const d = vol.dist, a = new Float32Array(d.length), h = v*.5; let bad = 0;
    for (let i = 0; i < a.length; i++){ const inS = !!set[vol[i]], x = d[i];
      if (inS === (x < 0)) a[i] = x; else { a[i] = inS ? -h : h; bad++; } }
    const [nx, ny, nz] = n;                                         // close the box faces
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!i || !j || !k || i === nx-1 || j === ny-1 || k === nz-1) a[i + nx*(j + ny*k)] = h;
    const m = K.nets(a, n, [o[0]+v/2, o[1]+v/2, o[2]+v/2], v), adj = K.smooth(m.pos, m.idx, iters);
    const g = K.geometry(m.pos, m.idx); g.userData.adj = adj; g.userData.disagree = bad/a.length; return g;
  }
  /* label under each vertex (nearest voxel of the set) */
  function vertexLabels(g, vol, o, n, v, set){
    const P = g.attributes.position, out = new Uint8Array(P.count), [nx, ny, nz] = n;
    for (let q = 0; q < P.count; q++){
      const x = (P.getX(q)-o[0])/v-.5, y = (P.getY(q)-o[1])/v-.5, z = (P.getZ(q)-o[2])/v-.5; let best = 0, bd = 1e9;
      for (let dk = -3; dk <= 3; dk++) for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++){
        const i = Math.round(x)+di, j = Math.round(y)+dj, k = Math.round(z)+dk; if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
        const l = vol[i + nx*(j + ny*k)]; if (!set[l]) continue; const d = (i-x)**2 + (j-y)**2 + (k-z)**2; if (d < bd){ bd = d; best = l; } }
      out[q] = best; }
    return out;
  }
  const labelSet = names => { const s = new Uint8Array(256); names.forEach(nm => { const i = L.indexOf(nm); if (i < 1) throw new Error("unknown label " + nm); s[i] = 1; }); return s; };

  /* realistic colours by structure (the teaching palette stays available in the cutaway's "Colours" toggle) */
  const MYO = [.46, .09, .08], REAL = { LV_myocardium: MYO, IVS: MYO, PW: MYO, LVOT: MYO, RVOT: [.5, .12, .1], RV_free_wall: [.52, .13, .11], RV_cavity: [.42, .04, .05], LV_cavity: [.42, .04, .05],
    "papillary_muscles.ALPM": [.5, .12, .11], "papillary_muscles.PMPM": [.5, .12, .11], moderator_band: [.5, .12, .11],
    LA: [.42, .12, .15], LAA: [.4, .1, .13], RA: [.36, .13, .22], LA_wall: [.44, .13, .16], RA_wall: [.38, .14, .23], crista_terminalis: [.5, .16, .22], pulmonary_veins: [.52, .2, .22], coronary_sinus: [.34, .22, .38], IAS: [.5, .18, .2],
    aortic_root: [.87, .73, .64], "aortic_root.ascending": [.87, .73, .64], aortic_arch: [.87, .73, .64], arch_branches: [.86, .72, .63], PA_main: [.82, .65, .62], RPA: [.8, .64, .62], LPA: [.8, .64, .62],
    MV_AML: [.93, .87, .76], MV_PML: [.93, .87, .76], TV_septal: [.93, .87, .76], TV_anterior: [.93, .87, .76], "AV_cusps.RCC": [.93, .87, .76], "AV_cusps.LCC": [.93, .87, .76], "AV_cusps.NCC": [.93, .87, .76], PV_cusps: [.93, .87, .76], TV_posterior: [.93, .87, .76], TV_annulus: [.9, .84, .74], chordae: [.95, .9, .8], LCA: [.72, .1, .1], RCA: [.72, .1, .1], cardiac_veins: [.25, .2, .45], epicardial_fat: [.9, .75, .42],
    liver: [.43, .14, .1], IVC: [.3, .33, .58], hepatic_veins: [.32, .35, .6], descending_aorta: [.78, .25, .21], "descending_aorta.abdominal": [.78, .25, .21] };
  const FAT = [.9, .74, .43], MUSCLE_L = new Set(["LV_myocardium", "IVS", "PW", "RV_free_wall", "LA", "RA", "LAA", "RVOT", "LVOT", "IAS", "LA_wall", "RA_wall", "crista_terminalis"]);
  const realPal = Array.from({ length: 64 }, (_, i) => new T.Vector3(...(REAL[L[i]] || [0, 0, 0])));
  function colourise(g, lab, mode){
    const P = g.attributes.position, nv = P.count, real = new Float32Array(nv*3), teach = new Float32Array(nv*3), pal = eng.uniforms.uPalette.value;
    let fat = null;
    if (mode === "heart"){                                         /* epicardial fat sits in the grooves: concave vertices of the chamber walls */
      const A = g.userData.adj, N = g.attributes.normal; fat = new Float32Array(nv); let cx = 0, cy = 0, cz2 = 0, out = 0;
      for (let i = 0; i < nv; i++){ cx += P.getX(i); cy += P.getY(i); cz2 += P.getZ(i); } cx /= nv; cy /= nv; cz2 /= nv;
      for (let i = 0; i < nv; i += 13) out += N.getX(i)*(P.getX(i)-cx) + N.getY(i)*(P.getY(i)-cy) + N.getZ(i)*(P.getZ(i)-cz2);
      const sg = out >= 0 ? 1 : -1;
      for (let i = 0; i < nv; i++){ const s = A.start[i], e = A.start[i+1]; if (e === s || !MUSCLE_L.has(L[lab[i]])) continue; let x = 0, y = 0, z = 0;
        for (let q = s; q < e; q++){ const j = A.nb[q]; x += P.getX(j); y += P.getY(j); z += P.getZ(j); } const m = e-s;
        const c = sg*((x/m-P.getX(i))*N.getX(i) + (y/m-P.getY(i))*N.getY(i) + (z/m-P.getZ(i))*N.getZ(i));
        fat[i] = Math.max(0, Math.min(1, (c - .003)/.012)); }
      for (let pass = 0; pass < 3; pass++){ const f2 = fat.slice(); for (let i = 0; i < nv; i++){ const s = A.start[i], e = A.start[i+1]; if (e === s) continue; let t = f2[i]*2; for (let q = s; q < e; q++) t += f2[A.nb[q]]; fat[i] = t/(e-s+2); } } }
    for (let i = 0; i < nv; i++){
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), nm = L[lab[i]];
      let c = (REAL[nm] || (mode === "lung" ? [.84, .6, .58] : MYO)).slice();
      const mot = .9 + .2*K.fbm(x*.9, y*.9, z*.9);
      if (mode === "lung"){ const sp = K.noise(x*1.6+7, y*1.6, z*1.6); c = c.map((v, k) => v*mot*(1 - .55*Math.max(0, (sp-.68)/.32)) ); }
      else c = c.map(v => v*mot);
      if (fat && fat[i] > 0){ const f = Math.min(1, fat[i]*1.6)*(.85 + .15*K.noise(x*2, y*2, z*2)); c = c.map((v, k) => v + (FAT[k]-v)*f); }
      real.set(c, i*3);
      const t = pal[lab[i]], has = lab[i] && t && t.lengthSq() > 0; teach.set(has ? [t.x, t.y, t.z] : c, i*3); }
    g.setAttribute("color", new T.BufferAttribute(real.slice(), 3)); g.userData.real = real; g.userData.teach = teach;
  }
  let colourMode = "real";
  function setColourMode(m){ colourMode = m;
    for (const o of [heart, liver, vessels]){ const g = o.geometry; if (g.userData.real){ g.attributes.color.array.set(m === "real" ? g.userData.real : g.userData.teach); g.attributes.color.needsUpdate = true; } }
    cutU.uPalette = { value: m === "real" ? realPal : eng.uniforms.uPalette.value }; }

  /* ---- heart: baked once in the heart frame; the object is placed by the inverse of worldToHeart, so LLD just moves it ---- */
  const heartGroup = new T.Group(); heartGroup.matrixAutoUpdate = false; patient.add(heartGroup);
  const NOT_HEART = new Set(["", "pericardium","liver","diaphragm","IVC","hepatic_veins","descending_aorta","descending_aorta.abdominal","ribs","sternum","lungs","stomach_gas","chest_wall"]);
  const beatU = { uBR: { value: 1 }, uBZ: { value: 0 } };
  const apexZ = ph.landmarks_heart.LV_apex_epi[2];
  const heartMat = new T.MeshPhysicalMaterial({ vertexColors: true, roughness: .42, metalness: 0, clearcoat: .55, clearcoatRoughness: .3, sheen: .12, sheenColor: new T.Color(0xff8070), side: T.DoubleSide, clippingPlanes: clips });
  heartMat.onBeforeCompile = s => { Object.assign(s.uniforms, beatU);
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uBR, uBZ;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        { float w = smoothstep(-1.0, 1.5, transformed.z);          /* ventricles squeeze toward the LV axis; the base descends, the apex stays */
          transformed.xy *= mix(1.0, uBR, w);
          float along = transformed.z >= 0.0 ? 1.0 - clamp(transformed.z/${apexZ.toFixed(2)}, 0.0, 1.0) : clamp(1.0 + transformed.z/7.0, 0.0, 1.0);
          transformed.z += uBZ*along; }`); };
  const heart = new T.Mesh(new T.BufferGeometry(), heartMat); heart.visible = false; heartGroup.add(heart);
  /* coronary arteries + cardiac veins in the 3D view: smooth tapered tubes swept from the SAME phantom centrelines and radii that scene()
     uses (they are 1–4 mm, below the 1.3 mm bake voxel, so a baked surface would only show jagged stitches). Same beat + clip as the heart. */
  const vesselMat = heartMat.clone(); vesselMat.vertexColors = true; vesselMat.clippingPlanes = clips; vesselMat.onBeforeCompile = heartMat.onBeforeCompile;
  const coronary = new T.Group(); coronary.visible = false; heartGroup.add(coronary);
  function sweptTube(pts, r0, r1, col, id){
    const curve = new T.CatmullRomCurve3(pts.map(p => new T.Vector3(...p)), false, "centripetal"), segs = Math.max(8, pts.length*6), rad = 10;
    const g = new T.TubeGeometry(curve, segs, 1, rad, false), P = g.attributes.position, c = new Float32Array(P.count*3), pt = new T.Vector3();
    for (let i = 0; i <= segs; i++){ curve.getPointAt(i/segs, pt); const r = r0 + (r1 - r0)*i/segs;
      for (let j = 0; j <= rad; j++){ const k = i*(rad+1) + j; P.setXYZ(k, pt.x + (P.getX(k)-pt.x)*r, pt.y + (P.getY(k)-pt.y)*r, pt.z + (P.getZ(k)-pt.z)*r); c.set(col, k*3); } }
    g.setAttribute("color", new T.BufferAttribute(c, 3)); g.computeVertexNormals(); const m = new T.Mesh(g, vesselMat); m.userData = { vessel: id }; return m; }
  let S_heartVol = null;
  /* signed distance of the baked heart (trilinear) and its gradient: lifts the display vessels onto the surface, used by the export */
  function heartDist(V, p){ const { vol, lo, n, v } = V, d = vol.dist, [nx, ny, nz] = n, x = (p[0]-lo[0])/v - .5, y = (p[1]-lo[1])/v - .5, z = (p[2]-lo[2])/v - .5;
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z); if (i < 0 || j < 0 || k < 0 || i >= nx-1 || j >= ny-1 || k >= nz-1) return 4;
    const fx = x-i, fy = y-j, fz = z-k; let s = 0;
    for (let c = 0; c < 8; c++){ const a = c & 1, b = (c >> 1) & 1, e = c >> 2; s += d[(i+a) + nx*((j+b) + ny*(k+e))]*(a ? fx : 1-fx)*(b ? fy : 1-fy)*(e ? fz : 1-fz); } return s; }
  function heartGrad(V, p){ const e = V.v; return [0,1,2].map(a => { const q1 = p.slice(), q0 = p.slice(); q1[a] += e; q0[a] -= e; return (heartDist(V, q1) - heartDist(V, q0))/(2*e); }); }
  /* display radius of a vessel (3D heart / MI lab): enlarged so it can be tapped; the true radius (r0→r1) stays for the echo and angiography */
  const DISP = ph.structures.coronary_arteries?.display || { arteryScale: 2.2, arteryMin: 0.16, veinScale: 1.4, veinMin: 0.12 };
  function displayTubes(V){
    for (const m of coronary.children.slice()){ coronary.remove(m); m.geometry.dispose(); }
    const lift = (pts, r) => V ? pts.map(p => { let q = p.slice(); for (let it = 0; it < 8; it++){ const s = heartDist(V, q) - r*0.55, g = heartGrad(V, q), gl = Math.hypot(...g) || 1; if (Math.abs(s) < .01) break; q = q.map((x, a) => x - s*g[a]/gl/gl*0.8); } return q; }) : pts;
    const CA = ph.structures.coronary_arteries, CV = ph.structures.cardiac_veins;
    if (CA) for (const a of CA.arteries){ const r0 = Math.max(a.r0*DISP.arteryScale, DISP.arteryMin), r1 = Math.max(a.r1*DISP.arteryScale, DISP.arteryMin*0.7);
      coronary.add(sweptTube(a.deep ? a.points : lift(a.points, (r0 + r1)/2), r0, r1, [.78, .13, .1], a.id)); }
    if (CV) for (const vv of CV.veins){ const r0 = Math.max(vv.r0*DISP.veinScale, DISP.veinMin), r1 = Math.max(vv.r1*DISP.veinScale, DISP.veinMin);
      coronary.add(sweptTube(lift(vv.points, (r0 + r1)/2), r0, r1, [.28, .22, .5], vv.id)); } }
  function bakeHeart(voxelCm){
    const v = voxelCm ?? ph._mesh?.heartVoxelCm ?? .13, lo = ph._mesh?.boxLo ?? [-8.5, -10.5, -9.5], hi = ph._mesh?.boxHi ?? [8, 8, 11], n = lo.map((a, i) => Math.ceil((hi[i]-a)/v));
    const h2b = PHANTOM.worldToHeart(ph, "supine", T).clone().invert(), keep = L.filter(x => !NOT_HEART.has(x)), set = labelSet(keep);
    const prev = eng.uniforms.uW2H.value.clone(); eng.uniforms.uW2H.value.copy(PHANTOM.worldToHeart(ph, "supine", T));
    bakeU.uSkipBody.value = 1; const vol = bake(h2b, lo, n, v); bakeU.uSkipBody.value = 0; eng.uniforms.uW2H.value.copy(prev);
    S_heartVol = { vol, lo, n, v };   // dev/design tools (coronary snapping, mesh export) read the baked heart volume
    const g = meshDistance(vol, lo, n, v, set, ph._mesh?.taubinIters ?? 3), vl = vertexLabels(g, vol, lo, n, v, set); g.userData.labels = vl; colourise(g, vl, "heart");
    if (voxelCm != null) return { geometry: g, vol: S_heartVol };   // export bake: do not replace the displayed heart
    displayTubes(S_heartVol);
    heart.geometry.dispose(); heart.geometry = g; heart.visible = true; coronary.visible = true; setColourMode(colourMode);
    return { verts: g.attributes.position.count, tris: g.index.count/3, voxelCm: v, disagree: +g.userData.disagree.toFixed(4) };
  }
  /* lungs and liver: body-fixed organs in a body-frame volume; lungs are re-baked per position (the cardiac notch changes) */
  const lungMat = new T.MeshPhysicalMaterial({ vertexColors: true, transparent: true, opacity: .3, roughness: .75, sheen: .5, sheenColor: new T.Color(0xffd0d0), depthWrite: false, side: T.DoubleSide, clippingPlanes: clips });
  const liverMat = new T.MeshPhysicalMaterial({ vertexColors: true, roughness: .38, clearcoat: .6, clearcoatRoughness: .25, clippingPlanes: clips });
  const lungs = new T.Mesh(new T.BufferGeometry(), lungMat), liver = new T.Mesh(new T.BufferGeometry(), liverMat), vessels = new T.Mesh(new T.BufferGeometry(), liverMat);
  lungs.renderOrder = 2; patient.add(lungs, liver, vessels); lungs.visible = liver.visible = vessels.visible = false;
  const lungCache = {};
  function bakeOrgans(position){
    const v = .45, lo = [-17, -34, -24], hi = [17, 2, 1], n = lo.map((a, i) => Math.ceil((hi[i]-a)/v));
    const vol = bake(new T.Matrix4(), lo, n, v);
    if (!liver.userData.done){
      const sL = labelSet(["liver"]), sV = labelSet(["IVC","hepatic_veins","descending_aorta","descending_aorta.abdominal"]);
      const gL = meshLabels(vol, lo, n, v, sL, 10); colourise(gL, vertexLabels(gL, vol, lo, n, v, sL), "organ"); liver.geometry = gL;
      const gV = meshLabels(vol, lo, n, v, sV, 6); colourise(gV, vertexLabels(gV, vol, lo, n, v, sV), "organ"); vessels.geometry = gV;
      liver.userData.done = 1; setColourMode(colourMode); }
    if (!lungCache[position]){ const sLu = labelSet(["lungs"]), g = meshLabels(vol, lo, n, v, sLu, 12); colourise(g, vertexLabels(g, vol, lo, n, v, sLu), "lung"); lungCache[position] = g; }
    lungs.geometry = lungCache[position];
  }

  /* ---- probe + fan + cut face: children of probeGroup, whose axes are X = lateral (notch side), Y = −beam, Z = −elev ---- */
  const probeGroup = new T.Group(); probeGroup.matrixAutoUpdate = false; patient.add(probeGroup);
  const probeVis = new T.Group(); probeGroup.add(probeVis);                 // lifted by the skin contour h(x,y); the fan and cut face are not
  const probeParts = [];
  { const prof = [[0, 0], [1.12, 0], [1.24, .3], [1.5, 1.0], [1.68, 2.0], [1.62, 3.0], [1.32, 4.4], [1.36, 5.8], [1.44, 7.3], [1.3, 8.6], [.95, 9.7], [.62, 10.5], [.5, 11.0], [0, 11.1]].map(q => new T.Vector2(q[0], q[1]));
    const shell = new T.Mesh(new T.LatheGeometry(prof, 40), new T.MeshPhysicalMaterial({ color: 0x29323a, roughness: .35, clearcoat: .6, clearcoatRoughness: .3 })); shell.scale.z = .62;
    const lens = new T.Mesh(new T.CylinderGeometry(1.13, 1.13, .34, 32), new T.MeshStandardMaterial({ color: 0x5a6670, roughness: .85 })); lens.scale.z = .5; lens.position.y = .17;
    const notch = new T.Mesh(new T.BoxGeometry(.35, 1.1, .5), new T.MeshBasicMaterial({ color: 0xff8a3c })); notch.position.set(1.66, 2.2, 0);
    const grip = new T.Mesh(new T.CylinderGeometry(1.41, 1.37, 2.4, 32, 1, true), new T.MeshStandardMaterial({ color: 0x3b4650, roughness: .7 })); grip.scale.z = .64; grip.position.y = 6.6;
    const cable = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([[0, 10.8, 0], [0, 13, 0], [0, 15.5, 1.4], [0, 16.5, 5], [0, 16, 10]].map(q => new T.Vector3(...q))), 30, .3, 8), new T.MeshStandardMaterial({ color: 0x1b2025, roughness: .6 }));
    probeVis.add(shell, lens, notch, grip, cable); probeParts.push(shell, lens, notch, grip); }
  /* gizmo (main view only): the tail cap tilts/rocks the probe about its skin contact, the orange ring rotates it */
  const gizmo = new T.Group(); probeVis.add(gizmo);
  const capMat = new T.MeshBasicMaterial({ color: 0x35d6e0, transparent: true, opacity: .9, depthTest: false }), ringMat = new T.MeshBasicMaterial({ color: 0xff8a3c, transparent: true, opacity: .85, depthTest: false });
  const cap = new T.Mesh(new T.SphereGeometry(1.05, 20, 14), capMat); cap.position.y = 11.9; cap.renderOrder = 9;
  const capHalo = new T.Mesh(new T.TorusGeometry(1.45, .09, 8, 32), capMat); capHalo.position.y = 11.9; capHalo.rotation.x = Math.PI/2; capHalo.renderOrder = 9;
  const ring = new T.Mesh(new T.TorusGeometry(2.6, .2, 10, 56), ringMat); ring.position.y = 7.3; ring.rotation.x = Math.PI/2; ring.renderOrder = 9;
  for (const a of [0, Math.PI]){ const c = new T.Mesh(new T.ConeGeometry(.45, 1.1, 12), ringMat); c.position.set(2.6*Math.cos(a+.6), 7.3, 2.6*Math.sin(a+.6)); c.rotation.set(0, -(a+.6), Math.PI/2*(a ? -1 : 1)); c.renderOrder = 9; gizmo.add(c); }
  gizmo.add(cap, capHalo, ring); onLayer(gizmo, 1);
  function setGizmoHover(k){ cap.scale.setScalar(k === "cap" ? 1.25 : 1); capHalo.scale.setScalar(k === "cap" ? 1.2 : 1); ringMat.opacity = k === "ring" ? 1 : .85; ring.scale.setScalar(k === "ring" ? 1.08 : 1); }

  /* the fan exists only inside the body: at steep beam angles its edge would otherwise poke out through the curved chest (the echo ignores that part too) */
  const tor = ph.extracardiac_patient.torso, hw = tor.halfWidthX, hd = tor.halfDepthZ, cz = tor.center_xz[1];
  const fanMat = (hex, opacity) => new T.ShaderMaterial({ transparent: opacity < 1, side: T.DoubleSide, depthWrite: false, toneMapped: false,
    uniforms: { uToBody: { value: probeGroup.matrix }, uCol: { value: new T.Color(hex) }, uA: { value: opacity } },
    vertexShader: `uniform mat4 uToBody; varying vec3 vB; void main(){ vB = (uToBody*vec4(position, 1.0)).xyz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uCol; uniform float uA; varying vec3 vB; void main(){ float q = vB.x/${hw.toFixed(1)}, r = (vB.z-(${cz.toFixed(1)}))/${hd.toFixed(1)}; if (q*q + r*r > 1.0) discard; gl_FragColor = vec4(uCol, uA); }` });
  const fanFill = new T.Mesh(new T.BufferGeometry(), fanMat(0x35d6e0, .22));
  const fanEdge = new T.Line(new T.BufferGeometry(), fanMat(0x7fe9f0, 1)), fanMark = new T.Line(new T.BufferGeometry(), fanMat(0xff8a3c, 1));
  fanFill.renderOrder = 3; probeGroup.add(fanFill, fanEdge, fanMark);
  const cutU = { ...eng.uniforms, uWorldToBody: { value: new T.Matrix4() } };
  const cutMat = new T.RawShaderMaterial({ glslVersion: T.GLSL3, transparent: true, side: T.DoubleSide, uniforms: cutU,
    vertexShader: `uniform mat4 modelMatrix, viewMatrix, projectionMatrix; in vec3 position; out vec3 vW;
      void main(){ vec4 w = modelMatrix*vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `precision highp float; precision highp int; uniform mat4 uWorldToBody; uniform vec3 uPalette[64];
${eng.glsl}
in vec3 vW; out vec4 o;
void main(){ int t, l; scene((uWorldToBody*vec4(vW, 1.0)).xyz, t, l);
  if (t == 0 || t == 7 || t == 13 || t == 16) discard;             // none, chest wall, lung, soft: keep the cut clean
  vec3 c = uPalette[l]; if (dot(c, c) == 0.0) c = vec3(0.85);
  o = vec4(t == 1 ? c*0.55 : c*0.7 + 0.3, 0.95); }` });
  const cutFace = new T.Mesh(new T.PlaneGeometry(1, 1), cutMat); cutFace.frustumCulled = false; probeGroup.add(cutFace); onLayer(cutFace, 3);
  let fanKey = "";
  function updateFan(depth, sectorDeg){
    const k = depth + "/" + sectorDeg; if (k === fanKey) return; fanKey = k;
    const a0 = sectorDeg*Math.PI/360, N = 32, pos = [0, 0, 0], arc = [];
    for (let i = 0; i <= N; i++){ const a = -a0 + 2*a0*i/N, x = Math.sin(a)*depth, y = -Math.cos(a)*depth; pos.push(x, y, 0); arc.push(new T.Vector3(x, y, 0)); }
    const idx = []; for (let i = 1; i <= N; i++) idx.push(0, i, i+1);
    fanFill.geometry.dispose(); const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); fanFill.geometry = g;
    const O = new T.Vector3();
    fanEdge.geometry.dispose(); fanEdge.geometry = new T.BufferGeometry().setFromPoints([O, ...arc]);
    fanMark.geometry.dispose(); fanMark.geometry = new T.BufferGeometry().setFromPoints([O, arc[N]]);
    const w = 2*depth*Math.max(.4, Math.sin(Math.min(a0, 1.5))); cutFace.scale.set(w, depth, 1); cutFace.position.set(0, -depth/2, 0);
  }

  /* ---- per-frame: pose → frame → probe matrix, engine probe, clip plane ---- */
  const mB = new T.Matrix4(), vX = new T.Vector3(), vY = new T.Vector3(), vZ = new T.Vector3();
  const elevWorld = new T.Vector3(), originWorld = new T.Vector3(), beamWorld = new T.Vector3(), latWorld = new T.Vector3();
  function syncProbe(){
    const f = APP.frame, pr = APP.press(), o = PROBE.v.sub(f.p, PROBE.v.mul(f.normal, pr));
    vX.set(...f.lateral); vY.set(-f.beam[0], -f.beam[1], -f.beam[2]); vZ.set(-f.elev[0], -f.elev[1], -f.elev[2]);
    mB.makeBasis(vX, vY, vZ); mB.setPosition(o[0], o[1], o[2]); probeGroup.matrix.copy(mB); probeGroup.matrixWorldNeedsUpdate = true;
    const cosB = Math.max(.35, -PROBE.v.dot(f.beam, f.normal)); probeVis.position.y = Math.max(0, body.liftAt(APP.pose.x, APP.pose.y) - pr*.6)/cosB;
    updateFan(APP.img.depthCm, APP.img.sectorDeg);
    patient.updateMatrixWorld(true);
    const m3 = new T.Matrix3().setFromMatrix4(patient.matrixWorld);
    elevWorld.set(...f.elev).applyMatrix3(m3); beamWorld.set(...f.beam).applyMatrix3(m3); latWorld.set(...f.lateral).applyMatrix3(m3);
    originWorld.set(...o).applyMatrix4(patient.matrixWorld);
    cutU.uWorldToBody.value.copy(patient.matrixWorld).invert();
  }
  function setPatientMatrix(position){ heartGroup.matrix.copy(PHANTOM.worldToHeart(ph, position, T)).invert(); heartGroup.matrixWorldNeedsUpdate = true; body.layout(position); }
  let rollNow = 0;
  function animateRoll(target, snap, dt = .016){ rollNow = snap ? target : rollNow + (target-rollNow)*(1-Math.exp(-dt*7)); if (Math.abs(target-rollNow) < .05) rollNow = target; patient.rotation.y = rollNow*Math.PI/180; }
  function updateBeat(){
    const u = eng.uniforms.uP.value, i = eng.names.indexOf("LV_outerXY"), j = eng.names.indexOf("MV_annulusZ");
    beatU.uBR.value = u[i]/APP.edOuterXY; beatU.uBZ.value = u[j];
  }
  /* ---- viewports ---- */
  const mainCam = new T.PerspectiveCamera(34, 1, 1, 400), orbit = { yaw: .3, pitch: .08, dist: 114, tx: 0, ty: -16, tz: -9 };
  mainCam.layers.disableAll();
  function aimMain(r){
    const asp = r.w/r.h, d = orbit.dist*Math.max(1, .7/asp);
    mainCam.aspect = asp; mainCam.position.set(orbit.tx + d*Math.sin(orbit.yaw)*Math.cos(orbit.pitch), orbit.ty + d*Math.sin(orbit.pitch), orbit.tz + d*Math.cos(orbit.yaw)*Math.cos(orbit.pitch));
    mainCam.up.set(0, 1, 0); mainCam.lookAt(orbit.tx, orbit.ty, orbit.tz);
    /* the overlay inset sits top-left: slide the picture right (no parallax) so the left chest and the probe stay clear of it */
    const ins = document.getElementById("inset"), over = innerWidth > 760 && !ins.classList.contains("min");
    if (over) mainCam.setViewOffset(r.w, r.h, -r.w*.19, -r.h*.05, r.w, r.h); else mainCam.clearViewOffset();
    mainCam.updateProjectionMatrix(); mainCam.updateMatrixWorld();
  }
  function drawTo(r, H, clearHex, alpha = 1){
    renderer.setViewport(r.x, H-r.y-r.h, r.w, r.h); renderer.setScissor(r.x, H-r.y-r.h, r.w, r.h); renderer.setScissorTest(true);
    renderer.setClearColor(clearHex, alpha);
  }
  const heartReady = () => heart.geometry.attributes.position !== undefined;
  function renderMain(r, H){
    aimMain(r); clip.constant = 1e5;
    const b = APP.body, inside = b === "ghost" || b === "skeleton";
    mainCam.layers.disableAll(); mainCam.layers.enable(0); mainCam.layers.enable(1); if (inside) mainCam.layers.enable(3);
    body.skinGroup.visible = b === "skin" || b === "ghost"; body.musGroup.visible = b === "muscle";
    body.skinMesh.material = b === "ghost" ? body.ghostMat : body.skinMat; body.ghostMat.opacity = APP.ghostOpacity;
    body.skeleton.visible = inside; heart.visible = heartReady() && inside; coronary.visible = heart.visible; lungs.visible = liver.visible = vessels.visible = heartReady() && b === "skeleton";
    body.landmarks.visible = APP.landmarks; body.setRibsVisible(APP.landmarks && b === "skin");
    gizmo.visible = APP.mode === "probe";
    fanFill.visible = true; fanEdge.visible = fanMark.visible = true;
    drawTo(r, H, APP.colors.scene); renderer.render(scene, mainCam);
    const ins = document.getElementById("panes"), ib = ins.getBoundingClientRect(), hole = ib.width > 2 && !document.getElementById("inset").classList.contains("min") && innerWidth > 760 ? { x: ib.left - r.x, y: ib.top - r.y, w: ib.width, h: ib.height } : null;
    body.updateLabels(mainCam, r, patient.matrixWorld, APP.landmarks, hole);
  }
  return { T, scene, patient, body, skin: body.skinGroup, skeleton: body.skeleton, torsoGeo: body.torsoGeo, heart, heartGroup, lungs, liver, vessels, probeGroup, probeVis, probeParts, gizmo, cap, ring, setGizmoHover,
    fanFill, fanEdge, fanMark, cutFace, clip, elevWorld, originWorld, beamWorld, latWorld, onSkin, onLayer, costalY: body.costalY, ribY: body.ribY, heartReady, drawTo,
    mainCam, orbit, aimMain, renderMain, syncProbe, setPatientMatrix, animateRoll, updateBeat, bakeHeart, coronary, heartDist, heartGrad, heartVol: () => S_heartVol, bakeOrgans, setColourMode, colourMode: () => colourMode };
}
