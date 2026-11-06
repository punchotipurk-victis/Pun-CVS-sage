/* ===== BODY: the visible patient. Skin (sculpted torso with shoulders, arms and neck), a muscle layer, the skeleton and the landmark/window markers.
   Over the scanning windows the trunk IS the phantom's analytic elliptic cylinder; contours (pectoralis, rectus, nipple…) are a small outward
   displacement h(x,y) ≤ 0.8 cm. The probe and the echo keep using the analytic surface (PROBE.skinPoint); only the drawn probe is lifted by h.
   Ribs, sternum and costal margin come from the same numbers the echo uses (phantom-normal.json). */
function makeBody(APP, clips){
  const T = THREE, ph = APP.ph, VJ = APP.VJ, E = ph.extracardiac_patient, K = MESHKIT;
  const tor = E.torso, hw = tor.halfWidthX, hd = tor.halfDepthZ, cz = tor.center_xz[1], hdB = hd*.86, stY = E.sternum.landmarks;
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); };
  const ribY = (n, ax) => -0.875 - 2.25*n - .25*Math.max(0, ax-3);
  const CM = [[0, stY.xiphoid_tip_y]].concat(E.ribs.costalMargin_polyline, [[16, -26]]);
  const costalY = ax => { for (let i = 1; i < CM.length; i++) if (ax <= CM[i][0]){ const t = (ax-CM[i-1][0])/(CM[i][0]-CM[i-1][0]); return CM[i-1][1]+t*(CM[i][1]-CM[i-1][1]); } return -26; };
  const NIP = [9.5, ribY(4, 9.5) - 1.125], UMB = [0, -37], ARM = { top: [18.4, -2.5, -9.3], bot: [22.6, -19.4, -9.6], r0: 4.4, r1: 3.7, cut: -19.2 }, NECKTOP = 12.5;

  /* ---- shape: signed distance of the trunk, neck, shoulders, arms and neck muscles (cm) ---- */
  const len3 = (x, y, z) => Math.sqrt(x*x + y*y + z*z);
  const smin = (a, b, k) => { const h = Math.max(k-Math.abs(a-b), 0)/k; return Math.min(a, b) - h*h*k*.25; };
  function ell2(x, z, a, b){ const k0 = Math.hypot(x/a, z/b), k1 = Math.hypot(x/(a*a), z/(b*b)); return k1 < 1e-9 ? -Math.min(a, b) : k0*(k0-1)/k1; }
  function roundCyl(d2, y, yTop, yBot, rb){ const yc = (yTop+yBot)/2, hh = (yTop-yBot)/2, dx = d2 + rb, dy = Math.abs(y-yc) - hh + rb; return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - rb; }
  function capsule(x, y, z, a, b, r){ const bx = b[0]-a[0], by = b[1]-a[1], bz = b[2]-a[2], px = x-a[0], py = y-a[1], pz = z-a[2], h = Math.max(0, Math.min(1, (px*bx+py*by+pz*bz)/(bx*bx+by*by+bz*bz))); return len3(px-bx*h, py-by*h, pz-bz*h) - r; }
  function cone(x, y, z, a, b, ra, rb){ const bx = b[0]-a[0], by = b[1]-a[1], bz = b[2]-a[2], px = x-a[0], py = y-a[1], pz = z-a[2], l2 = bx*bx+by*by+bz*bz, h = Math.max(0, Math.min(1, (px*bx+py*by+pz*bz)/l2)); return len3(px-bx*h, py-by*h, pz-bz*h) - (ra + (rb-ra)*h); }
  function trunk(x, y, z){
    const w = ss(-30, -37, y), a = hw - 1.6*w + .9*ss(-39, -45, y), zz = z - cz, b = zz > 0 ? hd - .2*w : hdB;
    return roundCyl(ell2(x, zz, a, b), y, 1.6, -45, 2.6);
  }
  function sdf(x, y, z){
    const s = x < 0 ? -1 : 1, ax = Math.abs(x);
    let d = trunk(x, y, z);
    d = smin(d, roundCyl(ell2(x, z+8.7, 6.1, 5.5), y, NECKTOP, -3, 1.2), 3.0);                               // neck
    d = smin(d, capsule(ax, y, z, [3.5, 8.6, -10.6], [16.4, 1.0, -10.2], 3.6), 3.4);                          // trapezius → shoulder line
    d = smin(d, len3(ax-17.6, y+1.8, z+9.2) - 5.0, 2.4);                                                       // deltoid cap
    d = smin(d, Math.max(cone(ax, y, z, ARM.top, ARM.bot, ARM.r0, ARM.r1), -(y - ARM.cut)), 2.0);              // upper arm, cut flat
    d = smin(d, capsule(ax, y, z, [4.3, 11.2, -10], [1.6, .3, -1.6], 1.05), 1.2);                              // sternocleidomastoid, sternal head
    d = smin(d, capsule(ax, y, z, [4.3, 11.2, -10], [5.2, .6, -2.6], .85), 1.2);                               //   clavicular head
    return d;
  }
  /* ---- contour map: outward displacement over the front of the trunk (cm) ---- */
  function height(x, y){
    const ax = Math.abs(x); let h = 0;
    const yL = -16 + Math.max(0, Math.min(12, ax-3))*.42, dB = y - yL;                                         // pectoralis major: lower border rises to the axillary fold
    const mPec = ss(-.4, 1.3, dB)*ss(1.5, 2.9, ax)*ss(.9, -1.6, y)*ss(17.5, 14.5, ax);
    h += .72*mPec*(.5 + .5*Math.exp(-((ax-8.5)**2/45 + (y+8.5)**2/26)));
    h += .16*Math.exp(-(((dB-.9)/.8)**2))*ss(2.4, 3.8, ax)*ss(16, 13, ax);
    h -= .22*Math.exp(-((x/1.2)**2))*ss(.5, -2, y)*ss(-21, -19, y);                                          // sternal groove
    { const t = Math.max(0, Math.min(1, (ax-2)/13)), cy = .2 + t*.9, dd = y - cy; h += .32*Math.exp(-((dd/.75)**2))*ss(1.2, 2.6, ax)*ss(16.5, 14.5, ax); }   // clavicle ridge
    h -= .18*Math.exp(-(((ax-12.5)/1.6)**2 + ((y+2.2)/1.0)**2));                                              // infraclavicular hollow
    { const lat = ss(.3, 1.2, ax)*ss(7.6, 6.2, ax), vert = ss(-16.5, -19.5, y)*ss(-44, -41, y);              // rectus abdominis with tendinous intersections
      let g = 0; for (const yi of [-23, -29.5, -35.5]) g += Math.exp(-(((y-yi + .25*Math.sin(x*.6))/.55)**2));
      h += .36*lat*vert*(1 - .8*Math.min(1, g)); h -= .2*Math.exp(-((x/.55)**2))*ss(-19, -21, y)*ss(-44, -40, y); h -= .12*Math.exp(-(((ax-7.3)/.6)**2))*ss(-20, -23, y)*ss(-44, -40, y); }
    h += .22*ss(9, 12, ax)*ss(15.5, 13.5, ax)*ss(-24, -28, y)*ss(-45, -39, y);                                // external oblique flank
    if (ax > 12.8 && y < -7 && y > -21) h += .16*ss(12.8, 14, ax)*Math.max(0, Math.sin((y+7)*Math.PI/2.4))**2*ss(-21, -18, y)*(dB < 0 ? 1 : 0);   // serratus digitations
    { const r2 = (ax-NIP[0])**2 + (y-NIP[1])**2; h += .07*Math.exp(-r2/1.3) + .22*Math.exp(-r2/.1); }       // areola, nipple
    { const r2 = x*x + (y-UMB[1])**2, r = Math.sqrt(r2); h += -.7*Math.exp(-r2/.35) + .16*Math.exp(-(((r-.95)/.35)**2)); }   // umbilicus
    h -= .2*Math.exp(-(x*x/4 + (y+21.6)**2/2));                                                                // epigastric hollow under the xiphoid
    return h;
  }
  const frontW = (z, y) => ss(cz-1.5, cz+3.5, z)*ss(3.5, 1.0, y);
  const grad = (x, y, z, e = .05) => { const g = [sdf(x+e, y, z)-sdf(x-e, y, z), sdf(x, y+e, z)-sdf(x, y-e, z), sdf(x, y, z+e)-sdf(x, y, z-e)], l = Math.hypot(...g) || 1; return g.map(q => q/l); };
  /* point on the drawn skin above (x, y), plus `off` cm outward: used by markers, labels and the torso map */
  function surfaceAt(x, y, off = 0){
    let z0 = 8, f0 = sdf(x, y, z0), z1 = z0;
    for (; z1 > cz; z1 -= .5){ const f = sdf(x, y, z1); if (f < 0) break; z0 = z1; f0 = f; }
    let a = z1, b = z0; for (let i = 0; i < 18; i++){ const m = (a+b)/2; if (sdf(x, y, m) < 0) a = m; else b = m; }
    const n = grad(x, y, b), hh = height(x, y)*frontW(b, y) + off;
    return { p: new T.Vector3(x + n[0]*hh, y + n[1]*hh, b + n[2]*hh), n: new T.Vector3(...n) };
  }
  const liftAt = (x, y) => height(x, y)*frontW(PROBE.skinPoint(x, y)[2], y);

  /* ---- skin + muscle meshes: SDF → surface nets → Taubin → contour displacement ---- */
  function buildSkin(){
    const v = .45, lo = [-28, -47, -22.5], hi = [28, NECKTOP + 1, 3];
    const S0 = K.sampleSDF(sdf, lo, hi, v), m = K.nets(S0.vals, S0.n, lo, v), P = m.pos, nv = P.length/3;
    K.smooth(P, m.idx, 6);
    const N = new Float32Array(P.length), skinP = new Float32Array(P.length), musP = new Float32Array(P.length);
    for (let i = 0; i < nv; i++){
      const x = P[i*3], y = P[i*3+1], z = P[i*3+2], n = grad(x, y, z), w = frontW(z, y), h = height(x, y)*w;
      N.set(n, i*3);
      for (let k = 0; k < 3; k++){ skinP[i*3+k] = P[i*3+k] + n[k]*h; musP[i*3+k] = P[i*3+k] + n[k]*(1.35*h - .22); } }
    const mk = pos => { const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setIndex(new T.BufferAttribute(m.idx, 1)); g.computeVertexNormals();
      /* surface nets winding is consistent but its sign depends on the field; make normals point outward */
      const gn = g.attributes.normal; let s = 0; for (let i = 0; i < nv; i += 97) s += gn.getX(i)*N[i*3] + gn.getY(i)*N[i*3+1] + gn.getZ(i)*N[i*3+2];
      if (s < 0){ const ix = g.index.array; for (let t = 0; t < ix.length; t += 3){ const q = ix[t+1]; ix[t+1] = ix[t+2]; ix[t+2] = q; } g.computeVertexNormals(); }
      return g; };
    return { skin: mk(skinP), muscle: mk(musP) };
  }

  /* shared GLSL helpers (numbers come from the phantom) */
  const f1 = x => (+x).toFixed(3);
  const glslCostal = "float costalY(float ax){" + CM.slice(1).map((q, i) => `if (ax <= ${f1(q[0])}) return mix(${f1(CM[i][1])}, ${f1(q[1])}, (ax-${f1(CM[i][0])})/${f1(q[0]-CM[i][0])});`).join(" ") + " return -26.0; }";
  const glslCommon = `
    varying vec3 vB;
    float sr(float a, float b, float x){ return a < b ? smoothstep(a, b, x) : 1.0 - smoothstep(b, a, x); }
    float segd(vec2 p, vec2 a, vec2 b){ vec2 pa = p-a, ba = b-a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); return length(pa - ba*h); }
    ${glslCostal}
    float ribBand(vec2 q){ float ax = abs(q.x); if (ax < 1.4 || ax > 15.6) return 0.0;
      float yc = -(q.y + 0.875 + 0.25*max(0.0, ax-3.0))/2.25, fn = floor(yc + 0.5); if (fn < 1.0 || fn > 10.0) return 0.0;
      float d = abs(yc - fn)*2.25; return (1.0 - smoothstep(0.36, 0.52, d))*smoothstep(costalY(ax)-0.25, costalY(ax)+0.25, q.y)*smoothstep(1.4, 2.4, ax)*(1.0 - smoothstep(14.2, 15.6, ax)); }
    float ribNo(vec2 q){ float ax = abs(q.x); return floor(-(q.y + 0.875 + 0.25*max(0.0, ax-3.0))/2.25 + 0.5); }
    float sternHW(float y){ return y > -5.0 ? mix(2.8, 2.0, (-0.5-y)/4.5) : (y > -18.0 ? mix(1.8, 1.5, (-5.0-y)/13.0) : mix(0.8, 0.3, (-18.0-y)/2.5)); }
    float sternBand(vec2 q){ return (1.0 - smoothstep(sternHW(q.y)-0.15, sternHW(q.y)+0.15, abs(q.x)))*step(-20.5, q.y)*step(q.y, -0.5); }`;
  const patchVB = s => { s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vB;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvB = position;"); };

  /* skin: warm subsurface-ish sheen, areolae; the rib cage shows faintly through the skin while landmarks are on (counting ICS) */
  const ribsU = { value: 1 };
  const skinShader = s => { patchVB(s); s.uniforms.uRibs = ribsU;
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uRibs;" + glslCommon)
      .replace("#include <color_fragment>", `#include <color_fragment>
        { vec2 q = vB.xy; float ax = abs(q.x), fr = smoothstep(${f1(cz-1)}, ${f1(cz+4)}, vB.z);
          float r = length(vec2(ax - ${f1(NIP[0])}, q.y - (${f1(NIP[1])})));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.60, .37, .31), (1.0 - smoothstep(1.05, 1.35, r))*fr*.8);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.47, .26, .22), (1.0 - smoothstep(.3, .42, r))*fr);
          diffuseColor.rgb *= 0.97 + 0.05*sin(vB.x*0.9 + vB.y*0.7)*sin(vB.y*1.3);
          float b = max(ribBand(q), sternBand(q)*0.8)*fr*uRibs;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.9, .86, .93), b*.3); }`); };
  const skinMat = new T.MeshPhysicalMaterial({ color: 0xe0b59a, roughness: .64, sheen: .3, sheenColor: new T.Color(0xffc2ad), sheenRoughness: .7, specularIntensity: .35 });
  const ghostMat = new T.MeshPhysicalMaterial({ color: 0xe0b59a, roughness: .64, sheen: .2, sheenColor: new T.Color(0xffc2ad), transparent: true, opacity: .25, depthWrite: false });
  skinMat.onBeforeCompile = skinShader; ghostMat.onBeforeCompile = skinShader;

  /* muscle: fibre directions by muscle (pectoralis fans to the humerus, rectus is vertical with tendinous intersections,
     external oblique runs down and in, serratus digitations, deltoid converges on the deltoid tuberosity…). Ribs and intercostals show
     where no large muscle covers them. Teaching drawing, not a dissection. */
  const musMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: .5, metalness: 0 });
  musMat.onBeforeCompile = s => { patchVB(s);
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\n" + glslCommon + `
      vec3 fib(vec3 base, float u){ float k = 0.5 + 0.5*sin(u); return base*(0.7 + 0.38*pow(k, 0.7)); }
      vec3 muscleColour(vec3 p){
        vec3 RED = vec3(.58, .14, .12), TEN = vec3(.87, .82, .73), BONE = vec3(.93, .89, .79), CART = vec3(.78, .86, .86);
        float ax = abs(p.x), s = p.x < 0.0 ? -1.0 : 1.0, fr = sr(${f1(cz-2)}, ${f1(cz+3)}, p.z);
        if (ax > 15.5 && p.y < ${f1(ARM.cut + .2)}) { float d = length(vec2(ax - ${f1(ARM.bot[0] - .1)}, p.z - (${f1(ARM.bot[2])}))); return d < 0.95 ? BONE : (d < 1.2 ? TEN : RED*0.75); }   // arm cut face
        if (p.y > ${f1(NECKTOP - .3)}) { float d = length(vec2(p.x, p.z + 10.6)); return d < 1.1 ? BONE : (length(vec2(p.x, p.z + 5.0)) < 1.0 ? vec3(.85,.75,.75) : RED*0.75); }   // neck cut: spine, trachea
        vec2 a1 = vec2(s*4.3, 11.2), b1 = vec2(s*1.6, 0.3), b2 = vec2(s*5.2, 0.6);
        float dS = min(segd(p.xy, a1, b1), segd(p.xy, a1, b2));
        if (p.y > -0.8 && p.z > -9.0 && dS < 1.25) { vec2 dir = normalize(b1 - a1); vec3 c = fib(RED, dot(p.xy, vec2(-dir.y, dir.x))*15.0); return mix(c, TEN, sr(1.4, 0.3, p.y)*0.85) * (0.8 + 0.2*smoothstep(1.25, 0.8, dS)); }
        if (ax > 14.0 && p.y > -13.0 && p.y < 3.5) { vec2 d = vec2((p.x - s*21.6)*s, p.y + 12.8); vec3 c = fib(RED, atan(d.y, d.x)*70.0); return mix(c, TEN, sr(-10.5, -12.8, p.y)*0.6); }   // deltoid
        if (ax > 16.0) { return fib(RED*0.92, (ax + 0.25*p.y)*14.0); }                                    // biceps / triceps
        if (p.y > -0.6 && p.z < -6.0) { vec2 dir = normalize(vec2(s*12.9, -7.6)); return fib(RED*0.9, dot(p.xy, vec2(-dir.y, dir.x))*12.0); }   // trapezius
        if (p.y > -0.6) { return fib(mix(RED, vec3(.7,.35,.32), 0.35), p.x*12.0); }                        // strap muscles of the neck
        if (p.z < ${f1(cz - 2.5)}) { float c = fib(RED*0.85, (p.y + 0.7*ax)*9.0).r; return mix(vec3(c, c*0.24, c*0.21), TEN, (1.0 - smoothstep(0.6, 1.2, ax))*0.7); }   // back
        if (fr > 0.5 && ax < sternHW(p.y) + 0.2 && p.y < -0.5 && p.y > -20.5) { return mix(BONE, TEN, 0.35); }   // sternum under its membrane
        float yL = -16.0 + clamp(ax - 3.0, 0.0, 12.0)*0.42;
        float mP = sr(-0.3, 0.5, p.y - yL)*sr(1.7, 2.4, ax)*sr(0.9, -0.4, p.y)*sr(16.6, 15.4, ax);
        if (mP > 0.02) { vec2 d = vec2((p.x - s*15.8)*s, p.y + 4.8); float an = atan(d.y, d.x);
          vec3 c = fib(RED, an*110.0);
          c *= 1.0 - 0.45*exp(-pow((an - 2.93)/0.025, 2.0));                                              // clavicular / sternocostal heads
          c = mix(c, TEN, sr(13.4, 15.3, ax)*0.75);
          return c*(0.55 + 0.45*smoothstep(0.02, 0.6, mP)); }
        if (ax < 7.4 && p.y < -16.5 && fr > 0.3) {                                                         // rectus abdominis
          if (ax < 0.55) return TEN;
          float w = 0.25*sin(p.x*0.6);
          if (abs(p.y + 23.0 + w) < 0.4 || abs(p.y + 29.5 + w) < 0.4 || abs(p.y + 35.5 + w) < 0.4) return TEN*0.97;
          return fib(RED, p.x*15.0)*(ax > 7.0 ? 0.75 : 1.0); }
        if (ax > 12.2 && p.y < yL - 0.2 && p.y > -21.0) {                                                  // serratus anterior
          float g = fract((p.y + 0.35*ax)/2.4); vec3 c = fib(RED, (p.y - 0.8*ax)*11.0); return c*(0.7 + 0.3*smoothstep(0.0, 0.18, g)); }
        if (p.y < costalY(ax) - 0.3 && fr > 0.3) {                                                         // external oblique + aponeurosis
          vec3 c = fib(RED, dot(p.xy, vec2(0.8, -s*0.6))*13.0); return mix(c, TEN, sr(9.6, 8.2, ax)*sr(-25.0, -28.0, p.y)*0.85); }
        float rb = ribBand(p.xy);                                                                         // rib cage: ribs, cartilages, intercostals
        if (rb > 0.5) { float n = ribNo(p.xy), cc = n <= 5.0 ? 2.5 + n : (n <= 7.0 ? 8.0 : n + 1.0); return ax < cc ? CART : BONE; }
        return fib(RED*0.82, dot(p.xy, vec2(0.8, -s*0.6))*16.0);
      }`).replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = muscleColour(vB);"); };

  const skinGroup = new T.Group(), musGroup = new T.Group();
  const skinMesh = new T.Mesh(new T.BufferGeometry(), skinMat), musMesh = new T.Mesh(new T.BufferGeometry(), musMat);
  skinGroup.add(skinMesh); musGroup.add(musMesh);
  const built = buildSkin(); skinMesh.geometry = built.skin; musMesh.geometry = built.muscle;

  /* ---- skeleton ---- */
  const boneMat = new T.MeshStandardMaterial({ color: 0xece2cc, roughness: .55, clippingPlanes: clips }),
        cartMat = new T.MeshStandardMaterial({ color: 0xbfd8da, roughness: .45, clippingPlanes: clips }),
        discMat = new T.MeshStandardMaterial({ color: 0x9fb7c9, roughness: .6, clippingPlanes: clips });
  const skeleton = new T.Group();
  const outward = p => { const zz = p.z - cz, b = zz > 0 ? hd : hdB; return new T.Vector3(p.x/(hw*hw), 0, zz/(b*b)).normalize(); };
  /* flat rib: elliptical cross-section, wide along the body axis, thin radially */
  function ribbon(pts, mat, w = 1.0, th = .44, nrm = outward){
    if (pts.length < 2) return null;
    const curve = new T.CatmullRomCurve3(pts, false, "centripetal"), N = Math.max(10, pts.length*3), SEG = 8, pos = [], idx = [];
    for (let i = 0; i <= N; i++){ const u = i/N, P = curve.getPointAt(u), Tg = curve.getTangentAt(u), n = nrm(P), taper = .82 + .18*Math.sin(Math.PI*Math.min(1, u*4, (1-u)*4 + .0001));
      n.sub(Tg.clone().multiplyScalar(n.dot(Tg))).normalize(); const b = new T.Vector3().crossVectors(Tg, n).normalize();
      for (let k = 0; k < SEG; k++){ const a = k/SEG*2*Math.PI; pos.push(P.x + b.x*Math.cos(a)*w/2*taper + n.x*Math.sin(a)*th/2, P.y + b.y*Math.cos(a)*w/2*taper + n.y*Math.sin(a)*th/2, P.z + b.z*Math.cos(a)*w/2*taper + n.z*Math.sin(a)*th/2); } }
    for (let i = 0; i < N; i++) for (let k = 0; k < SEG; k++){ const a = i*SEG+k, b = i*SEG+(k+1)%SEG, c = a+SEG, d = b+SEG; idx.push(a, c, b, b, c, d); }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(g, mat); m.material.side = T.DoubleSide; return m;
  }
  const under = (x, y, d = 1) => { const p = PROBE.skinPoint(x, y), m = PROBE.outwardNormal(p); return new T.Vector3(p[0]-m[0]*d, y, p[2]-m[2]*d); };
  const backArc = (s, f, y, inset = 2.0) => new T.Vector3(s*(hw-inset)*Math.sin(f), y, cz + (hdB-inset)*Math.cos(f));
  const numbers = E.ribs.numbers;
  for (const n of numbers) for (const s of [1, -1]){
    const cc = E.ribs.costochondralJunction_absX[n], cart = [], bone = [];
    for (let ax = 1.2; ax <= 14.6; ax += .45){ const y = ribY(n, ax); if (y <= costalY(ax) && n >= 7) continue; (ax < cc ? cart : bone).push(under(s*ax, y)); }
    if (cart.length && bone.length) bone.unshift(cart[cart.length-1].clone());
    if (bone.length){ const y0 = bone[bone.length-1].y;                                                          // round the side and back to the spine, rising
      for (let a = 100; a <= 168; a += 8) bone.push(backArc(s, a*Math.PI/180, y0 + (a-90)/78*6.4)); }
    const mc = ribbon(cart, cartMat, .95, .5), mb = ribbon(bone, boneMat);
    if (mc) skeleton.add(mc); if (mb) skeleton.add(mb);
  }
  for (const [n, yHead] of [[11, -22.4], [12, -24.6]]) for (const s of [1, -1]){                                // floating ribs
    const pts = []; for (let a = 168; a >= (n === 11 ? 104 : 118); a -= 8) pts.push(backArc(s, a*Math.PI/180, yHead - (168-a)/64*4.2));
    skeleton.add(ribbon(pts, boneMat, .85, .4)); }
  for (const s of [1, -1]){                                                                                     // costal arch (cartilages 7–10)
    const pts = [[1.4, -19.2]].concat(E.ribs.costalMargin_polyline.slice(0, 3).map((q, i) => [q[0], q[1] + (i ? .3 : .6)])).map(q => under(s*q[0], q[1], 1.1));
    skeleton.add(ribbon(pts, cartMat, .9, .5)); }
  { /* sternum: manubrium with jugular and clavicular notches, body, xiphoid; bevelled so it reads as bone */
    const R = [[0, -.95], [.65, -.45], [1.6, -.55], [2.65, -.9], [2.85, -1.6], [2.6, -2.9], [2.2, -4.6], [1.85, -5.05], [1.95, -5.5], [2.05, -9], [2.0, -12.5], [1.65, -16.5], [1.35, -17.9], [.8, -18.4], [.55, -19.6], [.25, -20.4], [0, -20.5]];
    const sh = new T.Shape(); sh.moveTo(R[0][0], R[0][1]); for (let i = 1; i < R.length; i++) sh.lineTo(R[i][0], R[i][1]); for (let i = R.length-2; i > 0; i--) sh.lineTo(-R[i][0], R[i][1]); sh.closePath();
    const t = E.sternum.thickness, bev = .28, g = new T.ExtrudeGeometry(sh, { depth: t - 2*bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev*.8, bevelSegments: 3, curveSegments: 4 });
    const m = new T.Mesh(g, boneMat); m.position.z = E.sternum.frontZ - t + bev; skeleton.add(m); }
  for (const c of E.clavicles.items){                                                                           // S-shaped clavicles, kept under the drawn skin
    const pts = []; for (let i = 0; i <= 14; i++){ const t = i/14, x = c.a[0]+(c.b[0]-c.a[0])*t, y = c.a[1]+(c.b[1]-c.a[1])*t - .4*Math.sin(Math.PI*t), z = c.a[2]+(c.b[2]-c.a[2])*t + .8*Math.sin(2*Math.PI*t);
      pts.push(new T.Vector3(x, y, Math.min(z, surfaceAt(x, y).p.z - 1.0))); }
    const m = ribbon(pts, boneMat, 1.5, 1.2, () => new T.Vector3(0, 0, 1)); skeleton.add(m);
    for (const e of [pts[0], pts[pts.length-1]]){ const k = new T.Mesh(new T.SphereGeometry(.85, 12, 10), boneMat); k.position.copy(e); skeleton.add(k); } }
  for (const s of [1, -1]){                                                                                     // scapula + spine of scapula, humerus
    const V = [[5.2, -3.2], [14.2, -3.6], [9, -19.5]], pos = [], N = 10;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N-i; j++){ const u = i/N, w = j/N, x = V[0][0] + (V[1][0]-V[0][0])*u + (V[2][0]-V[0][0])*w, y = V[0][1] + (V[1][1]-V[0][1])*u + (V[2][1]-V[0][1])*w;
      const f = Math.asin(Math.min(1, x/(hw-1.0))), q = backArc(s, Math.PI - f, y, 1.0); pos.push(q.x, q.y, q.z); }
    const idx = [], row = i => i*(N+1) - i*(i-1)/2;
    for (let i = 0; i < N; i++) for (let j = 0; j < N-i; j++){ const a = row(i)+j, b = row(i+1)+j, c = a+1; idx.push(a, b, c); if (j < N-i-1){ const d = row(i+1)+j+1; idx.push(b, d, c); } }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const bm = boneMat.clone(); bm.side = T.DoubleSide; bm.clippingPlanes = clips; skeleton.add(new T.Mesh(g, bm));   // clone() copies the planes: re-link the live one
    const sp = [backArc(s, Math.PI - .38, -6.5, 1.3), backArc(s, Math.PI - .7, -5.0, .9), backArc(s, Math.PI*.62, -3.2, .8), new T.Vector3(s*16.2, -1.6, -8.4)];
    skeleton.add(ribbon(sp, boneMat, .9, .7, p => p.clone().setY(0).sub(new T.Vector3(0, 0, cz)).normalize()));
    const head = new T.Mesh(new T.SphereGeometry(2.2, 18, 14), boneMat); head.position.set(s*17.8, -2.7, -9.3); skeleton.add(head);
    skeleton.add(new T.Mesh(new T.TubeGeometry(new T.LineCurve3(new T.Vector3(s*18.4, -3.8, -9.3), new T.Vector3(s*ARM.bot[0], ARM.cut, ARM.bot[2])), 8, .85, 10), boneMat)); }
  { /* spine: cervical lordosis, thoracic kyphosis; instanced vertebral bodies, discs, spinous and transverse processes */
    const L = []; let y = 12;
    for (let i = 0; i < 7; i++){ L.push({ y, h: 1.45, r: 1.05 }); y -= 1.45; }
    for (let i = 0; i < 12; i++){ L.push({ y, h: 2.15, r: 1.35 + i*.04 }); y -= 2.15; }
    for (let i = 0; i < 5; i++){ L.push({ y, h: 2.8, r: 1.95 }); y -= 2.8; }
    const zc = yy => yy > 2 ? -15.2 + (yy-2)*.36 : (yy > -24 ? -15.5 - .5*Math.sin((2-yy)/26*Math.PI) : -15.2 + Math.min(1.6, (-24-yy)*.12));
    const bodyG = new T.CylinderGeometry(1, 1, 1, 18), boxG = new T.BoxGeometry(1, 1, 1);
    const bodies = new T.InstancedMesh(bodyG, boneMat, L.length), discs = new T.InstancedMesh(bodyG, discMat, L.length), spines = new T.InstancedMesh(boxG, boneMat, L.length), trans = new T.InstancedMesh(boxG, boneMat, L.length);
    const M = new T.Object3D();
    L.forEach((v, i) => { const yc = v.y - v.h/2, z = zc(yc);
      M.position.set(0, yc, z); M.rotation.set(0, 0, 0); M.scale.set(v.r, v.h*.74, v.r*.85); M.updateMatrix(); bodies.setMatrixAt(i, M.matrix);
      M.position.set(0, v.y - v.h + .02, z); M.scale.set(v.r*.95, v.h*.24, v.r*.8); M.updateMatrix(); discs.setMatrixAt(i, M.matrix);
      M.position.set(0, yc - v.h*.25, z - v.r - 1.5); M.rotation.set(-.45, 0, 0); M.scale.set(.5, v.h*.45, 2.1); M.updateMatrix(); spines.setMatrixAt(i, M.matrix);
      M.position.set(0, yc + v.h*.1, z - v.r - .6); M.rotation.set(0, 0, 0); M.scale.set(v.r*3.8, .45, .8); M.updateMatrix(); trans.setMatrixAt(i, M.matrix); });
    skeleton.add(bodies, discs, spines, trans); }

  /* ---- landmarks and acoustic windows: lines on the skin + HTML labels (the HTML lives in #lmLabels over the 3D view) ---- */
  const landmarks = new T.Group(), labelHost = document.getElementById("lmLabels"), labels = [];
  const lineMat = new T.LineDashedMaterial({ color: 0xffffff, dashSize: .7, gapSize: .45, transparent: true, opacity: .9 }),
        solidMat = new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .75 }),
        winMat = new T.LineDashedMaterial({ color: 0x38c6e8, dashSize: .8, gapSize: .5 });
  const onSkinPts = (pts, off = .14) => pts.map(q => surfaceAt(q[0], q[1], off).p);
  const samp = (a, b, n = 16) => Array.from({ length: n+1 }, (_, i) => [a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n]);
  const addLine = (pts, mat) => { const l = new T.Line(new T.BufferGeometry().setFromPoints(onSkinPts(pts)), mat); if (mat.isLineDashedMaterial) l.computeLineDistances(); l.layers.set(1); landmarks.add(l); return l; };
  const dotGeo = new T.SphereGeometry(.32, 10, 8), dotMat = new T.MeshBasicMaterial({ color: 0xffffff }), winDotMat = new T.MeshBasicMaterial({ color: 0x38c6e8 });
  function addLabel(text, x, y, kind = "lm", side = "r", dot = true){
    const el = document.createElement("div"); el.className = `lm ${kind} ${side}`; el.innerHTML = `<i></i><span>${text}</span>`; labelHost.appendChild(el);
    const L = { el, x, y, pos: null, n: null, dot: null, side, cur: side }; labels.push(L);
    if (dot){ L.dot = new T.Mesh(dotGeo, kind === "win" ? winDotMat : dotMat); L.dot.layers.set(1); landmarks.add(L.dot); }
    placeLabel(L); return L; }
  function placeLabel(L){ const s = surfaceAt(L.x, L.y, .2); L.pos = s.p; L.n = s.n; if (L.dot) L.dot.position.copy(s.p); }
  /* fixed surface landmarks */
  addLine(samp([0, -1.2], [0, stY.xiphoid_tip_y], 24), lineMat);                                                // midsternal line
  addLine(samp([-2.6, stY.sternal_angle_y], [2.6, stY.sternal_angle_y], 8), solidMat);                          // sternal angle
  for (const s of [1, -1]){ let pts = [[0, stY.xiphoid_tip_y]]; const cm = E.ribs.costalMargin_polyline;      // costal margins
    cm.forEach((q, i) => { pts = pts.concat(samp(i ? [s*cm[i-1][0], cm[i-1][1]] : [0, stY.xiphoid_tip_y], [s*q[0], q[1]], 8).slice(1)); }); addLine(pts, solidMat); }
  addLine(samp([9.5, -2.5], [9.5, -24.5], 24), lineMat); addLine(samp([12.5, -4], [12.5, -25.5], 24), lineMat); // left MCL, AAL
  addLabel("Suprasternal notch", 0, -.15, "lm", "l");
  addLabel("Sternal angle · rib 2", -2.6, stY.sternal_angle_y, "lm", "l");
  for (let n = 1; n <= 6; n++) addLabel(`ICS ${n}`, -2.7, ribY(n, 2.7) - 1.125, "ics", "l");
  addLabel("Xiphoid", 0, stY.xiphoid_tip_y, "lm", "l", true);
  addLabel("Costal margin", -9.6, costalY(9.6), "lm minor", "l");
  addLabel("Nipple ≈ 4th ICS", NIP[0], NIP[1], "lm minor", "r");
  addLabel("MCL", 9.5, -2.8, "lm small", "r", false); addLabel("AAL", 12.5, -4.3, "lm small", "r", false);
  addLabel("Umbilicus", UMB[0], UMB[1], "lm minor", "r");
  const pmi = addLabel("Apex beat (PMI)", 10, -15, "lm", "r");
  /* windows: dashed outlines from views.json, apical moves with the heart in LLD */
  const winLines = {}, winLabels = {};
  const ellipse = (cx, cy, rx, ry) => Array.from({ length: 49 }, (_, i) => { const a = i/48*2*Math.PI; return [cx + rx*Math.cos(a), cy + ry*Math.sin(a)]; });
  const WIN = [["parasternal_left", "Parasternal window"], ["apical", "Apical window"], ["subxiphoid", "Subcostal window"]];
  function layout(position){
    const off = ph.positions[position].heartOffset_patient || [0, 0, 0];
    for (const [id, name] of WIN){ const w = VJ.windows[id], dx = id === "apical" ? off[0] : 0, cx = (w.xRange[0]+w.xRange[1])/2 + dx, cy = (w.yRange[0]+w.yRange[1])/2, rx = (w.xRange[1]-w.xRange[0])/2, ry = (w.yRange[0]-w.yRange[1])/2;
      if (winLines[id]){ landmarks.remove(winLines[id]); winLines[id].geometry.dispose(); }
      winLines[id] = addLine(ellipse(cx, cy, rx, ry), winMat);
      if (!winLabels[id]) winLabels[id] = addLabel(name, cx + rx, cy, "win", "r", false); else { winLabels[id].x = cx + rx; winLabels[id].y = cy; placeLabel(winLabels[id]); } }
    if (!winLines.ss){ winLines.ss = addLine(ellipse(0, .35, 1.7, 1.0), winMat); winLabels.ss = addLabel("Suprasternal window", 1.7, .5, "win", "r", false); }
    const a = DERIVE.heartToPatient(ph, position)(ph.landmarks_heart.LV_apex_epi); pmi.x = a[0]; pmi.y = a[1]; placeLabel(pmi);
  }
  /* per frame: project labels; hide those facing away or covered by the probe */
  const tmp = new T.Vector3(), nW = new T.Vector3(), camDir = new T.Vector3();
  function updateLabels(cam, rect, patientWorld, show, hole){
    labelHost.hidden = !show; if (!show) return;
    const m3 = new T.Matrix3().setFromMatrix4(patientWorld);
    for (const L of labels){
      tmp.copy(L.pos).applyMatrix4(patientWorld); nW.copy(L.n).applyMatrix3(m3).normalize(); camDir.copy(cam.position).sub(tmp).normalize();
      const facing = nW.dot(camDir) > .12; tmp.project(cam);
      const x = (tmp.x*.5+.5)*rect.w, y = (-tmp.y*.5+.5)*rect.h, inHole = hole && x > hole.x - 8 && x < hole.x + hole.w + 8 && y > hole.y - 8 && y < hole.y + hole.h + 8,
        vis = facing && !inHole && tmp.z < 1 && x > -40 && x < rect.w + 40 && y > -20 && y < rect.h + 20;
      L.el.style.display = vis ? "" : "none"; if (vis){ L.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
        const want = L.side === "r" ? (x > rect.w - 150 ? "l" : "r") : (x < 150 ? "r" : "l"); if (want !== L.cur){ L.cur = want; L.el.classList.toggle("r", want === "r"); L.el.classList.toggle("l", want === "l"); } } }
  }
  function setRibsVisible(on){ ribsU.value = on ? 1 : 0; }

  return { skinGroup, musGroup, skinMesh, musMesh, skinMat, ghostMat, skeleton, landmarks, torsoGeo: built.skin,
    surfaceAt, liftAt, height, sdf, costalY, ribY, layout, updateLabels, setRibsVisible, NIP };
}
