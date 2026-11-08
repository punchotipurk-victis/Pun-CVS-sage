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
if (!T || !JM || !JI){ host.innerHTML = '<p class="fallback">The refined 3D heart opens from the Pun CVS Lab site (its data is stored in the site page). Open the site and choose 3D Heart.</p>'; window.EXPLORE_APP = { ready: false, error: "no data" }; return; }
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
const beatU = { uSys: { value: 0 } };
function beatify(mat){ mat.onBeforeCompile = s => { s.uniforms.uSys = beatU.uSys;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uSys;").replace("#include <begin_vertex>", `#include <begin_vertex>
      { float w = smoothstep(-1.0, 1.5, transformed.z);
        transformed.xy *= 1.0 - 0.065*uSys*w;
        float along = transformed.z >= 0.0 ? 1.0 - clamp(transformed.z/9.4, 0.0, 1.0) : clamp(1.0 + transformed.z/7.0, 0.0, 1.0);
        transformed.z += 0.45*uSys*along; }`); };
  mat.customProgramCacheKey = () => "beat"; return mat; }
const sysCurve = t => { const s = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a)/(b - a))); return u*u*(3 - 2*u); }; return s(.03, .2, t)*(1 - s(.33, .5, t)); };

/* ---------- clip plane (Cut mode) ---------- */
const plane = new T.Plane(new T.Vector3(0, 0, 1), 1e5), clips = [plane];

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
HI.tissue.material = tisMat; HI.tissue.renderOrder = 2;
const valMat = beatify(new T.MeshStandardMaterial({ vertexColors: true, roughness: .42, side: T.DoubleSide, clippingPlanes: clips }));
HI.valves.children.forEach(m => { m.material = valMat; m.renderOrder = 2; });
/* stencil cap: the tissue surface is closed, so the plane is filled only where it cuts tissue (cavities stay open) */
function stencilMat(side){ const m = beatify(new T.MeshBasicMaterial({ depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: T.AlwaysStencilFunc, side, clippingPlanes: clips }));
  const op = side === T.BackSide ? T.IncrementWrapStencilOp : T.DecrementWrapStencilOp; m.stencilFail = m.stencilZFail = m.stencilZPass = op; return m; }
const stB = new T.Mesh(HI.tissue.geometry, stencilMat(T.BackSide)), stF = new T.Mesh(HI.tissue.geometry, stencilMat(T.FrontSide));
stB.renderOrder = stF.renderOrder = 1; HI.group.add(stB, stF);
const capMat = new T.MeshStandardMaterial({ color: 0x8e2a24, roughness: .75, stencilWrite: true, stencilRef: 0, stencilFunc: T.NotEqualStencilFunc,
  stencilFail: T.ReplaceStencilOp, stencilZFail: T.ReplaceStencilOp, stencilZPass: T.ReplaceStencilOp });
const cap = new T.Mesh(new T.PlaneGeometry(80, 80), capMat); cap.renderOrder = 1.5; cap.onAfterRender = r => r.clearStencil(); scene.add(cap);

/* ---------- conduction system + teaching landmarks (from the phantom's landmarks) ---------- */
const COND_IDS = D.LAYERS.find(l => l.id === "conduction").ids;
const condGroup = HI.landmarkObject(COND_IDS, { radius: .075, colour: 0x22c3ab, pointRadius: .2 });
const condMat = beatify(new T.MeshStandardMaterial({ color: 0x22c3ab, emissive: 0x22c3ab, emissiveIntensity: .45, roughness: .35, clippingPlanes: clips, transparent: true }));
const nodeMat = beatify(new T.MeshStandardMaterial({ color: 0x35e0c4, emissive: 0x35e0c4, emissiveIntensity: .6, roughness: .3, clippingPlanes: clips, transparent: true }));
condGroup.traverse(o => { if (o.isMesh) { o.material = o.geometry.type === "SphereGeometry" ? nodeMat : condMat; o.renderOrder = 6; } });
const lmGroup = new T.Group();
const koch = HI.landmarkObject(["koch_triangle"], { radius: .05, polygonColour: 0xffd34d }), cti = HI.landmarkObject(["cti"], { radius: .06, colour: 0xff7a3d });
const kochMat = beatify(new T.MeshBasicMaterial({ color: 0xffd34d, clippingPlanes: clips, transparent: true })), ctiMat = beatify(new T.MeshBasicMaterial({ color: 0xff7a3d, clippingPlanes: clips, transparent: true }));
koch.traverse(o => { if (o.isMesh){ o.material = kochMat; o.renderOrder = 6; } }); cti.traverse(o => { if (o.isMesh){ o.material = ctiMat; o.renderOrder = 6; } });
lmGroup.add(koch, cti); world.add(condGroup, lmGroup);

/* ---------- colours ---------- */
const hex = h => { const c = new T.Color(h); return [c.r, c.g, c.b]; };
const PALRGB = {}; for (const k in D.PAL) PALRGB[k] = hex(D.PAL[k]);
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
function paintExt(mode){ const P = HM.mesh.geometry.attributes.position, c = HM.mesh.geometry.attributes.color.array;
  for (let i = 0; i < P.count; i++){ const nm = extNames[mode === "labels" ? extUnder[i] : extLab[i]] || ""; let col;
    if (mode === "labels") col = PALRGB[nm] || (extWall[i] === 1 ? PALRGB.PW : extWall[i] === 2 ? PALRGB.RV_free_wall : extWall[i] === 3 ? PALRGB.RA_wall : [.6, .6, .6]);
    else { let b = REAL_EXT[extWall[i]] || REAL_EXT[0]; if (extWall[i] === 5){ const u = extNames[extUnder[i]], w = /RV|RVOT/.test(u) ? 2 : /LA|RA|SVC|IAS/.test(u) ? 3 : 1; b = b.map((v, k) => .5*v + .5*REAL_EXT[w][k]); }
      const n = .9 + .2*noise(P.getX(i)*.6, P.getY(i)*.6, P.getZ(i)*.6); col = b.map(v => v*n); }
    c[i*3] = col[0]; c[i*3+1] = col[1]; c[i*3+2] = col[2]; }
  HM.mesh.geometry.attributes.color.needsUpdate = true; }
function paintGeom(g, labels, mode){ const c = g.attributes.color.array, P = g.attributes.position;
  for (let i = 0; i < labels.length; i++){ const nm = intNames[labels[i]] || "";
    let col = mode === "labels" ? (nm === "epicardial_fat" ? [.62, .5, .42] : PALRGB[nm] || [.6, .6, .6]) : REAL_INT(nm);
    if (mode !== "labels"){ const n = .92 + .16*noise(P.getX(i)*.7, P.getY(i)*.7, P.getZ(i)*.7); col = col.map(v => v*n); }
    c[i*3] = col[0]; c[i*3+1] = col[1]; c[i*3+2] = col[2]; }
  g.attributes.color.needsUpdate = true; }
function paint(mode){ paintExt(mode); paintGeom(HI.tissue.geometry, HI.tissue.geometry.attributes.aLabel.array, mode);
  HI.valves.children.forEach(m => paintGeom(m.geometry, m.userData.labels, mode));
  capMat.color.set(mode === "labels" ? 0x9a5a5a : 0x8e2a24); $(".legend").hidden = mode !== "labels"; }

/* ---------- cut planes (heart frame; n points into the kept half; camera on the removed side) ---------- */
const BASE = new T.Vector3(0, 0, -1), ANT = new T.Vector3(0, -1, 0);
const CUTS = {
  coronal:  { name: "Coronal", group: "Body planes", n: fromBodyDir([0, 0, -1]), c: new T.Vector3(1.5, 0, 1), up: fromBodyDir([0, 1, 0]) },
  axial:    { name: "Axial", group: "Body planes", n: fromBodyDir([0, 1, 0]), c: new T.Vector3(1.5, 0, 1), up: fromBodyDir([0, 0, 1]) },
  sagittal: { name: "Sagittal", group: "Body planes", n: fromBodyDir([-1, 0, 0]), c: new T.Vector3(1.5, 0, 1), up: fromBodyDir([0, 1, 0]) },
  a4c:      { name: "4-chamber", group: "Cardiac planes", n: new T.Vector3(0, 1, 0), c: new T.Vector3(1.5, 0.15, 2), up: BASE },
  a2c:      { name: "2-chamber", group: "Cardiac planes", n: new T.Vector3(-1, 0, 0), c: new T.Vector3(0, 0, 2), up: BASE },
  a3c:      { name: "3-chamber (LVOT)", group: "Cardiac planes", n: new T.Vector3().crossVectors(new T.Vector3(1.6, -1.3, -0.28), new T.Vector3(0, 0, 1)).normalize(), c: new T.Vector3(0.8, -0.6, 2), up: BASE },
  saxBase:  { name: "Short axis · base", group: "Cardiac planes", n: new T.Vector3(0, 0, -1), c: new T.Vector3(0.6, -0.4, 1.2), up: ANT },
  saxMid:   { name: "Short axis · mid", group: "Cardiac planes", n: new T.Vector3(0, 0, -1), c: new T.Vector3(0, 0, 4.2), up: ANT },
  saxApex:  { name: "Short axis · apex", group: "Cardiac planes", n: new T.Vector3(0, 0, -1), c: new T.Vector3(0, 0, 6.6), up: ANT } };

/* ---------- state ---------- */
const st = { mode: "ext", cut: "a4c", off: 0, flip: 1, colour: "real", coronaries: true, beat: !reduced, speed: .5, t: 0,
  layers: { chambers: true, valves: true, vessels: true, conduction: true, landmarks: false }, sel: null };

/* ---------- camera: own orbit / pan / zoom (no addons) ---------- */
HM.mesh.geometry.computeBoundingSphere();
const centre = toWorld(HM.mesh.geometry.boundingSphere.center.clone()), radius = HM.mesh.geometry.boundingSphere.radius;
const tgt = centre.clone(); let dist = radius*3.3;
const VIEWS = { Front: [[0, 0, 1], [0, 1, 0]], Back: [[0, 0, -1], [0, 1, 0]], Left: [[1, 0, 0], [0, 1, 0]], Right: [[-1, 0, 0], [0, 1, 0]], Below: [[0, -1, .01], [0, 0, 1]], Above: [[0, 1, .01], [0, 0, 1]] };
function setView(name){ const [d, u] = VIEWS[name]; cam.up.set(...u); cam.position.copy(tgt).add(new T.Vector3(...d).normalize().multiplyScalar(dist)); cam.lookAt(tgt); dirty(); }
function faceCut(){ const C0 = CUTS[st.cut]; const n = toWorldDir(C0.n).multiplyScalar(-st.flip); cam.up.copy(toWorldDir(C0.up)); cam.position.copy(tgt).addScaledVector(n, dist); cam.lookAt(tgt); dirty(); }
function orbit(dx, dy){ const off = cam.position.clone().sub(tgt), right = new T.Vector3().crossVectors(off, cam.up).normalize();
  const q = new T.Quaternion().setFromAxisAngle(cam.up.clone().normalize(), -dx*.007).multiply(new T.Quaternion().setFromAxisAngle(right, -dy*.007));
  off.applyQuaternion(q); cam.up.applyQuaternion(q).normalize(); cam.position.copy(tgt).add(off); cam.lookAt(tgt); }
function pan(dx, dy){ const h = 2*Math.tan(cam.fov*Math.PI/360)*cam.position.distanceTo(tgt)/host.clientHeight;
  const right = new T.Vector3().setFromMatrixColumn(cam.matrix, 0), up = new T.Vector3().setFromMatrixColumn(cam.matrix, 1);
  const m = right.multiplyScalar(-dx*h).add(up.multiplyScalar(dy*h)); tgt.add(m); cam.position.add(m); }
function zoom(f){ dist = Math.max(radius*.8, Math.min(radius*12, dist*f)); cam.position.copy(tgt).add(cam.position.clone().sub(tgt).setLength(dist)); }
const fitDist = () => radius*3.3*Math.max(1, 1.25/Math.max(.3, cam.aspect || 1));   // narrow (phone) views back off so the whole heart fits
function resetView(){ size(); tgt.copy(centre); dist = fitDist(); setView("Front"); }
const ptrs = new Map(); let gesture = null, lastTap = 0;
const cvs = renderer.domElement; cvs.style.touchAction = "none";
cvs.addEventListener("contextmenu", e => e.preventDefault());
cvs.addEventListener("pointerdown", e => { cvs.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gesture = { moved: 0, panning: e.button === 2 || e.shiftKey || ptrs.size === 2, start: Date.now() }; if (ptrs.size === 2) gesture.pinch = pinchDist(); interacting(); });
function pinchDist(){ const p = [...ptrs.values()]; return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
cvs.addEventListener("pointermove", e => { const p = ptrs.get(e.pointerId); if (!p || !gesture) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  gesture.moved += Math.hypot(dx, dy);
  if (ptrs.size === 2){ const d = pinchDist(); if (gesture.pinch && d){ zoom(gesture.pinch/d); gesture.pinch = d; } pan(dx/2, dy/2); }
  else if (gesture.panning) pan(dx, dy); else orbit(dx, dy);
  interacting(); });
function endPtr(e){ if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
  if (gesture && ptrs.size === 0){ if (gesture.moved < 6 && Date.now() - gesture.start < 600){ const now = Date.now();
      if (now - lastTap < 320) focusAt(e.clientX, e.clientY); else tapAt(e.clientX, e.clientY); lastTap = now; } gesture = null; } }
cvs.addEventListener("pointerup", endPtr); cvs.addEventListener("pointercancel", endPtr);
cvs.addEventListener("wheel", e => { e.preventDefault(); zoom(1 + Math.sign(e.deltaY)*.09); interacting(); }, { passive: false });

/* ---------- modes ---------- */
function applyMode(){ const m = st.mode, cut = m === "cut", xr = m === "xray";
  extRoot.visible = !cut; HM.mesh.visible = !cut || false;
  extMat.transparent = xr; extMat.opacity = xr ? .16 : 1; extMat.depthWrite = !xr; extMat.side = xr ? T.DoubleSide : T.FrontSide; HM.mesh.renderOrder = xr ? 8 : 0; extMat.needsUpdate = true;
  HM.vessels.visible = st.coronaries && st.layers.vessels !== null && (m === "ext" || xr);
  if (cut){ extRoot.visible = st.coronaries; HM.mesh.visible = false; HM.vessels.visible = st.coronaries; }
  HI.tissue.visible = cut || xr; tisMat.transparent = xr; tisMat.opacity = xr ? .22 : 1; tisMat.depthWrite = !xr; tisMat.needsUpdate = true;
  HI.valves.visible = (cut || xr) && st.layers.valves !== false;
  stB.visible = stF.visible = cap.visible = cut;
  const onTop = m === "ext";                                     // in External the conduction system is drawn over the surface (it lies inside)
  for (const mat of [condMat, nodeMat, kochMat, ctiMat]){ mat.depthTest = !onTop; mat.opacity = onTop ? .9 : 1; mat.needsUpdate = true; }
  condGroup.visible = st.layers.conduction; lmGroup.visible = st.layers.landmarks;
  if (cut) applyCut(); else plane.set(new T.Vector3(0, 0, 1), 1e5);
  $$(".segMode button").forEach(b => b.setAttribute("aria-pressed", b.dataset.m === m)); $(".cutctl").hidden = !cut; $(".bFace").disabled = !cut;
  labelsDirty = true; dirty(); }
function applyCut(){ const C0 = CUTS[st.cut], nH = C0.n.clone().multiplyScalar(st.flip), pH = C0.c.clone().addScaledVector(C0.n, st.off);
  const nW = toWorldDir(nH), pW = toWorld(pH); plane.setFromNormalAndCoplanarPoint(nW, pW);
  cap.position.copy(pW).addScaledVector(nW, -.002); cap.lookAt(pW.clone().sub(nW)); $(".cutName").textContent = C0.name; labelsDirty = true; dirty(); }

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
      if (v){ const pts = v.points, k = Math.min(pts.length - 1, Math.round(pts.length*(vid === "LM" ? .5 : .35))); anchors.push({ id, layer: L.id, text, p: new T.Vector3(...pts[k]), nrm: null, where: "vessel" }); } continue; }
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
  for (const a of anchors){ const el = document.createElement("button"); el.type = "button"; el.className = "lab lab-" + a.layer; el.textContent = a.text; el.dataset.id = a.id; el.hidden = true;
    el.addEventListener("click", ev => { ev.stopPropagation(); select(a.id, null); }); labelLayer.appendChild(el); a.el = el; a.w = toWorld(a.p); }
})();
let labelsDirty = true, lastLabelCheck = 0;
const ray = new T.Raycaster();
function occluded(w, targets){ const d = cam.position.distanceTo(w); ray.set(cam.position, w.clone().sub(cam.position).normalize()); ray.far = d - .35;
  const hits = ray.intersectObjects(targets, false); return hits.some(h => plane.distanceToPoint(h.point) >= -0.01); }
function updateLabelVisibility(){
  const m = st.mode, ext = m === "ext", cut = m === "cut", occT = ext ? [HM.mesh] : cut ? [HI.tissue, ...HI.valves.children.filter(v => v.visible)] : [];
  for (const a of anchors){ let show = !!st.layers[a.layer];
    if (show){ if (ext) show = a.where === "ext" || a.where === "vessel" || ((a.where === "lm") && a.layer === "conduction");
      else if (cut) show = a.where !== "ext";
      else show = a.where !== "ext" && a.where !== "int" || a.layer === "landmarks"; }
    if (show && a.layer === "vessels" && a.where === "vessel" && !st.coronaries) show = false;
    if (show && cut && plane.distanceToPoint(a.w) < -0.05) show = false;
    if (show && occT.length && !(ext && a.layer === "conduction")) show = !occluded(a.w, occT);
    a.vis = show; }
  labelsDirty = false; lastLabelCheck = performance.now(); }
const PRIO = { chambers: 0, valves: 1, conduction: 2, vessels: 3, landmarks: 4 };
function placeLabels(){ const w = host.clientWidth, h = host.clientHeight, placed = [];
  const list = anchors.filter(a => a.vis).map(a => { const v = a.w.clone().project(cam); return { a, x: (v.x*.5 + .5)*w, y: (-v.y*.5 + .5)*h, z: v.z }; })
    .filter(o => o.z < 1 && o.x > 4 && o.x < w - 4 && o.y > 4 && o.y < h - 4).sort((p, q) => (PRIO[p.a.layer] - PRIO[q.a.layer]) || (p.z - q.z));
  const shown = new Set();
  for (const o of list){ const bw = o.a.text.length*6.8 + 14, bh = 20, r = [o.x - bw/2, o.y - bh/2, o.x + bw/2, o.y + bh/2];
    if (placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue; placed.push(r); shown.add(o.a);
    o.a.el.style.transform = `translate(${o.x.toFixed(1)}px,${o.y.toFixed(1)}px) translate(-50%,-50%)`; }
  for (const a of anchors){ const on = shown.has(a); if (a.el.hidden === on) a.el.hidden = !on; a.el.classList.toggle("sel", st.sel === a.id); } }

/* ---------- picking → structure id ---------- */
const marker = new T.Mesh(new T.SphereGeometry(.14, 16, 12), new T.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: .9 })); marker.renderOrder = 10; marker.visible = false; scene.add(marker);
function rayAt(x, y){ const r = cvs.getBoundingClientRect(); ray.far = Infinity; ray.setFromCamera(new T.Vector2((x - r.left)/r.width*2 - 1, -(y - r.top)/r.height*2 + 1), cam); }
const keep = h => plane.distanceToPoint(h.point) >= -0.01;
function pickAt(x, y){ rayAt(x, y); const m = st.mode;
  if (condGroup.visible){ const hc = ray.intersectObjects(condGroup.children, false).filter(keep)[0]; if (hc && (m === "ext" || !nearerTissue(hc))) return { id: hc.object.userData.landmark, point: hc.point }; }
  if (lmGroup.visible){ const hl = ray.intersectObjects(lmGroup.children.flatMap(g => g.children), false).filter(keep)[0]; if (hl) return { id: hl.object.userData.landmark, point: hl.point }; }
  if (HM.vessels.visible){ const hv = ray.intersectObjects(HM.vessels.children, false).filter(keep)[0], hs = m === "ext" ? ray.intersectObject(HM.mesh, false)[0] : null;
    if (hv && (!hs || hv.distance <= hs.distance + .05)) return vesselHit(hv); }
  if (m === "ext"){ const h = ray.intersectObject(HM.mesh, false)[0]; if (!h) return null; const i = h.face.a, nm = extNames[extLab[i]], a = extAha[i];
    if (a && D.AHA_WALL(a)) return { id: "wall:" + D.AHA_WALL(a), point: h.point, label: nm };
    if (nm === "RV_free_wall" || nm === "RVOT" && extWall[i] === 2) return { id: "wall:RV", point: h.point, label: nm };
    return { id: nm, point: h.point }; }
  const targets = [...HI.valves.children.filter(v => v.visible), HI.tissue];
  const h = ray.intersectObjects(targets, false).filter(keep)[0]; if (!h) return null;
  const g = h.object.geometry, i = h.face.a, nm = intNames[g.attributes.aLabel.array[i]], cv = g.attributes.aCavity ? intNames[g.attributes.aCavity.array[i]] : "";
  if (cv && /^(PW|LV_myocardium|RV_free_wall|LA_wall|RA_wall)$/.test(nm)) return { id: cv, point: h.point, label: nm };   // a tap on the endocardium opens its chamber
  return { id: nm, point: h.point }; }
function nearerTissue(hc){ const ht = ray.intersectObjects([HI.tissue], false).filter(keep)[0]; return st.mode === "cut" && ht && ht.distance < hc.distance - .2; }
function vesselHit(h){ const v = h.object.userData, pts = v.points; let bi = 0, bd = 1e9; const lp = h.object.worldToLocal(h.point.clone());
  pts.forEach((p, i) => { const d = (p[0]-lp.x)**2 + (p[1]-lp.y)**2 + (p[2]-lp.z)**2; if (d < bd){ bd = d; bi = i; } });
  return { id: (v.kind === "artery" ? "artery:" : "vein:") + v.id, t: bi/Math.max(1, pts.length - 1), point: h.point }; }
function tapAt(x, y){ const r = pickAt(x, y); if (!r){ return null; } select(r.id, r); return r.id; }
function focusAt(x, y){ const r = pickAt(x, y); if (!r) return; const d = r.point.clone().sub(tgt); tgt.add(d); cam.position.add(d); zoom(.8); dirty(); }

/* ---------- cards ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const scName = k => (C.SC[k] && C.SC[k].name) || (SIM.EXTRA[k] && SIM.EXTRA[k].name) || (SIM.MIS[k] && SIM.MIS[k][2]) || k;
const chips = (keys, label = "Run in the pathology simulator") => keys.length ? `<div class="glabel">${label}</div><div class="chips">${keys.map(k => `<button class="chip" data-go="${esc(k)}">${esc(scName(k))} →</button>`).join("")}</div>` : "";
/* the site keeps its labs in a const (not on window): detect a page by its switcher tab */
const siteHas = k => { try { return window.parent !== window && !!window.parent.document.querySelector(`.tabs a[data-topic="${k}"]`); } catch (e) { return false; } };
function goSim(k){ try { if (siteHas("pathology")){ window.parent.location.hash = "#pathology/" + k; return true; } } catch (e) {} return false; }
function card(id, hit){
  if (!id) return startCard();
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
function select(id, hit){ st.sel = id; panel.innerHTML = card(id, hit); panel.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { if (!goSim(b.dataset.go)) b.classList.add("nogo"); });
  if (hit && hit.point){ marker.position.copy(hit.point); marker.visible = true; } else marker.visible = false;
  window.__lastCard = panel.querySelector("h2") ? panel.querySelector("h2").textContent : ""; dirty(); }

/* ---------- toolbar ---------- */
const cutSel = $(".selCut"); let og = null;
for (const [k, c] of Object.entries(CUTS)){ if (!og || og.label !== c.group){ og = document.createElement("optgroup"); og.label = c.group; cutSel.appendChild(og); }
  const o = document.createElement("option"); o.value = k; o.textContent = c.name; og.appendChild(o); }
cutSel.value = st.cut;
cutSel.onchange = () => { st.cut = cutSel.value; st.off = 0; $(".rngOff").value = 0; applyCut(); faceCut(); };
$(".rngOff").oninput = e => { st.off = +e.target.value; applyCut(); };
$(".bFlip").onclick = () => { st.flip *= -1; applyCut(); faceCut(); };
$(".bFace").onclick = () => faceCut();
$$(".segMode button").forEach(b => b.onclick = () => { const was = st.mode; st.mode = b.dataset.m; applyMode(); if (st.mode === "cut" && was !== "cut") faceCut(); });
$$(".segCol button").forEach(b => b.onclick = () => { st.colour = b.dataset.c; $$(".segCol button").forEach(x => x.setAttribute("aria-pressed", x === b)); paint(st.colour); dirty(); });
const layerBox = $(".layerList");
layerBox.innerHTML = D.LAYERS.map(L => `<label><input type="checkbox" data-layer="${L.id}" ${st.layers[L.id] ? "checked" : ""}><span class="sw sw-${L.id}"></span>${esc(L.name)}</label>`).join("") +
  `<div class="lrow"><button type="button" class="bAll">All</button><button type="button" class="bNone">None</button></div>`;
const syncLayers = () => { layerBox.querySelectorAll("[data-layer]").forEach(c => c.checked = !!st.layers[c.dataset.layer]); $(".layerCount").textContent = Object.values(st.layers).filter(Boolean).length + "/" + D.LAYERS.length; applyMode(); };
layerBox.querySelectorAll("[data-layer]").forEach(c => c.onchange = () => { st.layers[c.dataset.layer] = c.checked; syncLayers(); });
$(".bAll").onclick = () => { for (const k in st.layers) st.layers[k] = true; syncLayers(); };
$(".bNone").onclick = () => { for (const k in st.layers) st.layers[k] = false; syncLayers(); };
const tog = (sel, get, set) => { const b = $(sel); const sync = () => { b.setAttribute("aria-pressed", get()); b.querySelector(".st").textContent = get() ? "On" : "Off"; }; b.onclick = () => { set(!get()); sync(); applyMode(); }; sync(); };
tog(".bCor", () => st.coronaries, v => st.coronaries = v);
tog(".bBeat", () => st.beat, v => { st.beat = v; if (!v){ beatU.uSys.value = 0; HI.setPhase(0); } kick(); });
$$(".views button").forEach(b => b.onclick = () => b.dataset.v === "Reset" ? resetView() : setView(b.dataset.v));
$(".legend").innerHTML = D.LEGEND.map(([n, cs]) => `<span>${cs.map(c => `<i style="background:${c}"></i>`).join("")}${esc(n)}</span>`).join("");

/* ---------- render loop: runs only while shown; idles when nothing moves ---------- */
let shown = true, onScreen = true, running = false, lastNow = 0, lastMove = 0, needs = true;
function dirty(){ needs = true; kick(); }
function interacting(){ lastMove = performance.now(); labelsDirty = true; dirty(); }
function active(){ return shown && onScreen && !document.hidden; }
function kick(){ if (!running && active()){ running = true; lastNow = 0; requestAnimationFrame(loop); } }
function loop(now){ if (!active()){ running = false; return; }
  const dt = lastNow ? Math.min(.1, (now - lastNow)/1000) : 0; lastNow = now;
  if (st.beat){ st.t = (st.t + dt*st.speed) % 1; beatU.uSys.value = sysCurve(st.t); HI.setPhase(st.t); needs = true; }
  if (needs){ size(); renderer.render(scene, cam); needs = false;
    if (labelsDirty && now - lastMove > 140 && now - lastLabelCheck > 120) updateLabelVisibility();
    placeLabels(); }
  if (st.beat || now - lastMove < 400 || labelsDirty) requestAnimationFrame(loop); else running = false; }
function size(){ const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; const c = renderer.domElement;
  if (c.width !== Math.round(w*renderer.getPixelRatio()) || c.height !== Math.round(h*renderer.getPixelRatio())){ renderer.setSize(w, h, false); c.style.width = w + "px"; c.style.height = h + "px"; cam.aspect = w/h; cam.updateProjectionMatrix(); } }
new ResizeObserver(() => dirty()).observe(host);
new IntersectionObserver(es => { onScreen = es[0].isIntersecting; kick(); }, { rootMargin: "80px 0px" }).observe(host);
document.addEventListener("visibilitychange", kick);
window.addEventListener("message", e => { const d = e.data; if (!d || d.pun !== "lab") return; if (typeof d.visible === "boolean"){ shown = d.visible; kick(); } });

/* ---------- start ---------- */
paint(st.colour); applyMode(); resetView(); select(null, null);
$(".busy").hidden = true;
window.EXPLORE_APP = { ready: true, st, CUTS, anchors, setMode(m){ st.mode = m; applyMode(); if (m === "cut") faceCut(); }, setCut(k, off = 0, flip = 1){ st.cut = k; st.off = off; st.flip = flip; cutSel.value = k; applyCut(); faceCut(); },
  setColour(c){ st.colour = c; paint(c); $$(".segCol button").forEach(x => x.setAttribute("aria-pressed", x.dataset.c === c)); dirty(); }, setLayer(k, on){ st.layers[k] = on; syncLayers(); },
  setView, resetView, setBeat(on, t){ st.beat = on; if (t != null){ st.t = t; beatU.uSys.value = sysCurve(t); HI.setPhase(t); } dirty(); },
  render(){ size(); updateLabelVisibility(); renderer.render(scene, cam); placeLabels(); },
  visibleLabels: () => anchors.filter(a => !a.el.hidden).map(a => { const r = a.el.getBoundingClientRect(); return { id: a.id, text: a.text, layer: a.layer, x: r.left + r.width/2, y: r.top + r.height/2 }; }),
  screenOf(id){ const a = anchors.find(x => x.id === id && !x.el.hidden) || anchors.find(x => x.id === id); if (!a) return null; const v = a.w.clone().project(cam), r = cvs.getBoundingClientRect(); return [r.left + (v.x*.5 + .5)*r.width, r.top + (-v.y*.5 + .5)*r.height]; },
  tapAt, select, card: () => window.__lastCard, legacy: typeof window.H3 !== "undefined" };
})();
