/* ===== PHANTOM: phantom-normal.json → (1) GLSL scene function for the GPU, (2) per-frame parameter values =====
   One JSON = one source of truth. The same GLSL drives the echo image AND the cut face in the Heart cutaway pane,
   so what the learner sees in 3D is exactly what the echo shows.
   Coordinates: patient frame (cm). Heart structures are evaluated in the heart frame via uniform uW2H. */
const PHANTOM = (() => {
  /* ---- tissue + label tables ---- */
  const TISSUES = ["none","blood","myocardium","valve","fibrous","pericardium","fat","chest_wall","liver","diaphragm",
                   "vessel_wall","cartilage","bone","lung","gas","fluid","soft"];
  const T = Object.fromEntries(TISSUES.map((t,i)=>[t,i]));
  /* Label ids = structure ids used in views.json (labels, contentChecks). Display text lives in LABEL_TEXT. */
  const LABELS = ["", "LV_cavity","RV_cavity","LA","RA","LVOT","RVOT","aortic_root","aortic_root.ascending","PA_main","LAA","pulmonary_veins",
    "coronary_sinus","MV_AML","MV_PML","TV_septal","TV_anterior","AV_cusps.RCC","AV_cusps.LCC","AV_cusps.NCC","PV_cusps",
    "papillary_muscles.ALPM","papillary_muscles.PMPM","moderator_band","IVS","PW","LV_myocardium","RV_free_wall","pericardium","liver",
    "diaphragm","IVC","hepatic_veins","descending_aorta","descending_aorta.abdominal","ribs","sternum","lungs","stomach_gas","chest_wall","IAS","LA_wall","RA_wall"];
  const LABEL_TEXT = { LV_cavity:"LV", RV_cavity:"RV", LA:"LA", RA:"RA", LVOT:"LVOT", RVOT:"RVOT", aortic_root:"Ao root", "aortic_root.ascending":"Asc. aorta",
    PA_main:"PA", LAA:"LAA", pulmonary_veins:"Pulm. veins", coronary_sinus:"Coronary sinus", MV_AML:"AML", MV_PML:"PML", TV_septal:"TV (septal)",
    TV_anterior:"TV (anterior)", "AV_cusps.RCC":"RCC", "AV_cusps.LCC":"LCC", "AV_cusps.NCC":"NCC", PV_cusps:"PV", "papillary_muscles.ALPM":"ALPM",
    "papillary_muscles.PMPM":"PMPM", moderator_band:"Moderator band", IVS:"IVS", PW:"Posterior wall", LV_myocardium:"LV wall", RV_free_wall:"RV free wall",
    pericardium:"Pericardium", liver:"Liver", diaphragm:"Diaphragm", IVC:"IVC", hepatic_veins:"Hepatic vein", descending_aorta:"Desc. Ao",
    "descending_aorta.abdominal":"Abd. aorta", ribs:"Rib", sternum:"Sternum", lungs:"Lung", stomach_gas:"Stomach gas", chest_wall:"Chest wall", IAS:"IAS", LA_wall:"LA wall", RA_wall:"RA wall" };
  const Lb = Object.fromEntries(LABELS.map((t,i)=>[t,i]));

  /* ---- cycle: monotone cubic interpolation of keyframes (no overshoot) ---- */
  function interp(keys, t){
    t = ((t%1)+1)%1; let i = 0; while (i < keys.length-2 && t > keys[i+1][0]) i++;
    const [t0,v0] = keys[i], [t1,v1] = keys[i+1], u = t1>t0 ? (t-t0)/(t1-t0) : 0;
    const s = u*u*(3-2*u);                                   // smoothstep ease: monotone, flat at keyframes
    return v0 + (v1-v0)*s;
  }
  function paramNames(ph){
    const P = ph.cycle.params, names = Object.keys(P).filter(k=>!k.startsWith("_"));
    return names.concat(["IVC_r","effusion_cm"]);
  }
  /* Evaluate every parameter at cardiac phase t and respiratory phase tr → Float32Array (index = paramNames order) */
  function makeParamEval(ph){
    const names = paramNames(ph), P = ph.cycle.params, out = new Float32Array(names.length);
    return (t, tr, extra={}) => {
      const val = {};
      for (const n of names) {
        const v = P[n];
        if (Array.isArray(v)) val[n] = interp(v, t);
      }
      for (const n of names) {
        const v = P[n];
        if (typeof v === "string") { const m = /^([\d.]+)\s*\*\s*(\w+)$/.exec(v); val[n] = m ? (+m[1])*val[m[2]] : 0; }
      }
      val.IVC_r = interp(ph.respiration.IVC_r, tr);
      val.effusion_cm = extra.effusion_cm ?? 0;
      names.forEach((n,i)=> out[i] = val[n] ?? 0);
      return out;
    };
  }

  /* ---- GLSL generation helpers ---- */
  const f = x => (Number.isInteger(x) ? x.toFixed(1) : (+x).toFixed(4));
  function compile(ph){
    const names = paramNames(ph), pidx = Object.fromEntries(names.map((n,i)=>[n,i]));
    const L = ph.landmarks_heart, A = ph.axes_heart, S = ph.structures, E = ph.extracardiac_patient;
    const num = v => (v && typeof v === "object" && v.param) ? `uP[${pidx[v.param]}]` : f(v);
    const v3 = a => typeof a === "string" ? `vec3(${L[a].map(f).join(",")})` : `vec3(${a.map(num).join(",")})`;
    const nrm = a => { const l = Math.hypot(...a); return a.map(x=>x/l); };
    const ln = [];   // body lines of scene()
    /* swept tube along a polyline (heart frame): radius tapers r0 → r1, joints smooth-blended (k) so it reads as one bent vessel */
    const tube = (pts, r0, r1 = r0, k = 0.25) => { const P = pts.map(v3); let e = "";
      for (let i = 0; i < P.length-1; i++){ const ra = r0 + (r1-r0)*i/(P.length-1), rb = r0 + (r1-r0)*(i+1)/(P.length-1);
        const seg = `sdRoundCone(h, ${P[i]}, ${P[i+1]}, ${f(ra)}, ${f(rb)})`; e = e ? `smin(${e}, ${seg}, ${f(k)})` : seg; }
      return e; };
    const add = s => ln.push("  " + s);

    /* -------- body wall first: skin, sternum, ribs, spine, chest wall (they must win over everything deeper) -------- */
    const tor = E.torso, hw = tor.halfWidthX, hd = tor.halfDepthZ, cz = tor.center_xz[1];
    add(`float skinZ = ${f(cz)} + ${f(hd)}*sqrt(max(0.0, 1.0 - (p.x*p.x)/${f(hw*hw)}));`);
    add(`float depth = skinZ - p.z;`);
    add(`if (depth < 0.0) { tissue = ${T.none}; label = 0; return; }`);
    add(`if (uSkipBody < 0.5) {`);   // the 3D-heart bake skips the body wall so the heart is meshed whole (the echo never sets this)
    /* sternum */
    const st = E.sternum;
    add(`if (p.y < ${f(st.items[0].yRange[0])} && p.y > ${f(st.items[2].yRange[1])} && p.z < ${f(st.frontZ)} && p.z > ${f(st.frontZ - st.thickness)}) {`);
    add(`  float hwS = p.y > ${f(st.items[0].yRange[1])} ? ${f(st.items[0].halfWidth[1])} : (p.y > ${f(st.items[1].yRange[1])} ? ${f(st.items[1].halfWidth[0])} : mix(${f(st.items[2].halfWidth[0])}, ${f(st.items[2].halfWidth[1])}, (${f(st.items[2].yRange[0])} - p.y)/${f(st.items[2].yRange[0]-st.items[2].yRange[1])}));`);
    add(`  if (abs(p.x) < hwS) { tissue = ${T.bone}; label = ${Lb["sternum"]}; return; } }`);
    /* ribs (anterior arcs) above the costal margin */
    add(`{ float ax_ = abs(p.x); float cm = costalY(ax_);`);
    add(`  if (p.y > cm && depth > ${f(1.0 - E.ribs.thickness/2)} && depth < ${f(1.0 + E.ribs.thickness/2)}) {`);
    add(`    float sl = 0.25*max(0.0, ax_ - 3.0); float n = floor((-0.875 - sl - p.y)/2.25 + 0.5);`);
    add(`    float yc = -0.875 - 2.25*n - sl; float icsW = 2.25 * uRibSpaceScale;`);
    add(`    if (n >= 1.0 && n <= 10.0 && abs(p.y - yc) < ${f(E.ribs.craniocaudalWidth/2)}) {`);
    add(`      float cc = n < 1.5 ? 3.5 : (n < 2.5 ? 4.5 : (n < 3.5 ? 5.5 : (n < 4.5 ? 6.5 : (n < 5.5 ? 7.5 : (n < 7.5 ? 8.0 : 9.0 + (n-8.0))))));`);
    add(`      tissue = ax_ < cc ? ${T.cartilage} : ${T.bone}; label = ${Lb["ribs"]}; return; } } }`);
    add(`if (abs(p.x) < 2.2 && p.z < -13.5 && p.z > -17.5) { tissue = ${T.bone}; label = 0; return; }`);
    add(`if (depth < ${f(E.chest_wall.thickness)}) { tissue = ${T.chest_wall}; label = ${Lb["chest_wall"]}; return; }`);
    add(`}`);
    /* -------- heart (heart frame, variable h) -------- */
    const lvc = S.LV_cavity.of, lvm = S.LV_myocardium.from.of;
    add(`vec3 h = (uW2H * vec4(p,1.0)).xyz;`);
    add(`float dHeartBound = length(h - vec3(1.0,0.0,1.5)) - 11.0;`);
    add(`if (dHeartBound < 0.0) {`);
    add(` float mvz = uP[${pidx.MV_annulusZ}];`);
    /* LV = bullet: ellipsoid ∪ round cone (conical apex), wall = outer − inner semi-axis, thinner toward the apex */
    const bul = S.LV_cavity.bullet || { apexCapRadius: 0.6, blend: 0.6, apicalWallFactor: 0.8 };
    add(` float rB = uP[${pidx.LV_semiXY}], apexZ = uP[${pidx.LV_centerZ}] + uP[${pidx.LV_semiZ}];`);
    add(` float lvShape = smin(sdEllipsoid(h - ${v3(lvc.center)}, ${v3(lvc.semi)}), sdRoundCone(h, vec3(0.0,0.0,mvz + 0.9*rB), vec3(0.0,0.0,apexZ - ${f(bul.apexCapRadius)}), rB, ${f(bul.apexCapRadius)}), ${f(bul.blend)});`);
    add(` float lvWall = (uP[${pidx.LV_outerXY}] - uP[${pidx.LV_semiXY}]) * mix(1.0, ${f(bul.apicalWallFactor)}, clamp((h.z - mvz)/7.0, 0.0, 1.0));`);
    const nA = nrm(S.MV_annulus.normal || [0,0,1]);
    add(` vec3 nA = ${v3(nA)}; float annD = dot(h - vec3(0.0,0.0,mvz), nA);   // signed distance to the (tilted) mitral annulus plane`);
    add(` float lvOut = max(lvShape - lvWall, -(annD + 0.3));`);
    add(` float lvCav = max(lvShape, -annD);`);
    add(` float lvot  = sdCapsule(h, ${v3(S.LVOT.a)}, ${v3(S.LVOT.b)}, ${f(S.LVOT.r)});`);
    const rv = S.RV_cavity.from;
    add(` vec3 rvC = ${v3(rv.center)}; vec3 rvS = ${v3(rv.semi)};`);
    add(` float rvOut = sdEllipsoid(h - rvC, rvS + vec3(0.4));`);
    add(` float rvCav = max(sdEllipsoid(h - rvC, rvS), -lvOut);`);
    if (S.RVOT.points) add(` float rvot = ${tube(S.RVOT.points.concat([S.RVOT.b]), S.RVOT.rStart ?? 1.3, S.RVOT.rEnd ?? 1.2, 0.5)} + (${num(S.RVOT.r)} - ${f(S.RVOT.rStart ?? 1.3)});`);   // conus: curved tube TV side → over the aorta → PV
    else add(` float rvot  = sdCapsule(h, ${v3(S.RVOT.a)}, ${v3(S.RVOT.b)}, ${num(S.RVOT.r)});`);
    add(` rvot = max(rvot, -lvOut);`);                               // RVOT never eats the LV/septum
    add(` float rvotW = rvot - 0.35;`);
    add(` float pa    = sdCapsule(h, ${v3(S.PA_main.a)}, ${v3(S.PA_main.b)}, ${f(S.PA_main.r)});`);
    const la = S.LA, ra = S.RA;
    const LD = la.detail || { vestibuleRadius: 1.4, vestibuleBlend: 0.8, veinBlend: 0.5, laaBlend: 0.4, wobble: 0.15 };
    const RD = ra.detail || { vestibuleRadius: 1.3, vestibuleBlend: 0.8, wobble: 0.15 };
    if (S.LAA.points) add(` float laa = ${tube(S.LAA.points, S.LAA.r, S.LAA.rTip ?? S.LAA.r*0.6, 0.3)};`);   // narrow finger, tapering, curving round the PA
    else add(` float laa   = sdCapsule(h, ${v3(S.LAA.a)}, ${v3(S.LAA.b)}, ${f(S.LAA.r)});`);
    add(` float pvn = 1e3;`);
    for (const it of S.pulmonary_veins.items) add(` pvn = min(pvn, sdCapsule(h, ${v3(it.a)}, ${v3(it.b)}, ${f(it.r)}));`);
    /* organic LA: ellipsoid + low-frequency wobble + funnel into the MV + PV ostia + LAA, clipped at the annulus plane */
    add(` vec3 laC = ${v3(la.center)};`);
    add(` float laRaw = sdEllipsoid(h - laC, ${v3(la.semi)}) + wobble(h - laC, ${f(LD.wobble)});`);
    add(` laRaw = smin(laRaw, sdCapsule(h, laC, vec3(0.0,0.0,mvz - 0.2), ${f(LD.vestibuleRadius)}), ${f(LD.vestibuleBlend)});`);
    add(` laRaw = smin(laRaw, pvn, ${f(LD.veinBlend)}); laRaw = smin(laRaw, laa, ${f(LD.laaBlend)});`);
    add(` laRaw = max(laRaw, annD - 0.1);`);
    /* organic RA: ellipsoid + wobble + funnel into the TV + SVC + RA appendage */
    add(` vec3 raC = ${v3(ra.center)}; float tvzR = uP[${pidx.TV_annulusShiftZ}] * 0.8;`);
    add(` float raRaw = sdEllipsoid(h - raC, ${v3(ra.semi)}) + wobble(h - raC + vec3(1.3), ${f(RD.wobble)});`);
    add(` raRaw = smin(raRaw, sdCapsule(h, raC, ${v3(S.TV_annulus.center)} + vec3(0.0,0.0,tvzR - 0.3), ${f(RD.vestibuleRadius)}), ${f(RD.vestibuleBlend)});`);
    if (RD.svc) add(` raRaw = smin(raRaw, sdCapsule(h, ${v3(RD.svc.a)}, ${v3(RD.svc.b)}, ${f(RD.svc.r)}), 0.6);`);
    if (RD.raa) add(` raRaw = smin(raRaw, sdCapsule(h, ${v3(RD.raa.a)}, ${v3(RD.raa.b)}, ${f(RD.raa.r)}), 0.6);`);
    add(` raRaw = max(raRaw, h.z - (${f(S.TV_annulus.center === "TV_center" ? L.TV_center[2] : 0.8)} + tvzR + 0.1));`);
    /* interatrial septum: each atrium is carved by the other + wall, so a real septum remains between them */
    const iasW = (S.IAS && S.IAS.carve) || 0.35;
    add(` float laCav = max(laRaw, -(raRaw - ${f(iasW)}));`);
    add(` float raCav = max(raRaw, -(laRaw - ${f(iasW)}));`);
    const cs = S.coronary_sinus.points;
    add(` float csv = min(sdCapsule(h, ${v3(cs[0])}, ${v3(cs[1])}, ${f(S.coronary_sinus.r)}), sdCapsule(h, ${v3(cs[1])}, ${v3(cs[2])}, ${f(S.coronary_sinus.r)}));`);
    /* aortic root as a lathe: radius profile along the root axis */
    const ar = S.aortic_root, ax = nrm(A.aortic_root), prof = ar.profile;
    add(` vec3 aAx = ${v3(ax)}; vec3 aO = ${v3(ar.axisOrigin)};`);
    add(` float at = clamp(dot(h - aO, aAx), 0.0, ${f(prof[prof.length-1][0])});`);
    let rexpr = f(prof[prof.length-1][1]);
    for (let i = prof.length-2; i >= 0; i--) {
      const [t0,r0] = prof[i], [t1,r1] = prof[i+1];
      rexpr = `(at < ${f(t1)} ? mix(${f(r0)}, ${f(r1)}, (at - ${f(t0)}) / ${f(t1-t0)}) : ${rexpr})`;
    }
    add(` float aoLum = length(h - (aO + aAx*at)) - ${rexpr};`);
    add(` aoLum = max(aoLum, -dot(h - aO, aAx));`);       // starts at the annulus
    add(` float aoWall = aoLum - ${f(ar.wall)};`);
    if (S.LVOT.anteriorWall){ const aw = S.LVOT.anteriorWall;
      /* the basal septum runs on into the anterior aortic wall: myocardium round the LVOT on the side away from the mitral valve
         (the posterior LVOT wall is the AML, in fibrous continuity with the posterior aortic wall) */
      add(` vec3 dPost = normalize((vec3(0.0) - aO) - aAx*dot(vec3(0.0) - aO, aAx));`);
      add(` float lvotW = max(max(sdCapsule(h, aO - aAx*${f(aw.length ?? 1.2)}, aO, ${f(S.LVOT.r + aw.thickness)}), dot(h - aO, dPost) - ${f(aw.postOffset ?? 0.3)}), dot(h - aO, aAx) - 0.2);`);
      add(` lvOut = min(lvOut, lvotW); rvot = max(rvot, -(lvotW + 0.05)); rvCav = max(rvCav, -(lvotW + 0.05));`); }
    add(` rvot = max(rvot, -(aoLum - 0.35)); rvCav = max(rvCav, -(aoLum - 0.35));`);   // keep a wall between RVOT and the aortic root
    add(` laCav = max(laCav, -(aoLum - 0.3)); raCav = max(raCav, -(aoLum - 0.3));`);     // aorto-atrial walls
    add(` laCav = max(laCav, -(lvOut + 0.05)); raCav = max(raCav, -(rvOut + 0.05));`);   // atria never eat ventricular wall
    add(` float atrWall = min(laRaw, raRaw) - 0.25;`);
    /* heart solid (myocardium + atrial walls) */
    add(` float solid = smin(smin(lvOut, rvOut, 0.6), atrWall, 0.6);`);
    add(` solid = min(solid, rvotW);`);
    /* valves */
    /* curved, tapered leaflet: centre-line bows (toward bowClosed in systole, bowOpen in diastole), thins toward the tip,
       narrows toward the free edge, and the free edge curls back toward the annulus (arc in short axis = fish mouth) */
    function leaflet(name, s, annZ) {
      const ot = nrm(s.openToward), dc = nrm(s.dirClosed), sc = s.openAngle.scale ?? 1, L = s.length;
      const bc = nrm(s.bowClosed || [0,0,-1]), bo = nrm(s.bowOpen || s.openToward);
      add(` { float a = radians(uP[${pidx[s.openAngle.param]}] * ${f(sc)}); float of = clamp(a / radians(70.0), 0.0, 1.0);`);
      add(`   vec3 dc = ${v3(dc)}; vec3 ot = normalize(${v3(ot)} - dot(${v3(ot)}, dc)*dc);`);
      add(`   vec3 dir = normalize(dc*cos(a) + ot*sin(a)); vec3 w = normalize(cross(dir, ot));`);
      add(`   vec3 bw = mix(${v3(bc)}, ${v3(bo)}, of); bw = bw - dot(bw,dir)*dir - dot(bw,w)*w; bw = dot(bw,bw) > 1e-6 ? normalize(bw) : normalize(cross(w,dir));`);
      add(`   float curv = mix(${f(s.curvatureClosed ?? 0.2)}, ${f(s.curvatureOpen ?? 0.4)}, of), kw = ${f(s.widthCurl ?? 0.2)};`);
      add(`   vec3 q = h - (${v3(s.hinge)} + vec3(0.0,0.0,${annZ}));`);
      add(`   float qw = dot(q, w), ua = dot(q, dir) + kw*qw*qw, u = clamp(ua, 0.0, ${f(L)}), fu = u/${f(L)};`);
      const hn = s.hinge, hl = Math.hypot(hn[0], hn[1]) || 1, tc = [-hn[0]/hl, -hn[1]/hl, 0];   // toward the orifice centre
      add(`   vec3 c = dir*(u - kw*qw*qw) + bw*(curv*u*fu) + ${v3(tc)}*(${f(s.arc ?? 0.25)}*qw*qw) + w*qw;   // width arc: commissures curve toward the orifice centre`);
      add(`   float t = mix(${f(s.thickness)}, ${f(s.tipThickness ?? s.thickness*0.6)}, fu), hw = ${f(s.width/2)}*sqrt(max(0.0, 1.0 - 0.5*fu*fu));`);
      add(`   ${name} = max(max(length(q - c) - 0.5*t, abs(qw) - hw), max(-ua, ua - ${f(L)})); }`);
    }
    add(` float aml, pml, tvs, tva;`);
    leaflet("aml", S.MV_AML, "mvz"); leaflet("pml", S.MV_PML, "mvz");
    add(` float tvz = uP[${pidx.TV_annulusShiftZ}] * 0.8;`);
    leaflet("tvs", S.TV_septal, "tvz"); leaflet("tva", S.TV_anterior, "tvz");
    add(` vec3 qa = h - vec3(0.0,0.0,mvz); float mvAnn = length(vec2(length(qa - nA*dot(qa,nA)) - ${f(S.MV_annulus.R)}, dot(qa,nA))) - ${f(S.MV_annulus.r)};`);
    /* aortic cusps: closed = 3 thin radial plates toward the commissures (= −cusp direction) → Mercedes Y */
    const cu = S.AV_cusps, dirs = A.AV_cusp_dirs;
    add(` float avc = 1e3; int avk = 0; { float of = uP[${pidx.AV_open}]; vec3 c0 = ${v3(cu.center)};`);
    for (const k of ["RCC","LCC","NCC"]) {
      const d = dirs[k].map(x=>-x);
      add(`   { vec3 cd = ${v3(d)}; vec3 q = h - c0 - aAx*${f(cu.height/2)}; float r0 = mix(0.0, ${f(cu.radius*0.85)}, of);`);
      add(`     vec3 a0 = cd*r0, a1 = cd*${f(cu.radius)}; vec3 pa_ = q - a0, ba = a1 - a0; float hh = clamp(dot(pa_,ba)/max(dot(ba,ba),1e-4),0.0,1.0);`);
      add(`     float rq = length(q - aAx*dot(q, aAx)) / ${f(cu.radius)};`);
      add(`     vec3 rr = pa_ - ba*hh; float ax_ = dot(rr, aAx) + ${f(cu.bellySag ?? 0.3)}*(1.0 - of)*(1.0 - min(rq*rq, 1.0)); vec3 rad = rr - aAx*dot(rr, aAx);`);
      add(`     float dc_ = max(length(rad) - ${f(cu.thickness)}, abs(ax_) - ${f(cu.height/2)}); if (dc_ < avc) { avc = dc_; avk = ${Lb["AV_cusps."+k]}; } }`);
    }
    add(` }`);
    /* pulmonary valve: same idea, smaller */
    add(` vec3 pvAx = normalize(${v3(S.PA_main.b)} - ${v3(S.PA_main.a)});`);
    /* closed = thin disc across the PA; open = disc with a central hole (radius grows with PV_open) */
    add(` vec3 qv = h - ${v3(S.PV_cusps.center)}; float axd = dot(qv, pvAx); float rrv = length(qv - pvAx*axd);`);
    add(` float pvc = max(abs(axd) - 0.06, max(rrv - ${f(S.PV_cusps.radius)}, uP[${pidx.PV_open}]*${f(S.PV_cusps.radius*0.9)} - rrv));`);
    /* papillary muscles + moderator band */
    const pm = S.papillary_muscles.items;
    add(` float papA = sdCapsule(h, ${v3(pm[0].a)}, ${v3(pm[0].b)}, ${f(pm[0].r)}), papP = sdCapsule(h, ${v3(pm[1].a)}, ${v3(pm[1].b)}, ${f(pm[1].r)}); float pap = min(papA, papP);`);
    add(` float mb = sdCapsule(h, ${v3(S.moderator_band.a)}, ${v3(S.moderator_band.b)}, ${f(S.moderator_band.r)});`);
    /* pericardium: shell around the heart solid */
    const pt = (S.pericardium.thickness || 0.22)/2, px = (S.pericardium.posteriorExtra || 0)/2;
    add(` float postW = clamp(dot(normalize(h - vec3(0.5,0.3,1.5)), normalize(vec3(-0.88,0.37,-0.30))), 0.0, 1.0);   // heart-frame posterior direction`);
    add(` float pHalf = ${f(pt)} + ${f(px)}*postW*postW;`);
    add(` float peri = abs(solid - 0.15 - uP[${pidx.effusion_cm}] - pHalf) - pHalf;`);
    add(` float effusion = (solid > 0.0 && solid < 0.15 + uP[${pidx.effusion_cm}]) ? -1.0 : 1.0;`);
    /* outer envelope of the heart (signed distance, cm): the 3D mesh is cut from this field, so grooves and thin walls stay crisp */
    add(` gHeartD = min(min(solid, rvotW), min(aoWall, min(pa - 0.15, min(laa - 0.15, min(pvn - 0.1, csv - 0.1)))));`);
    /* ---- priority: first match wins ---- */
    add(` if (avc < 0.0 && aoLum < 0.3) { tissue = ${T.valve}; label = avk; return; }`);
    add(` if (aml < 0.0) { tissue = ${T.valve}; label = ${Lb["MV_AML"]}; return; }`);
    add(` if (pml < 0.0) { tissue = ${T.valve}; label = ${Lb["MV_PML"]}; return; }`);
    add(` if (tvs < 0.0) { tissue = ${T.valve}; label = ${Lb["TV_septal"]}; return; }`);
    add(` if (tva < 0.0) { tissue = ${T.valve}; label = ${Lb["TV_anterior"]}; return; }`);
    add(` if (pvc < 0.0 && pa < 0.2) { tissue = ${T.valve}; label = ${Lb["PV_cusps"]}; return; }`);
    add(` if (mvAnn < 0.0) { tissue = ${T.fibrous}; label = ${Lb["MV_AML"]}; return; }`);
    add(` if (pap < 0.0 && lvCav < 0.3) { tissue = ${T.myocardium}; label = papA < papP ? ${Lb["papillary_muscles.ALPM"]} : ${Lb["papillary_muscles.PMPM"]}; return; }`);
    add(` if (mb < 0.0 && rvCav < 0.3) { tissue = ${T.myocardium}; label = ${Lb["moderator_band"]}; return; }`);
    add(` if (aoLum < 0.0) { tissue = ${T.blood}; label = at < 2.4 ? ${Lb["aortic_root"]} : ${Lb["aortic_root.ascending"]}; return; }`);
    add(` if (lvot < 0.0) { tissue = ${T.blood}; label = ${Lb["LVOT"]}; return; }`);      // LVOT before LV so the outflow tract is labelled
    add(` if (lvCav < 0.0) { tissue = ${T.blood}; label = ${Lb["LV_cavity"]}; return; }`);
    add(` if (pa < 0.0) { tissue = ${T.blood}; label = ${Lb["PA_main"]}; return; }`);
    add(` if (rvot < 0.0) { tissue = ${T.blood}; label = ${Lb["RVOT"]}; return; }`);
    add(` if (rvCav < 0.0) { tissue = ${T.blood}; label = ${Lb["RV_cavity"]}; return; }`);
    add(` if (csv < 0.0) { tissue = ${T.blood}; label = ${Lb["coronary_sinus"]}; return; }`);
    add(` if (laa < 0.0) { tissue = ${T.blood}; label = ${Lb["LAA"]}; return; }`);
    add(` if (laCav < 0.0) { tissue = ${T.blood}; label = ${Lb["LA"]}; return; }`);
    add(` if (raCav < 0.0) { tissue = ${T.blood}; label = ${Lb["RA"]}; return; }`);
    add(` if (pvn < 0.0) { tissue = ${T.blood}; label = ${Lb["pulmonary_veins"]}; return; }`);
    add(` if (aoWall < 0.0 || (pa < 0.15 && pa >= 0.0)) { tissue = ${T.vessel_wall}; label = ${Lb["aortic_root"]}; return; }`);
    add(` if (solid < 0.0) { tissue = ${T.myocardium};`);
    add(`   label = lvOut < 0.0 ? (rvOut < 0.2 && h.x > 0.5 ? ${Lb["IVS"]} : ${Lb["PW"]}) : (rvOut < 0.0 ? ${Lb["RV_free_wall"]} : (max(laRaw, raRaw) < 0.55 ? ${Lb["IAS"]} : (laRaw < raRaw ? ${Lb["LA_wall"]} : (raRaw < 0.6 ? ${Lb["RA_wall"]} : ${Lb["RV_free_wall"]})))); return; }`);
    add(` if (effusion < 0.0 && uP[${pidx.effusion_cm}] > 0.01) { tissue = ${T.fluid}; label = ${Lb["pericardium"]}; return; }`);
    add(` if (peri < 0.0) { tissue = ${T.pericardium}; label = ${Lb["pericardium"]}; return; }`);
    add(`}`);

    /* -------- deeper extracardiac structures -------- */
    /* great vessels outside the heart */
    function chain(name, pts, r) { add(`float ${name} = 1e3;`); for (let i=0;i<pts.length-1;i++) add(`${name} = min(${name}, sdCapsule(p, vec3(${pts[i].map(f)}), vec3(${pts[i+1].map(f)}), ${r}));`); }
    chain("dAo", E.descending_aorta.points, f(E.descending_aorta.r));
    chain("dIvc", E.IVC.points, `uP[${pidx.IVC_r}]`);
    add(`float dHv = 1e3;`); for (const it of E.hepatic_veins.items) add(`dHv = min(dHv, sdCapsule(p, vec3(${it.a.map(f)}), vec3(${it.b.map(f)}), ${f(it.r)}));`);
    add(`if (dAo < 0.0) { tissue = ${T.blood}; label = p.y > -20.0 ? ${Lb["descending_aorta"]} : ${Lb["descending_aorta.abdominal"]}; return; }`);
    add(`if (dAo < 0.2) { tissue = ${T.vessel_wall}; label = ${Lb["descending_aorta"]}; return; }`);
    add(`if (dIvc < 0.0) { tissue = ${T.blood}; label = ${Lb["IVC"]}; return; }`);
    add(`if (dHv < 0.0) { tissue = ${T.blood}; label = ${Lb["hepatic_veins"]}; return; }`);
    add(`if (dIvc < 0.12) { tissue = ${T.vessel_wall}; label = ${Lb["IVC"]}; return; }`);
    /* liver, diaphragm, stomach gas */
    const lv = E.liver.items;
    add(`float dLiver = smin(sdEllipsoid(p - vec3(${lv[0].center.map(f)}), vec3(${lv[0].semi.map(f)})), sdEllipsoid(p - vec3(${lv[1].center.map(f)}), vec3(${lv[1].semi.map(f)})), ${f(E.liver.k)});`);
    add(`float dDome = min(dLiver, sdEllipsoid(p - vec3(7.0,-20.0,-9.0), vec3(6.5,5.0,7.0)));`);
    add(`if (dLiver < 0.0) { tissue = ${T.liver}; label = ${Lb["liver"]}; return; }`);
    add(`if (abs(dDome) < 0.4 && p.y > -26.0) { tissue = ${T.diaphragm}; label = ${Lb["diaphragm"]}; return; }`);   // a shell (phantom: thickness 0.4), not a solid dome
    const sg = E.stomach_gas;
    add(`if (sdEllipsoid(p - vec3(${sg.center.map(f)}), vec3(${sg.semi.map(f)})) < 0.0) { tissue = ${T.gas}; label = ${Lb["stomach_gas"]}; return; }`);
    add(`if (dDome < 0.0 && p.y > -26.0) { tissue = ${T.soft}; label = 0; return; }`);   // abdomen under the dome: soft tissue, never lung
    /* lungs: ellipsoids minus mediastinum minus cardiac notch (notch is a uniform: changes with LLD) */
    const lu = E.lungs;
    add(`float dMed = sdEllipsoid(p - vec3(${lu.mediastinum.center.map(f)}), vec3(${lu.mediastinum.semi.map(f)}));`);
    add(`float dNotch = sdEllipsoid(p - uNotchC, uNotchS);`);
    add(`float dLL = max(max(sdEllipsoid(p - vec3(${lu.left.from.center.map(f)}), vec3(${lu.left.from.semi.map(f)})), -dMed), -dNotch);`);
    add(`float dLR = max(sdEllipsoid(p - vec3(${lu.right.from.center.map(f)}), vec3(${lu.right.from.semi.map(f)})), -dMed);`);
    add(`if (min(dLL, dLR) < 0.0) { tissue = ${T.lung}; label = ${Lb["lungs"]}; return; }`);
    add(`tissue = ${T.soft}; label = 0;`);

    const glsl = `
uniform float uP[${names.length}];
uniform mat4 uW2H;            // patient → heart frame (includes supine/LLD heart offset)
uniform vec3 uNotchC, uNotchS; // left-lung cardiac notch (supine vs LLD)
uniform float uRibSpaceScale;
uniform float uSkipBody;
float smin(float a, float b, float k){ float h = max(k - abs(a-b), 0.0)/k; return min(a,b) - h*h*k*0.25; }
float sdEllipsoid(vec3 p, vec3 r){ float k0 = length(p/r), k1 = length(p/(r*r)); return k0*(k0-1.0)/max(k1,1e-5); }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p-a, ba = b-a; float h = clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h)-r; }
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p)-b; return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0); }
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2){ vec3 ba = b-a; float l2 = dot(ba,ba), rr = r1-r2, a2 = l2-rr*rr, il2 = 1.0/l2;
  vec3 pa = p-a; float y = dot(pa,ba), z = y-l2; vec3 xv = pa*l2 - ba*y; float x2 = dot(xv,xv), y2 = y*y*l2, z2 = z*z*l2, k = sign(rr)*rr*rr*x2;
  if (sign(z)*a2*z2 > k) return sqrt(x2+z2)*il2 - r2; if (sign(y)*a2*y2 < k) return sqrt(x2+y2)*il2 - r1; return (sqrt(x2*a2*il2) + y*rr)*il2 - r1; }
float wobble(vec3 q, float a){ return a*sin(1.7*q.x + 0.6)*sin(1.3*q.y + 1.9)*sin(1.1*q.z + 0.3) + 0.5*a*sin(2.9*q.y + 0.4*q.z); }
float sdTorus(vec3 p, float R, float r){ return length(vec2(length(p.xy)-R, p.z)) - r; }
float costalY(float ax){ ${(()=>{const cm=[[0,-20.5]].concat(E.ribs.costalMargin_polyline).concat([[16,-26]]);let s="";
  for(let i=1;i<cm.length;i++){const a=cm[i-1],b=cm[i];s+=`if (ax <= ${f(b[0])}) return mix(${f(a[1])}, ${f(b[1])}, (ax - ${f(a[0])})/${f(Math.max(1e-3,b[0]-a[0]))}); `;}return s+`return ${f(cm[cm.length-1][1])};`})()} }
float gHeartD = 1e3;          // set by scene(): signed distance to the heart's outer surface (only valid near the heart)
void scene(vec3 p, out int tissue, out int label) {
  gHeartD = 1e3;
${ln.join("\n")}
}`;
    return { glsl, names, pidx };
  }

  /* patient→heart matrix (THREE.Matrix4) for a patient position; heart frame axes are rows of the rotation */
  function worldToHeart(ph, position, THREE){
    const h = ph.frames.heart, pos = ph.positions[position], O = h.origin_patient;
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...h.X_patient), new THREE.Vector3(...h.Y_patient), new THREE.Vector3(...h.Z_patient));
    m.setPosition(...O);                                         // heart → patient (supine)
    const piv = new THREE.Vector3(...O), rot = new THREE.Matrix4().makeRotationY((pos.heartRotateYDeg||0)*Math.PI/180);
    const lld = new THREE.Matrix4().makeTranslation(...(pos.heartOffset_patient||[0,0,0]))
      .multiply(new THREE.Matrix4().makeTranslation(piv.x,piv.y,piv.z)).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(-piv.x,-piv.y,-piv.z));
    return lld.multiply(m).invert();                             // patient → heart
  }
  function tissueTables(ph){
    const n = TISSUES.length, bright = new Float32Array(n), trans = new Float32Array(n).fill(1), grain = new Float32Array(n).fill(.08), edge = new Float32Array(n);
    TISSUES.forEach((t,i)=>{ const d = ph.tissues[t]; if (d){ bright[i]=d.brightness; trans[i]=d.transmit; grain[i]=d.speckleCm; edge[i]=d.edgeBoost; } });
    bright[T.soft] = .07; trans[T.soft] = .985; edge[T.soft] = .05;
    return { bright, trans, grain, edge };
  }
  return { compile, makeParamEval, worldToHeart, tissueTables, TISSUES, T, LABELS, LABEL_TEXT };
})();
