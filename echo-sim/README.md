# Echo Simulator — starter kit (P0 → P1)

Copy this folder into the Pun-CVS-sage repo as `echo-sim/`.

| Path | What it is |
|---|---|
| `AGENTS.md` | Rules for Codex / Claude Code (start here) |
| `docs/ENGINE.md`, `docs/VIEWS.md` | Full rules, mirrored from the Claude skills |
| `data/phantom-normal.json`, `data/views.json` | Anatomy + views (v0.2, single source of truth) |
| `src/engine/*.js` | Tested engine: phantom→GLSL compiler, 3-pass echo, probe maths, view derivation, scoring |
| `src/dev/render-test.*` | Renders all 8 views + off-target poses and prints quality scores |
| `tools/*.py` | build, embed, validate |
| `vendor/three.min.js` | three.js r0.158.0 (same as the other labs) |
| `dist/render-test.html` | Pre-built smoke test — open it in a browser |

Next step (P1): build `src/index.html` + `src/ui/*` (scene, probe input, Anatomy Inset, panels) on top of `src/engine`.
