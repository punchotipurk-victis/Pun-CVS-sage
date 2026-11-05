/* ===== SCENE: one shared scene graph (patient + skeleton + heart + probe + fan), drawn by every viewport =====
   Everything is in centimetres inside patientGroup (BODY frame). LLD only rolls patientGroup for display, so the pose never changes.
   Layers: 0 shared (heart, ribs, probe, fan) · 1 skin (main view only) · 2 torso-map overlays · 3 cut-face quad.
   The heart, lungs and liver are meshed from the phantom's scene() (GPU label volume → surface nets): never hand-copied anatomy. */
function makeScene(APP){
  const T = THREE, { ph, eng, renderer } = APP, L = PHANTOM.LABELS, E = ph.extracardiac_patient;
  const scene = new T.Scene(), patient = new T.Group(); scene.add(patient);
  const hemi = new T.HemisphereLight(0xfff6f0, 0x47505a, 1.15), key = new T.DirectionalLight(0xffffff, 1.5), fill = new T.DirectionalLight(0xdfe8ff, .45);
  key.position.set(18, 30, 50); fill.position.set(-30, -10, 20);
  for (const l of [hemi, key, fill]){ l.layers.enableAll(); scene.add(l); }
  const onLayer = (o, n) => { o.traverse(c => c.layers.set(n)); return o; };

  /* World clip plane shared by heart/ribs/lungs/liver: on in the cutaway's Section mode, pushed out of the way elsewhere. */
  const clip = new T.Plane(new T.Vector3(0, 0, 1), 1e5), clips = [clip];
  renderer.localClippingEnabled = true;

  /* ---- torso: analytic elliptic cylinder in the chest, capped at the neck and pelvis ---- */
  const tor = E.torso, hw = tor.halfWidthX, hd = tor.halfDepthZ, cz = tor.center_xz[1];
  function torsoGeometry(){
    const rows = [[-40,0],[-40,.9],[-39.4,1],[0,1],[1,.985],[2,.95],[3,.88],[4,.76],[5,.58],[5.8,.45],[6.6,.375],[7.6,.345],[11,.33],[11.2,0]], NA = 72, pos = [], idx = [];
    const ys = []; rows.forEach((r, i) => { if (i && r[0] - rows[i-1][0] > 4){ const n = Math.ceil((r[0]-rows[i-1][0])/4); for (let k = 1; k < n; k++) ys.push([rows[i-1][0]+(r[0]-rows[i-1][0])*k/n, rows[i-1][1]+(r[1]-rows[i-1][1])*k/n]); } ys.push(r); });
    ys.forEach(([y, s]) => { for (let a = 0; a <= NA; a++){ const f = a/NA*2*Math.PI; pos.push(hw*s*Math.sin(f), y, cz + hd*s*Math.cos(f)); } });
    for (let j = 0; j < ys.length-1; j++) for (let a = 0; a < NA; a++){ const p = j*(NA+1)+a, q = p+NA+1; idx.push(p, p+1, q, q, p+1, q+1); }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  const torsoGeo = torsoGeometry();
  const skinMat = new T.MeshStandardMaterial({ color: 0xd8b49a, roughness: .78, metalness: 0 }),
        ghostMat = new T.MeshStandardMaterial({ color: 0xd8b49a, roughness: .78, metalness: 0, transparent: true, opacity: .25, depthWrite: false });  // two materials: "transparent" is compiled into the program
  const skin = new T.Group(), torso = new T.Mesh(torsoGeo, skinMat); skin.add(torso); patient.add(skin);
  /* soft landmarks on the skin, so counting from the sternal angle works without seeing bone */
  const onSkin = (x, y, o = .06) => { const p = PROBE.skinPoint(x, y), n = PROBE.outwardNormal(p); return new T.Vector3(p[0]+n[0]*o, p[1], p[2]+n[2]*o); };
  const markMat = new T.LineBasicMaterial({ color: 0x8a6a58, transparent: true, opacity: .75 });
  const skinLine = pts => skin.add(new T.Line(new T.BufferGeometry().setFromPoints(pts.map(q => onSkin(q[0], q[1]))), markMat));
  const samp = (a, b, n = 16) => Array.from({ length: n+1 }, (_, i) => [a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n]);
  const stY = E.sternum.landmarks;
  skinLine(samp([-2.2, stY.sternal_angle_y], [2.2, stY.sternal_angle_y]));          // sternal angle
  skinLine(samp([0, -1], [0, stY.xiphoid_tip_y], 8));                               // midline
  for (const s of [1, -1]){                                                         // costal margin + nipple
    const cm = E.ribs.costalMargin_polyline; let pts = [[0, stY.xiphoid_tip_y]];
    cm.forEach((q, i) => { pts = pts.concat(samp(i ? [s*cm[i-1][0], cm[i-1][1]] : [0, stY.xiphoid_tip_y], [s*q[0], q[1]], 8)); });
    skinLine(pts);
    const nip = new T.Mesh(new T.CircleGeometry(.7, 18), new T.MeshBasicMaterial({ color: 0x9a6f5b })); const c = onSkin(s*9.5, -15.5, .08), n = PROBE.outwardNormal([c.x, c.y, c.z]);
    nip.position.copy(c); nip.lookAt(c.x+n[0], c.y+n[1], c.z+n[2]); skin.add(nip);
  }
  onLayer(skin, 1);

  /* ---- skeleton: ribs follow the same formula the echo uses (depth 1.0 under the skin, width 1.0) ---- */
  const boneMat = new T.MeshStandardMaterial({ color: 0xe8e2d2, roughness: .62, clippingPlanes: clips }),
        cartMat = new T.MeshStandardMaterial({ color: 0xb9d3d6, roughness: .5, clippingPlanes: clips });
  const skeleton = new T.Group(); patient.add(skeleton);
  const CM = [[0, stY.xiphoid_tip_y]].concat(E.ribs.costalMargin_polyline, [[16, -26]]);
  const costalY = ax => { for (let i = 1; i < CM.length; i++) if (ax <= CM[i][0]){ const t = (ax-CM[i-1][0])/(CM[i][0]-CM[i-1][0]); return CM[i-1][1]+t*(CM[i][1]-CM[i-1][1]); } return -26; };
  const ribY = (n, ax) => -0.875 - 2.25*n - .25*Math.max(0, ax-3);
  const under = (x, y, d = 1) => { const p = PROBE.skinPoint(x, y), m = PROBE.outwardNormal(p); return new T.Vector3(p[0]-m[0]*d, y, p[2]-m[2]*d); };
  const tube = (pts, mat, r = .42) => pts.length > 1 ? new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), Math.max(8, pts.length*2), r, 7), mat) : null;
  for (const n of E.ribs.numbers) for (const s of [1, -1]){
    const cc = E.ribs.costochondralJunction_absX[n], cart = [], bone = [];
    for (let ax = 1; ax <= hw - 1; ax += .5){ const y = ribY(n, ax); if (y <= costalY(ax)) continue; (ax < cc ? cart : bone).push(under(s*ax, y)); }
    if (cart.length && bone.length) bone.unshift(cart[cart.length-1].clone());
    /* posterior half (body shell only, the echo models anterior arcs): swings round toward the spine, rising */
    if (bone.length){ const y0 = bone[bone.length-1].y; for (let a = 95; a <= 165; a += 10){ const f = a*Math.PI/180, q = .92;
      bone.push(new T.Vector3(s*hw*q*Math.sin(f), y0 + (a-90)/75*5.5, cz + hd*q*Math.cos(f))); } }
    for (const [pts, mat] of [[cart, cartMat], [bone, boneMat]]){ const m = tube(pts, mat); if (m) skeleton.add(m); }
  }
  for (const it of E.sternum.items){ const s = new T.Shape(), [y0, y1] = it.yRange, [w0, w1] = it.halfWidth;
    s.moveTo(-w0, y0); s.lineTo(w0, y0); s.lineTo(w1, y1); s.lineTo(-w1, y1); s.closePath();
    const m = new T.Mesh(new T.ExtrudeGeometry(s, { depth: E.sternum.thickness, bevelEnabled: false }), boneMat); m.position.z = E.sternum.frontZ - E.sternum.thickness; skeleton.add(m); }
  for (const c of E.clavicles.items){ const pts = [];                                   // kept under the skin where the shoulder curves away
    for (let i = 0; i <= 10; i++){ const t = i/10, x = c.a[0]+(c.b[0]-c.a[0])*t, y = c.a[1]+(c.b[1]-c.a[1])*t, z = c.a[2]+(c.b[2]-c.a[2])*t; pts.push(new T.Vector3(x, y, Math.min(z, PROBE.skinPoint(x, y)[2]-1.1))); }
    skeleton.add(tube(pts, boneMat, E.clavicles.r)); }
  { const v = E.vertebral_column, g = new T.BoxGeometry(v.xRange[1]-v.xRange[0], v.yRange[0]-v.yRange[1], v.zRange[0]-v.zRange[1]), m = new T.Mesh(g, boneMat);
    m.position.set((v.xRange[0]+v.xRange[1])/2, (v.yRange[0]+v.yRange[1])/2, (v.zRange[0]+v.zRange[1])/2); skeleton.add(m); }

  /* ---- bake: scene() → label volume on the GPU (2D atlas of slices), read back once ---- */
  const bakeU = { ...eng.uniforms, uBox: { value: new T.Matrix4() }, uO: { value: new T.Vector3() }, uV: { value: .2 }, uN: { value: new T.Vector3() }, uTX: { value: 1 } };
  const bakeMat = new T.RawShaderMaterial({ glslVersion: T.GLSL3, uniforms: bakeU,
    vertexShader: `in vec3 position; void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `precision highp float; precision highp int; uniform mat4 uBox; uniform vec3 uO, uN; uniform float uV, uTX;
${eng.glsl}
out vec4 o; void main(){ ivec2 f = ivec2(gl_FragCoord.xy), n = ivec2(uN.xy);
  int ix = f.x % n.x, iy = f.y % n.y, iz = (f.x / n.x) + (f.y / n.y)*int(uTX);
  if (iz >= int(uN.z)) { o = vec4(0.0); return; }
  vec3 b = (uBox*vec4(uO + (vec3(float(ix), float(iy), float(iz)) + 0.5)*uV, 1.0)).xyz; int t, l; scene(b, t, l);
  o = vec4(float(l)/255.0, float(t)/255.0, 0.0, 1.0); }` });
  function bake(boxToBody, o, n, v){
    const tx = Math.ceil(Math.sqrt(n[2])), ty = Math.ceil(n[2]/tx), W = n[0]*tx, H = n[1]*ty;
    const rt = new T.WebGLRenderTarget(W, H, { minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: false });
    bakeU.uBox.value.copy(boxToBody); bakeU.uO.value.set(...o); bakeU.uV.value = v; bakeU.uN.value.set(...n); bakeU.uTX.value = tx;
    eng.uniforms.uP.value.set(APP.paramEval(0, 0));      // end-diastole
    const s = new T.Scene(), q = new T.Mesh(new T.PlaneGeometry(2, 2), bakeMat), c = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1); q.frustumCulled = false; s.add(q);
    const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.render(s, c);
    const buf = new Uint8Array(W*H*4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf); renderer.setRenderTarget(prev); rt.dispose(); q.geometry.dispose();
    const out = new Uint8Array(n[0]*n[1]*n[2]);
    for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++){
      const X = i + (k % tx)*n[0], Y = j + Math.floor(k/tx)*n[1]; out[i + n[0]*(j + n[1]*k)] = buf[(Y*W + X)*4]; }
    return out;
  }
  /* occupancy of a label set → twice box-blurred (smooth signed-ish field) → surface nets */
  function meshLabels(vol, o, n, v, set){
    const [nx, ny, nz] = n, id = (i, j, k) => i + nx*(j + ny*k); let a = new Float32Array(nx*ny*nz), b = new Float32Array(nx*ny*nz);
    for (let i = 0; i < a.length; i++) a[i] = set[vol[i]] ? 1 : 0;
    for (let pass = 0; pass < 2; pass++) for (const [dx, dy, dz] of [[1,0,0],[0,1,0],[0,0,1]]){
      const st = id(dx, dy, dz) - id(0, 0, 0);
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
        const c = id(i, j, k), edge = (dx && (i === 0 || i === nx-1)) || (dy && (j === 0 || j === ny-1)) || (dz && (k === 0 || k === nz-1));
        b[c] = edge ? 0 : (a[c-st] + a[c] + a[c+st])/3; }
      [a, b] = [b, a]; }
    const vid = new Int32Array(nx*ny*nz).fill(-1), pos = [], tris = [];
    const corners = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]], edges = [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]], c = new Float32Array(8);
    for (let k = 0; k < nz-1; k++) for (let j = 0; j < ny-1; j++) for (let i = 0; i < nx-1; i++){
      let mask = 0; for (let q = 0; q < 8; q++){ const w = .5 - a[id(i+corners[q][0], j+corners[q][1], k+corners[q][2])]; c[q] = w; if (w < 0) mask |= 1 << q; }
      if (mask === 0 || mask === 255) continue;
      let px = 0, py = 0, pz = 0, m = 0;
      for (const [e, f] of edges){ if ((c[e] < 0) === (c[f] < 0)) continue; const u = c[e]/(c[e]-c[f]); px += corners[e][0]+u*(corners[f][0]-corners[e][0]); py += corners[e][1]+u*(corners[f][1]-corners[e][1]); pz += corners[e][2]+u*(corners[f][2]-corners[e][2]); m++; }
      vid[id(i, j, k)] = pos.length/3; pos.push(o[0]+(i+.5+px/m)*v, o[1]+(j+.5+py/m)*v, o[2]+(k+.5+pz/m)*v); }
    const quad = (p, q, r, s, flip) => { if (p < 0 || q < 0 || r < 0 || s < 0) return; if (!flip) tris.push(p, r, q, p, s, r); else tris.push(p, q, r, p, r, s); };
    for (let k = 1; k < nz-1; k++) for (let j = 1; j < ny-1; j++) for (let i = 1; i < nx-1; i++){
      const s0 = a[id(i, j, k)] > .5;
      if (s0 !== (a[id(i+1, j, k)] > .5)) quad(vid[id(i,j-1,k-1)], vid[id(i,j,k-1)], vid[id(i,j,k)], vid[id(i,j-1,k)], s0);
      if (s0 !== (a[id(i, j+1, k)] > .5)) quad(vid[id(i-1,j,k-1)], vid[id(i-1,j,k)], vid[id(i,j,k)], vid[id(i,j,k-1)], s0);
      if (s0 !== (a[id(i, j, k+1)] > .5)) quad(vid[id(i-1,j-1,k)], vid[id(i,j-1,k)], vid[id(i,j,k)], vid[id(i-1,j,k)], s0); }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(new Float32Array(pos), 3)); g.setIndex(tris); g.computeVertexNormals();
    return g;
  }
  /* vertex colour = the phantom's label under that vertex, in the same palette as the echo tint and the cut face */
  function colourByLabel(g, vol, o, n, v, set, fallback){
    const P = g.attributes.position, col = new Float32Array(P.count*3), pal = eng.uniforms.uPalette.value, [nx, ny, nz] = n;
    for (let q = 0; q < P.count; q++){
      const x = (P.getX(q)-o[0])/v-.5, y = (P.getY(q)-o[1])/v-.5, z = (P.getZ(q)-o[2])/v-.5; let best = 0, bd = 1e9;
      for (let dk = -3; dk <= 3; dk++) for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++){
        const i = Math.round(x)+di, j = Math.round(y)+dj, k = Math.round(z)+dk; if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
        const l = vol[i + nx*(j + ny*k)]; if (!set[l]) continue; const d = (i-x)**2 + (j-y)**2 + (k-z)**2; if (d < bd){ bd = d; best = l; } }
      const c = pal[best]; const has = best && c.lengthSq() > 0;
      col[q*3] = has ? c.x : fallback[0]; col[q*3+1] = has ? c.y : fallback[1]; col[q*3+2] = has ? c.z : fallback[2]; }
    g.setAttribute("color", new T.BufferAttribute(col, 3));
  }
  const labelSet = names => { const s = new Uint8Array(256); names.forEach(nm => { const i = L.indexOf(nm); if (i < 1) throw new Error("unknown label " + nm); s[i] = 1; }); return s; };

  /* ---- heart: baked once in the heart frame; the object is placed by the inverse of worldToHeart, so LLD just moves it ---- */
  const heartGroup = new T.Group(); heartGroup.matrixAutoUpdate = false; patient.add(heartGroup);
  const NOT_HEART = new Set(["", "pericardium","liver","diaphragm","IVC","hepatic_veins","descending_aorta","descending_aorta.abdominal","ribs","sternum","lungs","stomach_gas","chest_wall"]);
  const beatU = { uBR: { value: 1 }, uBZ: { value: 0 } };
  const apexZ = ph.landmarks_heart.LV_apex_epi[2];
  const heartMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .02, side: T.DoubleSide, clippingPlanes: clips });
  heartMat.onBeforeCompile = s => { Object.assign(s.uniforms, beatU);
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uBR, uBZ;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        { float w = smoothstep(-1.0, 1.5, transformed.z);          /* ventricles squeeze toward the LV axis; the base descends, the apex stays */
          transformed.xy *= mix(1.0, uBR, w);
          float along = transformed.z >= 0.0 ? 1.0 - clamp(transformed.z/${apexZ.toFixed(2)}, 0.0, 1.0) : clamp(1.0 + transformed.z/7.0, 0.0, 1.0);
          transformed.z += uBZ*along; }`); };
  const heart = new T.Mesh(new T.BufferGeometry(), heartMat); heart.visible = false; heartGroup.add(heart);
  function bakeHeart(){
    const v = .2, lo = [-8, -8.5, -8.5], hi = [8, 8, 11], n = lo.map((a, i) => Math.ceil((hi[i]-a)/v));
    const h2b = PHANTOM.worldToHeart(ph, "supine", T).clone().invert(), keep = L.filter(x => !NOT_HEART.has(x)), set = labelSet(keep);
    const prev = eng.uniforms.uW2H.value.clone(); eng.uniforms.uW2H.value.copy(PHANTOM.worldToHeart(ph, "supine", T));
    const vol = bake(h2b, lo, n, v); eng.uniforms.uW2H.value.copy(prev);
    const g = meshLabels(vol, lo, n, v, set); colourByLabel(g, vol, lo, n, v, set, [.72, .36, .32]);
    heart.geometry.dispose(); heart.geometry = g; heart.visible = true; return { verts: g.attributes.position.count, tris: g.index.count/3 };
  }
  /* lungs and liver: body-fixed organs in a coarse body-frame volume; lungs are re-baked per position (the cardiac notch changes) */
  const lungMat = new T.MeshStandardMaterial({ color: 0x9fb8cc, transparent: true, opacity: .16, roughness: .9, depthWrite: false, side: T.DoubleSide, clippingPlanes: clips });
  const liverMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .7, clippingPlanes: clips });
  const lungs = new T.Mesh(new T.BufferGeometry(), lungMat), liver = new T.Mesh(new T.BufferGeometry(), liverMat), vessels = new T.Mesh(new T.BufferGeometry(), liverMat);
  lungs.renderOrder = 2; patient.add(lungs, liver, vessels); lungs.visible = liver.visible = vessels.visible = false;
  const lungCache = {};
  function bakeOrgans(position){
    const v = .6, lo = [-17, -34, -24], hi = [17, 2, 1], n = lo.map((a, i) => Math.ceil((hi[i]-a)/v));
    const vol = bake(new T.Matrix4(), lo, n, v);
    if (!liver.userData.done){
      const sL = labelSet(["liver"]), sV = labelSet(["IVC","hepatic_veins","descending_aorta","descending_aorta.abdominal"]);
      const gL = meshLabels(vol, lo, n, v, sL); colourByLabel(gL, vol, lo, n, v, sL, [.6, .42, .31]); liver.geometry = gL;
      const gV = meshLabels(vol, lo, n, v, sV); colourByLabel(gV, vol, lo, n, v, sV, [.5, .6, .8]); vessels.geometry = gV;
      liver.userData.done = 1; }
    lungs.geometry = lungCache[position] || (lungCache[position] = meshLabels(vol, lo, n, v, labelSet(["lungs"])));
  }

  /* ---- probe + fan + cut face: children of probeGroup, whose axes are X = lateral (notch side), Y = −beam, Z = −elev ---- */
  const probeGroup = new T.Group(); probeGroup.matrixAutoUpdate = false; patient.add(probeGroup);
  { const body = new T.Mesh(new T.CylinderGeometry(1.55, 1.25, 7.5, 24), new T.MeshStandardMaterial({ color: 0x2f3a42, roughness: .45 })); body.scale.z = .68; body.position.y = 5.35; probeGroup.add(body);
    const face = new T.Mesh(new T.CylinderGeometry(1.25, 1.1, 1.6, 24), new T.MeshStandardMaterial({ color: 0x59666e, roughness: .4 })); face.scale.z = .68; face.position.y = .8; probeGroup.add(face);
    const notch = new T.Mesh(new T.BoxGeometry(.5, 1.5, .55), new T.MeshBasicMaterial({ color: 0xff8a3c })); notch.position.set(1.45, 2.2, 0); probeGroup.add(notch); }
  const fanFill = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0x35d6e0, transparent: true, opacity: .22, side: T.DoubleSide, depthWrite: false }));
  const fanEdge = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0x7fe9f0 })), fanMark = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0xff8a3c }));
  fanFill.renderOrder = 3; probeGroup.add(fanFill, fanEdge, fanMark);
  const cutU = { ...eng.uniforms, uWorldToBody: { value: new T.Matrix4() } };
  const cutMat = new T.RawShaderMaterial({ glslVersion: T.GLSL3, transparent: true, side: T.DoubleSide, uniforms: cutU,
    vertexShader: `uniform mat4 modelMatrix, viewMatrix, projectionMatrix; in vec3 position; out vec3 vW;
      void main(){ vec4 w = modelMatrix*vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `precision highp float; precision highp int; uniform mat4 uWorldToBody; uniform vec3 uPalette[48];
${eng.glsl}
in vec3 vW; out vec4 o;
void main(){ int t, l; scene((uWorldToBody*vec4(vW, 1.0)).xyz, t, l);
  if (t == 0 || t == 7 || t == 13 || t == 16) discard;             // none, chest wall, lung, soft: keep the cut clean
  vec3 c = uPalette[l]; if (dot(c, c) == 0.0) c = vec3(0.85);
  o = vec4(t == 1 ? c*0.9 : c*0.6 + 0.25, 0.95); }` });
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
    updateFan(APP.img.depthCm, APP.img.sectorDeg);
    patient.updateMatrixWorld(true);
    const m3 = new T.Matrix3().setFromMatrix4(patient.matrixWorld);
    elevWorld.set(...f.elev).applyMatrix3(m3); beamWorld.set(...f.beam).applyMatrix3(m3); latWorld.set(...f.lateral).applyMatrix3(m3);
    originWorld.set(...o).applyMatrix4(patient.matrixWorld);
    cutU.uWorldToBody.value.copy(patient.matrixWorld).invert();
  }
  function setPatientMatrix(position){ heartGroup.matrix.copy(PHANTOM.worldToHeart(ph, position, T)).invert(); heartGroup.matrixWorldNeedsUpdate = true; }
  let rollNow = 0;
  function animateRoll(target, snap, dt = .016){ rollNow = snap ? target : rollNow + (target-rollNow)*(1-Math.exp(-dt*7)); if (Math.abs(target-rollNow) < .05) rollNow = target; patient.rotation.y = rollNow*Math.PI/180; }
  function updateBeat(){
    const u = eng.uniforms.uP.value, i = eng.names.indexOf("LV_outerXY"), j = eng.names.indexOf("MV_annulusZ");
    beatU.uBR.value = u[i]/APP.edOuterXY; beatU.uBZ.value = u[j];
  }
  /* ---- viewports ---- */
  const mainCam = new T.PerspectiveCamera(34, 1, 1, 400), orbit = { yaw: .3, pitch: .08, dist: 96, tx: 0, ty: -17, tz: -9 };
  mainCam.layers.disableAll();
  function aimMain(r){
    const asp = r.w/r.h, d = orbit.dist*Math.max(1, .62/asp);
    mainCam.aspect = asp; mainCam.position.set(orbit.tx + d*Math.sin(orbit.yaw)*Math.cos(orbit.pitch), orbit.ty + d*Math.sin(orbit.pitch), orbit.tz + d*Math.cos(orbit.yaw)*Math.cos(orbit.pitch));
    mainCam.up.set(0, 1, 0); mainCam.lookAt(orbit.tx, orbit.ty, orbit.tz);
    /* the overlay inset sits top-left: slide the picture right (no parallax) so the left chest and the probe stay clear of it */
    const ins = document.getElementById("inset"), over = innerWidth > 760 && !ins.classList.contains("min");
    if (over) mainCam.setViewOffset(r.w, r.h, -r.w*.12, 0, r.w, r.h); else mainCam.clearViewOffset();
    mainCam.updateProjectionMatrix(); mainCam.updateMatrixWorld();
  }
  function drawTo(r, H, clearHex, alpha = 1){
    renderer.setViewport(r.x, H-r.y-r.h, r.w, r.h); renderer.setScissor(r.x, H-r.y-r.h, r.w, r.h); renderer.setScissorTest(true);
    renderer.setClearColor(clearHex, alpha);
  }
  function renderMain(r, H){
    aimMain(r); clip.constant = 1e5;
    const b = APP.body, inside = b !== "skin";
    mainCam.layers.disableAll(); mainCam.layers.enable(0); mainCam.layers.enable(1); if (inside) mainCam.layers.enable(3);
    skin.visible = b !== "skeleton";
    torso.material = b === "ghost" ? ghostMat : skinMat; ghostMat.opacity = APP.ghostOpacity;
    skeleton.visible = inside; heart.visible = heartReady() && inside; lungs.visible = liver.visible = vessels.visible = heartReady() && b === "skeleton";
    fanFill.visible = true; fanEdge.visible = fanMark.visible = true;
    drawTo(r, H, APP.colors.scene); renderer.render(scene, mainCam);
  }
  const heartReady = () => heart.geometry.attributes.position !== undefined;
  return { T, scene, patient, skin, skeleton, torsoGeo, heart, heartGroup, lungs, liver, vessels, probeGroup, fanFill, fanEdge, fanMark, cutFace, clip,
    elevWorld, originWorld, beamWorld, latWorld, onSkin, onLayer, costalY, ribY, heartReady, drawTo,
    mainCam, orbit, aimMain, renderMain, syncProbe, setPatientMatrix, animateRoll, updateBeat, bakeHeart, bakeOrgans };
}
