/* ===== 3D HEART (explore page): the refined heart only =====
   Data (stored once in the site page, read from the parent; a standalone build inlines them):
     window.PUN_HEART_MESH      outer surface + coronary tree   (echo-sim/export/heart-mesh.json, HeartMesh loader)
     window.PUN_HEART_INTERIOR  tissue surface, valves at 8 phases, landmarks (echo-sim/export/heart-interior.json, HeartInterior loader)
   Modes: External (outer heart + coronaries) · X-ray (glass outer heart, valves and conduction inside) · Cut (body or cardiac plane,
   capped tissue, open cavities). Colours: real or by label (EXPLORE_DATA.PAL). Labels by layer, de-cluttered. Tap → card below.
   Everything is in the heart frame (cm) under one group placed by frames.heartToBody, so presets are anatomical views. */
(function(){
"use strict";
const T = window.THREE, D = EXPLORE_DATA, C = CONTENT, SIM = SIMC;
const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const host = $(".viewer"), labelLayer = $(".labels"), panel = $(".panel");
function getData(k){ try { if (window[k]) return window[k]; } catch (e) {} try { if (window.parent && window.parent !== window && window.parent[k]) return window.parent[k]; } catch (e) {} return null; }
const JM = getData("PUN_HEART_MESH"), JI = getData("PUN_HEART_INTERIOR");
if (!T || !JM || !JI || !CGRAPH.spec){ host.innerHTML = '<p class="fallback">The refined 3D heart opens from the Pun CVS Lab site (its data is stored in the site page). Open the site and choose 3D Heart.</p>'; window.EXPLORE_APP = { ready: false, error: "no data" }; return; }
const ecg = ECG.init(ECG.timingFromSpec(CGRAPH.spec.timing.legacy));
let ecgContext = {ev:ecg.buildEvents(C.SC.normal.rh,C.SC.normal),ST:null,pAmp:1};
let renderer; try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, stencil: true }); } catch (e) { host.innerHTML = '<p class="fallback">WebGL is not available in this browser, so the 3D model cannot be drawn.</p>'; window.EXPLORE_APP = { ready: false, error: "webgl" }; return; }
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.localClippingEnabled = true; renderer.setClearColor(0x000000, 0);
host.insertBefore(renderer.domElement, host.firstChild);
const scene = new T.Scene(), cam = new T.PerspectiveCamera(30, 1, 1, 600);
scene.add(new T.HemisphereLight(0xfff4ee, 0x2a1416, 1.25)); const key = new T.DirectionalLight(0xffffff, 1.7); key.position.set(-30, 40, 60); scene.add(key);
const fill = new T.DirectionalLight(0xffe0d8, .55); fill.position.set(40, -10, -40); scene.add(fill); scene.add(new T.AmbientLight(0xffffff, .28));

/* ---------- heart frame → body frame ---------- */
const H2B = new T.Matrix4().fromArray(JM.frames.heartToBody);
const world = new T.Group(); world.matrixAutoUpdate = false; world.matrix.copy(H2B); scene.add(world);
const H2Brot = new T.Matrix3().setFromMatrix4(H2B);
const toWorldDir = v => v.clone().applyMatrix3(H2Brot).normalize();
const toWorld = v => v.clone().applyMatrix4(H2B);
const B2Hrot = H2Brot.clone().transpose(), fromBodyDir = a => new T.Vector3(...a).applyMatrix3(B2Hrot).normalize();

