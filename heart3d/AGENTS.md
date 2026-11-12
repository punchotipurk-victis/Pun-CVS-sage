# AGENTS.md: 3D Heart section (Pun CVS Lab)

For coding agents (Codex, Claude Code) working in `heart3d/`. Read `../CLAUDE-CODEX.md` (hand-off rules), then this, then `heart3d/TASKS.md` (the task queue) and the status
in the PR description of the current branch. Do not read the whole repo; the files you need are listed here.

## What this is
Two pages of the Super App's "3D Heart" section, each a self-contained HTML lab embedded (base64) in the root `index.html`:
- **3D Heart** `#heart3d` (`src/index.html`): the refined heart only. Explore by tapping; External / X-ray / Cut (dissection views);
  real or label colours; labels by layer; card below the model.
- **Pathology simulator** `#pathology` (`src/pathology.html`): still the legacy H3 lab (`src/js/app.js` + scene/valves/conduction)
  until step 8 moves it onto the refined heart.

## Files
| File | What |
|---|---|
| `src/index.html`, `src/pathology.html` | page templates (build markers) |
| `src/parts/*.html` | shared head, footer, script lists |
| `src/style.css` | all CSS (theme tokens from the site; `.x3` = 3D Heart page) |
| `src/js/explore.js` | 3D Heart viewer: scene, camera (turntable around the view's up-axis), modes, cut views (`CUTS`), stencil caps, labels, picking, cards, render loop, `window.EXPLORE_APP` test API |
| `src/js/explore-data.js` | label palette `PAL`, layers, short names, card mapping, notes for structures without a full card |
| `src/js/content.js`, `src/js/patho-content.js` | teaching content (conduction cards, scenarios, coronary notes, valve notes) |
| `src/js/app.js`, `scene.js`, `valves.js`, `conduction.js`, `h3-anatomy.js` | legacy lab (pathology page only) |
| `../echo-sim/export/heart-mesh.json` + `heart-mesh-loader.js` | refined OUTER surface + coronary tree (format: `echo-sim/docs/HEART-MESH-EXPORT.md`) |
| `../echo-sim/export/heart-interior.json` + `heart-interior-loader.js` | refined INSIDE: tissue surface, valves at 8 phases, landmarks |
| `tools/build_heart3d.py` | build both pages → `dist/` (`--standalone` adds `dist/heart3d-standalone.html` with the data inlined; not committed) |
| `tools/integrate_heart3d.py <index.html>` | embed both pages + the interior data into a site page (re-runnable) |
| `tools/test_heart3d.py <index.html>` | the acceptance test (Playwright + SwiftShader) |

## Rules (do not break)
1. **One source of truth for anatomy:** `echo-sim/data/phantom-normal.json` → exports. Never hand-edit the exported JSON or place anatomy by hand in JS. Anatomy changes are Claude's job (phantom + `echo-sim/tools/export_heart_interior.py`).
2. **Self-contained pages:** three.js r0.158.0 inlined, no CDN, no three.js addons, no `</script` inside inlined code. The site has no build step on GitHub Pages: `index.html` must stay deployable.
3. **Frames:** the viewer works in the heart frame (cm) under one group placed by `frames.heartToBody`. Body frame: +x patient's left, +y head, +z anterior.
4. **Every material that shows heart geometry** goes through `beatify()` (beat deformation + `clipIntersection` with the two cut planes). Cut views remove only the region on the negative side of BOTH planes; single-plane views set `plane2 = plane`.
5. **Labels and taps** must keep working over labels (input is on `.viewer`, not the canvas). Keep `EXPLORE_APP` test hooks when you change things.
6. **Medical text:** do not write or change teaching text yourself. Put `TODO(content)` and leave it for Claude/Punnatorn. Keep ids (phantom labels, landmark ids, scenario keys) unchanged.
7. **Never merge** into `heart3d/rework` or `site/home-echo` without Punnatorn's approval. Work on a branch `codex/<task-id>` from `heart3d/rework`; open a PR into `heart3d/rework`.

## Commands
```bash
python heart3d/tools/build_heart3d.py --standalone                     # build; open dist/heart3d-standalone.html to look
python heart3d/tools/integrate_heart3d.py index.html --out /tmp/site.html
python heart3d/tools/test_heart3d.py /tmp/site.html --shots /tmp/shots    # must print 0 failure(s)
python echo-sim/tools/test_site.py /tmp/site.html                         # must print 0 failure(s)
python echo-sim/tools/test_embed.py /tmp/site.html                        # only if you touched the site shell (index.html outside LABS)
```
Playwright Chromium flags: `--use-angle=swiftshader --enable-webgl --ignore-gpu-blocklist --enable-unsafe-swiftshader`.
When everything passes: `python heart3d/tools/integrate_heart3d.py index.html` (updates the real page), commit `heart3d/` + `index.html`.

## Definition of done for a task
- The task's acceptance checks pass. Add the new check to `tools/test_heart3d.py`, not a separate script.
- `test_heart3d.py` and `test_site.py` print 0 failures.
- The PR description has: what changed (plain English, 5 lines max), before/after screenshots (from `--shots`), and the test output lines.
- Update the task's line in `heart3d/TASKS.md` (status + PR number). Do not edit other tasks.
