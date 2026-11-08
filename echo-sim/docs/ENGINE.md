<!-- Mirror of the Claude skill 'echo-sim-engine'. Keep in sync: edit both. -->

# Echo Simulator Engine (Pun CVS Lab)

This skill builds the 3D transthoracic echo simulator in Punnatorn's Cardio Super App. It covers the engine and the UI. The learner moves a probe on a 3D patient, and the echo fan updates live from a heart model. The sister skill **echo-view-library** covers *which* views exist, how they are scored and what is taught. Load both when building views, labels or learning modes.

The design is frozen in the project doc `claude/echo-simulator-plan.md` (v1.2). These are the locked decisions:
- **Echo image:** each frame slices a 3D heart model ("phantom") along the probe plane.
- **Patient position:** a Supine ⇄ Left lateral decubitus (LLD) button. In LLD the heart shifts and the lung window changes.
- **Screen convention:** cardiology/ASE by default (marker on the right of the screen), with a POCUS (marker-left) toggle.
- **Input:** mouse and touch. A phone-gyroscope probe comes later and plugs into the input layer.
- **Anatomy Inset:** two panes, a Torso map and a Heart cutaway. One is large and the other is a small thumbnail; tapping the small one swaps them. Both stay synced.
- **Body-view button:** Skin → Muscle → Ghost → Skeleton (Muscle added 7 Nov 2026 at the user's request).
- **3D heart:** the visible heart is meshed **from the same phantom** as the echo, so the cut face always matches the image.
- **Theme:** panels follow the app's light/dark theme. The echo screen and the Heart cutaway pane are always dark.
- **Audience:** medical students who love cardiology, residents and cardiology fellows.

## Where things live
- **Data (single source of truth):**
  - `echo-sim/data/phantom-normal.json`: anatomy, tissues, cardiac and respiratory cycles, positions, tint palette.
  - `echo-sim/data/views.json`: view targets, scoring and teaching.
  - Copies of both are in the Cardio Super App project docs (`claude/echo-sim/…`) and in Punnatorn's `Resources App/echo-sim/data/` folder.
  - If you can't find them, ask; never invent new geometry.
- **App:** GitHub `punchotipurk-victis/Pun-CVS-sage` contains a single `index.html` with no build step.
  - Every lab is a **self-contained HTML page**, stored as base64 in `const LABS = { key: {title, b64} }` and opened in an iframe through `srcdoc`.
  - Nothing can load by relative URL, so three.js, all JS/CSS and the JSON are inlined.
  - The echo lab key is `echo` (route `#echo`).
- **Code:** the tested engine (`src/engine/phantom.js, echo.js, probe.js, derive.js, scoring.js`) and tools (`tools/build_lab.py, embed_lab.py, validate_data.py`) are canonical in the repo under `echo-sim/`. Snapshots of v0.2 are in the project docs (`claude/echo-sim/engine/*.js`, `claude/echo-sim/tools/*.py`) and in the starter kit (`echo-sim-starter.zip`). If the repo doesn't have them yet, copy them in from there (read the project docs with `project_read`) before building. Don't rewrite them from memory.
- **Codex mirror:** `echo-sim/AGENTS.md` and `echo-sim/docs/ENGINE.md`, `VIEWS.md` repeat this skill's rules for Codex. If you change a rule here, update the mirror as well.

## Workflow
1. Say in one line what you are building, then make a task list. Read the plan doc and both JSON files first.
2. Run `tools/validate_data.py` before you touch the engine. A broken id there turns into a black echo later.
3. Repo layout:
   ```
   echo-sim/src/index.html        template with build markers
   echo-sim/src/engine/           phantom.js, echo.js, probe.js, derive.js, scoring.js (tested; see Code above)
   echo-sim/src/ui/               scene.js, inset.js, panels.js, input.js, style.css
   echo-sim/data/                 the JSON files (+ views.overrides.json from calibration)
   echo-sim/tools/                build_lab.py, embed_lab.py, validate_data.py
   echo-sim/dist/echo-sim.html    built, self-contained lab
   ```
4. Build with `build_lab.py` and test headless (see Testing). Then embed with `embed_lab.py` into a copy of `index.html` and check that `#echo` opens and that the other labs still route.
5. Add features one at a time and re-test after each, the same discipline as the heart-3d-model skill.
6. Deliver:
   - Commit or PR to the repo if push access is attached. Otherwise send the built files.
   - Write durable decisions into the project doc.
   - Never publish patient-identifying or copyrighted images. POCUS101, Mayo, Vimedix and Phantovis are *design references only*.

## Architecture: one phantom, three consumers
```
phantom-normal.json ──PHANTOM.compile()──► GLSL scene(p) → (tissue, label)
                                            │
     ┌──────────────────────────────────────┼──────────────────────────────────┐
     ▼                                      ▼                                  ▼
 Echo (EchoEngine, 3 GPU passes)   Heart cutaway cut face (quad on     Heart mesh (bake label volume on
 tissue map → beam → display       the beam plane runs scene())        the GPU → surface nets, once)
     │
     └─ readLabels() at 4–5 Hz → content checks, label placement, hints (echo-view-library)
```
Never hand-copy anatomy into a second place: the 3D heart, the cut face and the echo must come from the same `scene()`. The phantom compiler is *semi-generic*. JSON supplies every number, but each structure's role (cavity, wall, valve) and its drawing priority live in `compile()`. A new structure, for example a pathology, needs its own few lines there.

### Coordinates and units
- **Units:** centimetres.
- **Patient (body) frame:** origin at the suprasternal-notch skin. `+x` = patient's **left**, `+y` = head, `+z` = anterior. This matches heart-3d-model's axes, but that skill uses arbitrary units (1 unit ≈ 7.5 cm).
- **Heart frame** (`frames.heart`):
  - Origin at the MV annulus centre. `Z` = LV long axis (base → apex), `X` = toward RV/septum, `Y` = inferior-posterior.
  - The A4C plane ≈ the X–Z plane. Tilting toward −Y opens the LVOT (A5C); tilting toward +Y shows the coronary sinus.
- **LLD:**
  - The heart moves in the body frame: offset +1.6/−0.2/−0.6 cm and an 8° rotation about the MV centre. This is applied in `worldToHeart()`.
  - The **whole body** rolls 40° for display only. Store the probe pose in the body frame so rolling never changes it.
  - Any world-space ray or position must be multiplied by the inverse of the patient group's matrix before it reaches `PROBE`, `scene()` or the cut-face shader.
- **Probe pose:**
  - Stored as `{x, y, notchDeg, tiltDeg, rockDeg}` (+ `pressCm` from the window).
  - `PROBE.frame()` turns it into `{p, beam, lateral, elev, normal}`.
  - `notchDeg` 0 = 12 o'clock (head), +90 = 3 o'clock (patient's left).
  - Tilt + = beam toward the head side (out of the image plane). Rock + = beam toward the notch (in plane).

## Engine file: phantom.js
Compiles `phantom-normal.json` into GLSL `scene(p) → (tissue, label)` and evaluates the cardiac and respiratory parameters.
- **Drawing priority: first match wins:**
  1. Body wall (skin, sternum, ribs, spine, chest wall)
  2. Valves
  3. Papillary muscles and moderator band
  4. Lumens (LVOT before LV)
  5. Walls
  6. Pericardium
  7. Great vessels, liver and diaphragm, stomach gas, lungs
  8. Soft tissue
- **Label ids:** these are the structure ids that views.json uses. `LABEL_TEXT` holds the display text.

**Source:** `echo-sim/src/engine/phantom.js` (snapshot in project docs: `claude/echo-sim/engine/phantom.js`).
**API:** `PHANTOM.compile(ph) → {glsl, names, pidx}` · `makeParamEval(ph) → (t, tr, {effusion_cm}) → Float32Array` · `worldToHeart(ph, 'supine'|'LLD', THREE) → Matrix4` · `tissueTables(ph)` · `TISSUES`, `T` (tissue index), `LABELS` (label ids, index = GLSL label), `LABEL_TEXT`.
GLSL contract: `void scene(vec3 p_body, out int tissue, out int label)` + uniforms `uP[]`, `uW2H`, `uNotchC`, `uNotchS`, `uRibSpaceScale`; helpers `smin`, `sdEllipsoid`, `sdCapsule`, `sdBox`, `sdTorus`, `costalY`.

## Engine file: echo.js
A 3-pass GPU pipeline that works like a real scanner: beams → envelope → log compression → scan conversion. That is why depth, sector, gain and dynamic range behave as they do on a machine.
- **Pass A, tissue map (polar):** records which tissue and label sits at each point of each scan line.
- **Pass B, beam (polar):** walks each scan line from the probe, accumulating transmission.
  - Bone multiplies by 0.04 per cm, which makes the rib shadow.
  - Lung or gas stops the beam, and the image shows A-lines at multiples of the pleural depth instead.
  - (P2) Outputs a complex scatterer signal, not a grey level: `R,G = I,Q` of a zero-mean random field anchored to the **heart-frame** position (trilinear value noise, cell ≈ 0.6 × `speckleCm`, so it sticks to tissue, moves with the heart in LLD and has no blocky cells), `B` = coherent energy (specular borders, lung/gas A-lines). A second field rotates in slowly (`uDecor` ≈ 0.35 rad) for the shimmer of live tissue without brightness pulsing.
  - Past a lung/gas boundary use the transmission **at** the pleura (`TrPre`), not the zero transmission beyond it, or the A-lines vanish.
  - A boundary reflects most strongly when it faces the beam. The angle comes from the neighbouring scan line, which is why the thin fossa drops out in A4C as on a real echo.
  - Attenuation applies with 80% default TGC compensation.
- **Pass D, lateral PSF (polar, P2):** Gaussian across scan lines; beam width σ = 0.045 + 0.75·`lateralBlur_cm_per_cm_depth`·r + 0.008·|r − focus| cm, converted to lines (σ_cm / (r·sector/NL)), 17 taps with a stride so the dense near field stays cheap. I,Q are normalised by √Σw² (keeps speckle statistics), the coherent channel by Σw (keeps brightness).
- **Pass E, axial PSF + envelope (polar, P2):** Gaussian along the line (σ = 0.05 cm ≈ pulse length at 2.5 MHz), then envelope = |I + coherent, Q| × 0.62. This is what makes real Rayleigh speckle grains that elongate sideways with depth, and soft tissue edges instead of stair steps.
- **Pass C, display (screen):**
  - (P2) Samples the envelope with a cubic B-spline (4 bilinear taps): smooth scan conversion, no polar stair steps, no ringing. `setImaging({focus})` = focal depth as a fraction of depth (default 0.6).
  - Scan-converts the fan, then applies dB gain, dynamic range and the marker side.
  - Optionally adds a label tint (0.35 alpha) or the tissue debug view (`tint:'tissue'`).
- **Default resolution (P2):** 256 lines × 512 samples on desktop, 160 × 320 on phones. Scoring reads the nearest-id tissue map (Pass A), which is unchanged in kind, so view scores are the same as at 160 × 320.
- **Blood brightness** is 0.007 (P2; was 0.03): about 35 dB below myocardium, so blood is near-black at the default 55 dB dynamic range, as on a real scanner.

**Source:** `echo-sim/src/engine/echo.js` (snapshot: `claude/echo-sim/engine/echo.js`).
**API:** `EchoEngine(renderer, ph, {lines, samples}) → { render(t, tr, timeS, target|null, aspect), setProbe(frame, pressCm), setImaging({depthCm, sectorDeg, gainDb, drDb, markerRight, tint: true|false|'tissue'}), setPatientPosition(pos), setPalette(pal), readLabels(), tissueLine(i), uniforms, glsl, names, NL, NS }`.
`readLabels()` → `{ labelId: {area cm², cx, cy (cm; x lateral toward notch, y depth), major, minor (≈ full axis lengths), angleDeg (major axis vs screen horizontal), minDepth, maxDepth} }`.

**Usage per frame:**
```js
const fr = PROBE.frame(pose);                                  // body frame
eng.setProbe(fr, VJ.windows[view.window].pressCm || 0);        // probe pressure: subxiphoid needs ~1.5 cm
eng.setImaging({ depthCm, sectorDeg, gainDb, markerRight: convention === "ASE", tint: labelsState === "tint" });
renderer.setViewport(echoRect); renderer.setScissor(echoRect);  // pass C draws into the current viewport
eng.render(phaseT, respT, timeS, null, echoRect.w / echoRect.h);
// at ~4–5 Hz (never every frame — readPixels stalls the GPU):
const L = eng.readLabels();   // → SCORING.contentScore(view, L, ctx) and label placement
```
- **Clocks:** `phaseT = (timeS * HR/60) % 1` and `respT = (timeS * 14/60) % 1`. The Sniff button briefly overrides `IVC_r`.
- **Freeze:** stop advancing the clock but keep rendering, so the speckle still shimmers. ED/ES buttons jump to `cycle.markers`.
- **Persistence (to add):** keep the previous Pass-C output in a render target and blend it `mix(prev, cur, 1-persistence)`.
- **ECG strip:** a 2D canvas that sums the Gaussians in `cycle.ecg.waves` and moves a cursor at `phaseT`.

## Engine file: probe.js
Converts between the pose and the beam frame exactly in both directions (5,000 random poses round-trip with zero error). It also intersects a pointer ray with the skin and produces the clock text for the readout.
- **Key fact:** the notch axis lies in both the image plane and the skin tangent plane. The inverse therefore recovers it as their intersection line.
- **Bug avoided:** projecting the lateral vector onto the skin gives the wrong notch whenever tilt and rock are combined.

**Source:** `echo-sim/src/engine/probe.js` (snapshot: `claude/echo-sim/engine/probe.js`).
**API:** `PROBE.setTorso(ph.extracardiac_patient.torso)` · `frame({x,y,notchDeg,tiltDeg,rockDeg}) → {p, beam, lateral, elev, normal}` · `anglesFrom(x, y, beam, lateral) → {notchDeg, tiltDeg, rockDeg}` (exact inverse) · `rayToSkin(o, d) → {x,y}|null` (body-frame ray) · `skinPoint`, `outwardNormal`, `basis` · `clock(notchDeg) → "10:30"` · `v` (vector helpers).
Elevation sign: chosen toward the head side (toward patient's left if the notch is cranio-caudal), so tilt + always means "beam toward the head".

## Scene, panes and body view (P1)
The tested echo code above is the core. The parts below are a design to implement and test in P1.
- **One WebGL context, scissored viewports.** Use one `WebGLRenderer` on a canvas behind the layout, with DOM panels on top. Each frame, for each visible rect:
  - main 3D view
  - Torso map pane
  - Heart cutaway pane
  - echo screen
  
  …do `setViewport(rect)`, `setScissor(rect)`, `setScissorTest(true)`, then render with that rect's camera and layer mask. Phones limit how many WebGL contexts a page can open, and the Super App may keep several lab iframes alive, so one context is the safe choice.
- **Layers:**
  - 0 = shared (heart, probe, fan)
  - 1 = skin and body (main view only)
  - 2 = torso-map 2D overlays (window zones, beam footprint, probe dot)
  - 3 = cut-face quad (cutaway pane only, plus the main view in Ghost/Skeleton)
- **Units:** the scene is in centimetres. Keep the patient in `patientGroup`; LLD sets `patientGroup.rotation.y` for display.
- **Torso:**
  - Visual mesh: an elliptic-cylinder trunk (`halfWidthX` 16, `halfDepthZ` 11) with shoulders, neck and pelvis capped, plus soft landmark marks (sternal angle, nipple line, xiphoid, costal margin).
  - Probe contact uses the **analytic** surface (`PROBE.skinPoint`/`rayToSkin`), not the mesh, so pose maths stays exact.
- **Ribs and sternum:**
  - `TubeGeometry` along each rib arc: centre at 1.0 cm under the skin, y from the rib formula in the JSON.
  - Cartilage (medial to the costochondral junction) is paler.
  - In LLD, widen the rib spaces by `LLD_icsWidening_cm`.
- **3D heart mesh (from the phantom):**
  - Bake once: render `scene()` into a label volume on the GPU (an atlas of 2D slices, about 0.2 cm voxels, a ~16 cm box around the heart). Read back once.
  - Box-blur the occupancy twice (this gives a smooth signed-ish field), run surface nets (`mesh()` from heart-3d-model), then colour vertices by label using `palette_anatomyTint`.
  - Bake in the heart frame and place it with the inverse of `worldToHeart`, so LLD just moves the object.
  - Beating: a vertex-shader radial scale about the LV axis driven by the same parameters (approximate is fine). The echo and cut face stay exact.
- **Cut face (Heart cutaway Section mode, and Ghost view):**
  - A `PlaneGeometry` aligned to the fan (origin `p`, axes `lateral` and `beam`, size about depth × 2·depth·sin(sector/2)), drawn with the *same* `scene()`.
  - Clip the heart mesh with `THREE.Plane(normal = elev)`. No stencil cap is needed, because the quad is the cap.
  ```js
  const cutMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, transparent: true, side: THREE.DoubleSide,
    uniforms: { ...eng.uniforms, uWorldToBody: { value: new THREE.Matrix4() } },   // = patientGroup.matrixWorld.invert()
    vertexShader: `uniform mat4 modelMatrix, viewMatrix, projectionMatrix; in vec3 position; out vec3 vW;
      void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `precision highp float; precision highp int; uniform mat4 uWorldToBody; uniform vec3 uPalette[48];
      ${eng.glsl}
      in vec3 vW; out vec4 o;
      void main(){ int t, l; scene((uWorldToBody*vec4(vW,1.0)).xyz, t, l);
        if (t == 0 || t == 7 || t == 13 || t == 16) discard;          // none, chest wall, lung, soft: keep the cut clean
        vec3 c = uPalette[l]; if (dot(c,c) == 0.0) c = vec3(0.85);
        o = vec4(t == 1 ? c*0.9 : c*0.6 + 0.25, 0.95); }` });     // blood = flat colour, tissue = lighter
  ```
  - `uPalette` is filled by `eng.setPalette`. Reuse `eng.uniforms` so the cut face beats with the echo.
- **Visible body (`src/ui/body.js`, 7 Nov 2026):** an SDF torso (trunk, neck, trapezius line, deltoids, upper arms cut flat, sternocleidomastoids) meshed with surface nets (`src/ui/meshkit.js`) and Taubin-smoothed.
  - Over the windows the trunk **is** the analytic elliptic cylinder. Contours (pectoralis major, sternal groove, clavicles, rectus abdominis with tendinous intersections, serratus, nipple, umbilicus) are an outward displacement `height(x, y)` ≤ 0.8 cm. Probe contact and the echo still use `PROBE.skinPoint`; only the **drawn** probe (`probeVis`) is lifted by `liftAt(x, y)`. The fan and cut face are not lifted, so the cut face still matches the echo.
  - Muscle layer: the same mesh pushed in 0.22 cm and displaced 1.35× harder, with a shader that draws fibre direction per muscle (pectoralis fans to the humerus, rectus vertical with intersections, external oblique down-and-in, serratus digitations, deltoid, trapezius, SCM) and ribs/cartilage/intercostals where no big muscle covers them.
  - Skeleton: flat elliptical ribs 1–12 (posterior arcs, floating 11–12), costal arch cartilage, bevelled sternum with jugular notch, S-shaped clavicles, scapulae, humeri, instanced vertebrae with discs and processes. A cloned material copies its clip planes, so re-link `clippingPlanes = clips` after `clone()`.
  - Landmarks (M key, `Landmarks` button, remembered in localStorage): dashed lines and HTML labels on the drawn skin (suprasternal notch, sternal angle, ICS 1–6, xiphoid, costal margin, nipple, MCL, AAL, umbilicus, apex beat from `LV_apex_epi`) and window outlines from `views.json` (apical moves with the heart in LLD). Labels hide when facing away or inside the inset's panes (the panes are holes onto the canvas). While landmarks are on, ribs show faintly through the skin for ICS counting. Phones show only the main labels.
- **Body view (B key): Skin → Muscle → Ghost → Skeleton.**
  - Skin: opaque.
  - Muscle: muscle layer instead of skin.
  - Ghost: skin opacity 0.25 with `depthWrite:false`, plus the faint beating heart, ribs and fan.
  - Skeleton: no skin.
  - Challenge mode forces Skin and minimises the inset.
- **Anatomy Inset:**
  - Two DOM pane containers. The expanded pane takes about 70%; the collapsed one is a corner thumbnail with a ⇄ icon. Tapping the thumbnail swaps them with a 250 ms CSS transition.
  - The render loop reads each pane's `getBoundingClientRect()` **every frame**, so the viewports follow the animation.
  - The readout strip under both panes shows: probe text (`PROBE.clock`, ICS from the rib formula, window name), the view chip and quality. Minimise and size controls belong to the whole inset.
  - The collapsed pane renders at 15–20 fps. Remember the last expanded pane in `localStorage`, wrapped in try/catch.
- **Torso map pane:**
  - An orthographic camera from +z, with a simplified torso outline and ribs.
  - Window zones: `views.json` windows, bent onto the skin and shaded. They turn green when the probe is inside one.
  - Probe dot, notch arrow, and the beam footprint: the skin line along `lateral` ±3 cm.
- **Heart cutaway pane:**
  - Camera presets:
    - Follow beam (default): camera at `p − elev·25`, looking along `+elev`, up = `−beam`. The cut face then reads like the echo screen.
    - Front.
    - Probe's eye.
    - Free orbit.
  - Toggles: ribs, lungs, liver, coronaries, labels. Hovering an echo label highlights the matching structure, and the reverse.
- **No three.js addons.** The global `three.min.js` r158 build has no OrbitControls, so write a small orbit (pointer drag for yaw/pitch, wheel or pinch for distance), like heart-3d-model does.

## Input layer (mouse + touch now; gyroscope later)
- Every input source emits **pose deltas** `{dx, dy, dNotch, dTilt, dRock, dPress}` into one `applyDelta()`. That function clamps, keeps the probe on the skin and re-renders. The future gyroscope module only emits deltas too.
- **Probe handles (one hand, 7 Nov 2026, user request):** drag the **probe body** = slide (`rayToSkin`); drag the **cyan tip** (distal end) = tilt and rock: the pointer ray meets a sphere around the skin contact, the tail follows it, and the new beam goes through `PROBE.anglesFrom` with the start lateral re-orthogonalised (the beam is never allowed to point out of the patient); drag the **orange ring** = rotate (screen angle about the ring centre, sign from whether the tail faces the camera).
  - Picking: nearest handle on screen wins; on the probe body it is slide unless the pointer is on the ring outline; grab radii scale with the probe's length on screen (phones draw it small).
- **Mouse:**
  - wheel or Q/E = rotate
  - Shift+drag vertical = tilt, Shift+drag horizontal = rock (kept as an alternative)
  - F = fine mode ×0.3 (also slows the tip and ring)
- **Touch:**
  - 1 finger on the probe body = slide, on the tip = tilt/rock, on the ring = rotate
  - 2-finger twist = rotate
  - 2-finger vertical = tilt
  - 2-finger horizontal = rock
  - Separate the gestures by their dominant component, with hysteresis.
- **Camera/Probe mode pill:** in Camera mode, gestures orbit and zoom. Canvas `touch-action: none` applies only in Probe mode, so the page can still scroll elsewhere.
- **Precise controls:**
  - On-screen pad (⟲⟳ ▲▼ ◀▶ ↑↓←→): repeats while held; steps of 2° and 0.25 cm.
  - Right-panel sliders: position, notch, tilt, rock, press, depth, sector, gain, DR, HR.
- **Accessibility:** every pad button needs an `aria-label` and keyboard equivalents.

## View buttons and the ideal image (7 Nov 2026, user request)
- A "Go to view" bar names every v1 view (PLAX, PSAX · aortic valve / mitral valve / papillary, A4C, A5C, Subcostal 4C, IVC). A button glides the probe to the view's computed target over 0.9 s (so the hand movement is visible), sets that view's depth and sector, and opens the **ideal image**. Live quality for each view shows on its button.
- Ideal image = the same `EchoEngine`, probe at the target, rendered into a render target at ~20 fps **before** the live echo each frame (the live render then restores passes A/B, so `readLabels()` stays live), blitted into a picture-in-picture pane or a stacked side-by-side pane. Labels: the view's `labels`, filtered by `labelRules`, computed once at end-diastole and placed with the Pass C mapping.
- This overrides "Snap to view: Guided only" for Free scan. Challenge mode (P4) must hide the bar and the ideal image.

## Performance budget
- **Targets:** 50 fps on a laptop, 30 fps on a phone.
- **Echo resolution:** 256×512 on desktop, 160×320 on mobile (P2). Adapt NS down when the frame time stays above 25 ms.
- **Throttling:**
  - `readLabels()` at 4–5 Hz.
  - Collapsed pane at 15–20 fps.
  - Minimised inset: no render.
- **Hidden lab iframes:** a hidden iframe (`hidden` attribute) has zero size, so stop the render loop when the host rect is 0×0 and resume on resize. This is the same fix as heart-3d-model.
- **Meshing:** bake the heart mesh once (about 0.5–1.5 s). Show a short message and run it in `setTimeout`.

## Build and embed
`build_lab.py` assembles a single page from `src/index.html` markers:
- `<!--@THREE-->` is replaced by three.js 0.158.0 (fetched with `npm pack`; the leading `console.warn` line becomes `0,`).
- `<!--@CSS:path-->`, `<!--@JS:path-->` and `<!--@JSON:id:path-->` are inlined. A `?` makes a JSON file optional and produces `{}` when missing.
- The script fails if any inlined code contains `</script`.

Read JSON in the page with `JSON.parse(document.getElementById(id).textContent)`. Each page needs its own doctype, charset and viewport (srcdoc pages get no skeleton), `[hidden]{display:none!important}`, and the app's theme tokens.

**Source:** `echo-sim/tools/build_lab.py` (snapshot: `claude/echo-sim/tools/build_lab.py`).
`python tools/build_lab.py . [--template src/index.html] [--out dist/echo-sim.html] [--three vendor/three.min.js]`. For the dev smoke test use `--template src/dev/render-test.html --out dist/render-test.html`.

`embed_lab.py` adds or replaces `LABS.echo` and adds the tab. Use the title "Echo Simulator Lab" and the tab text "Echo simulator" / "Echo". Add the home tile and topic card by hand, copying the `.card` pattern with a new colour token, and update the topics lede ("Four labs…").

**Source:** `echo-sim/tools/embed_lab.py` (snapshot: `claude/echo-sim/tools/embed_lab.py`).
`python tools/embed_lab.py ../index.html dist/echo-sim.html --key echo --title "Echo Simulator Lab" --tab-long "Echo simulator" --tab-short "Echo" [--dry-run]`. It is idempotent: a second run replaces the entry.

### Theme
- Copy the lab tokens from the existing labs: `--paper --surface --ink --muted --rule --chip --accent --teal`, the fonts Barlow Condensed (display), Literata (body) and JetBrains Mono (numbers), and the light/dark blocks: `prefers-color-scheme`, `:root[data-theme="dark"]`, and `:root:not([data-theme="light"])`.
- The parent app syncs `data-theme` into each lab's iframe.
- The echo screen and Heart cutaway pane stay black or near-black in both themes.
- Add the footer disclaimer: "Simulation model for learning only — not for diagnosis or patient care."

## Testing
Chromium and Playwright are preinstalled. Launch with `--use-angle=swiftshader --enable-webgl --ignore-gpu-blocklist --enable-unsafe-swiftshader`.

Expose a test hook: `window.ECHO = { setPose, setPosition('supine'|'LLD'), setPhase(t), freeze(bool), renderOnce(), quality(viewId), labels(), tissueLine(i) }`.

Check each of these, and look at the screenshots yourself:
- No page errors, and every shader compiles (three logs GLSL errors to the console).
- At each view's derived target (supine and LLD): quality ≥ 80. Rotating 25° off target drops it below 60.
- `tissueLine(NL>>1)` reads sensibly for each view, e.g. PLAX: chest wall → RV → septum/LVOT → AV/AML → LA → descending aorta. This was the fastest way to find anatomy bugs in the prototype.
- With `tint:'tissue'` the debug picture shows the expected chambers. The ASE orientation is right: the aorta is on screen right in PLAX, and the LV is on screen right in A4C.
- After a drag or twist, the pose changes as expected and `PROBE.anglesFrom(frame(pose))` round-trips.
- Panes swap and stay synced. Ghost view shows the heart under the probe. LLD moves the heart and the apical window.
- At 400 px wide there is no sideways page scroll, and touch gestures work (emulate with `hasTouch:true`).
- Embedded in a copy of `index.html`: `#echo` opens, and `#mi` and the other labs still route.

## Pitfalls already found (do not undo)
- **Fan squeezed sideways (fixed in P1).** Pass C scaled x by 2×aspect, so a 90° fan looked like a kite and a round LV looked oval. x and y now share one scale, and a wide fan zooms out to fit a narrow screen. The overlay in `panels.js` uses the same mapping.
- **Solid diaphragm (fixed in P1).** `dDome < 0.4` filled the whole left dome with diaphragm and hid stomach gas. It is now `abs(dDome) < 0.4`, with soft tissue under the dome.
- **Quality is judged over one beat (P1).** Content score = the best single frame in the last R-R interval, because the mitral fish mouth exists only while the valve is open. A frozen image scores that one frame only.
- **`#inset` must not live inside `#stage`.** On phones it is a static block; inside the stage it filled the 3D view.
- **Hidden iframe keeps `innerWidth`.** Pause on the host element's rect, not on `innerWidth`.
- **Collapsed pane.** Other viewports draw over it, so throttling needs a render target that is blitted every frame.
- **The heart was drawn over the chest wall.** Evaluate the body wall *first* in `scene()`, so bone and chest wall win.
- **Cavities merged with no wall** (RVOT ran straight into the LVOT/aorta). Carve walls with `max(a, -(b - wall))`.
- **The LVOT never got labelled.** Test it before the LV cavity.
- **The phantom sat 1.2 cm too anterior** (the RV touched the skin). Check depths with `tissueLine` and `validate_data.py`.
- **Ribs too wide** (1.3 cm). This blocked the angled apical beam. Rib width is now 1.0 cm, and target placement adds a cost for the rib path along the beam, not just at the entry point.
- **The subxiphoid beam was trapped in the costal-cartilage layer.** Model probe pressure with `pressCm` per window; the probe origin moves inward.
- **The lung beyond the pleura looked grey.** Keep its floor amplitude at about 0.004 so only the A-lines show.
- **`readPixels` stalls the GPU.** Throttle it, and never call it per frame.
- **Labels:** GLSL emits ids, and the UI maps them to `LABEL_TEXT`. Never put display strings into views.json checks.
- **Build markers:** match `JSON?|JSON|JS` in that order, or `JS` swallows `JSON` markers.
- **three r158:** use `RawShaderMaterial` with `glslVersion: THREE.GLSL3`, and declare `in vec3 position`, the precision qualifiers and an `out` colour yourself.

### Found in P1.5 (heart refinement, phantom 0.4)
- **The LV wall closed the mitral orifice.** `lvOut` reached 0.3 cm above the annulus across the whole opening (a muscle plate between LA and LV in every cut). The orifice is now carved out of `lvOut`; the wall above the annulus is a ring only.
- **Leaflets had half their width.** The commissural `arc` shift was added to the centre-line but not removed before projecting onto the leaflet axis. Subtract it first (see `leaflet()`), or wide leaflets thin out to a strip.
- **Closed valves must seal.** Check with the ray-cast preview (`tools/valve_views.py`), not only 2D slices: aim each closed leaflet at a shared coaptation point (MV: posterior third, ~0.55 cm into the LV; TV: centre), length = hinge→coaptation + overlap.
- **Semilunar cusps are bellies + vertical coaptation walls.** A short-axis slice shows the Mercedes Y only where it cuts the walls, so PSAX-AV is derived through `AV_coaptation` (0.8 cm above the annulus), not the annulus.
- **plane3 lateral must lie in the plane.** A side landmark off the derived plane silently rotated A4C ~12°; project it onto the plane (it only picks the sign).
- **Sinus term:** measure the root radius from the *clamped* axis point, or the ascending aorta becomes an endless cylinder.
- **A flat cap on a tapering cavity** turns into a square tab once the wall is added: build the LV from round cones (exact distances).
- **The bake must skip the body wall** (`uSkipBody`), or the chest-wall layer cuts the anterior RV flat in the 3D heart.
- **Coronaries are sub-voxel.** Evaluating the full tree in `scene()` made the echo ~5× slower and the bake ~10×. Detail levels: `compile(ph, {detail:'echo'|'bake'|'full'})`; the 3D view sweeps tubes from the same centrelines (display radius ×2.2 so they can be tapped). Re-run `tools/coronary_design.py` after any change to the outer shape (it designs on a bake *without* vessels/fat).
- **Label palette is 64 entries** (`uPalette[64]`); the validator errors if the label list outgrows it.
- **Don't run test_lab.py in parallel with other SwiftShader jobs**: clicks time out under CPU load.
- **No blood–blood contact between two named cavities.** In the echo a blood/blood boundary is invisible, so it reads as a hole (PLAX LA↔LVOT, 8 Nov). Every pair of cavities needs a wall that is *assigned a tissue* in the priority list, not just a carve: a band carved out of one cavity that matches no later rule renders as dashes (`lvlaW` → fibrous).
- **AML hinge on the line of the posterior aortic wall.** The aortomitral curtain (~0.6–1 cm) is a *sheet* (2.6 cm wide), not a rod; the LVOT tube is clipped to its ventricular side; the anterior ±60° of the mitral ring is removed (D-shaped annulus: its straight side is the curtain). A hinge on the round ring sat 1.7 cm from the aortic annulus, close to the septum: gap to the LA and a narrow LVOT. Check PLAX at t = 0, 0.3, 0.38 and in diastole (`tools/phases.py`).

## Extending to pathology (P6)
- Prefer changing **parameters**: e.g. `effusion_cm`, which the shader already supports as a fluid shell, wall thickness, cavity size, and leaflet thickness or opening.
- Add new structures to `compile()` with an explicit drawing priority.
- Keep one phantom file per disease (`phantom-<id>.json`), each overriding the normal one. Views stay the same, because pathology changes the anatomy, not the view definitions.
