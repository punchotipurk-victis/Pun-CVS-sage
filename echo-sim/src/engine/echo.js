/* ===== ECHO: 3-pass ultrasound image on the GPU (three.js r158, WebGL2) =====
   Pass A  tissue map  (lines × samples, polar): which tissue/label sits at each point of each scan line.
   Pass B  beam        (lines × samples, polar): walk each scan line from the probe, accumulating transmission
                       → shadows (rib), A-lines (lung/gas), speckle, specular interfaces, attenuation.
   Pass C  display     (screen, Cartesian): scan-convert the fan, log-compress, gain/DR, label tint.
   This mirrors a real scanner (beam → envelope → log compression → scan conversion), so the controls
   (depth, sector, gain, DR, TGC) behave the way they do on a machine. */
function EchoEngine(renderer, ph, opts = {}) {
  const T = THREE, P = PHANTOM, comp = P.compile(ph), tables = P.tissueTables(ph), paramEval = P.makeParamEval(ph);
  const NL = opts.lines || 160, NS = opts.samples || 320;          // mobile: 128 × 256
  const mkRT = (type) => new T.WebGLRenderTarget(NL, NS, { type, format: T.RGBAFormat, minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: false });
  /* rtA tissue/label ids (nearest; scoring + labels) · rtB raw RF-like signal (I, Q, coherent) · rtD after lateral PSF ·
     rtE envelope after axial PSF (linear, sampled bicubic in Pass C) */
  const rtA = mkRT(T.UnsignedByteType), rtB = mkRT(T.HalfFloatType), rtD = mkRT(T.HalfFloatType), rtE = mkRT(T.HalfFloatType);
  for (const r of [rtB, rtD, rtE]) r.texture.minFilter = r.texture.magFilter = T.LinearFilter;
  const ID = ph.imaging_defaults;
  const quad = new T.Mesh(new T.PlaneGeometry(2, 2)), cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), scn = new T.Scene(); scn.add(quad);
  const nTis = P.TISSUES.length;
  const U = {
    uP: { value: new Float32Array(comp.names.length) }, uW2H: { value: new T.Matrix4() },
    uNotchC: { value: new T.Vector3() }, uNotchS: { value: new T.Vector3(1, 1, 1) }, uRibSpaceScale: { value: 1 }, uSkipBody: { value: 0 },
    uOrigin: { value: new T.Vector3() }, uBeam: { value: new T.Vector3(0, 0, -1) }, uLat: { value: new T.Vector3(1, 0, 0) },
    uDepth: { value: 16 }, uSector: { value: 80 * Math.PI / 180 }, uNL: { value: NL }, uNS: { value: NS },
    uBright: { value: tables.bright }, uTrans: { value: tables.trans }, uGrain: { value: tables.grain }, uEdge: { value: tables.edge },
    uTime: { value: 0 }, uFreq: { value: ph.imaging_defaults.frequencyMHz }, uAtt: { value: ph.imaging_defaults.attenuation_dB_per_cm_MHz },
    uTissue: { value: rtA.texture }, uBeamTex: { value: rtE.texture }, uRaw: { value: rtB.texture }, uLatTex: { value: rtD.texture },
    uFocus: { value: 0.6 }, uLatK: { value: ID.lateralBlur_cm_per_cm_depth ?? 0.012 }, uLat0: { value: 0.045 }, uAx: { value: 0.05 },
    uDecor: { value: 0.35 },
    uGain: { value: 0 }, uDR: { value: ph.imaging_defaults.dynamicRange_dB }, uMarkerRight: { value: 1 }, uTint: { value: 0 },
    uPalette: { value: new Array(64).fill(0).map(() => new T.Vector3()) }, uAspect: { value: 1 }
  };
  const common = `precision highp float; precision highp int;
uniform vec3 uOrigin, uBeam, uLat; uniform float uDepth, uSector, uNL, uNS;
vec3 samplePos(float i, float j){ float a = ((i + 0.5)/uNL - 0.5)*uSector; float r = (j + 0.5)/uNS*uDepth;
  return uOrigin + (uBeam*cos(a) + uLat*sin(a))*r; }`;
  const vs = `in vec3 position; out vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.0,1.0); }`;
  const matA = new T.RawShaderMaterial({ glslVersion: T.GLSL3, uniforms: U, vertexShader: vs, fragmentShader: `${common}
${comp.glsl}
out vec4 o; void main(){ int t, l; scene(samplePos(floor(gl_FragCoord.x), floor(gl_FragCoord.y)), t, l);
  o = vec4(float(t)/255.0, float(l)/255.0, 0.0, 1.0); }` });
  const matB = new T.RawShaderMaterial({ glslVersion: T.GLSL3, uniforms: U, vertexShader: vs, fragmentShader: `${common}
uniform sampler2D uTissue; uniform float uBright[${nTis}], uTrans[${nTis}], uGrain[${nTis}], uEdge[${nTis}];
uniform float uTime, uFreq, uAtt, uDecor; uniform mat4 uW2H;
float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
int tis(int i, int j){ return int(texelFetch(uTissue, ivec2(clamp(i,0,int(uNL)-1), clamp(j,0,int(uNS)-1)), 0).r*255.0 + 0.5); }
out vec4 o;
void main(){
  int i = int(gl_FragCoord.x), j = int(gl_FragCoord.y);
  float dr = uDepth/uNS, Tr = 1.0, blockedAt = -1.0, TrPre = 1.0;
  int prev = tis(i, 0);
  for (int k = 1; k < ${NS}; k++){                   // bound = NS (small constant loop: fast to compile on Windows/ANGLE); transmission from the probe down to this sample
    if (k >= j) break;
    int t = tis(i, k);
    if (t != prev){                               // interface: reflection takes a little energy
      Tr *= 1.0 - 0.15*uEdge[t];
      if (uTrans[t] < 0.01 && blockedAt < 0.0) { blockedAt = float(k)*dr; TrPre = Tr; }   // air: nothing beyond
    }
    Tr *= pow(uTrans[t], dr);                     // per-cm transmission (bone 0.04/cm → shadow)
    prev = t;
  }
  float r = (float(j)+0.5)*dr;
  int t = tis(i, j), tp = tis(i, j-1);
  vec3 wp = samplePos(float(i), float(j));
  /* Scatterers: a zero-mean random field anchored to the HEART-frame position (so speckle sticks to tissue and moves with
     the heart in LLD), interpolated in space (no blocky cells) and split into I/Q components. The PSF passes (D, E) blur
     I and Q and take the envelope → genuine Rayleigh speckle whose grain size is set by the beam, as on a real scanner.
     A small, slowly rotating second field gives the gentle shimmer of live tissue without changing brightness. */
  vec3 hp = (uW2H*vec4(wp, 1.0)).xyz;
  float cell = clamp(uGrain[t]*0.6, 0.025, 0.07); vec3 q = hp/cell;
  float n1 = vnoise(q) - 0.5, n2 = vnoise(q + vec3(17.3, 5.1, 9.7)) - 0.5;
  float ph = uTime*0.8, th = uDecor;
  vec3 qd = q + vec3(31.0, 47.0, 13.0)*floor(ph); vec3 qe = qd + vec3(31.0, 47.0, 13.0);
  float fr = fract(ph), cs = cos(fr*1.5708), sn = sin(fr*1.5708);
  float d1 = (vnoise(qd) - 0.5)*cs + (vnoise(qe) - 0.5)*sn, d2 = (vnoise(qd + 7.7) - 0.5)*cs + (vnoise(qe + 7.7) - 0.5)*sn;
  n1 = n1*cos(th) + d1*sin(th); n2 = n2*cos(th) + d2*sin(th);
  float diff = uBright[t]*0.62*3.0;                     // ×3 ≈ 1/std of interpolated value noise → unit-variance components
  if (t == 2 || t == 8) diff *= 0.7 + 0.6*vnoise(hp*1.4);   // myocardium/liver: coarse mottling (fibre texture), not flat grey
  float coh = 0.0;
  /* specular interface: strongest when the boundary faces the beam. Estimate the boundary tilt from where
     the same transition sits on the neighbouring scan line (in-plane slope). Parallel boundaries (thin IAS in A4C) drop out. */
  if (t != tp){
    int jn = -1; for (int d = 0; d < 9; d++){ if (tis(i+1, j+d) != tis(i+1, j+d-1)) { jn = j+d; break; } if (tis(i+1, j-d) != tis(i+1, j-d-1)) { jn = j-d; break; } }
    float c = 0.3;
    if (jn >= 0){ float slope = float(jn - j)*dr / max(r*uSector/uNL, 1e-3); c = 1.0/sqrt(1.0 + slope*slope); }
    coh += max(uEdge[t], uEdge[tp]) * c*c * 1.2 * (0.05/dr);   // energy per cm, independent of the sample spacing
  }
  if (blockedAt > 0.0){                           // lung/gas: reverberation A-lines at multiples of the pleural depth
    float n = r/blockedAt, fa = abs(fract(n + 0.5) - 0.5)*blockedAt;
    coh = (fa < 0.06 ? 0.55*pow(0.6, floor(n + 0.5) - 1.0)*2.0 : 0.0); diff = 0.004*3.0;
  }
  float att = pow(10.0, -uAtt*uFreq*2.0*r/20.0); // round-trip attenuation (dB/cm/MHz)
  float tgc = pow(10.0, 0.8*uAtt*uFreq*2.0*r/20.0); // default TGC compensates 80%
  float g = (blockedAt > 0.0 ? TrPre : Tr)*att*tgc;
  o = vec4(diff*n1*g, diff*n2*g, coh*g, 1.0);
}` });
  /* Pass D: lateral point-spread function. Beam width (σ, cm) is narrowest at the focus and widens with depth, so far-field
     structures smear sideways and speckle grains elongate laterally. The kernel is applied across scan lines (σ in lines =
     σ_cm / arc length between lines), with a stride so the near field (lines very close together) stays cheap.
     Random channels (I, Q) are normalised by √Σw² (keeps speckle statistics), the coherent channel by Σw (keeps brightness). */
  const psfCommon = `precision highp float; precision highp int; uniform float uDepth, uSector, uNL, uNS, uFocus, uLatK, uLat0, uAx;`;
  const matD = new T.RawShaderMaterial({ glslVersion: T.GLSL3, uniforms: U, vertexShader: vs, fragmentShader: `${psfCommon}
uniform sampler2D uRaw; out vec4 o;
void main(){
  float i = gl_FragCoord.x, j = gl_FragCoord.y, r = j/uNS*uDepth + 1e-3, fz = uFocus*uDepth;
  float sig = uLat0 + 0.75*uLatK*r + 0.008*abs(r - fz);
  float sL = clamp(sig/(r*uSector/uNL), 0.35, 64.0), st = max(1.0, 2.6*sL/8.0);
  vec3 acc = vec3(0.0); float w1 = 0.0, w2 = 0.0;
  for (int k = -8; k <= 8; k++){ float x = float(k)*st, w = exp(-0.5*x*x/(sL*sL));
    vec3 v = texture(uRaw, vec2((i + x)/uNL, j/uNS)).rgb; acc += v*w; w1 += w; w2 += w*w; }
  o = vec4(acc.rg/sqrt(w2), acc.b/w1, 1.0);
}` });
  /* Pass E: axial PSF (pulse length) then envelope detection |I + coherent, Q|. */
  const matE = new T.RawShaderMaterial({ glslVersion: T.GLSL3, uniforms: U, vertexShader: vs, fragmentShader: `${psfCommon}
uniform sampler2D uLatTex; out vec4 o;
void main(){
  float i = gl_FragCoord.x, j = gl_FragCoord.y, sS = max(0.35, uAx/(uDepth/uNS)), st = max(1.0, 2.6*sS/6.0);
  vec3 acc = vec3(0.0); float w1 = 0.0, w2 = 0.0;
  for (int k = -6; k <= 6; k++){ float y = float(k)*st, w = exp(-0.5*y*y/(sS*sS));
    vec3 v = texture(uLatTex, vec2(i/uNL, (j + y)/uNS)).rgb; acc += v*w; w1 += w; w2 += w*w; }
  vec2 iq = acc.rg/sqrt(w2); float c = acc.b/w1;
  o = vec4(length(vec2(iq.x + c, iq.y))*0.62, 0.0, 0.0, 1.0);   // 0.62: same mean level as the P1 speckle
}` });
  const matC = new T.RawShaderMaterial({ glslVersion: T.GLSL3, uniforms: U, vertexShader: vs, fragmentShader: `precision highp float;
uniform sampler2D uBeamTex, uTissue; uniform float uSector, uGain, uDR, uMarkerRight, uTint, uAspect; uniform vec3 uPalette[64];
in vec2 vUv; out vec4 o;
/* cubic B-spline reconstruction from 4 bilinear taps: smooth (C2) scan conversion, no polar stair steps, no ringing */
float bspline(sampler2D tx, vec2 uv){
  vec2 sz = vec2(textureSize(tx, 0)), p = uv*sz - 0.5, f = fract(p), b = floor(p) + 0.5;
  vec2 f2 = f*f, f3 = f2*f, w0 = (1.0 - 3.0*f + 3.0*f2 - f3)/6.0, w1 = (4.0 - 6.0*f2 + 3.0*f3)/6.0, w2 = (1.0 + 3.0*f + 3.0*f2 - 3.0*f3)/6.0, w3 = f3/6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3, h0 = (b - 1.0 + w1/g0)/sz, h1 = (b + 1.0 + w3/g1)/sz;
  return g0.y*(g0.x*texture(tx, vec2(h0.x, h0.y)).r + g1.x*texture(tx, vec2(h1.x, h0.y)).r)
       + g1.y*(g0.x*texture(tx, vec2(h0.x, h1.y)).r + g1.x*texture(tx, vec2(h1.x, h1.y)).r);
}
void main(){
  /* screen: apex at top-centre; x to the marker side = the probe's notch (lateral) side */
  vec2 q = vec2((vUv.x - 0.5)*uAspect, 1.0 - vUv.y);          // 1 unit = screen height on BOTH axes (isotropic, so a round LV stays round)
  q *= max(1.0, 2.0*0.97*sin(min(uSector, 3.14)*0.5)/uAspect); // zoom out so a wide fan fits a narrow screen
  q.x *= uMarkerRight > 0.5 ? 1.0 : -1.0;
  float R = 0.97, r = length(q)/R, a = atan(q.x, q.y);
  if (r > 1.0 || abs(a) > uSector*0.5) { o = vec4(0.0,0.0,0.0,1.0); return; }
  vec2 tc = vec2(a/uSector + 0.5, r);
  float A = max(bspline(uBeamTex, tc), 0.0);
  float dB = 20.0*log(max(A, 1e-5))/log(10.0) + uGain;
  float gray = clamp((dB + uDR)/uDR, 0.0, 1.0);
  vec3 col = vec3(gray);
  if (uTint > 1.5){ int ti = int(texture(uTissue, tc).r*255.0 + 0.5); o = vec4(fract(vec3(0.37,0.61,0.83)*float(ti)*1.7)*0.9 + 0.1*gray, 1.0); return; }
  if (uTint > 0.5){ int lab = int(texture(uTissue, tc).g*255.0 + 0.5); vec3 pc = uPalette[lab]; if (lab > 0 && dot(pc,pc) > 0.0) col = mix(col, pc, 0.35); }
  o = vec4(col, 1.0);
}` });

  /* ---- per-frame state ---- */
  let position = "supine";
  function setPatientPosition(pos){
    position = pos; U.uW2H.value.copy(P.worldToHeart(ph, pos, T));
    const n = ph.extracardiac_patient.lungs.cardiac_notch[pos === "LLD" ? "LLD" : "supine"];
    U.uNotchC.value.set(...n.center); U.uNotchS.value.set(...n.semi);
    U.uRibSpaceScale.value = pos === "LLD" ? 1 + ph.extracardiac_patient.ribs.LLD_icsWidening_cm/2.25 : 1;
  }
  /* Tint palette: phantom.palette_anatomyTint keys → label ids */
  const TINT_KEY = { LV_cavity:"LV", LVOT:"LV", RV_cavity:"RV", RVOT:"RV", LA:"LA", LAA:"LA", pulmonary_veins:"LA", RA:"RA", aortic_root:"Ao",
    "aortic_root.ascending":"Ao", PA_main:"PA", MV_AML:"valves", MV_PML:"valves", TV_septal:"valves", TV_anterior:"valves", "AV_cusps.RCC":"valves",
    "AV_cusps.LCC":"valves", "AV_cusps.NCC":"valves", PV_cusps:"valves", IVS:"LV_myocardium", PW:"LV_myocardium", LV_myocardium:"LV_myocardium",
    "papillary_muscles.ALPM":"LV_myocardium", "papillary_muscles.PMPM":"LV_myocardium", RV_free_wall:"RV_free_wall", moderator_band:"RV_free_wall",
    pericardium:"pericardium", liver:"liver", IVC:"IVC", hepatic_veins:"IVC", descending_aorta:"DA", "descending_aorta.abdominal":"DA", coronary_sinus:"CS", LA_wall:"LA_wall", RA_wall:"RA_wall", aortic_arch:"Ao", arch_branches:"Ao", RPA:"PA", LPA:"PA", crista_terminalis:"RA_wall", TV_posterior:"valves", TV_annulus:"valves", chordae:"valves", LCA:"Ao", RCA:"Ao", cardiac_veins:"CS", epicardial_fat:"pericardium" };
  function setPalette(pal){ U.uPalette.value.forEach((v,i)=>{ const hex = pal[TINT_KEY[P.LABELS[i]]]; if (hex){ const c = new T.Color(hex); v.set(c.r,c.g,c.b); } else v.set(0,0,0); }); }
  setPalette(ph.palette_anatomyTint);
  setPatientPosition("supine");
  function setProbe(fr, pressCm=0){ const o=[fr.p[0]-fr.normal[0]*pressCm, fr.p[1]-fr.normal[1]*pressCm, fr.p[2]-fr.normal[2]*pressCm]; U.uOrigin.value.set(...o); U.uBeam.value.set(...fr.beam); U.uLat.value.set(...fr.lateral); }
  function setImaging(o){ if (o.depthCm) U.uDepth.value = o.depthCm; if (o.sectorDeg) U.uSector.value = o.sectorDeg*Math.PI/180;
    if (o.gainDb != null) U.uGain.value = o.gainDb; if (o.drDb) U.uDR.value = o.drDb; if (o.markerRight != null) U.uMarkerRight.value = o.markerRight ? 1 : 0;
    if (o.focus != null) U.uFocus.value = o.focus;                 // focal depth as a fraction of depth (0.2–0.9)
    if (o.tint != null) U.uTint.value = o.tint === 'tissue' ? 2 : (o.tint ? 1 : 0); }
  /* render: phase t (0–1 of RR), tr (respiratory phase), time (s) → draws the fan into `target` (null = canvas) */
  function render(t, tr, time, target, aspect){
    U.uP.value.set(paramEval(t, tr)); U.uTime.value = time; U.uAspect.value = aspect || 1;
    const prevT = renderer.getRenderTarget();
    quad.material = matA; renderer.setRenderTarget(rtA); renderer.render(scn, cam);
    quad.material = matB; renderer.setRenderTarget(rtB); renderer.render(scn, cam);
    quad.material = matD; renderer.setRenderTarget(rtD); renderer.render(scn, cam);
    quad.material = matE; renderer.setRenderTarget(rtE); renderer.render(scn, cam);
    quad.material = matC; renderer.setRenderTarget(target || null); renderer.render(scn, cam);
    renderer.setRenderTarget(prevT);
  }
  /* readback of the tissue/label map for content checks + label placement (call at ~4–5 Hz, not every frame) */
  const buf = new Uint8Array(NL*NS*4);
  /* Returns { labelId: {area cm², cx, cy (cm; x = lateral toward notch, y = depth), major, minor (cm, ≈ full axis lengths),
     angleDeg (major axis vs screen horizontal), minDepth, maxDepth} } — the input for content checks and label placement. */
  function readLabels(){ renderer.readRenderTargetPixels(rtA, 0, 0, NL, NS, buf);
    const depth = U.uDepth.value, sec = U.uSector.value, dr = depth/NS, acc = {};
    for (let j = 0; j < NS; j++) for (let i = 0; i < NL; i++){
      const lab = buf[(j*NL + i)*4 + 1]; if (!lab) continue;
      const r = (j+.5)*dr, a = ((i+.5)/NL - .5)*sec, dA = r*(sec/NL)*dr, x = r*Math.sin(a), y = r*Math.cos(a);
      const o = acc[lab] || (acc[lab] = { id: P.LABELS[lab], w: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, minD: 1e9, maxD: 0 });
      o.w += dA; o.sx += x*dA; o.sy += y*dA; o.sxx += x*x*dA; o.syy += y*y*dA; o.sxy += x*y*dA; o.minD = Math.min(o.minD, y); o.maxD = Math.max(o.maxD, y);
    }
    const out = {};
    for (const k in acc){ const o = acc[k], cx = o.sx/o.w, cy = o.sy/o.w, vxx = o.sxx/o.w - cx*cx, vyy = o.syy/o.w - cy*cy, vxy = o.sxy/o.w - cx*cy;
      const tr = vxx + vyy, det = vxx*vyy - vxy*vxy, l1 = tr/2 + Math.sqrt(Math.max(0, tr*tr/4 - det)), l2 = Math.max(0, tr - l1);
      out[o.id] = { area: o.w, cx, cy, major: 4*Math.sqrt(l1), minor: 4*Math.sqrt(l2), angleDeg: 0.5*Math.atan2(2*vxy, vxx - vyy)*180/Math.PI, minDepth: o.minD, maxDepth: o.maxD }; }
    return out;
  }
  function tissueLine(i){ renderer.readRenderTargetPixels(rtA, i, 0, 1, NS, buf); const out=[]; let last=-1;
    for(let j=0;j<NS;j++){ const t=buf[j*4]; if(t!==last){ out.push(P.TISSUES[t]+"@"+((j+.5)*U.uDepth.value/NS).toFixed(1)); last=t; } } return out.join(" → "); }
  return { tissueLine, render, setProbe, setImaging, setPatientPosition, setPalette, readLabels, uniforms: U, names: comp.names, glsl: comp.glsl, NL, NS };
}
