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
      pose: { x: 3, y: -8.9, notchDeg: -30, tiltDeg: 0, rockDeg: 0, pressCm: 0 }, pressAuto: true, frame: null, edOuterXY: 1, colors: {}, targets: {}, paneDragged: false };
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
    APP.applyDelta = d => { const p = APP.pose;
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
      if (S.heartReady()) S.bakeOrgans(pos); inset && inset.layoutZones(pos); if (snap) S.animateRoll(ph.positions[pos].bodyRollDeg, true); clearBeat(); applyPose(); syncAll();
      if (panels && !snap && pos === "LLD") panels.toast(ph.positions.LLD.teachingTooltip); };
    APP.setConvention = c => { if (c === APP.conv) return; APP.conv = c; pushImaging(); clearBeat(); syncAll();
      panels.toast(c === "POCUS" ? "POCUS: marker on the screen's left. The picture mirrors, so rotate the probe 180° to get the same image back." : "ASE: marker on the screen's right."); };
    APP.setMode = m => { APP.mode = m; syncAll(); };
    APP.setFrozen = f => { APP.frozen = f; clearBeat(); syncAll(); };
    APP.setFine = f => { APP.fine = f; syncAll(); };
    const BODY = ["skin", "ghost", "skeleton"]; APP.cycleBody = () => { APP.body = BODY[(BODY.indexOf(APP.body)+1)%3]; syncAll(); };
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

    /* ---- render loop ---- */
    let last = performance.now(), W = 0, H = 0, lastScore = 0, slow = 0, frameDt = .016;
    function resize(){ const w = innerWidth, h = innerHeight; if (w === W && h === H) return; W = w; H = h; renderer.setSize(w, h, false); }
    function drawAll(now, force){
      resize(); S.animateRoll(ph.positions[APP.position].bodyRollDeg, false, frameDt); S.syncProbe();
      renderer.setScissorTest(false); renderer.setClearColor(0, 0); renderer.clear();
      const rEcho = inset.rectOf($("echoScreen")), rMain = inset.rectOf($("stage")), vis = r => r.w > 2 && r.h > 2 && r.y < H && r.y+r.h > 0;
      /* echo: always computed (labels depend on it), Pass C drawn into the echo viewport */
      S.drawTo(vis(rEcho) ? rEcho : { x: 0, y: 0, w: 1, h: 1 }, H, 0);
      eng.render(APP.phase, APP.resp, APP.time, null, rEcho.w/Math.max(1, rEcho.h));
      S.updateBeat();
      if (vis(rMain)) S.renderMain(rMain, H);
      inset.render(H, W, now, force);
      renderer.setScissorTest(false);
      panels.drawEcg(); panels.drawOverlay();
    }
    let lastPose = "";
    function frame(now){
      requestAnimationFrame(frame);
      if (!innerWidth || !innerHeight || document.hidden) { last = now; return; }     // hidden lab iframe: nothing to draw
      const dt = Math.min(.1, (now-last)/1000); last = now; APP.time += dt; frameDt = dt;
      if (!APP.frozen){ APP.phase = (APP.phase + dt*APP.hr/60)%1; APP.resp = (APP.resp + dt*14/60)%1; }
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
    const info = S.bakeHeart(); await wait();
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
      heartMatrix: () => S.heartGroup.matrix.elements.slice(), roll: () => S.patient.rotation.y, img: APP.img };
  }
  boot().catch(e => { console.error(e); fail(e.message || String(e)); });
})();
