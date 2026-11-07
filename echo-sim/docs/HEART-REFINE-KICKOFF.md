# P1.5 kickoff: refine the 3D heart (paste into a new conversation)

Refine the heart in the echo simulator's phantom so it is anatomically accurate and not blocky, without breaking the echo. Load the skills `echo-sim-engine`, `echo-view-library` and `heart-3d-model`. First read, in the repo `punchotipurk-victis/Pun-CVS-sage` (branch `echo-sim/p1-scene-ui`, or `main` if PR #2 is merged): `echo-sim/docs/P1-CONTEXT.md`, `echo-sim/AGENTS.md`, `docs/ENGINE.md` (pitfalls), `data/phantom-normal.json` (v0.3), `src/engine/phantom.js` (`compile()`), `tools/validate_data.py`. Use the project's anatomy images (`heart-anatomy-labeled-diagram-1.png`, `Detailed heart anatomy 02.jpg`) as visual references.

## Resources (prepared by Punnatorn, folder "Resources for 3d heart alignment")
- **Where:** lecture files, a Netter extract (heart + mediastinum) and a large cardiac CT dataset. If the folder is not among the project files, it is on Punnatorn's PC: ask him to add it with **+ → Add folder** in the Claude desktop app, then open files individually (device tools; ≤ 400 MB per file, ≤ 500 MB per transfer). Never guess paths; ask if it is not found.
- **CT:** use ONE normal adult, ECG-gated, contrast-enhanced study at end-diastole (~70–75 % R-R), slices ≤ 1 mm. Read DICOM/NIfTI with `pydicom`/`nibabel` (pip). If masks exist, measure from them. Extract positions and sizes in cm (chamber centroids and axes, wall thickness, annulus planes and diameters, vessel centrelines) and convert them to the heart frame. Record every value with its source (`CT: <series>`, `Netter p.x`, `Lang 2015`, `lecture`). Confirm the data is de-identified or openly licensed.
- **Netter and lectures:** for shape and relationships only. Private references: no images or text from them go into the app or its teaching cards.
- **Echo comparison:** POCUS101 "Cardiac Ultrasound (Echocardiography) Made Easy" (https://www.pocus101.com/cardiac-ultrasound-echocardiography-made-easy-step-by-step-guide/). Compare each simulated view against it side by side; do not copy its images.
- **First step:** a short plan and a baseline (screenshots of the current heart + 8 views + scores), shown to Punnatorn before any change.

## Why
The heart is built from simple SDF primitives (ellipsoids, capsules, truncations, shells). The 3D mesh looks like joined shapes, and the same shapes slice into the echo, so blocky anatomy also means a less realistic echo. One phantom feeds three things (echo, cut face, 3D mesh), so improving it improves all three at once.

## Goal (deliverables)
1. `phantom-normal.json` v0.4 + matching `compile()` changes: truer chamber and vessel shapes.
2. A finer, smoother 3D heart mesh (bake resolution and meshing).
3. Updated `validate_data.py` checks for the new structures.
4. All 8 views still pass (`test_lab.py`: target ≥ 80, 25° off < 60, supine + LLD + POCUS); targets re-derived; screenshot grid before/after for each view and for the 3D heart (front, back, left, 4-chamber cut).
5. Optional: `tools/export_heart_mesh.py` (or an in-page exporter) that writes the baked heart as a mesh (positions, normals, per-vertex label id, AHA segment id) so the other Super App labs (3D heart, MI lab) can reuse it later.
6. Changelog in the JSON `_meta`, and in `claude/echo-simulator-plan.md` §15; durable rules into the skills.

## Anatomy targets (normal adult; numbers tagged `Lang 2015` / `teaching (verify)`)
Do these one at a time, re-testing after each (heart-3d-model discipline):
1. **LV:** bullet shape kept; smoother base-to-apex taper; slight trabeculated apex texture optional (echo speckle only); papillary muscles with heads; chordae as thin strands (echo-visible only where they should be).
2. **RV:** a crescent wrapping the septum in short axis (not an ellipsoid), triangular in long axis, with the RVOT/infundibulum curving up and left to the pulmonary valve; moderator band from septum to anterior papillary muscle; RV apex short of the LV apex.
3. **Atria:** RA with a broad triangular appendage, crista terminalis region, SVC and IVC entering (IVC continuous with the extracardiac IVC), coronary sinus ostium; LA posterior and smooth with four pulmonary veins, the LAA as a narrow finger curving anteriorly round the left of the PA.
4. **Great vessels:** aortic root with three sinuses of Valsalva and a sinotubular junction; ascending aorta + arch + three arch branches + descending aorta joined to the existing body-frame descending aorta; PA trunk with bifurcation into RPA (passing under the arch) and LPA.
5. **Valves:** saddle-shaped mitral annulus; AML/PML with scallops (A1–A3, P1–P3 optional); three tricuspid leaflets; AV and PV cusps with commissures. Keep leaflet thickness ≥ 2 voxels at echo resolution or they flicker.
6. **Surface:** atrioventricular and interventricular grooves, epicardial fat in them, coronary arteries (LM, LAD + diagonals, LCx + OM, RCA + PDA) and the great cardiac vein / coronary sinus as new structures. Tissue `vessel_wall`/`fat`; they should be invisible or faint on echo except where real echoes show them.
7. **Pericardium:** thin, follows the heart; oblique/transverse sinus not needed.

## Hard rules (do not break)
- **Ids stay.** Every label id used by `views.json` (labels, mustSee, mustNotSee, landmarks) keeps its name and meaning. New structures get new ids + `LABEL_TEXT` entries. Check with `validate_data.py`.
- **Frames stay.** Heart frame (origin MV centre, Z = LV long axis) and body frame unchanged; landmarks used by derivations (`MV_center`, `TV_center`, `AV_center`, `LV_apex_endo/epi`, `crux`, `CS_*`, papillary levels…) must move only if the anatomy truly moves them; then re-derive targets and re-check scores.
- **Priority order** in `scene()` (body wall first; valves; papillary/moderator; lumens with LVOT before LV; walls; pericardium; extracardiac). New structures need an explicit place in it. Walls between cavities stay carved (`max(a, -(b - wall))`).
- **Beating:** every new structure must move with the cycle parameters (or be attached to a structure that does).
- **Performance:** `scene()` runs per echo sample, per cut-face pixel and per bake voxel. Add bounding-sphere early-outs per structure group; keep the echo at ≥ 50 fps on a laptop (check the render-test timing and Windows Intel Arc if possible). Avoid long loops in GLSL (Windows ANGLE pitfall from v0.3).
- **One source of truth:** no hand-made heart mesh. The 3D heart, cut face and echo must all come from `scene()`.

## Suggested method
1. Baseline: run validate, build, `test_lab.py`; save screenshots of the 8 views + 4 heart angles.
2. Extend the SDF vocabulary where primitives are the limit: e.g. swept tubes along splines (vessels, coronaries, LAA), lofted cross-sections (RV crescent, aortic sinuses), smooth unions with per-pair blend radii, signed "carve" for grooves. Document each new type in `structures._sdf_vocabulary`.
3. Change one structure at a time → validate → `tissueLine` checks → views ≥ 80 → screenshots.
4. Mesh quality: bake at 0.12–0.15 cm (check bake time < 2 s and memory), feed the **signed distance** (not blurred occupancy) to surface nets or dual contouring for crisp grooves, then light Taubin smoothing.
5. Echo side: if blockiness remains in the image, it may be scan resolution (160 lines × 320 samples), not anatomy; note it for P2 rather than changing the engine here.

## Reusing the heart in the other labs (later step)
The 3D heart lab and MI lab use the `heart-3d-model` SDF engine (arbitrary units, 1 unit ≈ 7.5 cm, own wall regions, 14 coronary segments, picking). To switch them to the new heart, export the baked mesh with per-vertex labels, AHA segments and coronary territories, plus a transform to their axes, then rebuild their picking/infarct painting on it. Plan that as its own task after P1.5; do not change those labs in this conversation.

## Done when
Validator 0 errors; build OK; `test_lab.py` 0 failures; before/after screenshot grid reviewed by Punnatorn; no fps regression; PR opened on a new branch (`echo-sim/p1.5-heart`), not merged without approval.
