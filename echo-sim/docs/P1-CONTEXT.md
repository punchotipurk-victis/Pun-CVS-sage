# Echo Simulator: P1 build context (handover)

Read this first in any new conversation about the echo lab. Updated 7 Nov 2026.
Repo `punchotipurk-victis/Pun-CVS-sage`, branch `echo-sim/p1-scene-ui`, PR #2. **Not embedded in the real `index.html` yet** (waiting for Punnatorn's approval).

## Roadmap
| Phase | Content | Status |
|---|---|---|
| P0 | Plan v1.2, data v0.2→v0.3, engine prototype, skills, starter kit | ✅ done |
| P1 | Scene, probe, Anatomy Inset, heart mesh, scoring UI | ✅ done (PR #2) |
| P1.1 | View buttons + ideal image, tip/ring probe handles, sculpted body, Muscle view, skeleton, landmarks, organ shading | ✅ done (PR #2) |
| **P1.5** | **Refine the 3D heart (phantom-normal.json v0.4)**: less blocky, more anatomical, finer mesh; optional mesh export for the other labs | ⏭ next (own conversation; kickoff in `HEART-REFINE-KICKOFF.md`) |
| P2 | Echo engine polish: persistence, HR scaling of systole, image-control tuning, adaptive resolution, expert tuning | ⏳ |
| P3 | View library UI: hints, 3-state labels (Off/Text/Tint) with cross-highlight, view cards (4 teaching layers), pitfall states, calibration mode `?dev=1` | ⏳ |
| P4 | Learning modes (Guided tour, Challenge, Label quiz, Pitfall hunt) + Super App integration (embed `LABS.echo`, tab, home tile, topic card) | ⏳ |
| P5 | M-mode, stylised colour Doppler, measurements, v2 views (A2C, A3C, RV inflow, PSAX apex, suprasternal, subcostal SAX) | ⏳ |
| P6 | Pathology pack (`phantom-<id>.json`) + real-clip comparison panel | ⏳ |
Expert check (Ramathibodi echo lab) after P2 and P3; the staff review of data v0.3 was planned for 6 Nov.

## File map (`echo-sim/`)
| File | Role |
|---|---|
| `data/phantom-normal.json` | Anatomy, tissues, cycle, positions, palette: the single source of truth |
| `data/views.json` | 8 views: targets (derivation), tolerances, content checks, labels, teaching |
| `src/engine/phantom.js` | JSON → GLSL `scene(p) → (tissue, label)`; param evaluator; `worldToHeart` |
| `src/engine/echo.js` | 3-pass GPU echo (tissue map → beam → display), `readLabels()` |
| `src/engine/probe.js`, `derive.js`, `scoring.js` | Pose ⇄ beam frame (exact), view target derivation, quality/lock/hints |
| `src/ui/meshkit.js` | Surface nets, SDF sampling, Taubin smoothing, value noise |
| `src/ui/body.js` | Sculpted torso (SDF), muscle layer shader, skeleton, landmarks + window outlines |
| `src/ui/scene.js` | Scene graph, GPU bake of the phantom → heart/liver/lungs meshes, realistic colours, probe + tip/ring gizmo, fan, cut face, main view |
| `src/ui/inset.js` | Anatomy Inset: Heart cutaway (Section/Whole, camera presets, Ribs/Lungs/Liver/Colours) + Torso map, swap, throttled thumbnail |
| `src/ui/input.js` | Pose deltas from pointer (body = slide, tip = tilt/rock, ring = rotate), Shift-drag, wheel, touch gestures, pad, keys |
| `src/ui/panels.js` | Top bar, view bar, sliders, ECG strip, echo overlay, readout, ideal-image labels |
| `src/ui/app.js` | State, clocks, render loop (one WebGL context, scissored viewports), scoring at 5 Hz, ideal image, test hook `window.ECHO` |
| `src/index.html`, `src/ui/style.css` | Template with build markers; theme tokens (light/dark; echo + cutaway always dark) |
| `tools/validate_data.py`, `build_lab.py`, `embed_lab.py` | Data check, single-file build (three r0.158.0 inlined), embed into `index.html` |
| `tools/test_lab.py`, `test_embed.py` | Headless acceptance tests (Playwright + SwiftShader) |
| `docs/ENGINE.md`, `docs/VIEWS.md`, `AGENTS.md` | Codex mirror of the two skills; `docs/P1-STATUS.md` = decisions + review items |

## How it works (one paragraph)
`PHANTOM.compile()` turns the JSON into one GLSL `scene()`. Three consumers use it: the echo (sliced per frame along the probe plane), the cut face in the Heart cutaway (a quad on the beam plane running `scene()`), and the 3D heart mesh (the label volume is baked once on the GPU at 0.2 cm, blurred, meshed with surface nets and Taubin-smoothed, then coloured by label). The probe pose `{x, y, notchDeg, tiltDeg, rockDeg}` is stored in the body frame (cm; +x patient's left, +y head, +z anterior; origin at the suprasternal notch). `PROBE.frame()` gives the beam frame. LLD only rolls the body for display and moves the heart through `worldToHeart`. Each frame: the ideal image (if shown) renders to a texture, then the live echo, main 3D view, inset panes, ECG and overlay all draw into scissored rects of one canvas. Every 200 ms `readLabels()` feeds `SCORING` → view chip, button %, lock.

## Decisions made in P1 / P1.1 (keep)
- Quality = 0.5 pose + 0.5 content; content = best frame in the last R-R interval (the mitral fish mouth only exists in diastole).
- POCUS targets = the same beam with the lateral reversed (via `PROBE.anglesFrom`), not just notch + 180°.
- Pressure is automatic per window (`views.json windows.pressCm`) until the Press slider is moved.
- View buttons are available in Free scan and glide the probe to the target over 0.9 s; Challenge mode (P4) must hide them and the ideal image.
- Probe handles: body = slide, cyan tip = tilt/rock about the skin contact, orange ring = rotate; nearest handle on screen wins; Shift-drag kept.
- The visible skin over the windows equals the analytic cylinder; contours are a ≤ 0.8 cm displacement; only the drawn probe is lifted.
- Body views: Skin → Muscle → Ghost → Skeleton. Landmarks (M) remembered per viewer.
- Organ **shapes** only come from the phantom. Organ **colours** are realistic by default; the cutaway's "Label colours" toggle restores the teaching palette (same as the echo tint).

## Engine fixes made during P1 (affect the picture)
- `echo.js` Pass C: x was scaled 2× vs y (fans narrow, round LV oval). Fixed; older screenshots are distorted.
- `phantom.js`: the diaphragm was a solid dome; now the 0.4 cm shell the data specifies, with soft tissue under it.

## Test results (7 Nov 2026)
`validate_data.py` 0 errors · `test_lab.py` 0 failures (every view ≥ 80 at target, 25° off < 60, supine + LLD + POCUS; handles; view buttons; ideal image; landmarks; body modes; phone 400 px; touch) · `test_embed.py` 0 failures (#echo + heart3d, brady, narrow, wide, mi routes; theme sync; hidden-iframe pause) · P1 build ran on Punnatorn's Windows PC (Intel Arc, D3D11) at ~59 fps; P1.1 not yet checked there.

Scores at target (supine/LLD): PLAX 89/94 · PSAX-PM 100/100 · PSAX-MV 100/86 · PSAX-AV 93/93 · A4C 100/100 · A5C 100/100 · S4C 94/94 · IVC 100/100.

## Open items
- For the expert: PLAX LV–aorta not horizontal (+ apex in image supine); PSAX-AV root not round; S4C RV area low; PSAX-MV LV not round in LLD.
- Not built: on-probe ghost opacity slider; coronary + label toggles in the cutaway; true bottom-sheet inset on phones; LLD rib-space widening (`uRibSpaceScale` unused in GLSL).
- The real `index.html` embed + home tile + topic card wait for approval (P4).

## Test hook (`window.ECHO`)
`setPose, pose, frameOf, setPosition, setConvention, snap, goToView(id, instant), target, setPhase, freeze, setBody, renderOnce, quality(id), qualityED(id), live, labels, tissueLine(i), NL, readout, chip, inset, swap, orbit, handleScreen('cap'|'ring'|'body'|'face'), pick(x, y, touch), refShown, refView, refLabels, setLandmarks, visibleLandmarks, setColourMode, heartMatrix, roll, zoneCentre, info, shaderErr`.
