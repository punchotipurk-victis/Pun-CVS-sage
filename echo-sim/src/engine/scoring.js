/* ===== SCORING: quality 0–100 = 0.5·poseScore + 0.5·contentScore, lock with hysteresis, one hint at a time =====
   poseScore compares the probe pose with the derived target (UI angles + skin distance).
   contentScore asks "does the IMAGE actually show this view?" from engine.readLabels() — so a different but valid
   pose that shows the right anatomy still scores well, and a near-target pose that hits a rib does not. */
const SCORING = (() => {
  const wrap = d => ((d + 540) % 360) - 180;
  function poseScore(pose, target, tol){
    const s = k => tol[k] / 1.5;
    const e = [Math.hypot(pose.x - target.x, pose.y - target.y)/s("positionCm"), wrap(pose.notchDeg - target.notchDeg)/s("rotationDeg"),
               (pose.tiltDeg - target.tiltDeg)/s("tiltDeg"), (pose.rockDeg - target.rockDeg)/s("rockDeg")];
    return { score: 100*Math.exp(-0.5*e.reduce((a,b)=>a+b*b, 0)), errs: { pos: e[0], rot: e[1], tilt: e[2], rock: e[3] } };
  }
  const has = (L, id) => { const hit = Object.keys(L).filter(k => k === id || k.startsWith(id + ".")); return hit.length ? hit : null; };
  const sumArea = (L, id) => (has(L,id)||[]).reduce((a,k)=>a+L[k].area, 0);
  const maxLen = (L, id) => Math.max(0, ...(has(L,id)||[]).map(k=>L[k].major));
  /* named shape checks used in views.json contentChecks.shapeChecks[].id; unknown ids are skipped (warned once) */
  /* Merge label regions into one (area-weighted mean + covariance, rebuilt from major/minor/angle: major = 4√λ1, minor = 4√λ2).
     Used where a reader judges one outline that the model labels as two regions (LV cavity + LVOT). */
  function merged(L, ids){
    const parts = ids.map(id => L[id]).filter(Boolean); if (!parts.length) return null; if (parts.length === 1) return parts[0];
    const W = parts.reduce((a, o) => a + o.area, 0), cx = parts.reduce((a, o) => a + o.cx*o.area, 0)/W, cy = parts.reduce((a, o) => a + o.cy*o.area, 0)/W;
    let sxx = 0, syy = 0, sxy = 0;
    for (const o of parts){ const l1 = (o.major/4)**2, l2 = (o.minor/4)**2, a = o.angleDeg*Math.PI/180, c = Math.cos(a), s = Math.sin(a);
      const vxx = l1*c*c + l2*s*s, vyy = l1*s*s + l2*c*c, vxy = (l1 - l2)*c*s, dx = o.cx - cx, dy = o.cy - cy;
      sxx += o.area*(vxx + dx*dx); syy += o.area*(vyy + dy*dy); sxy += o.area*(vxy + dx*dy); }
    sxx /= W; syy /= W; sxy /= W; const tr = sxx + syy, det = sxx*syy - sxy*sxy, l1 = tr/2 + Math.sqrt(Math.max(0, tr*tr/4 - det)), l2 = Math.max(0, tr - l1);
    return { area: W, cx, cy, major: 4*Math.sqrt(l1), minor: 4*Math.sqrt(l2), angleDeg: 0.5*Math.atan2(2*sxy, sxx - syy)*180/Math.PI,
             minDepth: Math.min(...parts.map(o => o.minDepth)), maxDepth: Math.max(...parts.map(o => o.maxDepth)) };
  }
  const CHECKS = {
    lv_round:          (L,c) => { const o = merged(L, ["LV_cavity", "LVOT"]); return !!o && o.minor/o.major >= (c.min || 0.8); },   // whole LV blood pool: at basal levels the outflow tract is part of the LV outline
    av_round:          (L)   => { const o = L.aortic_root; return !!o && o.minor/o.major >= 0.8; },
    not_foreshortened: (L,c,x) => { const o = L.LV_cavity; return !!o && o.major >= 0.9*x.trueLVLength; },
    apex_at_top:       (L)   => { const o = L.LV_cavity; return !!o && o.minDepth < 6; },
    septum_vertical:   (L)   => { const o = L.IVS; return !!o && Math.abs(Math.abs(o.angleDeg) - 90) < 20; },
    aorta_LV_horizontal:(L)  => { const a = L.aortic_root, v = L.LV_cavity; if (!a || !v) return false;         // LV→Ao centroid line vs horizontal
                                  return Math.abs(Math.atan2(a.cy - v.cy, a.cx - v.cx)*180/Math.PI) % 180 < 25 || Math.abs(Math.atan2(a.cy - v.cy, a.cx - v.cx)*180/Math.PI) > 155; },
    fish_mouth:        (L)   => !!L.MV_AML && !!L.MV_PML,
    mv_av_both:        (L)   => !!has(L,"AV_cusps") && !!has(L,"MV_AML"),
    ias_perpendicular: (L)   => { const o = L.IAS; return !!o && Math.abs(o.angleDeg) < 45; },
    lvot_aligned:      (L)   => { const o = L.LVOT; return !!o && Math.abs(Math.abs(o.angleDeg) - 90) < 30; },
    not_cylinder_effect:(L,c,x) => { const o = L.IVC; return !!o && o.minor >= 0.9*2*x.ivcRadius; }
  };
  const warned = new Set();
  function contentScore(view, L, ctx){
    const cc = view.contentChecks || {}, parts = [], fails = [];
    for (const m of cc.mustSee || []){
      let ok;
      if (m.count) ok = (has(L, m.id) || []).filter(k => L[k].area > 0.15 || L[k].major > 0.6).length >= m.count;   // thin parts (cusps) count by length
      else if (m.minLenCm) ok = maxLen(L, m.id) >= m.minLenCm;
      else ok = sumArea(L, m.id) >= (m.minAreaCm2 || 0.8);
      parts.push(ok); if (!ok) fails.push("missing:" + m.id);
    }
    for (const m of cc.mustNotSee || []){
      let ok = true;
      if (ctx.landmarkInImage && ctx.landmarkInImage(m.id) !== null) ok = !ctx.landmarkInImage(m.id);   // landmarks (e.g. LV_apex_endo)
      else ok = sumArea(L, m.id) < 0.5;
      parts.push(ok); if (!ok) fails.push("unwanted:" + m.id);
    }
    for (const s of cc.shapeChecks || []){
      const fn = CHECKS[s.id]; if (!fn){ if (!warned.has(s.id)){ warned.add(s.id); console.warn("no shape check", s.id); } continue; }
      const ok = fn(L, s, ctx); parts.push(ok); if (!ok) fails.push("shape:" + s.id);
    }
    return { score: parts.length ? 100*parts.filter(Boolean).length/parts.length : 0, fails };
  }
  /* Lock state machine per view: lock at ≥80 held 0.5 s, unlock below 65 */
  function makeLock(){ let since = null, locked = false;
    return (q, now) => { if (locked){ if (q < 65) locked = false; } else if (q >= 80){ since ??= now; if (now - since >= 500) locked = true; } else since = null; return locked; }; }
  /* One hint, in sonographer language, for the largest normalised error */
  function hint(errs, T, view){
    const big = Object.entries(errs).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))[0]; if (!big || Math.abs(big[1]) < 1) return null;
    const [k, e] = big, deg = v => Math.round(Math.abs(v)/5)*5 || 5;
    if (k === "rot")  return (e > 0 ? T["rotation-"] : T["rotation+"]).replace("{deg}", deg(e*view.tolerance.rotationDeg/1.5));
    if (k === "tilt") return (e > 0 ? T["tilt-"] : T["tilt+"]).replace("{deg}", deg(e*view.tolerance.tiltDeg/1.5));
    if (k === "rock") return (e > 0 ? T["rock-"] : T["rock+"]).replace("{deg}", deg(e*view.tolerance.rockDeg/1.5));
    return null;   // position: the caller turns the skin-distance vector into slideUp/slideDown/slideMedial/slideLateral
  }
  return { poseScore, contentScore, makeLock, hint, CHECKS, merged };
})();