/* ---------- beat: one deformation for every heart object (same as the echo's 3D heart) ---------- */
const BEAT_SHAPE = { axialLift: 0.45, apexZ: 9.4, baseDepth: 7.0, radialSqueeze: 0.065 };
const beatU = { uSys: { value: 0 } };
function beatify(mat){ if (mat.clippingPlanes && mat.clippingPlanes.length) mat.clipIntersection = true; mat.onBeforeCompile = s => { s.uniforms.uSys = beatU.uSys;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uSys;").replace("#include <begin_vertex>", `#include <begin_vertex>
      { float w = smoothstep(-1.0, 1.5, transformed.z);
        transformed.xy *= 1.0 - ${BEAT_SHAPE.radialSqueeze}*uSys*w;
        float along = transformed.z >= 0.0 ? 1.0 - clamp(transformed.z/${BEAT_SHAPE.apexZ}, 0.0, 1.0) : clamp(1.0 + transformed.z/${BEAT_SHAPE.baseDepth.toFixed(1)}, 0.0, 1.0);
        transformed.z += ${BEAT_SHAPE.axialLift}*uSys*along; }`); };
  mat.customProgramCacheKey = () => "beat"; return mat; }
const sysCurve = t => { const s = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a)/(b - a))); return u*u*(3 - 2*u); }; return s(.03, .2, t)*(1 - s(.33, .5, t)); };

/* ---------- clip plane (Cut mode) ---------- */
const plane = new T.Plane(new T.Vector3(0, 0, 1), 1e5), plane2 = new T.Plane(new T.Vector3(0, 0, 1), 1e5), clips = [plane, plane2];
const planeNeg = new T.Plane(), plane2Neg = new T.Plane();          // caps: cap 1 only where plane 2 removes, and vice versa
const removed = p => plane.distanceToPoint(p) < -0.01 && plane2.distanceToPoint(p) < -0.01;

/* ---------- outer heart + coronaries ---------- */
const HM = HeartMesh.load(JM, T, { frame: "heart" });
const extRoot = HM.mesh.parent; extRoot.matrixAutoUpdate = true; extRoot.matrix.identity(); world.add(extRoot);
const extMat = beatify(new T.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: 0, side: T.FrontSide, clippingPlanes: clips }));
HM.mesh.material = extMat;
const artMat = beatify(new T.MeshStandardMaterial({ color: 0xc62a1e, roughness: .35, clippingPlanes: clips })), veinMat = beatify(new T.MeshStandardMaterial({ color: 0x4a3d86, roughness: .35, clippingPlanes: clips }));
HM.vessels.children.forEach(m => { m.material = m.userData.kind === "artery" ? artMat : veinMat; });
const extNames = JM.labelNames, extLab = HM.attr.label, extWall = HM.attr.wall, extAha = HM.attr.aha;

/* ---------- interior: tissue, valves ---------- */
const HI = HeartInterior.load(JI, T, { clippingPlanes: clips }); world.add(HI.group);
const intNames = JI.labelNames;
const tisMat = beatify(new T.MeshStandardMaterial({ vertexColors: true, roughness: .58, metalness: 0, side: T.DoubleSide, clippingPlanes: clips }));
/* endocardial relief (procedural, in the heart frame): trabeculae carneae in the ventricles (fine and dense toward the LV apex,
   coarse in the RV), pectinate ridges on the anterior RA and in the LAA (running off the crista terminalis), smooth LVOT, upper
   septum and LA body. Height → bump (screen-space derivatives) + darker crevices. Only on surfaces that face a cavity. */
const IDX = n => intNames.indexOf(n);
const crA = new T.Vector3(...JI.landmarks.crista_terminalis.points[0]), crB = new T.Vector3(...JI.landmarks.crista_terminalis.points[2]);
const CRDIR = crB.clone().sub(crA).normalize(), LAAAX = new T.Vector3(...JI.landmarks.laa_tip.p).sub(new T.Vector3(-1.1, -0.3, -2.25)).normalize();
const texU = { uRelief: { value: 1 } };
function texturize(mat){ const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = s2 => { prev(s2); s2.uniforms.uRelief = texU.uRelief;
    s2.vertexShader = s2.vertexShader.replace("#include <common>", "#include <common>\nattribute float aCavity; attribute float aLabel; varying vec3 vHP; varying float vCav; varying float vLab;")
      .replace("#include <project_vertex>", "vHP = transformed; vCav = aCavity; vLab = aLabel;\n#include <project_vertex>");
    const I = n => IDX(n).toFixed(1), v3 = v => `vec3(${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)})`;
    s2.fragmentShader = s2.fragmentShader.replace("#include <common>", `#include <common>
      varying vec3 vHP; varying float vCav; varying float vLab; uniform float uRelief;
      float hsh(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x + p.y + p.z)); }
      float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
        return mix(mix(mix(hsh(i), hsh(i + vec3(1,0,0)), f.x), mix(hsh(i + vec3(0,1,0)), hsh(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hsh(i + vec3(0,0,1)), hsh(i + vec3(1,0,1)), f.x), mix(hsh(i + vec3(0,1,1)), hsh(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float ridge(float s){ return pow(1.0 - abs(s), 3.0); }
      bool isC(float c, float id){ return abs(c - id) < 0.5; }
      float relief(vec3 p, float cav, float lab){
        if (cav < 0.5 || uRelief < 0.5) return 0.0;
        if (isC(cav, ${I("LV_cavity")})){                       /* LV: fine trabeculae, smooth base, LVOT and upper septum */
          float th = atan(p.y, p.x), w = smoothstep(2.2, 5.6, p.z);
          if (isC(lab, ${I("IVS")})) w *= smoothstep(4.2, 6.5, p.z);
          float warp = 2.2*vnoise(p*0.9) + 0.9*vnoise(p*2.3);
          float a = ridge(sin(th*22.0 + p.z*0.55 + warp)), b = ridge(sin(th*9.0 - p.z*1.7 + 1.3*warp))*0.55;
          return w*max(a, b); }
        if (isC(cav, ${I("RV_cavity")})){                       /* RV: coarse, oblique trabeculae in the inflow and apex */
          vec3 q = p - vec3(3.4, -0.2, 3.5); float th = atan(q.y, q.x), w = smoothstep(1.6, 4.2, p.z);
          float warp = 2.6*vnoise(p*0.7);
          return w*max(ridge(sin(th*11.0 + p.z*0.9 + warp)), 0.6*ridge(sin(dot(p, vec3(0.5, 0.7, 0.5))*4.0 + warp))); }
        if (isC(cav, ${I("LAA")})){                             /* LAA: dense pectinate ridges across its axis */
          float warp = 1.6*vnoise(p*1.4); return 0.9*ridge(sin(dot(p, ${v3(LAAAX)})*13.0 + warp)); }
        if (isC(cav, ${I("RA")}) && p.y < 0.9 && !isC(lab, ${I("IAS")})){   /* RA: pectinate ridges in front of the crista; sinus venarum (posterior) smooth */
          float w = smoothstep(0.9, -0.2, p.y) * smoothstep(2.4, 3.2, p.x);
          float warp = 1.4*vnoise(p*1.1); return w*ridge(sin(dot(p, ${v3(CRDIR)})*7.5 + warp)); }
        return 0.0; }
      vec3 perturbR(vec3 sp, vec3 sn, vec2 dH, float fd){ vec3 sx = dFdx(sp), sy = dFdy(sp), r1 = cross(sy, sn), r2 = cross(sn, sx);
        float det = dot(sx, r1)*fd; vec3 g = sign(det)*(dH.x*r1 + dH.y*r2); return normalize(abs(det)*sn - g); }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
      float rH = relief(vHP, vCav, vLab);
      if (vCav > 0.5) diffuseColor.rgb *= mix(0.78, 1.1, rH) * (0.96 + 0.08*vnoise(vHP*3.1));`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      if (vCav > 0.5){ float hh = rH*0.09; normal = perturbR(-vViewPosition, normal, vec2(dFdx(hh), dFdy(hh))*1.0, faceDirection); }`); };
  mat.customProgramCacheKey = () => "beat-relief"; return mat; }
texturize(tisMat);
HI.tissue.material = tisMat; HI.tissue.renderOrder = 2;
const valMat = beatify(new T.MeshStandardMaterial({ vertexColors: true, roughness: .42, side: T.DoubleSide, clippingPlanes: clips }));
HI.valves.children.forEach(m => { m.material = valMat; m.renderOrder = 2; });
/* stencil caps: the tissue surface is closed, so a plane is filled only where it cuts tissue (cavities stay open).
   Two planes (a view may remove only the region behind plane 1 AND beyond plane 2): one stencil group + cap per plane. */
const hex = h => { const c = new T.Color(h); return [c.r, c.g, c.b]; };
const PALRGB = {}; for (const k in D.PAL) PALRGB[k] = hex(D.PAL[k]);
const CAP_REAL = { myocardium: 0x8e2a24, fibrous: 0xe5d6bb, valve: 0xefe6d4, fat: 0xe2bb55, vessel_wall: 0xca8c7b };
const capData = JI.capVolume;
const capInk = { real: 0x8e2a24, labels: 0x9a4a46 };
const capPalettes = capData && Object.fromEntries(Object.keys(capInk).map(mode => [mode,
  new Float32Array(intNames.flatMap((name, i) => {
    const real = hex(CAP_REAL[capData.tissueByLabel[i]] ?? capInk.real);
    return mode === "labels" ? PALRGB[name] || real : real;
  }))]));
const capUniforms = capData && renderer.capabilities.isWebGL2 ? (() => {
  const [nx, ny, nz] = capData.n;
  const runs = atob(capData.rle), labels = new Uint8Array(nx * ny * nz);
  let offset = 0;
  for (let i = 0; i < runs.length; i += 2){
    const end = offset + runs.charCodeAt(i) + 1;
    labels.fill(runs.charCodeAt(i + 1), offset, end);
    offset = end;
  }
  const texture = new T.Data3DTexture(labels, nx, ny, nz);
  texture.format = T.RedFormat;
  texture.internalFormat = "R8";
  texture.minFilter = texture.magFilter = T.NearestFilter;
  texture.needsUpdate = true;
  return {
    uCapLabels: { value: texture },
    uCapPalette: { value: capPalettes.real },
    uCapLo: { value: new T.Vector3(...capData.lo) },
    uCapSize: { value: new T.Vector3(...capData.n).multiplyScalar(capData.v) },
    uBodyToHeart: { value: H2B.clone().invert() },
    uSys: beatU.uSys
  };
})() : null;
function stencilMat(side, pl){ const m = beatify(new T.MeshBasicMaterial({ depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: T.AlwaysStencilFunc, side, clippingPlanes: [pl] }));
  m.clipIntersection = false; const op = side === T.BackSide ? T.IncrementWrapStencilOp : T.DecrementWrapStencilOp; m.stencilFail = m.stencilZFail = m.stencilZPass = op; return m; }
function capMat(clipTo){
  const mat = new T.MeshStandardMaterial({ color: capInk.real, roughness: .75, stencilWrite: true, stencilRef: 0, stencilFunc: T.NotEqualStencilFunc,
    stencilFail: T.ReplaceStencilOp, stencilZFail: T.ReplaceStencilOp, stencilZPass: T.ReplaceStencilOp, clippingPlanes: [clipTo] });
  if (!capUniforms) return mat;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, capUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 uBodyToHeart;\nvarying vec3 vCapHeart;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vCapHeart = (uBodyToHeart * modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform highp sampler3D uCapLabels;
        uniform vec3 uCapPalette[${intNames.length}];
        uniform vec3 uCapLo, uCapSize;
        uniform float uSys;
        varying vec3 vCapHeart;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        // The cap plane stays fixed. Undo beatify's deformation to sample the rest-pose volume.
        vec3 p = vCapHeart;
        float lift = ${BEAT_SHAPE.axialLift} * uSys;
        float z = p.z - lift;
        p.z = z / (z >= 0.0 ? 1.0 - lift / ${BEAT_SHAPE.apexZ} : 1.0 + lift / ${BEAT_SHAPE.baseDepth.toFixed(1)});
        if (p.z < -${BEAT_SHAPE.baseDepth.toFixed(1)} || p.z > ${BEAT_SHAPE.apexZ}) p.z = vCapHeart.z;
        p.xy /= 1.0 - ${BEAT_SHAPE.radialSqueeze} * uSys * smoothstep(-1.0, 1.5, p.z);
        vec3 uvw = (p - uCapLo) / uCapSize;
        if (all(greaterThanEqual(uvw, vec3(0.0))) && all(lessThan(uvw, vec3(1.0)))) {
          int label = int(texture(uCapLabels, uvw).r * 255.0 + 0.5);
          if (label > 0 && label < ${intNames.length}) diffuseColor.rgb = uCapPalette[label];
        }`);
  };
  mat.customProgramCacheKey = () => "cap-volume";
  return mat;
}
const capGroups = [[plane, plane2Neg], [plane2, planeNeg]].map(([pl, clipTo], gi) => {
  const b = new T.Mesh(HI.tissue.geometry, stencilMat(T.BackSide, pl)), f = new T.Mesh(HI.tissue.geometry, stencilMat(T.FrontSide, pl));
  b.renderOrder = f.renderOrder = 1 + gi*.2; HI.group.add(b, f);
  const cap = new T.Mesh(new T.PlaneGeometry(80, 80), capMat(clipTo)); cap.renderOrder = 1.1 + gi*.2; cap.onAfterRender = r => r.clearStencil(); scene.add(cap);
  return { b, f, cap, pl, clipTo }; });
/* ---------- conduction system + teaching landmarks (from the phantom's landmarks) ---------- */
const condGroup = new T.Group();
// Record nearest tissue only AFTER X-ray colours have been composited. This keeps
// the existing transparent look while the two conduction passes classify depth.
const conductionDepthMat=beatify(new T.MeshBasicMaterial({transparent:true,colorWrite:false,depthWrite:true,depthTest:true,side:T.DoubleSide,clippingPlanes:clips}));
const conductionDepth=[HM.mesh,HI.tissue].map(source=>{const mesh=new T.Mesh(source.geometry,conductionDepthMat);mesh.renderOrder=9;mesh.visible=false;world.add(mesh);return mesh});
const lmGroup = new T.Group();
const koch = HI.landmarkObject(["koch_triangle"], { radius: .05, polygonColour: 0xffd34d }), cti = HI.landmarkObject(["cti"], { radius: .06, colour: 0xff7a3d });
const kochMat = beatify(new T.MeshBasicMaterial({ color: 0xffd34d, clippingPlanes: clips, transparent: true })), ctiMat = beatify(new T.MeshBasicMaterial({ color: 0xff7a3d, clippingPlanes: clips, transparent: true }));
koch.traverse(o => { if (o.isMesh){ o.material = kochMat; o.renderOrder = 6; } }); cti.traverse(o => { if (o.isMesh){ o.material = ctiMat; o.renderOrder = 6; } });
lmGroup.add(koch, cti); world.add(condGroup, lmGroup);

/* ---------- colours ---------- */
const noise = (x, y, z) => { const s = Math.sin(x*12.9898 + y*78.233 + z*37.719)*43758.5453; return s - Math.floor(s); };
const REAL_EXT = { 0: [.6, .38, .36], 1: [.6, .17, .15], 2: [.62, .2, .18], 3: [.55, .22, .3], 4: [.86, .66, .6], 5: [.88, .73, .44] };
const REAL_INT = name => /^(MV_|TV_|AV_|PV_|chordae)/.test(name) ? [.95, .9, .8] : /^(central_fibrous_body|membranous_septum|TV_annulus|todaro_tendon|eustachian_valve|thebesian_valve)$/.test(name) ? [.92, .86, .74]
  : /^(aortic|arch|PA_main|RPA|LPA)/.test(name) ? [.88, .7, .62] : name === "epicardial_fat" ? [.9, .76, .45] : /^(LA_wall|RA_wall|IAS|SVC|crista|pectinate|LAA)/.test(name) ? [.68, .3, .3] : [.66, .18, .16];
/* in label colours, groove fat and surface-vessel vertices take the colour of the nearest chamber wall (clean blocks); real colours keep the fat */
const extUnder = (() => { const P = HM.mesh.geometry.attributes.position, n = P.count, skip = new Set(["epicardial_fat", "LCA", "RCA", "cardiac_veins", ""].map(x => extNames.indexOf(x)));
  const out = Uint8Array.from(extLab), cell = .6, grid = new Map(), keyOf = (x, y, z) => `${Math.floor(x/cell)},${Math.floor(y/cell)},${Math.floor(z/cell)}`;
  for (let i = 0; i < n; i++) if (!skip.has(extLab[i])){ const k = keyOf(P.getX(i), P.getY(i), P.getZ(i)); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  for (let i = 0; i < n; i++){ if (!skip.has(extLab[i])) continue; const x = P.getX(i), y = P.getY(i), z = P.getZ(i), gx = Math.floor(x/cell), gy = Math.floor(y/cell), gz = Math.floor(z/cell); let best = -1, bd = 1e9;
    for (let r = 1; r <= 3 && best < 0; r++) for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++){ const L = grid.get(`${gx+a},${gy+b},${gz+c}`); if (!L) continue;
      for (const j of L){ const d = (P.getX(j)-x)**2 + (P.getY(j)-y)**2 + (P.getZ(j)-z)**2; if (d < bd){ bd = d; best = j; } } }
    if (best >= 0) out[i] = extLab[best]; }
  return out; })();
/* vertex neighbours (CSR) for colour smoothing: blends the tint borders over a few millimetres so colours look natural */
function adjacency(g){ const n = g.attributes.position.count, I = g.index.array, deg = new Uint32Array(n + 1);
  for (let i = 0; i < I.length; i++) deg[I[i] + 1] += 2;
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const nb = new Uint32Array(deg[n]), fillp = deg.slice(0, n);
  for (let t = 0; t < I.length; t += 3){ const a = I[t], b = I[t+1], c = I[t+2]; nb[fillp[a]++] = b; nb[fillp[a]++] = c; nb[fillp[b]++] = c; nb[fillp[b]++] = a; nb[fillp[c]++] = a; nb[fillp[c]++] = b; }
  return { start: deg, nb }; }
function smoothColours(g, iters){ if (!iters) return; const A = g.userData.adj || (g.userData.adj = adjacency(g)), c = g.attributes.color.array, n = c.length/3; let src = c, dst = new Float32Array(c.length);
  for (let it = 0; it < iters; it++){ for (let i = 0; i < n; i++){ const s0 = A.start[i], s1 = A.start[i+1]; let r = src[i*3]*2, gg = src[i*3+1]*2, b = src[i*3+2]*2, w = 2;
      for (let q = s0; q < s1; q++){ const j = A.nb[q]; r += src[j*3]; gg += src[j*3+1]; b += src[j*3+2]; w++; }
      dst[i*3] = r/w; dst[i*3+1] = gg/w; dst[i*3+2] = b/w; } [src, dst] = [dst, src]; }
  if (src !== c) c.set(src); }
function paintExt(mode){ const P = HM.mesh.geometry.attributes.position, c = HM.mesh.geometry.attributes.color.array;
  for (let i = 0; i < P.count; i++){ const nm = extNames[mode === "labels" ? extUnder[i] : extLab[i]] || ""; let col;
    if (mode === "labels"){ col = PALRGB[nm] || (extWall[i] === 1 ? PALRGB.PW : extWall[i] === 2 ? PALRGB.RV_free_wall : extWall[i] === 3 ? PALRGB.RA_wall : [.6, .6, .6]);
      if (extWall[i] === 5) col = col.map((v, k) => .45*v + .55*PALRGB.epicardial_fat[k]); }
    else { let b = REAL_EXT[extWall[i]] || REAL_EXT[0]; if (extWall[i] === 5){ const u = extNames[extUnder[i]], w = /RV|RVOT/.test(u) ? 2 : /LA|RA|SVC|IAS/.test(u) ? 3 : 1; b = b.map((v, k) => .5*v + .5*REAL_EXT[w][k]); }
      const n = .9 + .2*noise(P.getX(i)*.6, P.getY(i)*.6, P.getZ(i)*.6); col = b.map(v => v*n); }
    if (mode === "labels"){ const n = .93 + .14*noise(P.getX(i)*.6, P.getY(i)*.6, P.getZ(i)*.6); col = col.map(v => v*n); }
    c[i*3] = col[0]; c[i*3+1] = col[1]; c[i*3+2] = col[2]; }
  smoothColours(HM.mesh.geometry, mode === "labels" ? 7 : 2); HM.mesh.geometry.attributes.color.needsUpdate = true; }
function paintGeom(g, labels, mode, smooth = 0){ const c = g.attributes.color.array, P = g.attributes.position;
  for (let i = 0; i < labels.length; i++){ const nm = intNames[labels[i]] || "";
    let col = mode === "labels" ? (PALRGB[nm] || [.6, .6, .6]) : REAL_INT(nm);
    const n = .92 + .16*noise(P.getX(i)*.7, P.getY(i)*.7, P.getZ(i)*.7); col = col.map(v => v*n);
    c[i*3] = col[0]; c[i*3+1] = col[1]; c[i*3+2] = col[2]; }
  smoothColours(g, smooth); g.attributes.color.needsUpdate = true; }
function paint(mode){ paintExt(mode); paintGeom(HI.tissue.geometry, HI.tissue.geometry.attributes.aLabel.array, mode, mode === "labels" ? 5 : 2);
  HI.valves.children.forEach(m => paintGeom(m.geometry, m.userData.labels, mode));
  if (capUniforms) capUniforms.uCapPalette.value = capPalettes[mode];
  capGroups.forEach(g => g.cap.material.color.set(capInk[mode])); $(".legend").hidden = mode !== "labels"; }

/* ---------- cut views (heart frame; n points into the kept half; the camera looks from the removed side) ----------
   Dissection views are fixed, curated sections like an anatomy atlas: each shows structures that the outside view hides and lists
   what to find. Body sections (CT-style) can be slid through the heart. */
const BASE = new T.Vector3(0, 0, -1), ANT = new T.Vector3(0, -1, 0);
const NB = new T.Vector3(0.28, -0.22, -0.934).normalize(), VALVE_C = new T.Vector3(1.81, -1.2, 0.47);   // best plane through the four valve centres (toward the base)
const CUTS = {
  valves: { name: "Valves from above (atria removed)", group: "Dissection views", n: NB.clone().negate(), c: VALVE_C.clone().addScaledVector(NB, 1.1), up: ANT, zoom: .62, at: VALVE_C.clone(),
    about: "The atria and the great arteries are cut away just above the valves, and you look down on the base of the heart, as in the atlas view of the fibrous skeleton. The four valves sit side by side: pulmonary in front, aortic in the middle, mitral and tricuspid behind. The central fibrous body binds the mitral, tricuspid and aortic rings together.",
    find: ["PV_cusps", "AV_cusps.RCC", "AV_cusps.LCC", "AV_cusps.NCC", "MV_AML", "MV_PML", "TV_septal", "TV_anterior", "TV_posterior", "central_fibrous_body", "artery:RCA", "artery:LCx", "coronary_sinus"],
    layers: { valves: true, vessels: true, landmarks: true, chambers: false, conduction: false } },
  a4c: { name: "Four-chamber section", group: "Dissection views", n: new T.Vector3(0, 1, 0), c: new T.Vector3(1.5, 0.15, 2), up: BASE,
    about: "The classic long-axis section through all four chambers. Compare the thin RV wall with the thick LV, see the septa, and note that the tricuspid valve hinges a little closer to the apex than the mitral valve.",
    find: ["RA", "LA", "RV_cavity", "LV_cavity", "IAS", "fossa_ovalis", "IVS", "membranous_septum", "MV_AML", "TV_septal", "moderator_band", "papillary_muscles.PMPM", "av_node"],
    layers: { chambers: true, valves: true, landmarks: true, conduction: true, vessels: false } },
  lvOpen: { name: "Left heart opened (LV outflow)", group: "Dissection views", n: new T.Vector3().crossVectors(new T.Vector3(1.6, -1.3, -0.28), new T.Vector3(0, 0, 1)).normalize(), c: new T.Vector3(0.8, -0.6, 2), up: BASE,
    about: "A long-axis cut through the LA, the LV and the aortic valve. Follow blood from the LA through the mitral valve, then up the outflow tract past the anterior mitral leaflet (which is in fibrous continuity with the aortic valve) into the aorta. The chordae tie the leaflets to the two papillary muscles.",
    find: ["LA", "LV_cavity", "LVOT", "MV_AML", "MV_PML", "chordae", "papillary_muscles.ALPM", "papillary_muscles.PMPM", "AV_cusps.RCC", "AV_cusps.NCC", "IVS", "membranous_septum"],
    layers: { chambers: true, valves: true, landmarks: true, conduction: false, vessels: false } },
  rvOpen: { name: "Right ventricle opened", group: "Dissection views", n: new T.Vector3(-1, 0.55, 0).normalize(), c: new T.Vector3(3.6, -0.6, 3.2), up: BASE, zoom: .8, at: new T.Vector3(2.8, -0.6, 2.4),
    n2: NB.clone(), c2: VALVE_C.clone().addScaledVector(NB, 1.3),          /* only the front RV wall (and the RVOT front) below the valve plane */
    about: "The front wall of the RV is removed, so you look at the septal surface of the RV. Find the tricuspid leaflets, the moderator band crossing from the septum to the anterior papillary muscle (it carries the right bundle branch), the coarse trabeculae, and the smooth outflow tract leading up to the pulmonary valve.",
    find: ["RV_cavity", "TV_septal", "TV_anterior", "TV_posterior", "moderator_band", "RVOT", "PV_cusps", "IVS", "rbb"],
    layers: { chambers: true, valves: true, landmarks: true, conduction: true, vessels: false } },
  raOpen: { name: "Right atrium opened (Koch's triangle)", group: "Dissection views", n: new T.Vector3(-1, 0, 0), c: new T.Vector3(3.9, 0.8, -2.2), up: BASE, zoom: .7, at: new T.Vector3(2.6, 0.9, -1.4),
    n2: NB.clone().negate(), c2: VALVE_C.clone().addScaledVector(NB, -0.1),   /* only the lateral RA wall, above the valve plane */
    about: "The lateral RA wall is removed and you face the septal wall from the right. Find the fossa ovalis, the crista terminalis with the pectinate muscles in front of it, the openings of the SVC, IVC and coronary sinus, and Koch's triangle (CS ostium, tendon of Todaro, septal tricuspid hinge) with the AV node at its apex.",
    find: ["fossa_ovalis", "crista_terminalis", "pectinate_muscles", "SVC", "cs_ostium", "thebesian_valve", "eustachian_valve", "todaro_tendon", "koch_triangle", "av_node", "TV_septal", "cti"],
    layers: { chambers: false, valves: true, landmarks: true, conduction: true, vessels: true } },
  laOpen: { name: "Left atrium opened (from behind)", group: "Dissection views", n: new T.Vector3(0, -1, 0), c: new T.Vector3(-1.1, 0.7, -2.2), up: BASE, zoom: .66, at: new T.Vector3(-0.6, 0.2, -1.9),
    n2: NB.clone().negate(), c2: VALVE_C.clone().addScaledVector(NB, 0.15),   /* only the back wall of the atria, above the valve plane */
    about: "The back wall of the LA is removed. Find the four pulmonary vein openings (where AF triggers fire and where ablation isolates them), the narrow mouth of the left atrial appendage, the septum with the fossa ovalis from the left, and the mitral valve below.",
    find: ["pulmonary_veins", "LAA", "IAS", "fossa_ovalis", "MV_AML", "MV_PML", "LA"],
    layers: { chambers: true, valves: true, landmarks: true, conduction: false, vessels: true } },
  sax: { name: "Short axis (papillary muscles)", group: "Dissection views", n: new T.Vector3(0, 0, -1), c: new T.Vector3(0, 0, 4.2), up: ANT,
    about: "A cross-section of both ventricles seen from the apex, as in a short-axis echo. The round, thick LV holds two papillary muscles; the thin RV wraps around it like a crescent; the septum bulges into the RV.",
    find: ["LV_cavity", "RV_cavity", "IVS", "papillary_muscles.ALPM", "papillary_muscles.PMPM", "moderator_band"],
    layers: { chambers: true, valves: true, landmarks: true, conduction: false, vessels: false } },
  coronal:  { name: "Coronal", group: "Body sections (CT-style)", body: true, n: fromBodyDir([0, 0, -1]), c: new T.Vector3(1.5, 0, 1), up: fromBodyDir([0, 1, 0]),
    about: "A frontal slice as on a coronal CT, seen from the front. Slide it from front to back through the heart." },
  axial:    { name: "Axial", group: "Body sections (CT-style)", body: true, n: fromBodyDir([0, 1, 0]), c: new T.Vector3(1.5, 0, 1), up: fromBodyDir([0, 0, 1]),
    about: "A horizontal slice as on an axial CT, seen from the feet (the patient's right on the left of the screen). Slide it from top to bottom." },
  sagittal: { name: "Sagittal", group: "Body sections (CT-style)", body: true, n: fromBodyDir([-1, 0, 0]), c: new T.Vector3(1.5, 0, 1), up: fromBodyDir([0, 1, 0]),
    about: "A side slice as on a sagittal CT, seen from the patient's left. Slide it from right to left." } };

/* ---------- state ---------- */
const st = { mode: "ext", cut: "valves", off: 0, flip: 1, colour: "real", coronaries: true, beat: !reduced, speed: .5, t: 0,
  layers: { chambers: true, valves: true, vessels: true, conduction: false, landmarks: false }, sel: null };

/* ---------- camera: turntable around the body's head–foot axis (like a specimen on a turntable); surface follows the cursor ---------- */
HM.mesh.geometry.computeBoundingSphere();
const centre = toWorld(HM.mesh.geometry.boundingSphere.center.clone()), radius = HM.mesh.geometry.boundingSphere.radius;
const WUP = new T.Vector3(0, 1, 0), tgt = centre.clone(); let dist = radius*3.3, theta = 0;
/* turntable around the CURRENT VIEW'S up-axis (head-up for Front/Back/sides, anterior-up for Below/Above, the dissection's own up for
   cut views). The axis never changes while dragging, so the picture never rolls; the camera never sits on the axis, so it never sticks. */
const U = WUP.clone(), dirV = new T.Vector3(0, 0, 1);
const ZMIN = radius*1.15, ZMAX = radius*10;
function placeCam(){ cam.position.copy(tgt).addScaledVector(dirV, dist); cam.up.copy(U); cam.lookAt(tgt); cam.updateMatrixWorld(); labelsDirty = true; }
function lookFrom(dir, up){ dirV.copy(dir).normalize(); const u = (up || WUP).clone().normalize();
  if (Math.abs(u.dot(dirV)) > .97) u.copy(Math.abs(dirV.y) < .9 ? WUP : new T.Vector3(0, 0, 1));
  U.copy(u); theta = 0; placeCam(); dirty(); }
const VIEWS = { Front: [[0, 0, 1]], Back: [[0, 0, -1]], Left: [[1, 0, 0]], Right: [[-1, 0, 0]], Below: [[0, -1, 0], [0, 0, 1]], Above: [[0, 1, 0], [0, 0, 1]] };
function setView(name){ const [d, u] = VIEWS[name]; lookFrom(new T.Vector3(...d), u ? new T.Vector3(...u) : null); }
function faceCut(){ const C0 = CUTS[st.cut]; lookFrom(toWorldDir(C0.n).multiplyScalar(-st.flip), toWorldDir(C0.up)); }
function orbit(dx, dy){
  const yaw = -dx*.008; dirV.applyAxisAngle(U, yaw); theta += yaw;                     // drag right → heart turns right
  const right = new T.Vector3().crossVectors(U, dirV); if (right.lengthSq() > 1e-8){ right.normalize();
    const ang = Math.acos(Math.max(-1, Math.min(1, dirV.dot(U)))), next = Math.max(.06, Math.min(Math.PI - .06, ang - dy*.008));
    dirV.applyAxisAngle(right, next - ang).normalize(); }                              // drag down → heart tilts down (camera rises)
  placeCam(); }
const phiNow = () => Math.acos(Math.max(-1, Math.min(1, dirV.dot(U))));
function pan(dx, dy){ const h = 2*Math.tan(cam.fov*Math.PI/360)*dist/Math.max(1, host.clientHeight);
  const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  tgt.add(right.multiplyScalar(-dx*h)).add(up.multiplyScalar(dy*h)); placeCam(); }
function zoom(f){ dist = Math.max(ZMIN, Math.min(ZMAX, dist*f)); placeCam(); dirty(); }
const fitDist = () => radius*3.3*Math.max(1, 1.25/Math.max(.3, cam.aspect || 1));   // narrow (phone) views back off so the whole heart fits
function resetView(){ size(); tgt.copy(centre); dist = fitDist(); setView("Front"); }
const ptrs = new Map(); let gesture = null, lastTap = 0;
const cvs = renderer.domElement; host.style.touchAction = "none";
host.addEventListener("contextmenu", e => e.preventDefault());
host.addEventListener("pointerdown", e => { if (e.target.closest(".zoomctl")) return; host.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gesture = { moved: 0, panning: e.button === 2 || e.shiftKey || ptrs.size === 2, start: Date.now(), target: e.target }; if (ptrs.size === 2) gesture.pinch = pinchDist(); interacting(); });
function pinchDist(){ const p = [...ptrs.values()]; return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
host.addEventListener("pointermove", e => { const p = ptrs.get(e.pointerId); if (!p || !gesture) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  gesture.moved += Math.hypot(dx, dy);
  if (ptrs.size === 2){ const d = pinchDist(); if (gesture.pinch && d){ zoom(gesture.pinch/d); gesture.pinch = d; } pan(dx/2, dy/2); }
  else if (gesture.panning) pan(dx, dy); else orbit(dx, dy);
  interacting(); });
function endPtr(e){ if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
  if (gesture && ptrs.size === 0){ if (gesture.moved < 6 && Date.now() - gesture.start < 600){ const lab = gesture.target && gesture.target.closest && gesture.target.closest(".lab");
      if (lab) { if(lab.dataset.tap)conduction.select(lab.dataset.tap);else select(lab.dataset.id, null); }
      else { const now = Date.now(); rayAt(e.clientX,e.clientY);const network=conduction.pick(e.clientX,e.clientY,ray.ray);
        if(network){conduction.select(network.id);lastTap=0}else{if (now - lastTap < 320) focusAt(e.clientX, e.clientY); else tapAt(e.clientX, e.clientY); lastTap = now;} } } gesture = null; } }
host.addEventListener("pointerup", endPtr); host.addEventListener("pointercancel", endPtr);
host.addEventListener("wheel", e => { e.preventDefault(); zoom(1 + Math.sign(e.deltaY)*.1); interacting(); }, { passive: false });

/* ---------- modes ---------- */
function applyMode(){ const m = st.mode, cut = m === "cut", xr = m === "xray";
  extRoot.visible = !cut; HM.mesh.visible = !cut || false;
  extMat.transparent = xr || st.layers.conduction; extMat.opacity = xr ? .16 : st.layers.conduction ? .3 : 1; extMat.depthWrite = !xr; extMat.side = xr ? T.DoubleSide : T.FrontSide; HM.mesh.renderOrder = xr ? 8 : 0; extMat.needsUpdate = true;
  HM.vessels.visible = st.coronaries && st.layers.vessels !== null && (m === "ext" || xr);
  if (cut){ extRoot.visible = st.coronaries; HM.mesh.visible = false; HM.vessels.visible = st.coronaries; }
  HI.tissue.visible = cut || xr; tisMat.transparent = xr; tisMat.opacity = xr ? .22 : 1; tisMat.depthWrite = !xr; tisMat.needsUpdate = true;
  conductionDepth.forEach(mesh=>mesh.visible=xr&&st.layers.conduction);
  HI.valves.visible = (cut || xr) && st.layers.valves !== false;
  capGroups.forEach((g, i) => { g.b.visible = g.f.visible = g.cap.visible = cut && (i === 0 || !!CUTS[st.cut].n2); });
  const onTop = m === "ext";                                     // in External the conduction system is drawn over the surface (it lies inside)
  for (const mat of [kochMat, ctiMat]){ mat.depthTest = !onTop; mat.opacity = onTop ? .9 : 1; mat.needsUpdate = true; }
  condGroup.visible = false; lmGroup.visible = st.layers.landmarks;
  conduction.enable(st.layers.conduction);
  $('.bConduction').setAttribute('aria-pressed',st.layers.conduction);$('.bConduction .st').textContent=st.layers.conduction?'On':'Off';
  $('.conduction-panel').classList.toggle('enabled',st.layers.conduction);
  if (cut) applyCut(); else { plane.set(new T.Vector3(0, 0, 1), 1e5); plane2.copy(plane); }
  $$(".segMode button").forEach(b => b.setAttribute("aria-pressed", b.dataset.m === m)); $(".cutctl").hidden = !cut; $(".bFace").disabled = !cut;
  labelsDirty = true; dirty(); }
function applyCut(){ const C0 = CUTS[st.cut], nH = C0.n.clone().multiplyScalar(st.flip), pH = C0.c.clone().addScaledVector(C0.n, st.off);
  const nW = toWorldDir(nH), pW = toWorld(pH); plane.setFromNormalAndCoplanarPoint(nW, pW);
  if (C0.n2) plane2.setFromNormalAndCoplanarPoint(toWorldDir(C0.n2), toWorld(C0.c2)); else plane2.copy(plane);
  planeNeg.copy(plane).negate(); plane2Neg.copy(plane2).negate();
  for (const g of capGroups){ const n = g.pl.normal, p0 = n.clone().multiplyScalar(-g.pl.constant); g.cap.position.copy(p0).addScaledVector(n, -.002); g.cap.lookAt(p0.clone().sub(n)); }
  const rng = $(".rngOff"), lim = C0.body ? 5 : 1.5; if (+rng.max !== lim){ rng.min = -lim; rng.max = lim; }
  $(".depthLbl").textContent = C0.body ? "Slide through the heart" : "Fine-tune"; $(".bFlip").hidden = !C0.body; labelsDirty = true; dirty(); }
function chooseCut(k, fromUser){ st.cut = k; st.off = 0; st.flip = 1; $(".rngOff").value = 0; $(".selCut").value = k; const C0 = CUTS[k];
  if (C0.layers){ const {conduction:unused,...layers}=C0.layers; Object.assign(st.layers,layers); syncLayersUI(); }
  applyMode(); tgt.copy(C0.at ? toWorld(C0.at) : centre); dist = fitDist()*(C0.zoom || 1); faceCut(); if (fromUser !== false) showView(k); }
function showView(k){ const C0 = CUTS[k]; st.sel = null; marker.visible = false;
  panel.innerHTML = `<span class="eyebrow">${esc(C0.group)}</span><h2>${esc(C0.name)}</h2><p>${esc(C0.about)}</p>` +
    (C0.find ? `<div class="glabel">Find in this view (tap a name)</div><div class="chips">${C0.find.filter(id => anchors.some(a => a.id === id)).map(id => `<button class="chip" data-find="${esc(id)}">${esc(D.SHORT[id] || id)}</button>`).join("")}</div>` : "");
  panel.querySelectorAll("[data-find]").forEach(b => b.onclick = () => select(b.dataset.find, null)); window.__lastCard = C0.name; dirty(); }

/* ---------- labels: anchors per structure, de-cluttered, hidden when behind tissue or cut away ---------- */
function centroidAnchor(geom, labels, pred){ const P = geom.attributes.position, N = geom.attributes.normal; let sx = 0, sy = 0, sz = 0, n = 0;
  for (let i = 0; i < labels.length; i++) if (pred(labels[i], i)){ sx += P.getX(i); sy += P.getY(i); sz += P.getZ(i); n++; }
  if (!n) return null; const c = new T.Vector3(sx/n, sy/n, sz/n); let best = -1, bd = 1e9;
  for (let i = 0; i < labels.length; i++) if (pred(labels[i], i)){ const d = (P.getX(i)-c.x)**2 + (P.getY(i)-c.y)**2 + (P.getZ(i)-c.z)**2; if (d < bd){ bd = d; best = i; } }
  return { p: new T.Vector3(P.getX(best), P.getY(best), P.getZ(best)), nrm: N ? new T.Vector3(N.getX(best), N.getY(best), N.getZ(best)) : null, centroid: c, count: n }; }
const anchors = [];   // { id, layer, text, p (heart frame), nrm, where: 'ext'|'int'|'cav'|'valve'|'lm'|'vessel' }
(function buildAnchors(){
  const extOf = { RA: ["RA_wall", "RA"], RV_cavity: ["RV_free_wall"], LA: ["LA_wall", "LA"], LV_cavity: ["PW", "LV_myocardium"], LAA: ["LAA"], RVOT: ["RVOT"] };
  const tl = HI.tissue.geometry.attributes.aLabel.array, tc = HI.tissue.geometry.attributes.aCavity.array;
  for (const L of D.LAYERS) for (const id of L.ids){ const text = D.SHORT[id] || id;
    if (L.id === "chambers"){
      const ci = intNames.indexOf(id); if (ci > 0){ const a = centroidAnchor(HI.tissue.geometry, tc, c => c === ci); if (a) anchors.push({ id, layer: L.id, text, p: a.centroid, nrm: null, where: "cav" }); }
      const ex = (extOf[id] || []).map(n => extNames.indexOf(n)).filter(i => i > 0);
      if (ex.length){ const a = centroidAnchor(HM.mesh.geometry, extLab, l => ex.includes(l)); if (a && a.count > 30) anchors.push({ id, layer: L.id, text, p: a.p, nrm: a.nrm, where: "ext" }); }
      continue; }
    if (id.startsWith("artery:") || id.startsWith("vein:")){ const [kind, vid] = id.split(":"); const v = (kind === "artery" ? JM.vessels.arteries : JM.vessels.veins).find(x => x.id === vid);
      if (v){ const pts = v.points, k = Math.min(pts.length - 1, Math.round(pts.length*(vid === "LM" ? .5 : .35))), p = new T.Vector3(...pts[k]);
        const P = HM.mesh.geometry.attributes.position, N = HM.mesh.geometry.attributes.normal; let bi = 0, bd = 1e9;
        for (let i = 0; i < P.count; i++){ const d = (P.getX(i)-p.x)**2 + (P.getY(i)-p.y)**2 + (P.getZ(i)-p.z)**2; if (d < bd){ bd = d; bi = i; } }
        const nrm = new T.Vector3(N.getX(bi), N.getY(bi), N.getZ(bi)).normalize();
        anchors.push({ id, layer: L.id, text, p: p.clone().addScaledVector(nrm, .25), nrm, where: "vessel" }); } continue; }
    const lm = JI.landmarks[id];
    if (lm){ let p; if (lm.kind === "point") p = lm.p; else if (lm.points && Array.isArray(lm.points)) p = lm.points[Math.floor(lm.points.length/2)]; else continue;
      anchors.push({ id, layer: L.id, text, p: new T.Vector3(...p), nrm: null, where: "lm" }); continue; }
    const vi = HI.items.map(it => it.frames[0]).filter(Boolean).find(m => m.userData.labels.includes(intNames.indexOf(id)));
    if (vi){ const li = intNames.indexOf(id); const a = centroidAnchor(vi.geometry, vi.userData.labels, l => l === li); if (a) anchors.push({ id, layer: L.id, text, p: a.centroid, nrm: null, where: "valve" }); continue; }
    const ti = intNames.indexOf(id);
    if (ti > 0){ const a = centroidAnchor(HI.tissue.geometry, tl, l => l === ti); if (a) anchors.push({ id, layer: L.id, text, p: a.p, nrm: a.nrm, where: "int" }); }
    const ei = extNames.indexOf(id);
    if (ei > 0){ const a = centroidAnchor(HM.mesh.geometry, extLab, l => l === ei); if (a && a.count > 20) anchors.push({ id, layer: L.id, text, p: a.p, nrm: a.nrm, where: "ext" }); }
  }
  for (const a of anchors){ const el = document.createElement("button"); el.type = "button"; el.className = "lab lab-" + a.layer; el.textContent = a.text; el.dataset.id = a.id; el.hidden = true; if (a.nrm) a.nw = toWorldDir(a.nrm);
    labelLayer.appendChild(el); a.el = el; a.w = toWorld(a.p); }
})();
let labelsDirty = true, lastLabelCheck = 0;
const ray = new T.Raycaster();
function occluded(w, targets){ const d = cam.position.distanceTo(w); ray.set(cam.position, w.clone().sub(cam.position).normalize()); ray.far = d - .35;
  const hits = ray.intersectObjects(targets, false); return hits.some(h => !removed(h.point)); }
function updateLabelVisibility(){
  const m = st.mode, ext = m === "ext", cut = m === "cut", occT = ext ? [HM.mesh] : cut ? [HI.tissue, ...HI.valves.children.filter(v => v.visible)] : [];
  for (const a of anchors){ let show = a.layer !== "conduction" && !!st.layers[a.layer];
    if (show){ if (ext) show = a.where === "ext" || a.where === "vessel" || ((a.where === "lm") && a.layer === "conduction");
      else if (!cut) show = a.where !== "ext" && a.where !== "int" || a.layer === "landmarks"; }
    if (show && a.layer === "vessels" && a.where === "vessel" && !st.coronaries) show = false;
    if (show && cut && removed(a.w)) show = false;
    /* the "find" list curates the cut face only; outer-surface labels stay available so a turned cut (back of the 4C, side of the valve view) is labelled too */
    const surf = a.where === "ext" || a.where === "vessel";
    if (show && cut && !surf && CUTS[st.cut].find && !CUTS[st.cut].find.includes(a.id) && st.sel !== a.id) show = false;
    if (show && a.where === "vessel") show = a.nw.dot(cam.position.clone().sub(a.w).normalize()) > .12;   // vessels: the surface must face you
    if (show && occT.length && !(ext && (a.layer === "conduction" || a.where === "vessel"))) show = !occluded(a.w, occT);
    a.vis = show; }
  if (cut){ const inner = new Set(anchors.filter(a => a.vis && a.where !== "ext").map(a => a.id)); for (const a of anchors) if (a.vis && a.where === "ext" && inner.has(a.id)) a.vis = false; }   // one label per structure
  labelsDirty = false; lastLabelCheck = performance.now(); }
const PRIO = { chambers: 0, valves: 1, conduction: 2, vessels: 3, landmarks: 4 };
function placeLabels(){ const w = host.clientWidth, h = host.clientHeight, rect=host.getBoundingClientRect();
  const placed = st.layers.conduction?conduction.labels.map(l=>conduction.midpoint(l.id,true)).filter(p=>p.visible).map(p=>[p.x-rect.left-5,p.y-rect.top-5,p.x-rect.left+5,p.y-rect.top+5]):[];
  const list = anchors.filter(a => a.vis).map(a => { const v = a.w.clone().project(cam); return { a, x: (v.x*.5 + .5)*w, y: (-v.y*.5 + .5)*h, z: v.z }; })
    .filter(o => o.z < 1 && o.x > 4 && o.x < w - 4 && o.y > 4 && o.y < h - 4).sort((p, q) => (PRIO[p.a.layer] - PRIO[q.a.layer]) || (p.z - q.z));
  const shown = new Set();
  for (const o of list){ const bw = o.a.text.length*6.8 + 14, bh = 20, r = [o.x - bw/2, o.y - bh/2, o.x + bw/2, o.y + bh/2];
    if (placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue; placed.push(r); shown.add(o.a);
    const transform=`translate(${o.x.toFixed(1)}px,${o.y.toFixed(1)}px) translate(-50%,-50%)`;
    if(o.a.transform!==transform){o.a.el.style.transform=transform;o.a.transform=transform;} }
  for (const a of anchors){ const on = shown.has(a); if (a.el.hidden === on) a.el.hidden = !on; a.el.classList.toggle("sel", st.sel === a.id); } }

/* ---------- picking → structure id ---------- */
const marker = new T.Mesh(new T.SphereGeometry(.14, 16, 12), new T.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: .9 })); marker.renderOrder = 10; marker.visible = false; scene.add(marker);
function rayAt(x, y){ const r = cvs.getBoundingClientRect(); ray.far = Infinity; ray.setFromCamera(new T.Vector2((x - r.left)/r.width*2 - 1, -(y - r.top)/r.height*2 + 1), cam); }
const keep = h => !removed(h.point);
function capLabelAt(point){
  const p = point.clone().applyMatrix4(capUniforms.uBodyToHeart.value);
  // Match the cap shader: transform the hit back to the rest-pose bake.
  const { axialLift, apexZ, baseDepth, radialSqueeze } = BEAT_SHAPE;
  const lift = axialLift * beatU.uSys.value, z = p.z - lift;
  const restZ = z / (z >= 0 ? 1 - lift/apexZ : 1 + lift/baseDepth);
  if (restZ >= -baseDepth && restZ <= apexZ) p.z = restZ;
  const scale = 1 - radialSqueeze * beatU.uSys.value * T.MathUtils.smoothstep(p.z, -1, 1.5);
  const [x0, y0, z0] = capData.lo, v = capData.v;
  const x = Math.floor((p.x/scale - x0)/v), y = Math.floor((p.y/scale - y0)/v), k = Math.floor((p.z - z0)/v);
  const { data, width, height, depth } = capUniforms.uCapLabels.value.image;
  if (x < 0 || y < 0 || k < 0 || x >= width || y >= height || k >= depth) return null;
  const label = data[x + width*(y + height*k)];
  return label ? intNames[label] : null;
}
function pickCap(){
  if (!capUniforms) return null;
  let nearest = null;
  for (const { cap, clipTo } of capGroups){
    if (!cap.visible) continue;
    const hit = ray.intersectObject(cap, false)[0];
    if (!hit || clipTo.distanceToPoint(hit.point) < 0 || (nearest && nearest.distance <= hit.distance)) continue;
    const id = capLabelAt(hit.point);
    if (id) nearest = { id, point: hit.point, distance: hit.distance };
  }
  return nearest;
}
function pickAt(x, y){ rayAt(x, y); const m = st.mode;
  const capHit = m === "cut" ? pickCap() : null;
  const visibleHit = h => keep(h) && (!capHit || h.distance <= capHit.distance);
  if (condGroup.visible){ const hc = ray.intersectObjects(condGroup.children, false).find(visibleHit); if (hc && (m === "ext" || !nearerTissue(hc))) return { id: hc.object.userData.landmark, point: hc.point }; }
  if (lmGroup.visible){ const hl = ray.intersectObjects(lmGroup.children.flatMap(g => g.children), false).find(visibleHit); if (hl) return { id: hl.object.userData.landmark, point: hl.point }; }
  if (HM.vessels.visible){ const hv = ray.intersectObjects(HM.vessels.children, false).find(visibleHit), hs = m === "ext" ? ray.intersectObject(HM.mesh, false)[0] : null;
    if (hv && (!hs || hv.distance <= hs.distance + .05)) return vesselHit(hv); }
  if (m === "ext"){ const h = ray.intersectObject(HM.mesh, false)[0]; if (!h) return null; const i = h.face.a, nm = extNames[extLab[i]], a = extAha[i];
    if (a && D.AHA_WALL(a)) return { id: "wall:" + D.AHA_WALL(a), point: h.point, label: nm };
    if (nm === "RV_free_wall" || nm === "RVOT" && extWall[i] === 2) return { id: "wall:RV", point: h.point, label: nm };
    return { id: nm, point: h.point }; }
  const targets = [...HI.valves.children.filter(v => v.visible), HI.tissue];
  const h = ray.intersectObjects(targets, false).find(visibleHit); if (!h) return capHit;
  const g = h.object.geometry, i = h.face.a, nm = intNames[g.attributes.aLabel.array[i]], cv = g.attributes.aCavity ? intNames[g.attributes.aCavity.array[i]] : "";
  if (cv && /^(PW|LV_myocardium|RV_free_wall|LA_wall|RA_wall)$/.test(nm)) return { id: cv, point: h.point, label: nm };   // a tap on the endocardium opens its chamber
  return { id: nm, point: h.point }; }
function nearerTissue(hc){ const ht = ray.intersectObjects([HI.tissue], false).filter(keep)[0]; return st.mode === "cut" && ht && ht.distance < hc.distance - .2; }
function vesselHit(h){ const v = h.object.userData, pts = v.points; let bi = 0, bd = 1e9; const lp = h.object.worldToLocal(h.point.clone());
  pts.forEach((p, i) => { const d = (p[0]-lp.x)**2 + (p[1]-lp.y)**2 + (p[2]-lp.z)**2; if (d < bd){ bd = d; bi = i; } });
  return { id: (v.kind === "artery" ? "artery:" : "vein:") + v.id, t: bi/Math.max(1, pts.length - 1), point: h.point }; }
function tapAt(x, y){ rayAt(x,y);const c=conduction.pick(x,y,ray.ray);if(c){conduction.select(c.id);return "conduction:"+c.id} const r = pickAt(x, y); if (!r){ return null; } select(r.id, r); return r.id; }
function focusAt(x, y){ const r = pickAt(x, y); if (!r) return; tgt.copy(r.point); zoom(.8); }

/* ---------- cards ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const scName = k => (C.SC[k] && C.SC[k].name) || (SIM.EXTRA[k] && SIM.EXTRA[k].name) || (SIM.MIS[k] && SIM.MIS[k][2]) || k;
const chips = (keys, label = "Run in the pathology simulator") => keys.length ? `<div class="glabel">${label}</div><div class="chips">${keys.map(k => `<button class="chip" data-go="${esc(k)}">${esc(scName(k))} →</button>`).join("")}</div>` : "";
/* the site keeps its labs in a const (not on window): detect a page by its switcher tab */
const siteHas = k => { try { return window.parent !== window && !!window.parent.document.querySelector(`.tabs a[data-topic="${k}"]`); } catch (e) { return false; } };
function goSim(k){ try { if (siteHas("pathology")){ window.parent.location.hash = "#pathology/" + k; return true; } } catch (e) {} return false; }
function card(id, hit){
  if (!id) return startCard();
  if(id.startsWith('conduction:')){
    const tap=id.slice(11),key=CGRAPH.spec.display.pick.taps[tap],s=C.STRUCT[key];
    if(!s)return '<h2>'+esc(D.CONDUCTION_SHORT[tap]||tap)+'</h2><p>TODO(content)</p>';
    return '<span class="eyebrow">'+esc(s.tag)+'</span><h2>'+esc(D.CONDUCTION_SHORT[tap]||s.name)+'</h2><p>'+s.anat+'</p><table class="kv">'+
      s.phys.map(([k,v])=>'<tr><th>'+esc(k)+'</th><td>'+v+'</td></tr>').join('')+'</table><p class="small"><b>Blood supply.</b> '+esc(s.supply)+'</p>'+chips(s.sc);
  }
  if (id.startsWith("wall:")){ const w = id.slice(5), tr = C.TERR[w];
    return `<span class="eyebrow">Ventricular wall · coronary territory</span><h2>${esc(C.WALLNAME[w] || w)}</h2>
      ${tr ? `<table class="kv"><tr><th>Leads that face it</th><td>${esc(tr.leads)}</td></tr><tr><th>Reciprocal change</th><td>${esc(tr.recip)}</td></tr><tr><th>Usual culprit</th><td>${esc(tr.culprit)}</td></tr></table>` : ""}
      <p>${esc(C.MI_TEXT.mech)}</p>${chips([w], "Watch this infarct on the model and ECG")}`; }
  if (id.startsWith("artery:") || id.startsWith("vein:")){ const [kind, vid] = id.split(":"); const name = D.ART_NAME[vid] || vid;
    if (kind === "vein") return `<span class="eyebrow">Cardiac vein</span><h2>${esc(vid === "GCV" ? "Great cardiac vein" : vid === "MCV" ? "Middle cardiac vein" : vid === "SCV" ? "Small cardiac vein" : name)}</h2><p>Cardiac veins drain into the coronary sinus in the posterior AV groove, which opens into the right atrium.</p>`;
    const vk = D.VESSEL_KEY(vid, hit && hit.t != null ? hit.t : .3), V = vk && C.VESSEL[vk];
    return `<span class="eyebrow">Coronary artery</span><h2>${esc(name)}${vk && vk !== vid ? ` <small>(${esc(vk)})</small>` : ""}</h2>${V ? `<p>${esc(V.note)}</p>${V.cond ? `<p class="small">${esc(V.cond)}</p>` : ""}${chips([vk], "Occlude it in the simulator")}` : `<p>A branch of the ${vid === "SAN" ? "RCA (in about 60 %) that supplies the SA node" : vid === "AVN" ? "dominant artery (RCA here) that supplies the AV node at the crux" : "coronary tree"}.</p>`}`; }
  const cd = D.CARD[id];
  if (cd && cd[0] === "struct"){ const s = C.STRUCT[cd[1]];
    return `<span class="eyebrow">${esc(s.tag)}</span><h2>${esc(s.name)}</h2><p>${s.anat}</p><table class="kv">${s.phys.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}</table>
      <p class="small"><b>Blood supply.</b> ${esc(s.supply)}</p>${chips(s.sc, "Complications: run them in the pathology simulator")}`; }
  if (cd && cd[0] === "valve"){ const n = SIM.VALVENOTE[cd[1]], rel = { lvot: ["hocm"], laa: ["af"] }[cd[1]] || [];
    return `<span class="eyebrow">${cd[1] === "laa" || cd[1] === "lvot" ? "Chamber" : "Valve"}</span><h2>${esc(n.name)}</h2><p>${esc(n.note)}</p>${chips(rel)}`; }
  const nt = D.NOTE[id];
  if (nt) return `<span class="eyebrow">${esc(nt[1])}</span><h2>${esc(nt[0])}</h2><p>${esc(nt[2])}</p>${id === "cti" ? chips(["flutter"]) : id === "cs_ostium" ? chips(["avb1"]) : id === "pulmonary_veins" ? chips(["af"]) : id === "central_fibrous_body" || id === "membranous_septum" ? chips(["chbV"]) : ""}`;
  return `<span class="eyebrow">Structure</span><h2>${esc(D.SHORT[id] || id)}</h2>`; }
function startCard(){ return `<span class="eyebrow">Start here</span><h2>Explore the heart</h2>
  <p>Drag to rotate, right-drag or two fingers to move, scroll or pinch to zoom; double-tap a spot to centre on it. Tap any structure (or its label) to read about it here.</p>
  <p><b>External</b> shows the surface and the coronary arteries. <b>X-ray</b> turns the wall to glass so the valves and the conduction system show inside. <b>Cut</b> opens the heart along a body plane (coronal, axial, sagittal) or a cardiac plane (4-, 2-, 3-chamber, short axis); move the slider to slide the cut through the heart.</p>
  <p><b>Label colours</b> paint the heart by function: blue/purple for the right heart that carries deoxygenated blood, red for the left heart and aorta that carry oxygenated blood.</p>`; }
function select(id, hit){ if(!id?.startsWith("conduction:")&&conduction.state.selected){conduction.state.selected=null;conduction.update(conduction.state.ms)} st.sel = id; panel.innerHTML = card(id, hit); panel.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { if (!goSim(b.dataset.go)) b.classList.add("nogo"); });
  if (hit && hit.point){ marker.position.copy(hit.point); marker.visible = true; } else marker.visible = false;
  window.__lastCard = panel.querySelector("h2") ? panel.querySelector("h2").textContent : ""; dirty(); }

/* ---------- shared conduction / ECG clock ---------- */
let conductionReady=false;
function deform(p){const v=p.clone(),z=v.z,w=T.MathUtils.smoothstep(z,-1,1.5),u=beatU.uSys.value;
  v.x*=1-BEAT_SHAPE.radialSqueeze*u*w;v.y*=1-BEAT_SHAPE.radialSqueeze*u*w;
  v.z+=BEAT_SHAPE.axialLift*u*(z>=0?1-T.MathUtils.clamp(z/BEAT_SHAPE.apexZ,0,1):T.MathUtils.clamp(1+z/BEAT_SHAPE.baseDepth,0,1));return v;}
const conduction=CONDUCTION_VIEW.create({T,world,cam,host,labelLayer,beatify,clips,deform,removed,reduced,
  cycleMs:()=>60000/C.SC.normal.rh.rate,
  clocks:ms=>{const {a,v}=ecg.curEv(ecgContext.ev,ms+200);return {a:a?ms+200-a.t:-1e9,v:v?ms+200-v.t-(v.his||0):-1e9}},
  onSelect:id=>select('conduction:'+id,null),onChange:()=>{if(conductionReady){syncClock();dirty()}}});
Object.assign(window.CONDUCTION_VIEW,conduction);
ecg.LEGACY_TA=ECG.LEGACY_TIMING.TA_AVN;
const ecgStrip=CONDUCTION_VIEW.strip({root:$('.conduction-panel'),engine:ecg,getContext:()=>ecgContext,view:conduction});
function syncClock(){
  const ms=conduction.state.ms,rr=60000/C.SC.normal.rh.rate,v=ecg.curEv(ecgContext.ev,ms+200).v;
  if(st.beat){const ventricularTime=v?ms+200-v.t-v.on:ms-CGRAPH.constants.TA_AVN-conduction.state.mode.avDelay-ecg.ONSET.normal;
    st.t=((ventricularTime/rr)%1+1)%1;beatU.uSys.value=sysCurve(st.t);HI.setPhase(st.t);}
  conduction.update(ms);ecgStrip.draw(ms,false);
}
function conductionMode(mode){conduction.setMode(mode);const m=conduction.state.mode;
  ecgContext={ev:ecg.buildEvents({...C.SC.normal.rh,amode:m.atrial,vmode:m.ventricular,avAdd:m.avDelay-ecg.D0},{}),ST:null,pAmp:1};
  syncClock();dirty();return m;
}

/* ---------- toolbar ---------- */
const cutSel = $(".selCut"); let og = null;
for (const [k, c] of Object.entries(CUTS)){ if (!og || og.label !== c.group){ og = document.createElement("optgroup"); og.label = c.group; cutSel.appendChild(og); }
  const o = document.createElement("option"); o.value = k; o.textContent = c.name; og.appendChild(o); }
cutSel.value = st.cut;
cutSel.onchange = () => chooseCut(cutSel.value);
$(".rngOff").oninput = e => { st.off = +e.target.value; applyCut(); };
$(".bFlip").onclick = () => { st.flip *= -1; applyCut(); faceCut(); };
$(".bFace").onclick = () => faceCut();
$$(".segMode button").forEach(b => b.onclick = () => { const was = st.mode; st.mode = b.dataset.m; applyMode(); if (st.mode === "cut" && was !== "cut") chooseCut(st.cut); else if (was === "cut" && st.mode !== "cut") resetView(); });
$$(".segCol button").forEach(b => b.onclick = () => { st.colour = b.dataset.c; $$(".segCol button").forEach(x => x.setAttribute("aria-pressed", x === b)); paint(st.colour); dirty(); });
const layerBox = $(".layerList");
layerBox.innerHTML = D.LAYERS.map(L => `<label><input type="checkbox" data-layer="${L.id}" ${st.layers[L.id] ? "checked" : ""}><span class="sw sw-${L.id}"></span>${esc(L.name)}</label>`).join("") +
  `<div class="lrow"><button type="button" class="bAll">All</button><button type="button" class="bNone">None</button></div>`;
const syncLayersUI = () => { layerBox.querySelectorAll("[data-layer]").forEach(c => c.checked = !!st.layers[c.dataset.layer]); $(".layerCount").textContent = Object.values(st.layers).filter(Boolean).length + "/" + D.LAYERS.length; };
const syncLayers = () => { syncLayersUI(); applyMode(); };
layerBox.querySelectorAll("[data-layer]").forEach(c => c.onchange = () => { st.layers[c.dataset.layer] = c.checked; syncLayers(); });
$(".bAll").onclick = () => { for (const k in st.layers) st.layers[k] = true; syncLayers(); };
$(".bNone").onclick = () => { for (const k in st.layers) st.layers[k] = false; syncLayers(); };
const tog = (sel, get, set) => { const b = $(sel); const sync = () => { b.setAttribute("aria-pressed", get()); b.querySelector(".st").textContent = get() ? "On" : "Off"; }; b.onclick = () => { set(!get()); sync(); applyMode(); }; sync(); };
$('.bConduction').onclick=()=>{st.layers.conduction=!st.layers.conduction;syncLayers();};
tog(".bCor", () => st.coronaries, v => st.coronaries = v);
tog(".bBeat", () => st.beat, v => { st.beat = v; if (!v){ beatU.uSys.value = 0; HI.setPhase(0); } kick(); });
$$(".views button[data-v]").forEach(b => b.onclick = () => b.dataset.v === "Reset" ? resetView() : setView(b.dataset.v));
$(".bZin").onclick = () => zoom(1/1.25); $(".bZout").onclick = () => zoom(1.25); $(".bZreset").onclick = () => { if (st.mode === "cut") chooseCut(st.cut, false); else resetView(); };
$(".legend").innerHTML = D.LEGEND.map(([n, cs]) => `<span>${cs.map(c => `<i style="background:${c}"></i>`).join("")}${esc(n)}</span>`).join("");

/* ---------- render loop: runs only while shown; idles when nothing moves ---------- */
let shown = true, onScreen = true, viewerVisible=true,running = false, lastMove = 0, needs = true;
let frameCost={};
function dirty(){ needs = true; kick(); }
function interacting(){ lastMove = performance.now(); labelsDirty = true; dirty(); }
function active(){ return shown && onScreen && !document.hidden; }
function kick(){conduction.visibility(active()&&(st.beat||st.layers.conduction)); if (!running && active()){ running = true; requestAnimationFrame(loop); } }
function loop(now){ if (!active()){ running = false; return; }
  const start=performance.now();let rendered=0;
  if (conduction.state.playing && (st.beat || st.layers.conduction)){conduction.advance();syncClock();needs=true;}
  const clockEnd=performance.now();
  const relabel = labelsDirty && now - lastMove > 140 && now - lastLabelCheck > 120;
  if ((needs || relabel)&&viewerVisible){ size(); if (needs) renderer.render(scene, cam); needs = false;rendered=performance.now();
    if (relabel) updateLabelVisibility();
    placeLabels(); conduction.placeLabels(); }
  frameCost={clock:clockEnd-start,render:rendered?rendered-clockEnd:0,labels:rendered?performance.now()-rendered:0,calls:renderer.info.render.calls};
  if ((conduction.state.playing && (st.beat || st.layers.conduction)) || now - lastMove < 400 || labelsDirty) requestAnimationFrame(loop); else running = false; }
function size(){ const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; const c = renderer.domElement;
  if (c.width !== Math.round(w*renderer.getPixelRatio()) || c.height !== Math.round(h*renderer.getPixelRatio())){ renderer.setSize(w, h, false); c.style.width = w + "px"; c.style.height = h + "px"; cam.aspect = w/h; cam.updateProjectionMatrix(); } }
new ResizeObserver(() => dirty()).observe(host);
new IntersectionObserver(es=>{viewerVisible=es[0].isIntersecting;if(viewerVisible)dirty()}).observe(host);
new IntersectionObserver(es => { onScreen = es[0].isIntersecting; kick(); }, { rootMargin: "80px 0px" }).observe($("#explore"));
document.addEventListener("visibilitychange", kick);
window.addEventListener("message", e => { const d = e.data; if (!d || d.pun !== "lab") return; if (typeof d.visible === "boolean"){ shown = d.visible; kick(); } });

/* ---------- start ---------- */
conductionReady=true;
paint(st.colour); applyMode(); resetView(); select(null, null);syncLayersUI();ecgStrip.draw(conduction.state.ms,true);
$(".busy").hidden = true;
window.EXPLORE_APP = { ready: true, st, CUTS, anchors, setMode(m){ if(typeof m === "object")return conductionMode(m); const was = st.mode; st.mode = m; applyMode(); if (m === "cut" && was !== "cut") chooseCut(st.cut, false); }, setCut(k, off = 0, flip = 1){ chooseCut(k, true); st.off = off; st.flip = flip; $(".rngOff").value = off; applyCut(); faceCut(); },
  conduction(on){st.layers.conduction=!!on;syncLayers();},
  now:()=>conduction.now(),seek:ms=>conduction.seek(ms),tapStruct:id=>conduction.select(id),
  frameCost:()=>frameCost,
  playback:options=>conduction.playback(options),conductionMidpoint:id=>conduction.midpoint(id),
  conductionState:()=>({enabled:st.layers.conduction,...conduction.state,cacheSize:conduction.cacheSize(),rings:conduction.rings.filter(r=>r.userData.block).map(r=>r.userData.block),opacity:extMat.opacity}),
  ecgSample(lead,ms){return ecg.leadVal(ecg.vecAt(ecgContext,ms),lead)},
  setColour(c){ st.colour = c; paint(c); $$(".segCol button").forEach(x => x.setAttribute("aria-pressed", x.dataset.c === c)); dirty(); }, setLayer(k, on){ st.layers[k] = on; syncLayers(); },
  setView, resetView, setBeat(on, t){ st.beat = on; if (t != null){ st.t = t; beatU.uSys.value = sysCurve(t); HI.setPhase(t); } dirty(); },
  render(){ size(); updateLabelVisibility(); renderer.render(scene, cam); placeLabels(); conduction.placeLabels(); if(st.layers.conduction)ecgStrip.draw(conduction.state.ms,true); },
  visibleLabels: () => [...conduction.labels.filter(l=>!l.el.hidden).map(l=>{const r=l.el.getBoundingClientRect();return{id:'conduction:'+l.id,text:l.el.textContent,layer:'conduction',x:r.left+r.width/2,y:r.top+r.height/2}}),...anchors.filter(a => !a.el.hidden).map(a => { const r = a.el.getBoundingClientRect(); return { id: a.id, text: a.text, layer: a.layer, x: r.left + r.width/2, y: r.top + r.height/2 }; })],
  screenOf(idOrPoint){
    const a = Array.isArray(idOrPoint) ? null : anchors.find(x => x.id === idOrPoint && !x.el.hidden) || anchors.find(x => x.id === idOrPoint);
    const p = a ? a.w.clone() : Array.isArray(idOrPoint) ? toWorld(new T.Vector3(...idOrPoint)) : null;
    if (!p) return null;
    const v = p.project(cam), r = cvs.getBoundingClientRect();
    return [r.left + (v.x*.5 + .5)*r.width, r.top + (-v.y*.5 + .5)*r.height];
  },
  tapAt, select, card: () => window.__lastCard, camState: () => ({ theta, phi: phiNow(), dist, x: cam.position.x, y: cam.position.y, z: cam.position.z, up: [U.x, U.y, U.z] }), legacy: typeof window.H3 !== "undefined" };
})();
