/* Dev slice lab: fast engine-only renders for anatomy work (no heart bake). window.SL.render(view, pos, opts) → {img, q, fails, line} */
(() => {
  const J = id => JSON.parse(document.getElementById(id).textContent), ph = J("phantom"), VJ = J("views");
  const W = 520, H = 400, cv = document.createElement("canvas"); cv.width = W; cv.height = H; document.body.appendChild(cv);
  const renderer = new THREE.WebGLRenderer({ canvas: cv, preserveDrawingBuffer: true }); renderer.setSize(W, H, false);
  let shaderErr = null; renderer.debug.onShaderError = (gl, prog, vs, fs) => { shaderErr = (gl.getShaderInfoLog(fs) || "") + (gl.getProgramInfoLog(prog) || ""); };
  const eng = EchoEngine(renderer, ph, { lines: 160, samples: 320 });
  const ctx = { trueLVLength: 8.5, ivcRadius: 0.9, landmarkInImage: () => null };
  const T = {}; for (const p of ["supine", "LLD"]) T[p] = DERIVE.derive(VJ, ph, p);
  window.SL = { ready: true, views: VJ.views.map(v => v.id), err: () => shaderErr, targets: T,
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
