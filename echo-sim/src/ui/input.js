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
  const ptrs = new Map(); let act = null, gesture = null;
  const shiftAngles = (dx, dy) => APP.applyDelta({ dRock: dx*.25*scale(), dTilt: -dy*.25*scale() });
  el.addEventListener("pointerdown", e => {
    el.focus({ preventScroll: true }); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { el.setPointerCapture(e.pointerId); } catch (_) {}
    if (ptrs.size === 2){ const [a, b] = [...ptrs.values()]; gesture = { ang: Math.atan2(b.y-a.y, b.x-a.x), cx: (a.x+b.x)/2, cy: (a.y+b.y)/2, dist: Math.hypot(b.x-a.x, b.y-a.y), lock: null, acc: { tw: 0, v: 0, h: 0 } }; act = null; return; }
    if (APP.mode === "camera"){ act = { kind: "orbit", x: e.clientX, y: e.clientY }; return; }
    if (e.shiftKey){ act = { kind: "angles", x: e.clientX, y: e.clientY }; return; }
    if (probeDist(e) < (e.pointerType === "touch" ? 70 : 46)){ const r = bodyRay(e), h = PROBE.rayToSkin(r.o, r.d); act = { kind: "slide", ox: h ? APP.pose.x-h.x : 0, oy: h ? APP.pose.y-h.y : 0 }; el.classList.add("grabbing"); return; }
    act = { kind: "orbit", x: e.clientX, y: e.clientY };
  });
  el.addEventListener("pointermove", e => {
    if (!ptrs.has(e.pointerId)){ if (e.pointerType === "mouse" && !e.target.closest("button,select,input,#inset,#pad")) el.classList.toggle("nearprobe", APP.mode === "probe" && probeDist(e) < 46); return; }
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
    else if (k === "f") APP.setFine(!APP.fine); else if (k === "b") APP.cycleBody(); else if (k === " " && e.target === document.body){ e.preventDefault(); APP.setFrozen(!APP.frozen); }
  });
  return { bodyRay, probeDist };
}
