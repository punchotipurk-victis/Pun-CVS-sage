# P1 kickoff — paste into a new conversation (Claude Code or Codex)

Build P1 of the echo simulator using the starter kit in `echo-sim/`. Load the skills
`echo-sim-engine` and `echo-view-library` (Codex: read `echo-sim/AGENTS.md`, `docs/ENGINE.md`, `docs/VIEWS.md`).

Scope (P1):
1. `src/index.html` + `src/ui/{scene,inset,panels,input}.js` + `style.css` on top of the tested `src/engine/*`.
2. One WebGL context with scissored viewports: main 3D view, echo screen, Anatomy Inset (Torso map + Heart cutaway, swap-to-expand, readout strip, minimise/size).
3. Patient: torso (analytic skin), ribs/sternum, Body-view button (Skin → Ghost → Skeleton), Supine ⇄ LLD.
4. Probe: drag/touch/pad/sliders → pose deltas → `PROBE.frame()`; live fan in 3D; echo via `EchoEngine`; ECG strip; Freeze/ED/ES; ASE/POCUS toggle.
5. Heart mesh baked from the phantom (`scene()` label volume → surface nets); cut-face quad in the cutaway.
6. View chip + quality from `SCORING` (labels/teaching cards can wait for P3).

Done when: `python tools/validate_data.py data` = 0 errors; `python tools/build_lab.py .` builds;
headless test passes (every view's target ≥ 80, 25° off < 60, no page/shader errors, 400 px no sideways scroll);
`dist/echo-sim.html` opens on Windows Chrome; embedded with `tools/embed_lab.py` into a copy of `index.html`
and `#echo` + all other labs route. Do not embed into the real `index.html` until the user approves.
