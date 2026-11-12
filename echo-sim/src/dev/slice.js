/* Dev slice lab: fast engine-only renders for anatomy work (no heart bake). window.SL.render(view, pos, opts) → {img, q, fails, line} */
(() => {
  const J = id => JSON.parse(document.getElementById(id).textContent), ph = J("phantom"), VJ = J("views");
  const W = 520, H = 400, cv = document.createElement("canvas"); cv.width = W; cv.height = H; document.body.appendChild(cv);
  const renderer = new THREE.WebGLRenderer({ canvas: cv, preserveDrawingBuffer: true }); renderer.setSize(W, H, false);
  let shaderErr = null; renderer.debug.onShaderError = (gl, prog, vs, fs) => { shaderErr = (gl.getShaderInfoLog(fs) || "") + (gl.getProgramInfoLog(prog) || ""); };
  const eng = EchoEngine(renderer, ph, { lines: 160, samples: 320 });
  const ctx = { trueLVLength: 8.5, ivcRadius: 0.9, landmarkInImage: () => null };
  const T = {}; for (const p of ["supine", "LLD"]) T[p] = DERIVE.derive(VJ, ph, p);
  window.SL = { _eng: eng, _renderer: renderer, ready: true, views: VJ.views.map(v => v.id), err: () => shaderErr, targets: T,
    render(viewId, pos = "supine", o = {}){
      const v = VJ.views.find(x => x.id === viewId), tg = T[pos][viewId];
      const pose = { x: tg.x + (o.dx || 0), y: tg.y + (o.dy || 0), notchDeg: tg.notchDeg + (o.notch || 0), tiltDeg: tg.tiltDeg + (o.tilt || 0), rockDeg: tg.rockDeg + (o.rock || 0) };
      eng.setPatientPosition(pos); eng.setProbe(PROBE.frame(pose), VJ.windows[v.window].pressCm || 0);
      if (o.debugPal){ eng.uniforms.uPalette.value.forEach((c, i) => { const h = (i*0.381966) % 1; const col = new THREE.Color().setHSL(h, .9, .55); c.set(col.r, col.g, col.b); }); } else eng.setPalette(ph.palette_anatomyTint);
      eng.setImaging({ depthCm: o.depth || v.image.depthCm, sectorDeg: v.image.sectorDeg, gainDb: 0, markerRight: true, tint: o.tint ?? false });
      let best = null; const phases = o.phases || [0, .06, .2, .38, .53, .62, .75, .92];
      for (const t of phases){ eng.render(t, 0, 1, null, W/H); const c = SCORING.contentScore(v, eng.readLabels(), ctx); if (!best || c.score > best.score) best = { ...c, t }; }
      eng.render(o.t || 0, 0, 1, null, W/H);
      const ps = SCORING.poseScore(pose, tg, v.tolerance);
      return { depth: o.depth || v.image.depthCm, sector: v.image.sectorDeg, img: cv.toDataURL(), q: .5*ps.score + .5*best.score, fails: best.fails, labels: eng.readLabels(), line: eng.tissueLine(eng.NL >> 1), err: shaderErr };
    } };
})();
/* Dev ray-caster: first non-blood hit along parallel rays, in the heart frame, from the same scene() as the echo.
   SL.raycast({o:[heart xyz], x:[...], y:[...], z:[view dir], half:cm, max:cm, step:cm, t:phase, size:px}) → {w,h,data:[R=label,G=tissue,B,A=depth16]} */
(() => {
  const T = THREE, eng = SL._eng, R = SL._renderer;
  const mat = new T.RawShaderMaterial({ glslVersion: T.GLSL3, uniforms: { ...eng.uniforms, uH2B: { value: new T.Matrix4() }, uCo: { value: new T.Vector3() }, uCx: { value: new T.Vector3() }, uCy: { value: new T.Vector3() }, uCz: { value: new T.Vector3() }, uHalf: { value: 4 }, uMax: { value: 6 }, uStep: { value: .03 } },
    vertexShader: `in vec3 position; out vec2 vUv; void main(){ vUv = position.xy*0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `precision highp float; precision highp int; uniform mat4 uH2B; uniform vec3 uCo, uCx, uCy, uCz; uniform float uHalf, uMax, uStep;
${eng.glsl}
in vec2 vUv; out vec4 o;
bool solidT(int t){ return !(t == 0 || t == 1 || t == 13 || t == 14 || t == 15 || t == 16); }
void main(){ vec2 s = (vUv*2.0 - 1.0)*uHalf; vec3 ro = uCo + uCx*s.x + uCy*s.y; int tt, ll; float t = 0.0, hit = -1.0;
  for (int i = 0; i < 360; i++){ scene((uH2B*vec4(ro + uCz*t, 1.0)).xyz, tt, ll); if (solidT(tt)){ hit = t; break; } t += uStep; if (t > uMax) break; }
  if (hit < 0.0){ o = vec4(0.0); return; }
  float a = hit - uStep, b = hit; for (int k = 0; k < 6; k++){ float m = 0.5*(a+b); scene((uH2B*vec4(ro + uCz*m, 1.0)).xyz, tt, ll); if (solidT(tt)) b = m; else a = m; }
  scene((uH2B*vec4(ro + uCz*b, 1.0)).xyz, tt, ll); float e = floor(clamp(b/uMax, 0.0, 1.0)*65535.0);
  o = vec4(float(ll)/255.0, float(tt)/255.0, floor(e/256.0)/255.0, mod(e, 256.0)/255.0); }` });
  const scn = new T.Scene(), cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), q = new T.Mesh(new T.PlaneGeometry(2, 2), mat); q.frustumCulled = false; scn.add(q);
  SL.raycast = (o) => { const N = o.size || 420, rt = new T.WebGLRenderTarget(N, N, { minFilter: T.NearestFilter, magFilter: T.NearestFilter });
    eng.setPatientPosition("supine"); eng.render(o.t || 0, 0, 1, null, 1);           // sets uP for the phase
    const U = mat.uniforms; U.uH2B.value.copy(eng.uniforms.uW2H.value).invert(); U.uCo.value.set(...o.o); U.uCx.value.set(...o.x); U.uCy.value.set(...o.y); U.uCz.value.set(...o.z);
    U.uHalf.value = o.half || 4; U.uMax.value = o.max || 6; U.uStep.value = o.step || .03;
    R.setRenderTarget(rt); R.render(scn, cam); const buf = new Uint8Array(N*N*4); R.readRenderTargetPixels(rt, 0, 0, N, N, buf); R.setRenderTarget(null); rt.dispose();
    return { w: N, h: N, data: Array.from(buf), labels: PHANTOM.LABELS }; };
})();
