/* ===== APP: state, clocks, render loop, scoring, boot. One WebGLRenderer on a fixed canvas behind the layout; each frame draws into every visible pane's rect. ===== */
(function(){
  const $ = id => document.getElementById(id), J = id => JSON.parse(document.getElementById(id).textContent), ph = J("phantom"), VJ = J("views"), OV = J("viewsOverrides");
  const fail = msg => { const b = $("boot"); b.hidden = false; b.classList.add("bad"); b.textContent = msg; };
  const say = msg => { const b = $("boot"); b.hidden = false; b.textContent = msg; };
  const wait = () => new Promise(r => setTimeout(r, 30));
  addEventListener("error", e => { if (e.message) fail("Error: " + e.message); });

  async function boot(){
    if (typeof THREE === "undefined") throw new Error("three.js did not load");
    const cv = $("gl");
    if (!cv.getContext("webgl2", { alpha: true, antialias: true })) throw new Error("WebGL2 is not available in this browser. Turn on hardware acceleration in the browser settings.");
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: "high-performance" });
    let shaderErr = null;
    renderer.debug.onShaderError = (gl, prog, vs, fs) => { shaderErr = (gl.getShaderInfoLog(fs) || "") + (gl.getShaderInfoLog(vs) || "") + (gl.getProgramInfoLog(prog) || ""); console.error("Shader failed:", shaderErr.slice(0, 1500)); };
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.autoClear = true;
    PROBE.setTorso(ph.extracardiac_patient.torso);
    const small = Math.min(screen.width, innerWidth) < 760;

    say("Compiling the echo engine…"); await wait();
    const eng = EchoEngine(renderer, ph, small ? { lines: 128, samples: 256 } : { lines: 160, samples: 320 });
    const paramEval = PHANTOM.makeParamEval(ph);

    /* ---- state ---- */
    const APP = window.APP = { ph, VJ, eng, renderer, paramEval, position: "supine", conv: "ASE", mode: "probe", body: "skin", ghostOpacity: .25, fine: false, frozen: false, hr: ph.cycle.HR_default,
      img: { depthCm: 16, sectorDeg: 90, gainDb: ph.imaging_defaults.gain_dB, drDb: ph.imaging_defaults.dynamicRange_dB }, phase: 0, resp: 0, time: 0,
      pose: { x: 3, y: -8.9, notchDeg: -30, tiltDeg: 0, rockDeg: 0, pressCm: 0 }, pressAuto: true, frame: null, edOuterXY: 1, colors: {}, targets: {}, paneDragged: false,
      landmarks: true, refView: null, refShown: false, refSplit: false, tween: null };
    try { const v = localStorage.getItem("echoLandmarks"); if (v != null) APP.landmarks = v === "1"; } catch (e) {}
    APP.edOuterXY = paramEval(0, 0)[eng.names.indexOf("LV_outerXY")];
    /* windows: the first zone (most specific order below) that contains the probe; LLD shifts the apical zone with the heart */
    const WIN = ["subxiphoid_ivc", "subxiphoid", "apical", "parasternal_left"].map(id => ({ id, w: VJ.windows[id] }));
    APP.windowAt = (x, y) => { const off = (ph.positions[APP.position].heartOffset_patient || [0])[0];
      for (const z of WIN){ const dx = z.id === "apical" ? off : 0, a = z.w; if (x >= a.xRange[0]+dx && x <= a.xRange[1]+dx && y <= a.yRange[0] && y >= a.yRange[1]) return z; } return null; };
    APP.windowPress = () => { const z = APP.windowAt(APP.pose.x, APP.pose.y); return z ? (z.w.pressCm || 0) : 0; };
    APP.press = () => APP.pressAuto ? APP.windowPress() : APP.pose.pressCm;
    let dirty = true, S, inset, input, panels; const clearBeat = () => { for (const k in beatBuf) beatBuf[k] = []; };
    APP.markDirty = () => { dirty = true; };

    S = makeScene(APP);
    const applyPose = () => { APP.frame = PROBE.frame(APP.pose); eng.setProbe(APP.frame, APP.press()); dirty = true; };
    const wrap = d => ((d+540)%360)-180, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    APP.applyDelta = d => { const p = APP.pose; APP.tween = null;
      if (d.dx) p.x = clamp(p.x+d.dx, -14, 14); if (d.dy) p.y = clamp(p.y+d.dy, -30, -1);
      if (d.dNotch) p.notchDeg = wrap(p.notchDeg+d.dNotch); if (d.dTilt) p.tiltDeg = clamp(p.tiltDeg+d.dTilt, -75, 75); if (d.dRock) p.rockDeg = clamp(p.rockDeg+d.dRock, -50, 50);
      if (d.dPress){ APP.pressAuto = false; p.pressCm = clamp(p.pressCm+d.dPress, 0, 3); } applyPose(); };
    APP.setPress = v => { APP.pressAuto = false; APP.pose.pressCm = clamp(v, 0, 3); applyPose(); };
    const pushImaging = () => eng.setImaging({ depthCm: APP.img.depthCm, sectorDeg: APP.img.sectorDeg, gainDb: APP.img.gainDb, drDb: APP.img.drDb, markerRight: APP.conv === "ASE", tint: false });
    APP.setImg = o => { Object.assign(APP.img, o); pushImaging(); clearBeat(); dirty = true; };

    /* ---- view targets: derived per position, expert overrides on top, POCUS = same beam with the notch reversed ---- */
    function deriveTargets(pos){ const D = DERIVE.derive(VJ, ph, pos), ov = (OV && OV.views) || {};
      for (const v of VJ.views){ const o = (v.poseOverride && v.poseOverride[pos]) || (ov[v.id] && ov[v.id].poseOverride && ov[v.id].poseOverride[pos]); if (o && D[v.id]) Object.assign(D[v.id], o); } return D; }
    const target = id => { const t = APP.targets[id]; if (APP.conv === "ASE") return t;
      const f = PROBE.frame(t), a = PROBE.anglesFrom(t.x, t.y, f.beam, PROBE.v.mul(f.lateral, -1)); return { ...t, ...a }; };
    APP.target = target;

    APP.setPosition = (pos, snap) => { if (pos === APP.position && !snap) return; APP.position = pos; eng.setPatientPosition(pos); S.setPatientMatrix(pos); APP.targets = deriveTargets(pos);
      if (S.heartReady()) S.bakeOrgans(pos); inset && inset.layoutZones(pos); refLabelsDirty = true; if (snap) S.animateRoll(ph.positions[pos].bodyRollDeg, true); clearBeat(); applyPose(); syncAll();
      if (panels && !snap && pos === "LLD") panels.toast(ph.positions.LLD.teachingTooltip); };
    APP.setConvention = c => { if (c === APP.conv) return; APP.conv = c; pushImaging(); clearBeat(); refLabelsDirty = true; syncAll();
      panels.toast(c === "POCUS" ? "POCUS: marker on the screen's left. The picture mirrors, so rotate the probe 180° to get the same image back." : "ASE: marker on the screen's right."); };
    APP.setMode = m => { APP.mode = m; syncAll(); };
    APP.setFrozen = f => { APP.frozen = f; clearBeat(); syncAll(); };
    APP.setFine = f => { APP.fine = f; syncAll(); };
    const BODY = ["skin", "muscle", "ghost", "skeleton"]; APP.cycleBody = () => { APP.body = BODY[(BODY.indexOf(APP.body)+1)%BODY.length]; syncAll(); };
    APP.setLandmarks = on => { APP.landmarks = on; try { localStorage.setItem("echoLandmarks", on ? "1" : "0"); } catch (e) {} syncAll(); };
    /* go to a view: the probe glides to the computed target (so the learner sees the hand movement) and the ideal image opens */
    const ease = t => t < .5 ? 2*t*t : 1 - (-2*t + 2)**2/2;
    APP.goToView = (id, instant) => { const v = VJ.views.find(x => x.id === id), t = target(id); if (!v || t.error) return;
      APP.refView = id; APP.refShown = true; APP.pressAuto = true; APP.setImg({ depthCm: v.image.depthCm, sectorDeg: v.image.sectorDeg });
      if (instant) APP.snapTo(id); else APP.tween = { from: { ...APP.pose }, to: { x: t.x, y: t.y, notchDeg: t.notchDeg, tiltDeg: t.tiltDeg, rockDeg: t.rockDeg }, t0: performance.now(), dur: 900 };
      refLabelsDirty = true; syncAll(); };
    APP.showRef = on => { if (on && !APP.refView){ const b = APP.scores && Object.entries(APP.scores).sort((a, c) => c[1].q - a[1].q)[0]; APP.refView = b ? b[0] : VJ.views[0].id; refLabelsDirty = true; }
      APP.refShown = on; syncAll(); };
    function stepTween(now){ const w = APP.tween; if (!w) return; const k = Math.min(1, (now - w.t0)/w.dur), e = ease(k), P = APP.pose;
      for (const a of ["x", "y", "tiltDeg", "rockDeg"]) P[a] = w.from[a] + (w.to[a] - w.from[a])*e;
      P.notchDeg = wrap(w.from.notchDeg + wrap(w.to.notchDeg - w.from.notchDeg)*e);
      applyPose(); clearBeat(); if (k >= 1) APP.tween = null; }
    APP.snapTo = id => { const v = VJ.views.find(x => x.id === id), t = target(id); Object.assign(APP.pose, { x: t.x, y: t.y, notchDeg: t.notchDeg, tiltDeg: t.tiltDeg, rockDeg: t.rockDeg }); APP.pressAuto = true;
      APP.setImg({ depthCm: v.image.depthCm, sectorDeg: v.image.sectorDeg }); applyPose(); clearBeat(); syncAll(); };

    /* ---- theme: panels follow the app's tokens, the echo and cutaway stay dark ---- */
    function readTheme(){ const cs = getComputedStyle(document.documentElement), g = k => cs.getPropertyValue(k).trim(), hex = s => new THREE.Color(s).getHex();
      APP.colors = { scene: hex(g("--scene")), map: hex(g("--map")), cut: 0x07090b, mapBody: g("--map-body"), mapRib: g("--map-rib"), mapCart: g("--map-cart") }; inset && inset.setMapTheme(APP.colors); }
    new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readTheme);

    /* ---- UI ---- */
    inset = makeInset(APP, S); panels = makePanels(APP); input = makeInput(APP, S); readTheme();
    function syncAll(){ panels.syncTop(); dirty = true; }

    /* ---- scoring at 5 Hz. A view is judged over one beat: the best single frame in the last R-R interval
       (the mitral "fish mouth" exists only while the valve is open, as a sonographer would also judge from the loop). ---- */
    const beatBuf = {}, locks = {}; for (const v of VJ.views){ beatBuf[v.id] = []; locks[v.id] = SCORING.makeLock(); }
    const lvLen = ph.landmarks_heart.LV_apex_endo[2], ivcI = eng.names.indexOf("IVC_r");
    const toP = () => DERIVE.heartToPatient(ph, APP.position);
    function ctx(){ const f = APP.frame, o = PROBE.v.sub(f.p, PROBE.v.mul(f.normal, APP.press())), q = toP(), sec = APP.img.sectorDeg*Math.PI/180, D = APP.img.depthCm, V = PROBE.v;
      return { trueLVLength: lvLen, ivcRadius: eng.uniforms.uP.value[ivcI],
        landmarkInImage: id => { const L = ph.landmarks_heart[id]; if (!L) return null; const d = V.sub(q(L) , o); if (Math.abs(V.dot(d, f.elev)) > .6) return false;
          const a = Math.atan2(V.dot(d, f.lateral), V.dot(d, f.beam)), r = Math.hypot(d[0], d[1], d[2]); return Math.abs(a) < sec/2-.03 && r < D; } }; }
    let best = null; APP.scores = {};
    function score(now){
      const L = eng.readLabels(), c = ctx(), rr = 60000/APP.hr; let top = null;
      for (const v of VJ.views){ const cs = SCORING.contentScore(v, L, c), b = beatBuf[v.id]; b.push({ t: now, s: cs.score, fails: cs.fails });
        while (b.length > 1 && (APP.frozen || now-b[0].t > rr)) b.shift();
        const hi = b.reduce((m, e) => e.s > m.s ? e : m, b[0]), t = target(v.id); if (t.error) continue;
        const ps = SCORING.poseScore(APP.pose, t, v.tolerance), q = .5*ps.score + .5*hi.s, locked = locks[v.id](q, now);
        APP.scores[v.id] = { q, pose: ps.score, content: hi.s, fails: hi.fails, locked, errs: ps.errs };
        if (!top || q > top.q) top = { view: v, q, locked }; }
      best = top; panels.syncChip(best);
    }

    /* ---- ideal image: the same engine, probe at the view's target, rendered to a texture and shown beside the live echo ---- */
    let refRT = null, lastRef = 0, refLabelsDirty = true, refLabelKey = "", refLabelList = [];
    const scratchRef = new THREE.WebGLRenderTarget(64, 64);
    const blitS = new THREE.Scene(), blitC = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), blitQ = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: `varying vec2 v; void main(){ v = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: `uniform sampler2D t; varying vec2 v; void main(){ gl_FragColor = texture2D(t, v); }` }));
    blitQ.frustumCulled = false; blitS.add(blitQ);
    function renderRef(rt, asp, phase){ const id = APP.refView, v = VJ.views.find(x => x.id === id), t = target(id), z = APP.windowAt(t.x, t.y);
      eng.setProbe(PROBE.frame(t), z ? (z.w.pressCm || 0) : 0);
      eng.setImaging({ depthCm: v.image.depthCm, sectorDeg: v.image.sectorDeg, gainDb: APP.img.gainDb, drDb: APP.img.drDb, markerRight: APP.conv === "ASE", tint: false });
      eng.render(phase, APP.resp, APP.time, rt, asp);
      eng.setProbe(APP.frame, APP.press()); pushImaging(); }
    /* which structures to name: the view's label list, filtered by the label rules (area, or length for thin parts) */
    const THIN = /^(MV_|TV_|AV_|PV_|IVS|IAS|pericardium|diaphragm|PW|RV_free_wall|LV_myocardium)/, GROUP_TEXT = { AV_cusps: "AV", papillary_muscles: "Papillary m." };
    function computeRefLabels(){ const v = VJ.views.find(x => x.id === APP.refView); renderRef(scratchRef, 1, 0); const Lb = eng.readLabels(), out = [];
      for (const id of v.labels){ const base = id.split(".segments")[0], keys = Object.keys(Lb).filter(k => k === base || k.startsWith(base + ".")); if (!keys.length) continue;
        let A = 0, cx = 0, cy = 0, maj = 0, minD = 1e9, maxD = 0; for (const k of keys){ const q = Lb[k]; A += q.area; cx += q.cx*q.area; cy += q.cy*q.area; maj = Math.max(maj, q.major); minD = Math.min(minD, q.minDepth); maxD = Math.max(maxD, q.maxDepth); }
        if (A < VJ.labelRules.minCutAreaCm2 && !(THIN.test(base) && maj >= 1.0)) continue;
        cx /= A; cy /= A; if (base === "pericardium") cy = maxD - .25; if (base === "LV_myocardium") cy = minD + .5;
        out.push({ id: base, text: PHANTOM.LABEL_TEXT[base] || GROUP_TEXT[base] || base, cx, cy }); }
      refLabelList = out; refLabelsDirty = false; refLabelKey = ""; }

    /* ---- render loop ---- */
    let last = performance.now(), W = 0, H = 0, lastScore = 0, slow = 0, frameDt = .016;
    function resize(){ const w = innerWidth, h = innerHeight; if (w === W && h === H) return; W = w; H = h; renderer.setSize(w, h, false); }
    function drawAll(now, force){
      resize(); S.animateRoll(ph.positions[APP.position].bodyRollDeg, false, frameDt); S.syncProbe();
      renderer.setScissorTest(false); renderer.setClearColor(0, 0); renderer.clear();
      const rEcho = inset.rectOf($("echoLive")), rMain = inset.rectOf($("stage")), vis = r => r.w > 2 && r.h > 2 && r.y < H && r.y+r.h > 0;
      const rRef = APP.refShown && APP.refView ? inset.rectOf($("refView")) : null, showRef = rRef && vis(rRef);
      if (showRef){ const pr = renderer.getPixelRatio(), w = Math.max(2, Math.round(rRef.w*pr)), h = Math.max(2, Math.round(rRef.h*pr));
        if (!refRT){ refRT = new THREE.WebGLRenderTarget(w, h); lastRef = 0; } else if (refRT.width !== w || refRT.height !== h){ refRT.setSize(w, h); lastRef = 0; }
        if (refLabelsDirty) computeRefLabels();
        if (force || now - lastRef > 50){ renderRef(refRT, rRef.w/rRef.h, APP.phase); lastRef = now; }
        const key = [rRef.w, rRef.h, APP.conv, APP.refView].join(); if (key !== refLabelKey){ refLabelKey = key; panels.placeRefLabels(refLabelList, APP.conv, VJ.views.find(x => x.id === APP.refView).image); $("refTitle").textContent = "Ideal " + (panels.VIEW_NAMES[APP.refView] || APP.refView); } }
      /* echo: always computed (labels depend on it), Pass C drawn into the echo viewport */
      S.drawTo(vis(rEcho) ? rEcho : { x: 0, y: 0, w: 1, h: 1 }, H, 0);
      eng.render(APP.phase, APP.resp, APP.time, null, rEcho.w/Math.max(1, rEcho.h));
      S.updateBeat();
      if (showRef){ S.drawTo(rRef, H, 0); blitQ.material.uniforms.t.value = refRT.texture; renderer.render(blitS, blitC); }
      if (vis(rMain)) S.renderMain(rMain, H);
      inset.render(H, W, now, force);
      renderer.setScissorTest(false);
      panels.drawEcg(); panels.drawOverlay();
    }
    let lastPose = "";
    function frame(now){
      requestAnimationFrame(frame);
      const host = $("app").getBoundingClientRect(); if (!host.width || !host.height || document.hidden) { last = now; return; }     // hidden lab iframe: nothing to draw
      const dt = Math.min(.1, (now-last)/1000); last = now; APP.time += dt; frameDt = dt;
      if (!APP.frozen){ APP.phase = (APP.phase + dt*APP.hr/60)%1; APP.resp = (APP.resp + dt*14/60)%1; }
      stepTween(now);
      drawAll(now);
      if (now-lastScore > 200){ lastScore = now; score(now); $("readout").textContent = panels.readout(); }
      if (dirty){ dirty = false; panels.syncSliders(); }
      /* laptop GPU that cannot hold the budget: drop the pixel ratio rather than the frame rate */
      slow = dt > .04 ? slow+1 : Math.max(0, slow-1); if (slow > 45 && renderer.getPixelRatio() > 1){ renderer.setPixelRatio(1); W = 0; slow = 0; }
    }

    /* ---- first picture before the slow bake, so the page is never blank ---- */
    pushImaging(); eng.setPatientPosition("supine"); S.setPatientMatrix("supine"); APP.targets = deriveTargets("supine");
    inset.layoutZones("supine");
    { const t = target("plax"); Object.assign(APP.pose, { x: t.x, y: t.y, notchDeg: t.notchDeg, tiltDeg: t.tiltDeg, rockDeg: t.rockDeg }); }
    applyPose(); syncAll(); panels.syncSliders();
    drawAll(performance.now(), true); if (shaderErr) throw new Error("Shader failed to compile: " + shaderErr.slice(0, 900));
    say("Building the 3D heart from the phantom…"); await wait();
    const tb0 = performance.now(), info = S.bakeHeart(); info.bakeMs = Math.round(performance.now() - tb0); await wait();
    S.bakeOrgans("supine"); drawAll(performance.now(), true); if (shaderErr) throw new Error("Shader failed to compile: " + shaderErr.slice(0, 900));
    $("boot").hidden = true;
    requestAnimationFrame(frame);

    /* ---- test hook ---- */
    const scratch = new THREE.WebGLRenderTarget(64, 64);
    const qualityAt = (id, phases) => { const v = VJ.views.find(x => x.id === id), t = target(id), ps = SCORING.poseScore(APP.pose, t, v.tolerance); let hi = null, ed = null;
      for (const p of phases){ eng.render(p, 0, APP.time, scratch, 1); const c = SCORING.contentScore(v, eng.readLabels(), ctx()); if (p === 0) ed = c; if (!hi || c.score > hi.score) hi = { ...c, phase: p }; }
      return { quality: .5*ps.score + .5*hi.score, pose: ps.score, content: hi.score, phase: hi.phase, fails: hi.fails, atED: ed && { quality: .5*ps.score + .5*ed.score, content: ed.score, fails: ed.fails } }; };
    window.ECHO = { ready: true, shaderErr: () => shaderErr, info, views: VJ.views.map(v => v.id),
      setPose(p){ Object.assign(APP.pose, p); applyPose(); clearBeat(); }, pose: () => ({ ...APP.pose }), press: APP.press, frameOf: () => APP.frame,
      setPosition: p => APP.setPosition(p, true), setConvention: c => APP.setConvention(c), snap: APP.snapTo, target,
      setPhase(t){ APP.phase = t; }, freeze: f => APP.setFrozen(f), setBody(b){ APP.body = b; syncAll(); }, body: () => APP.body,
      renderOnce(){ drawAll(performance.now(), true); }, quality: id => qualityAt(id, [0, .06, .2, .38, .53, .62, .75, .92]), qualityED: id => qualityAt(id, [0]), live: () => APP.scores,
      labels: () => eng.readLabels(), tissueLine: i => eng.tissueLine(i), NL: eng.NL, readout: () => panels.readout(), inset: inset.st, swap: inset.swap, orbit: S.orbit, chip: () => $("chip").textContent,
      probeScreen(){ const r = document.getElementById("stage").getBoundingClientRect(); S.aimMain({ w: r.width, h: r.height }); const q = new THREE.Vector3(0, 3, 0).applyMatrix4(S.probeGroup.matrixWorld).project(S.mainCam); return [r.left+(q.x*.5+.5)*r.width, r.top+(-q.y*.5+.5)*r.height]; },
      zoneCentre: id => inset.zoneCentre(id),
      goToView: (id, instant) => APP.goToView(id, instant), tweening: () => !!APP.tween, refShown: () => APP.refShown && !$("refPane").hidden, refView: () => APP.refView, refLabels: () => refLabelList.map(l => l.text),
      setLandmarks: on => APP.setLandmarks(on), landmarks: () => APP.landmarks, visibleLandmarks: () => [...document.querySelectorAll("#lmLabels .lm")].filter(e => e.style.display !== "none" && !document.getElementById("lmLabels").hidden).map(e => e.textContent),
      handleScreen(k){ const r = document.getElementById("stage").getBoundingClientRect(); S.aimMain({ w: r.width, h: r.height }); S.patient.updateMatrixWorld(true);
        const o = k === "ring" ? new THREE.Vector3(2.6, 0, 0).applyMatrix4(S.ring.matrixWorld) : new THREE.Vector3().setFromMatrixPosition((k === "cap" ? S.cap : S.probeVis).matrixWorld).add(k === "body" ? new THREE.Vector3() : new THREE.Vector3());
        if (k === "body" || k === "face") o.copy(new THREE.Vector3(0, k === "face" ? 1.2 : 4.5, 0).applyMatrix4(S.probeVis.matrixWorld));
        const q = o.project(S.mainCam); return [r.left+(q.x*.5+.5)*r.width, r.top+(-q.y*.5+.5)*r.height]; },
      pick: (x, y, touch) => input.pick({ clientX: x, clientY: y, pointerType: touch ? "touch" : "mouse" }), setColourMode: m => S.setColourMode(m),
      heartMatrix: () => S.heartGroup.matrix.elements.slice(), roll: () => S.patient.rotation.y, img: APP.img,
      /* dev: the baked heart alone (front | back | left | cut = A4C plane), for before/after grids. Returns a PNG data URL. */
      heartShot(which, w = 560, h = 560){
        const T = THREE, rt = new T.WebGLRenderTarget(w, h, { samples: 4 }), cam = new T.PerspectiveCamera(30, w/h, 1, 300), hidden = [];
        S.scene.traverse(o => { if ((o.isMesh || o.isLine || o.isLineSegments || o.isPoints || o.isSprite) && o !== S.heart && o !== S.cutFace && o.visible){ hidden.push(o); o.visible = false; } });
        S.patient.updateMatrixWorld(true); S.syncProbe();
        S.heart.geometry.computeBoundingSphere(); const bs = S.heart.geometry.boundingSphere, hc = bs.center.clone().applyMatrix4(S.heart.matrixWorld), R = bs.radius;
        const dirs = { front: [0, 0, 1], back: [0, 0, -1], left: [1, .15, .1] }, cutOn = which === "cut";
        S.heart.visible = true; S.cutFace.visible = cutOn; cam.layers.enableAll();
        if (cutOn){ S.clip.setFromNormalAndCoplanarPoint(S.elevWorld.clone(), S.originWorld);
          const tg = S.originWorld.clone().addScaledVector(S.beamWorld, APP.img.depthCm*.55); cam.position.copy(tg).addScaledVector(S.elevWorld, -34); cam.up.copy(S.beamWorld).negate(); cam.lookAt(tg); }
        else { S.clip.constant = 1e5; const d = new T.Vector3(...dirs[which]).normalize().transformDirection(S.patient.matrixWorld); cam.position.copy(hc).addScaledVector(d, R*3.6); cam.up.set(0, 1, 0).transformDirection(S.patient.matrixWorld); cam.lookAt(hc); }
        cam.updateProjectionMatrix(); cam.updateMatrixWorld();
        renderer.setRenderTarget(rt); renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h); renderer.setClearColor(0x15181b, 1); renderer.clear(); renderer.render(S.scene, cam);
        const buf = new Uint8Array(w*h*4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf); renderer.setRenderTarget(null); rt.dispose();
        hidden.forEach(o => o.visible = true); S.clip.set(new T.Vector3(0, 0, 1), 1e5);
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const cx = cv.getContext("2d"), im = cx.createImageData(w, h);
        for (let y = 0; y < h; y++) im.data.set(buf.subarray((h-1-y)*w*4, (h-y)*w*4), y*w*4);
        cx.putImageData(im, 0, 0); return cv.toDataURL("image/png"); } };
  }
  boot().catch(e => { console.error(e); fail(e.message || String(e)); });
})();
