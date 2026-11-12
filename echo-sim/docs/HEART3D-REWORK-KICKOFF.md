# 3D heart page rework: kickoff (handover for a new conversation)

Written 8 Nov 2026. Independent of the echo phases: it can run before, after or alongside P3. Paste "Prompt to start" into the new conversation.

## Goal
Rework the Super App's 3D heart lab (`LABS.heart3d`, title "Heart Conduction Lab", route `#heart3d`) into **two subtabs, each its own page**:
- **(a) Main 3D heart.**
  - The refined heart, large, rotatable and movable.
  - The conduction system rebuilt on the refined anatomy; the warp removed.
  - A refined cut (4-chamber) view.
  - Labels and tap-to-learn cards.
- **(b) Pathology simulator.**
  - Today's conditions (blocks, AF, flutter, WPW, MI scenarios with 12 leads), running on the refined heart.
- The refined heart is the one shared model for every 3D lab (echo, 3D heart, MI, angiogram).

## Where things are
- Repo `punchotipurk-victis/Pun-CVS-sage`.
  - The refined heart lives on `echo-sim/p1.5-heart` and later branches; nothing is merged.
  - **Branch from `echo-sim/p2-engine`** (it has the latest phantom + tools) to `heart3d/rework`, PR into `echo-sim/p2-engine`.
  - Never merge without Punnatorn's approval.
- **The lab has no source folder:**
  - It exists only as base64 in `index.html` (`LABS.heart3d`, ≈ 0.8 MB decoded, three.js inlined).
  - An older standalone copy is the project doc `Super Cardio App/heart-conduction-lab.html`.
- **Today's page:**
  - One long page: "Part 1 · Explore by tapping" and "Part 2 · Pathology simulator".
  - Shared clock with the ECG; labels toggles (anatomy / conduction / valve); views Front / Back / Left / Right / Below / Face the cut; External / Internal (cut).
  - Teaching content is in `CONTENT` (`STRUCT`, scenarios `SC` + `SIMC.EXTRA` + `SIMC.MIS` via `miScenario`).
- **Refined heart in the site** (`echo-sim/tools/integrate_heart_mesh.py`):
  - The mesh JSON is stored once in `index.html` (`window.PUN_HEART_MESH`).
  - `export/neo-heart-adapter.js` is injected after the lab's H3 module with five hooks.
  - The intact heart is replaced by the refined mesh + refined coronaries; cut and lesion views still use the legacy H3 SDF heart.
  - `CFG.warpToLegacy` bends the refined mesh onto the legacy H3 atria so the old conduction network still lines up. **That warp is what this rework removes.**
- Mesh format and loader: `echo-sim/docs/HEART-MESH-EXPORT.md`, `export/heart-mesh-loader.js`. Per-vertex label, AHA segment, territory, nearest artery; `infarctDownstream`.
- Read first: `HEART-MESH-EXPORT.md`, `P15-STATUS.md` ("Open" list), `docs/HEART-REFINE-KICKOFF.md` (how the refined heart was built), `AGENTS.md`.
- Skills: heart-3d-model (lab structure, conduction models), refined-heart-model (phantom, bake, export, Blender), cardiology-rotation (teaching text), interactive-study-lab (format of the pathology part).

## Plan, in this order (one step at a time, test after each)
1. **Extract the lab into source.**
   - Move it into `heart3d/` with the same build as the echo: `heart3d/src/index.html` with markers, `src/*.js`, `data/*.json`, `tools/build_heart3d.py` (reuse `build_lab.py`), `dist/heart3d.html`. Embed with `embed_lab.py --key heart3d`.
   - Proof step: build → embed → byte-compare behaviour with today's page (screenshots of every view and scenario, no console errors) **before** changing anything.
2. **Subtab shell.**
   - Two tabs inside the lab, with deep links `#heart3d/explore` and `#heart3d/pathology` (the parent passes the hash).
   - Each tab owns its page and render loop; the hidden tab stops rendering. One WebGL context shared, or one per tab only if memory allows.
   - Mobile: tabs as a segmented control; no sideways scroll at 400 px.
