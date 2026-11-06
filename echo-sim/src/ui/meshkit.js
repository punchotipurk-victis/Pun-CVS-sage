/* ===== MESHKIT: surface nets on a sampled field, Taubin smoothing, value noise. Shared by body.js and scene.js. ===== */
const MESHKIT = (() => {
  const C = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]], E = [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
  /* vals < 0 = inside. Sample (i,j,k) sits at o + (i,j,k)*v. */
  function nets(vals, n, o, v){
    const [nx, ny, nz] = n, id = (i, j, k) => i + nx*(j + ny*k), vid = new Int32Array(nx*ny*nz).fill(-1), pos = [], tris = [], c = new Float32Array(8);
    for (let k = 0; k < nz-1; k++) for (let j = 0; j < ny-1; j++) for (let i = 0; i < nx-1; i++){
      let mask = 0; for (let q = 0; q < 8; q++){ const w = vals[id(i+C[q][0], j+C[q][1], k+C[q][2])]; c[q] = w; if (w < 0) mask |= 1 << q; }
      if (mask === 0 || mask === 255) continue;
      let px = 0, py = 0, pz = 0, m = 0;
      for (const [e, f] of E){ if ((c[e] < 0) === (c[f] < 0)) continue; const u = c[e]/(c[e]-c[f]); px += C[e][0]+u*(C[f][0]-C[e][0]); py += C[e][1]+u*(C[f][1]-C[e][1]); pz += C[e][2]+u*(C[f][2]-C[e][2]); m++; }
      vid[id(i, j, k)] = pos.length/3; pos.push(o[0]+(i+px/m)*v, o[1]+(j+py/m)*v, o[2]+(k+pz/m)*v); }
    const quad = (p, q, r, s, flip) => { if (p < 0 || q < 0 || r < 0 || s < 0) return; if (!flip) tris.push(p, r, q, p, s, r); else tris.push(p, q, r, p, r, s); };
    for (let k = 1; k < nz-1; k++) for (let j = 1; j < ny-1; j++) for (let i = 1; i < nx-1; i++){
      const s0 = vals[id(i, j, k)] < 0;
      if (s0 !== (vals[id(i+1, j, k)] < 0)) quad(vid[id(i,j-1,k-1)], vid[id(i,j,k-1)], vid[id(i,j,k)], vid[id(i,j-1,k)], s0);
      if (s0 !== (vals[id(i, j+1, k)] < 0)) quad(vid[id(i-1,j,k-1)], vid[id(i-1,j,k)], vid[id(i,j,k)], vid[id(i,j,k-1)], s0);
      if (s0 !== (vals[id(i, j, k+1)] < 0)) quad(vid[id(i-1,j-1,k)], vid[id(i,j-1,k)], vid[id(i,j,k)], vid[id(i-1,j,k)], s0); }
    return { pos: new Float32Array(pos), idx: new Uint32Array(tris) };
  }
  /* sample an SDF on a grid, skipping 4³ blocks that are clearly far from the surface */
  function sampleSDF(f, lo, hi, v){
    const n = lo.map((a, i) => Math.ceil((hi[i]-a)/v)+1), [nx, ny, nz] = n, vals = new Float32Array(nx*ny*nz), B = 4, far = v*B*1.0;
    for (let k0 = 0; k0 < nz; k0 += B) for (let j0 = 0; j0 < ny; j0 += B) for (let i0 = 0; i0 < nx; i0 += B){
      const cval = f(lo[0]+(i0+B/2)*v, lo[1]+(j0+B/2)*v, lo[2]+(k0+B/2)*v), skip = Math.abs(cval) > far;
      for (let k = k0; k < Math.min(nz, k0+B); k++) for (let j = j0; j < Math.min(ny, j0+B); j++) for (let i = i0; i < Math.min(nx, i0+B); i++)
        vals[i + nx*(j + ny*k)] = skip ? cval : f(lo[0]+i*v, lo[1]+j*v, lo[2]+k*v); }
    return { vals, n };
  }
  /* neighbours in CSR form */
  function adjacency(nv, idx){
    const deg = new Uint32Array(nv+1); for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++){ deg[idx[t+e]] += 2; }
    const start = new Uint32Array(nv+1); for (let i = 0; i < nv; i++) start[i+1] = start[i] + deg[i];
    const fill = start.slice(0, nv), nb = new Uint32Array(start[nv]);
    for (let t = 0; t < idx.length; t += 3){ const a = idx[t], b = idx[t+1], c = idx[t+2]; nb[fill[a]++] = b; nb[fill[a]++] = c; nb[fill[b]++] = a; nb[fill[b]++] = c; nb[fill[c]++] = a; nb[fill[c]++] = b; }
    return { start, nb };
  }
  /* Taubin λ|μ smoothing: removes the surface-nets facets without shrinking the organ */
  function smooth(pos, idx, iters = 8, lam = .5, mu = -.53, adj){
    const nv = pos.length/3, A = adj || adjacency(nv, idx), tmp = new Float32Array(pos.length);
    for (let it = 0; it < iters; it++) for (const f of [lam, mu]){
      for (let i = 0; i < nv; i++){ const s = A.start[i], e = A.start[i+1]; if (e === s){ tmp[i*3] = pos[i*3]; tmp[i*3+1] = pos[i*3+1]; tmp[i*3+2] = pos[i*3+2]; continue; }
        let x = 0, y = 0, z = 0; for (let q = s; q < e; q++){ const j = A.nb[q]*3; x += pos[j]; y += pos[j+1]; z += pos[j+2]; } const m = e-s;
        tmp[i*3] = pos[i*3] + f*(x/m-pos[i*3]); tmp[i*3+1] = pos[i*3+1] + f*(y/m-pos[i*3+1]); tmp[i*3+2] = pos[i*3+2] + f*(z/m-pos[i*3+2]); }
      pos.set(tmp); }
    return A;
  }
  /* cheap smooth 3D value noise in [0,1] */
  const hash = (x, y, z) => { const s = Math.sin(x*127.1 + y*311.7 + z*74.7)*43758.5453; return s - Math.floor(s); };
  function noise(x, y, z){ const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x-ix, fy = y-iy, fz = z-iz, u = fx*fx*(3-2*fx), w = fy*fy*(3-2*fy), t = fz*fz*(3-2*fz);
    const L = (a, b, k) => a + (b-a)*k, h = (a, b, c) => hash(ix+a, iy+b, iz+c);
    return L(L(L(h(0,0,0), h(1,0,0), u), L(h(0,1,0), h(1,1,0), u), w), L(L(h(0,0,1), h(1,0,1), u), L(h(0,1,1), h(1,1,1), u), w), t); }
  const fbm = (x, y, z) => .55*noise(x, y, z) + .3*noise(x*2.1, y*2.1, z*2.1) + .15*noise(x*4.3, y*4.3, z*4.3);
  function geometry(pos, idx){ const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals(); return g; }
  return { nets, sampleSDF, adjacency, smooth, noise, fbm, geometry };
})();
