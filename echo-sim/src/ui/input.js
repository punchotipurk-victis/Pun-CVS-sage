/* ===== INPUT: every source emits pose deltas {dx,dy,dNotch,dTilt,dRock,dPress} into APP.applyDelta().
   A future phone-gyroscope module only needs to call APP.applyDelta too. Slide uses the ANALYTIC skin (PROBE.rayToSkin), not the mesh. */
function makeInput(APP, S){
  const T = THREE, $ = id => document.getElementById(id), el = $("stage");
  const STEP = { deg: 2, cm: .25 }, scale = () => APP.fine ? .3 : 1;
  const ndc = new T.Vector3(), o = new T.Vector3(), d = new T.Vector3(), inv = new T.Matrix4();
  /* pointer → BODY-frame ray: multiply by the inverse of the patient group, so LLD roll cannot change the pose maths */
  function bodyRay(e){
    const b = el.getBoundingClientRect(); S.aimMain({ w: b.width, h: b.height });
    ndc.set((e.clientX-b.left)/b.width*2-1, -(e.clientY-b.top)/b.height*2+1, .5);
    o.copy(S.mainCam.position); d.copy(ndc).unproject(S.mainCam).sub(o).normalize();
    inv.copy(S.patient.matrixWorld).invert(); const O = o.clone().applyMatrix4(inv), D = d.clone().transformDirection(inv);
    return { o: O.toArray(), d: D.toArray() };
  }
  /* distance (px) from a pointer to the probe on screen: the probe is the grab handle, with a forgiving radius for fingers */
  function probeDist(e){
    const b = el.getBoundingClientRect(); S.aimMain({ w: b.width, h: b.height }); let best = 1e9;
    for (const y of [0, 2.5, 5, 8]){ const q = new T.Vector3(0, y, 0).applyMatrix4(S.probeGroup.matrixWorld).project(S.mainCam), dx = (q.x*.5+.5)*b.width-(e.clientX-b.left), dy = (-q.y*.5+.5)*b.height-(e.clientY-b.top); best = Math.min(best, Math.hypot(dx, dy)); }
    return best;
  }
  /* ---- probe handles: cap (distal tip) = tilt/rock about the skin contact, ring = rotate, body = slide ---- */
  const ray = new T.Raycaster(); ray.layers.enableAll();
  const toScreen = (v3, b) => { const q = v3.clone().project(S.mainCam); return [b.left + (q.x*.5+.5)*b.width, b.top + (-q.y*.5+.5)*b.height]; };
  const wpos = o => { S.patient.updateMatrixWorld(true); return new T.Vector3().setFromMatrixPosition(o.matrixWorld); };
  function pick(e){
    if (APP.mode !== "probe") return null;
    const b = el.getBoundingClientRect(), touch = e.pointerType === "touch"; S.aimMain({ w: b.width, h: b.height }); S.patient.updateMatrixWorld(true);
    ray.setFromCamera(new T.Vector2((e.clientX-b.left)/b.width*2-1, -(e.clientY-b.top)/b.height*2+1), S.mainCam);
    const hits = ray.intersectObjects([S.cap, S.ring, ...S.probeParts], false);
    /* nearest handle on screen wins (the ring is drawn as an ellipse: distance to its projected outline) */
    const c = toScreen(wpos(S.cap), b), dCap = Math.hypot(c[0]-e.clientX, c[1]-e.clientY);
    let dRing = 1e9; for (let i = 0; i < 48; i++){ const a = i/48*2*Math.PI, q = toScreen(new T.Vector3(2.6*Math.cos(a), 2.6*Math.sin(a), 0).applyMatrix4(S.ring.matrixWorld), b); dRing = Math.min(dRing, Math.hypot(q[0]-e.clientX, q[1]-e.clientY)); }
    const face = toScreen(new T.Vector3(0, 1.2, 0).applyMatrix4(S.probeVis.matrixWorld), b), Lpx = Math.hypot(c[0]-face[0], c[1]-face[1]);
    const tCap = Math.min(touch ? 30 : 14, Math.max(8, .32*Lpx)), tRing = Math.min(touch ? 18 : 8, Math.max(5, .2*Lpx));
    if (dCap < tCap && dCap <= dRing + 2) return "cap";
    const onBody = hits.some(h => S.probeParts.includes(h.object));
    if (onBody && dRing > 3) return "body";                                                      // the ring encircles the body: on the body = slide
    if (dRing < tRing) return "ring";
    if (hits.length && hits[0].object === S.cap) return "cap";
    if (hits.length) return "body";
    if (probeDist(e) < (touch ? 56 : 30)) return "body";
    return null;
  }
  const V = PROBE.v;
  const pivot = () => V.sub(APP.frame.p, V.mul(APP.frame.normal, APP.press()));
  function sphereDir(e, c, R){ const r = bodyRay(e), oc = V.sub(r.o, c), bb = V.dot(oc, r.d), cc = V.dot(oc, oc) - R*R, disc = bb*bb - cc, t = disc >= 0 ? -bb - Math.sqrt(disc) : -bb;
    return V.norm(V.sub(V.add(r.o, V.mul(r.d, t)), c)); }
  function startTail(e){ const c = pivot(), f = APP.frame, R = 11.9 + S.probeVis.position.y;
    act = { kind: "tail", c, R, q0: new T.Vector3(...sphereDir(e, c, R)), t0: new T.Vector3(...V.mul(f.beam, -1)), lat0: f.lateral.slice() }; }
  function moveTail(e){ const a = act, q = new T.Vector3(...sphereDir(e, a.c, a.R)), rot = new T.Quaternion().setFromUnitVectors(a.q0, q);
    let beam = V.mul(a.t0.clone().applyQuaternion(rot).toArray(), -1); const N = APP.frame.normal, dn = V.dot(beam, N);
    if (dn > -.22) beam = V.norm(V.sub(beam, V.mul(N, dn + .22)));                                       // never aim the beam out of the patient
    const lat = V.norm(V.sub(a.lat0, V.mul(beam, V.dot(a.lat0, beam)))), g = PROBE.anglesFrom(APP.pose.x, APP.pose.y, beam, lat), k = scale(), P = APP.pose;
    APP.applyDelta({ dNotch: ((g.notchDeg - P.notchDeg + 540)%360 - 180)*k, dTilt: (g.tiltDeg - P.tiltDeg)*k, dRock: (g.rockDeg - P.rockDeg)*k }); }
  function ringAngle(e){ const b = el.getBoundingClientRect(), c = toScreen(wpos(S.ring), b); return Math.atan2(e.clientY - c[1], e.clientX - c[0]); }
  function startRing(e){ const tail = wpos(S.cap).sub(wpos(S.ring)), toCam = S.mainCam.position.clone().sub(wpos(S.ring)); act = { kind: "ring", a: ringAngle(e), sign: tail.dot(toCam) >= 0 ? 1 : -1 }; }
  function moveRing(e){ const a = ringAngle(e); let d = a - act.a; if (d > Math.PI) d -= 2*Math.PI; if (d < -Math.PI) d += 2*Math.PI; act.a = a; APP.applyDelta({ dNotch: d*180/Math.PI*act.sign*scale() }); }
  const ptrs = new Map(); let act = null, gesture = null, hoverK = null;
  const shiftAngles = (dx, dy) => APP.applyDelta({ dRock: dx*.25*scale(), dTilt: -dy*.25*scale() });
  el.addEventListener("pointerdown", e => {
    el.focus({ preventScroll: true }); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { el.setPointerCapture(e.pointerId); } catch (_) {}
    if (ptrs.size === 2){ const [a, b] = [...ptrs.values()]; gesture = { ang: Math.atan2(b.y-a.y, b.x-a.x), cx: (a.x+b.x)/2, cy: (a.y+b.y)/2, dist: Math.hypot(b.x-a.x, b.y-a.y), lock: null, acc: { tw: 0, v: 0, h: 0 } }; act = null; return; }
    if (APP.mode === "camera"){ act = { kind: "orbit", x: e.clientX, y: e.clientY }; return; }
    if (e.shiftKey){ act = { kind: "angles", x: e.clientX, y: e.clientY }; return; }
    const k = pick(e);
    if (k === "cap"){ startTail(e); el.classList.add("grabbing"); return; }
    if (k === "ring"){ startRing(e); el.classList.add("grabbing"); return; }
    if (k === "body"){ const r = bodyRay(e), h = PROBE.rayToSkin(r.o, r.d); act = { kind: "slide", ox: h ? APP.pose.x-h.x : 0, oy: h ? APP.pose.y-h.y : 0 }; el.classList.add("grabbing"); return; }
    act = { kind: "orbit", x: e.clientX, y: e.clientY };
  });
  el.addEventListener("pointermove", e => {
    if (!ptrs.has(e.pointerId)){ if (e.pointerType === "mouse" && !e.target.closest("button,select,input,#inset,#pad")){ const k = pick(e); if (k !== hoverK){ hoverK = k; S.setGizmoHover(k); el.dataset.hover = k || ""; } } return; }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture && ptrs.size >= 2){
      const [a, b] = [...ptrs.values()], ang = Math.atan2(b.y-a.y, b.x-a.x), cx = (a.x+b.x)/2, cy = (a.y+b.y)/2, dist = Math.hypot(b.x-a.x, b.y-a.y);
      let dA = ang-gesture.ang; if (dA > Math.PI) dA -= 2*Math.PI; if (dA < -Math.PI) dA += 2*Math.PI;
      const dV = cy-gesture.cy, dH = cx-gesture.cx, dZ = dist-gesture.dist; Object.assign(gesture, { ang, cx, cy, dist });
      if (APP.mode === "camera"){ S.orbit.dist = Math.max(30, Math.min(120, S.orbit.dist*Math.exp(-dZ*.006))); S.orbit.yaw -= dH*.008; return; }
      if (!gesture.lock){                                    // hysteresis: commit to the dominant motion, keep it until the fingers lift
        const G = gesture.acc; G.tw += Math.abs(dA)*gesture.dist*.5; G.v += Math.abs(dV); G.h += Math.abs(dH);
        const top = Math.max(G.tw, G.v, G.h); if (top > 10) gesture.lock = top === G.tw ? "twist" : (top === G.v ? "tilt" : "rock"); else return; }
      if (gesture.lock === "twist") APP.applyDelta({ dNotch: dA*180/Math.PI*scale() });
      else if (gesture.lock === "tilt") APP.applyDelta({ dTilt: -dV*.25*scale() });
      else APP.applyDelta({ dRock: dH*.25*scale() });
      return; }
    if (!act) return;
    if (act.kind === "tail"){ moveTail(e); return; }
    if (act.kind === "ring"){ moveRing(e); return; }
    if (act.kind === "slide"){ const r = bodyRay(e), h = PROBE.rayToSkin(r.o, r.d); if (!h) return;
      const k = scale(), tx = h.x+act.ox, ty = h.y+act.oy; APP.applyDelta({ dx: (tx-APP.pose.x)*k, dy: (ty-APP.pose.y)*k }); if (k !== 1){ act.ox = APP.pose.x-h.x; act.oy = APP.pose.y-h.y; } }
    else { const dx = e.clientX-act.x, dy = e.clientY-act.y; act.x = e.clientX; act.y = e.clientY;
      if (act.kind === "angles") shiftAngles(dx, dy);
      else { S.orbit.yaw -= dx*.008; if (e.pointerType === "mouse" || APP.mode === "probe") S.orbit.pitch = Math.max(-1.2, Math.min(1.2, S.orbit.pitch + dy*.006)); } }
  });
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) gesture = null; if (!ptrs.size){ act = null; el.classList.remove("grabbing"); } };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", e => { if (e.target.closest("#inset")) return; e.preventDefault();
    if (APP.mode === "camera" || e.ctrlKey) S.orbit.dist = Math.max(30, Math.min(120, S.orbit.dist*Math.exp(e.deltaY*.001)));
    else APP.applyDelta({ dNotch: (e.deltaY > 0 ? 3 : -3)*scale() }); }, { passive: false });

  /* on-screen pad: repeats while held; keyboard activation arrives as click with detail 0 */
  const PAD = [["⟲","Rotate counter-clockwise",{dNotch:-1},"Q"],["⟳","Rotate clockwise",{dNotch:1},"E"],["▲","Tilt beam toward head",{dTilt:1},"W"],["▼","Tilt beam toward feet",{dTilt:-1},"S"],
               ["◀","Rock away from notch",{dRock:-1},"A"],["▶","Rock toward notch",{dRock:1},"D"],["↑","Slide toward head",{dy:1},"↑"],["↓","Slide toward feet",{dy:-1},"↓"],["←","Slide toward patient's right",{dx:-1},"←"],["→","Slide toward patient's left",{dx:1},"→"]];
  const stepDelta = u => { const k = scale(), q = {}; for (const a in u) q[a] = u[a]*k*(a === "dx" || a === "dy" ? STEP.cm : STEP.deg); return q; };
  const pad = $("padKeys");
  for (const [g, lab, u, key] of PAD){ const b = document.createElement("button"); b.type = "button"; b.textContent = g; b.title = `${lab} (${key})`; b.setAttribute("aria-label", `${lab}, key ${key}`); pad.appendChild(b);
    let t0 = null, t1 = null; const stop = () => { clearTimeout(t0); clearInterval(t1); t0 = t1 = null; };
    b.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); APP.applyDelta(stepDelta(u)); t0 = setTimeout(() => { t1 = setInterval(() => APP.applyDelta(stepDelta(u)), 60); }, 280); });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, stop);
    b.addEventListener("click", e => { if (e.detail === 0) APP.applyDelta(stepDelta(u)); }); }

  /* keyboard */
  const KEYS = { q:{dNotch:-1}, e:{dNotch:1}, w:{dTilt:1}, s:{dTilt:-1}, a:{dRock:-1}, d:{dRock:1}, arrowup:{dy:1}, arrowdown:{dy:-1}, arrowleft:{dx:-1}, arrowright:{dx:1} };
  addEventListener("keydown", e => {
    if (e.target.matches && e.target.matches("input,select,textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (KEYS[k]){ e.preventDefault(); APP.applyDelta(stepDelta(KEYS[k])); }
    else if (k === "f") APP.setFine(!APP.fine); else if (k === "b") APP.cycleBody(); else if (k === "m") APP.setLandmarks(!APP.landmarks); else if (k === " " && e.target === document.body){ e.preventDefault(); APP.setFrozen(!APP.frozen); }
  });
  return { bodyRay, probeDist, pick };
}
