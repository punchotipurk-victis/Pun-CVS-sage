/* Echo render test: renders every v1 view at its derived target, one per frame, with visible status and errors.
   Open dist/render-test.html in Chrome/Edge. */
const $ = id => document.getElementById(id);
const status = (m, bad) => { const s = $("status"); s.textContent = m; s.className = bad ? "bad" : ""; };
const log = m => { $("log").textContent += m + "\n"; console.log(m); };
window.addEventListener("error", e => status("Error: " + (e.message || e.error), true));
async function main(){
  const J = id => JSON.parse(document.getElementById(id).textContent), ph = J("phantom"), VJ = J("views");
  if (typeof THREE === "undefined") throw new Error("three.js did not load");
  const W = 640, H = 480, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  if (!cv.getContext("webgl2")) throw new Error("WebGL2 is not available in this browser (turn on hardware acceleration in browser settings).");
  const renderer = new THREE.WebGLRenderer({ canvas: cv, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  let shaderErr = null;
  renderer.debug.onShaderError = (gl, prog, vs, fs) => { shaderErr = (gl.getShaderInfoLog(fs) || "") + (gl.getShaderInfoLog(vs) || "") + (gl.getProgramInfoLog(prog) || ""); };
  const eng = EchoEngine(renderer, ph, { lines: 160, samples: 320 });
  const ctx = { trueLVLength: 8.5, ivcRadius: 0.9, landmarkInImage: () => null };
  const grid = $("grid"), next = () => new Promise(r => requestAnimationFrame(() => r()));
  async function shot(title, viewId, pos, delta = {}, tint = false){
    status("Rendering " + title + " …"); await next();
    const v = VJ.views.find(x => x.id === viewId), tg = DERIVE.derive(VJ, ph, pos)[viewId];
    const pose = { x: tg.x, y: tg.y, notchDeg: tg.notchDeg + (delta.notch || 0), tiltDeg: tg.tiltDeg + (delta.tilt || 0), rockDeg: tg.rockDeg };
    eng.setPatientPosition(pos); eng.setProbe(PROBE.frame(pose), VJ.windows[v.window].pressCm || 0);
    eng.setImaging({ depthCm: v.image.depthCm, sectorDeg: v.image.sectorDeg, gainDb: 0, markerRight: true, tint });
    const t0 = performance.now(); eng.render(delta.t || 0, 0, 1, null, W / H);
    if (shaderErr) throw new Error("Shader failed to compile:\n" + shaderErr.slice(0, 1500));
    const L = eng.readLabels(), ms = performance.now() - t0;
    const ps = SCORING.poseScore(pose, tg, v.tolerance), cs = SCORING.contentScore(v, L, ctx), q = 0.5 * ps.score + 0.5 * cs.score;
    const f = document.createElement("figure");
    f.innerHTML = `<img src="${cv.toDataURL()}" alt="${title}"><figcaption>${title} · quality ${q.toFixed(0)}${cs.fails.length ? " · " + cs.fails.join(", ") : ""}</figcaption>`;
    grid.appendChild(f);
    log(`${title.padEnd(28)} quality ${q.toFixed(0).padStart(3)}  (pose ${ps.score.toFixed(0)}, content ${cs.score.toFixed(0)})  ${ms.toFixed(0)} ms`);
  }
  for (const v of VJ.views) await shot(v.shortName + " (supine, end-diastole)", v.id, "supine");
  await shot("PLAX · early diastole (MV open)", "plax", "supine", { t: 0.53 });
  await shot("PSAX-MV · early diastole (fish mouth)", "psax_mv", "supine", { t: 0.53 });
  await shot("A4C · early diastole (MV/TV open)", "a4c", "supine", { t: 0.53 });
  await shot("A5C · systole (AV open)", "a5c", "supine", { t: 0.2 });
  await shot("A4C (LLD)", "a4c", "LLD");
  await shot("A4C tilted toward CS (pitfall)", "a4c", "supine", { tilt: -12 });
  await shot("PLAX rotated 25° (off target)", "plax", "supine", { notch: 25 });
  await shot("PLAX · anatomy tint", "plax", "supine", {}, true);
  await shot("A4C · anatomy tint", "a4c", "supine", {}, true);
  await shot("PSAX-AV · anatomy tint", "psax_av", "supine", {}, true);
  status("Done — " + grid.children.length + " renders. Quality ≥ 80 = view locks.");
  document.body.dataset.done = "1";
}
main().catch(e => { status("Error: " + e.message, true); log(e.stack || String(e)); document.body.dataset.done = "1"; });