3. **Main heart on the refined model only.**
   - Load `PUN_HEART_MESH` (fallback: the inlined export).
   - Large canvas; orbit + pan + zoom (own controls, no addons); view presets; real / label colours; coronaries on/off; tap-to-learn cards from `CONTENT.STRUCT`.
4. **Conduction system rebuilt on refined landmarks; warp removed.**
   - Define the network in data (`heart3d/data/conduction.json`), placed from phantom landmarks:
     - SA node at the SVC–RA junction (crista terminalis)
     - internodal tracts and Bachmann's bundle across to the LAA
     - AV node at the apex of Koch's triangle (CS ostium, tendon of Todaro, TV septal leaflet)
     - His through the central fibrous body
     - LBB fascicles and RBB via the moderator band
     - Purkinje under the endocardium
   - Activation times from today's model, so the ECG stays identical.
   - Delete `warpToLegacy`. Check: SA → AV → His path lengths and timings within ±5% of today; every node sits inside or on the refined myocardium.
5. **Refined cut view.**
   - 4-chamber cut from the phantom (bake a clipped label volume, or clip the mesh + cap from `scene()` like the echo's cut face).
   - The conduction network stays visible on the cut; "Face the cut" camera.
   - This also supplies the cut/lesion export the MI lab needs later.
6. **Pathology simulator on the refined heart.**
   - Port every scenario: blocks, AF, flutter, WPW, MI territories via `infarctDownstream`.
   - Lesions that change shape (VSD, papillary rupture, aneurysm, free-wall rupture, RV dilation) become phantom variants or mesh deformers.
   - The legacy H3 heart is no longer used anywhere.
7. **Integrate and hand over.**
   - Re-embed into a copy of the newest page; every route (`#heart3d`, `#mi`, `#echo`, `#brady`, `#narrow`, `#wide`) still opens.
   - Write `heart3d/AGENTS.md`, a status doc and the MI-lab kickoff.

## Rules
- One source of truth for anatomy: the phantom / exported mesh; conduction data is placed from phantom landmarks, never hand-placed coordinates.
- Self-contained page (three r0.158.0 inlined, no CDN, no `</script` in inlined code); theme tokens and footer disclaimer as the other labs.
- Teaching text: mechanism first, layered, source tags; no copied text or images.
- Tests: a `heart3d/tools/test_heart3d.py` (Playwright + SwiftShader). It checks:
  - both tabs load, no console errors, tab switch stops the hidden loop
  - tap a structure → its card
  - each scenario runs and the 12-lead changes
  - conduction timings vs baseline
  - no sideways scroll at 400 px
  - `test_embed.py` on a copy of the newest page
- Show before/after screenshots per step, and a preview page in Punnatorn's folder.

## Decisions to ask Punnatorn at the start
- Subtabs inside the one lab (recommended: one route, shared assets, deep links), or two separate Super App routes.
- Does the MI lab move onto the refined heart in the same project, or in its own conversation afterwards (recommended: afterwards)?

## Prompt to start
> Start the 3D heart page rework of my Cardio Super App. Read `echo-sim/docs/HEART3D-REWORK-KICKOFF.md` in the repo
> punchotipurk-victis/Pun-CVS-sage (branch echo-sim/p2-engine) and the project doc `claude/heart3d/REWORK-KICKOFF.md`, then
> HEART-MESH-EXPORT.md, P15-STATUS.md and AGENTS.md. Use the skills heart-3d-model, refined-heart-model and cardiology-rotation.
> My newest page is `index-P2.5-echo-PREVIEW.html` in my Super Cardio App folder. Work on a new branch heart3d/rework, one step at a
> time (extract the lab into source first and prove nothing changed), test after each, and show me screenshots. Don't merge
> anything without my approval.
