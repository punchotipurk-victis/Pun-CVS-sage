/* ===== ANATOMY INSET: Torso map + Heart cutaway, same scene graph, swap-to-expand =====
   Pane containers are plain DOM; their rects are read every frame, so the viewports follow the CSS swap animation.
   The collapsed pane renders into a render target at 18 fps and is blitted every frame (other viewports draw over it otherwise). */
function makeInset(APP, S){
  const T = THREE, $ = id => document.getElementById(id), { renderer, ph, VJ } = APP, E = ph.extracardiac_patient;
  const store = { get(k){ try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v){ try { localStorage.setItem(k, v); } catch (e) {} } };
  const st = { big: store.get("echoInsetBig") === "map" ? "map" : "cut", minimised: false, large: false, section: true, preset: "follow",
               ribs: true, lungs: false, liver: true, free: { yaw: .5, pitch: .1, dist: 44 } };
  const panes = { cut: $("paneCut"), map: $("paneMap") }, inset = $("inset");
  function applyClasses(){
    panes.cut.classList.toggle("big", st.big === "cut"); panes.cut.classList.toggle("small", st.big !== "cut");
    panes.map.classList.toggle("big", st.big === "map"); panes.map.classList.toggle("small", st.big !== "map");
    inset.classList.toggle("min", st.minimised); inset.classList.toggle("large", st.large);
    $("insetMin").setAttribute("aria-pressed", st.minimised); $("insetMin").textContent = st.minimised ? "▢" : "–";
    $("insetSize").setAttribute("aria-pressed", st.large);
    $("swapCut").hidden = st.big === "cut"; $("swapMap").hidden = st.big === "map";
    $("cutCtl").hidden = st.big !== "cut";
  }
  const swap = () => { st.big = st.big === "cut" ? "map" : "cut"; store.set("echoInsetBig", st.big); applyClasses(); };
  for (const [k, p] of Object.entries(panes)) p.addEventListener("click", () => { if (st.big !== k && !APP.paneDragged) swap(); });
  $("insetMin").onclick = () => { st.minimised = !st.minimised; applyClasses(); };
  $("insetSize").onclick = () => { st.large = !st.large; applyClasses(); };
  $("cutSection").onclick = () => { st.section = !st.section; $("cutSection").textContent = st.section ? "Section" : "Whole"; $("cutSection").setAttribute("aria-pressed", st.section); };
  $("cutPreset").onchange = e => { st.preset = e.target.value; };
  for (const k of ["ribs", "lungs", "liver"]){ const b = $("cut_" + k); b.setAttribute("aria-pressed", st[k]); b.onclick = () => { st[k] = !st[k]; b.setAttribute("aria-pressed", st[k]); }; }

  /* free orbit: dragging the big cutaway switches to Free; wheel zooms */
  { const el = panes.cut; let d = null;
    el.addEventListener("pointerdown", e => { if (st.big !== "cut") return; d = { x: e.clientX, y: e.clientY, moved: 0 }; try { el.setPointerCapture(e.pointerId); } catch (_) {} });
    el.addEventListener("pointermove", e => { if (!d) return; const dx = e.clientX-d.x, dy = e.clientY-d.y; d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx)+Math.abs(dy);
      if (d.moved > 4 && st.preset !== "free"){ if (cut.pos) { const q = cut.pos.clone().sub(cut.tgt), r = q.length(); st.free = { yaw: Math.atan2(q.x, q.z), pitch: Math.asin(q.y/r), dist: r }; } st.preset = "free"; $("cutPreset").value = "free"; }
      if (st.preset === "free"){ st.free.yaw -= dx*.008; st.free.pitch = Math.max(-1.4, Math.min(1.4, st.free.pitch + dy*.006)); } });
    const end = () => { d = null; }; el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    el.addEventListener("wheel", e => { if (st.big !== "cut") return; e.preventDefault(); e.stopPropagation(); cut.zoom = Math.max(.45, Math.min(2.2, cut.zoom*Math.exp(e.deltaY*.001))); }, { passive: false }); }

  /* ---- Heart cutaway camera ---- */
  const cam = new T.PerspectiveCamera(30, 1, 1, 300), cut = { zoom: 1, pos: null, tgt: new T.Vector3() };
  cam.layers.disableAll(); cam.layers.enable(0); cam.layers.enable(3);
  function aimCut(r){
    const asp = r.w/r.h, sgn = APP.conv === "ASE" ? 1 : -1, D = APP.img.depthCm, hf = new T.Vector3(...ph.frames.heart.origin_patient).applyMatrix4(S.patient.matrixWorld);
    let up = new T.Vector3(0, 1, 0), pos, tgt;
    const fit = Math.max(1, 1.25/asp)*cut.zoom;
    if (st.preset === "follow"){            /* looks along the plane normal, up = −beam → the cut face reads like the echo screen */
      tgt = S.originWorld.clone().addScaledVector(S.beamWorld, D*.5); pos = tgt.clone().addScaledVector(S.elevWorld, -sgn*(D*2.1)*fit);
      up = S.beamWorld.clone().negate();
    } else if (st.preset === "probe"){      /* probe's eye: from behind the probe down the beam, notch side to the right */
      tgt = S.originWorld.clone().addScaledVector(S.beamWorld, D*.6); pos = S.originWorld.clone().addScaledVector(S.beamWorld, -16*fit);
      up = S.elevWorld.clone().multiplyScalar(-sgn);
    } else if (st.preset === "front"){
      tgt = hf; pos = tgt.clone().add(new T.Vector3(0, 0, 44*fit));
    } else { const f = st.free; tgt = hf; pos = tgt.clone().add(new T.Vector3(f.dist*Math.sin(f.yaw)*Math.cos(f.pitch), f.dist*Math.sin(f.pitch), f.dist*Math.cos(f.yaw)*Math.cos(f.pitch)).multiplyScalar(fit/cut.zoom*cut.zoom)); }
    cam.aspect = asp; cam.position.copy(pos); cam.up.copy(up); cam.lookAt(tgt); cam.updateProjectionMatrix(); cam.updateMatrixWorld(); cut.pos = pos; cut.tgt = tgt;
  }
  function drawCut(r){
    aimCut(r);
    const sgn = APP.conv === "ASE" ? 1 : -1;           // keep the half of the heart on the far side of the cut, as the camera sees it
    if (st.section) S.clip.setFromNormalAndCoplanarPoint(S.elevWorld.clone().multiplyScalar(st.preset === "follow" ? sgn : 1), S.originWorld); else S.clip.constant = 1e5;
    S.skeleton.visible = st.ribs; S.lungs.visible = st.lungs && S.heartReady(); S.liver.visible = S.vessels.visible = st.liver && S.heartReady(); S.heart.visible = S.heartReady();
    S.cutFace.visible = st.section; S.fanFill.visible = false;
    renderer.render(S.scene, cam);
    S.fanFill.visible = true; S.cutFace.visible = true; S.clip.set(new T.Vector3(0, 0, 1), 1e5);
  }

  /* ---- Torso map: orthographic front view + overlays on layer 2 ---- */
  const mapCam = new T.OrthographicCamera(-20, 20, 24, -24, 1, 200); mapCam.layers.disableAll(); mapCam.layers.enable(2); mapCam.position.set(0, -13, 80); mapCam.lookAt(0, -13, 0); mapCam.updateMatrixWorld();
  const map = new T.Group(); S.patient.add(map);
  const silh = new T.MeshBasicMaterial({ color: 0x888888 }), ribLine = new T.LineBasicMaterial({ color: 0x777777 }), ctLine = new T.LineBasicMaterial({ color: 0x77a0a4 });
  map.add(new T.Mesh(S.torsoGeo, silh));
  /* ribs and sternum edge, drawn on the skin */
  for (const n of E.ribs.numbers) for (const s of [1, -1]){
    const cc = E.ribs.costochondralJunction_absX[n], c = [], b = [];
    for (let ax = 1; ax <= 15; ax += .5){ const y = S.ribY(n, ax); if (y <= S.costalY(ax)) continue; (ax < cc ? c : b).push(S.onSkin(s*ax, y, .12)); }
    if (c.length > 1) map.add(new T.Line(new T.BufferGeometry().setFromPoints(c), ctLine));
    if (b.length > 1) map.add(new T.Line(new T.BufferGeometry().setFromPoints(b), ribLine)); }
  { const pts = [[-1.7,-.8],[1.7,-.8],[1.5,-18],[.4,-20.5],[-.4,-20.5],[-1.5,-18],[-1.7,-.8]].map(q => S.onSkin(q[0], q[1], .12)); map.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), ribLine)); }
  /* window zones: views.json windows bent onto the skin; green when the probe is inside */
  const zones = [], ZONE_OFF = 0xd9a441, ZONE_ON = 0x2fbf71;
  for (const [id, w] of Object.entries(VJ.windows)){ if (id.startsWith("_") || !w.xRange) continue;
    const g = new T.PlaneGeometry(1, 1, 10, 10), P = g.attributes.position, mat = new T.MeshBasicMaterial({ color: ZONE_OFF, transparent: true, opacity: .3, depthWrite: false, side: T.DoubleSide });
    const m = new T.Mesh(g, mat); m.renderOrder = 1; map.add(m); zones.push({ id, w, m, P });
  }
  function layoutZones(position){ const off = (ph.positions[position].heartOffset_patient || [0])[0];
    for (const z of zones){ const a = z.w, dx = z.id === "apical" ? off : 0;
      const uv = z.m.geometry.attributes.uv;                       // uv, not position: this runs again on every position change
      for (let i = 0; i < z.P.count; i++){ const u = uv.getX(i), v = uv.getY(i), q = S.onSkin(a.xRange[0]+dx+(a.xRange[1]-a.xRange[0])*u, a.yRange[1]+(a.yRange[0]-a.yRange[1])*v, .15); z.P.setXYZ(i, q.x, q.y, q.z); }
      z.P.needsUpdate = true; z.m.geometry.computeBoundingSphere(); } }
  const accent = new T.MeshBasicMaterial({ color: 0xe0592a, depthTest: false }), noteMat = new T.MeshBasicMaterial({ color: 0xff8a3c, depthTest: false });
  const dot = new T.Mesh(new T.SphereGeometry(.85, 16, 12), accent); dot.renderOrder = 6; map.add(dot);
  const arrow = new T.Mesh(new T.ConeGeometry(.7, 2.2, 12), noteMat); arrow.renderOrder = 6; map.add(arrow);
  const footMat = new T.LineBasicMaterial({ color: 0xe0592a, depthTest: false }), foot = new T.Line(new T.BufferGeometry().setFromPoints(Array.from({ length: 13 }, () => new T.Vector3())), footMat); foot.frustumCulled = false; foot.renderOrder = 5; map.add(foot);
  S.onLayer(map, 2);
  const _up = new T.Vector3(0, 1, 0), _dir = new T.Vector3();
  function updateMapOverlays(){
    const f = APP.frame, p = APP.pose;
    dot.position.copy(S.onSkin(p.x, p.y, .3));
    const { H, Lt } = PROBE.basis(f.p), a = p.notchDeg*Math.PI/180, u = PROBE.v.add(PROBE.v.mul(H, Math.cos(a)), PROBE.v.mul(Lt, Math.sin(a)));
    _dir.set(...u).normalize(); arrow.position.copy(dot.position).addScaledVector(_dir, 2.6); arrow.quaternion.setFromUnitVectors(_up, _dir);
    const P = foot.geometry.attributes.position;                    // beam footprint: the skin line along lateral ±3 cm
    for (let i = 0; i < 13; i++){ const s = (i-6)/2, q = S.onSkin(p.x + u[0]*s, p.y + u[1]*s, .2); P.setXYZ(i, q.x, q.y, q.z); } P.needsUpdate = true;
    const w = APP.windowAt(p.x, p.y);
    for (const z of zones){ const on = w && w.id === z.id; z.m.material.color.setHex(on ? ZONE_ON : ZONE_OFF); z.m.material.opacity = on ? .55 : .26; }
  }
  function setMapTheme(c){ silh.color.set(c.mapBody); ribLine.color.set(c.mapRib); ctLine.color.set(c.mapCart); }
  function drawMap(r){
    const asp = r.w/r.h, hH = Math.max(24, 19/asp); mapCam.top = hH-2; mapCam.bottom = -hH-2; mapCam.left = -hH*asp; mapCam.right = hH*asp; mapCam.updateProjectionMatrix();
    updateMapOverlays(); renderer.render(S.scene, mapCam);
  }

  /* ---- drawing: direct while a pane's rect is changing, render target + blit for the throttled collapsed pane ---- */
  const rectOf = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  let rtSmall = null, lastSmallT = 0, lastKey = "";
  const blitS = new T.Scene(), blitQ = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({ uniforms: { t: { value: null } }, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 v; void main(){ v = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: `uniform sampler2D t; varying vec2 v; void main(){ gl_FragColor = texture2D(t, v); }` })), blitC = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  blitQ.frustumCulled = false; blitS.add(blitQ);
  const drawPane = { cut: drawCut, map: drawMap }, paneClear = () => ({ cut: APP.colors.cut, map: APP.colors.map });
  function render(H, W, now, force){
    if (st.minimised) return;
    const bigK = st.big, smK = bigK === "cut" ? "map" : "cut", R = rectOf(panes[bigK]), r = rectOf(panes[smK]);
    const visible = q => q.w > 2 && q.h > 2 && q.y < H && q.y + q.h > 0;
    if (visible(R)){ S.drawTo(R, H, paneClear()[bigK]); drawPane[bigK](R); }
    if (!visible(r)) return;
    const key = [R.x, R.y, R.w, R.h, r.x, r.y, r.w, r.h].join(), moving = key !== lastKey; lastKey = key;
    const pr = renderer.getPixelRatio(), rw = Math.max(1, Math.round(r.w*pr)), rh = Math.max(1, Math.round(r.h*pr));
    if (moving || force){ S.drawTo(r, H, paneClear()[smK]); drawPane[smK](r); if (rtSmall) lastSmallT = 0; if (!force) return; }
    if (!rtSmall){ rtSmall = new T.WebGLRenderTarget(rw, rh, { samples: 0 }); rtSmall.texture.colorSpace = T.NoColorSpace; lastSmallT = 0; }
    else if (rtSmall.width !== rw || rtSmall.height !== rh){ rtSmall.setSize(rw, rh); lastSmallT = 0; }
    if (now - lastSmallT > 55){                       // ≈18 fps
      const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rtSmall); renderer.setClearColor(paneClear()[smK], 1); drawPane[smK](r); renderer.setRenderTarget(prev); lastSmallT = now; }
    S.drawTo(r, H, 0, 1); blitQ.material.uniforms.t.value = rtSmall.texture; renderer.render(blitS, blitC);
  }
  applyClasses();
  const zoneCentre = id => { const z = zones.find(q => q.id === id); return z.m.geometry.boundingSphere.center.toArray(); };
  return { st, render, zoneCentre, layoutZones, setMapTheme, applyClasses, swap, panes, rectOf };
}
