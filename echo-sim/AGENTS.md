# AGENTS.md — Echo Simulator Lab (Pun CVS Lab)

Instructions for coding agents (Codex, Claude Code) working in `echo-sim/`. The full rules are in
`docs/ENGINE.md` (rendering, probe, scene, build, testing) and `docs/VIEWS.md` (views, scoring, labels,
teaching, calibration). Read the one that matches your task before changing code. They mirror the Claude
skills `echo-sim-engine` and `echo-view-library`; if you change a rule, update both.

## What this is
An interactive 3D transthoracic echo simulator for medical students, residents and cardiology fellows.
The learner moves a probe on a 3D patient. The echo fan is computed live by slicing a 3D heart model
("phantom") with the probe plane. It ships as ONE self-contained HTML lab embedded (base64) in the
Super App's `index.html` (`LABS.echo`, route `#echo`).

## Non-negotiable rules
1. **One source of truth.** Anatomy only lives in `data/phantom-normal.json` → `PHANTOM.compile()` → GLSL `scene()`.
   The echo, the Heart-cutaway cut face and the 3D heart mesh all come from `scene()`. Never hand-copy anatomy.
2. **Units and frames.** cm. Body frame: +x patient's LEFT, +y HEAD, +z ANTERIOR, origin at the suprasternal-notch skin.
   Probe pose `{x,y,notchDeg,tiltDeg,rockDeg}` + `pressCm` is stored in the BODY frame; LLD body roll is display only.
   notchDeg 0 = 12 o'clock (head), +90 = 3 o'clock (patient's left).
3. **Self-contained output.** Labs open via iframe `srcdoc`: inline three.js r0.158.0, all JS/CSS/JSON
   (`tools/build_lab.py`). No relative URLs, no CDN at runtime, no `</script` inside inlined code, no three.js addons.
4. **Ids, not display strings.** GLSL emits structure ids (`LV_cavity`, `MV_AML`, `AV_cusps.RCC`…);
   views.json checks/labels use those ids; UI text comes from `PHANTOM.LABEL_TEXT`.
5. **Validate first.** `python tools/validate_data.py data` must report 0 errors before a build.
6. **Do not undo solved pitfalls** (docs/ENGINE.md → "Pitfalls already found"): body wall evaluated first,
   walls carved between cavities, LVOT before LV, rib-path cost, probe pressure for subxiphoid, readPixels ≤5 Hz.
7. **Medical content.** Friendly, mechanism-first, layered (Core → Deeper → Fellow pearl → Why it looks like this).
   Every number has a source tag (`ASE 2015`, `POCUS101`, `teaching (verify)`); show ASE vs POCUS101 side by side when
   they differ. No copied text/images from references. Footer disclaimer always on.

## Commands
```bash
python tools/validate_data.py data                       # data sanity (ids, frames, anatomy depths)
python tools/build_lab.py .                              # → dist/echo-sim.html (fetches three@0.158.0 via npm if vendor/ is empty)
python tools/build_lab.py . --template src/dev/render-test.html --out dist/render-test.html   # engine smoke test
python tools/embed_lab.py ../index.html dist/echo-sim.html --key echo --title "Echo Simulator Lab" --tab-long "Echo simulator" --tab-short "Echo"
```
Headless test (Playwright, Chromium flags): `--use-angle=swiftshader --enable-webgl --ignore-gpu-blocklist --enable-unsafe-swiftshader`.
Pass criteria: no page/shader errors; every view's derived target quality ≥ 80 (supine and LLD); 25° off target < 60;
no sideways scroll at 400 px; `#echo` and the other labs still route after embedding.

## Division of labour (suggested)
- Claude: phantom/shader (`src/engine/phantom.js`, `echo.js`), views/teaching content (`data/*.json`), reviews of UI PRs.
- Codex: scene, input, Anatomy Inset, panels (`src/ui/*`), reviews of engine PRs.
Each PR: say which phase (P1–P6) it advances, attach the render-test screenshot grid, run validate + build.
