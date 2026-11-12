# P2 kickoff: echo engine polish (handover for a new conversation)

Written 8 Nov 2026, at the end of P1.5. Paste the "Prompt to start" below into the new conversation.

## Where things are
- Repo `punchotipurk-victis/Pun-CVS-sage`. Branches: `echo-sim/p1-scene-ui` (P1, PR #2 → main), `echo-sim/p1.5-heart`
  (P1.5, draft PR #3 → p1-scene-ui). Neither is merged: the live site still has no echo lab. **Start P2 from `echo-sim/p1.5-heart`**
  on a new branch `echo-sim/p2-engine` (PR into `echo-sim/p1.5-heart`). Never merge without Punnatorn's approval.
- Newest site page: Punnatorn's folder `C:\Users\punch\Downloads\Super Cardio App\index-with-refined-heart-PREVIEW.html`
  (= repo `index.html` on p1.5-heart). Build on it, never on an older copy.
- Read first: `echo-sim/AGENTS.md`, `docs/P1-CONTEXT.md`, `docs/P15-STATUS.md`, `docs/ENGINE.md` (pitfalls!), `docs/VIEWS.md`.
- Skills: echo-sim-engine, echo-view-library (and refined-heart-model if anatomy changes are needed).

## State at handover
- Phantom v0.4 (refined heart). All supine views 100 at target; LLD PSAX-MV 86 (missing LV_cavity / lv_round), S4C 88 (RV, RA);
  every view <60 at 25° off. `test_lab.py` and `test_embed.py`: 0 failures.
- PLAX fixed on 8 Nov (aortomitral curtain sheet, AML hinge on the posterior aortic wall line, no LA–LVOT hole).
- Performance on SwiftShader (CPU): echo frame + label read-back 138 ms (113 before P1.5), renderOnce ~13 ms, heart bake ~6.7 s.
  Not yet measured on a real GPU or on Punnatorn's Windows Intel Arc laptop.
- Known image issue: edges look stair-stepped/blocky. Cause is the scan resolution (160 lines × 320 samples) and nearest
  label sampling, not the anatomy.

## P2 scope (from the plan, §11)
1. **Image quality**: higher/adaptive scan resolution (lines × samples by GPU speed), smoother scan conversion (bilinear or
   bicubic on the polar image), speckle that stays stuck to tissue, softer tissue edges (no stair steps), lateral blur growing with depth.
2. **Persistence** (frame averaging slider) and **HR scaling** of systole (systole shortens less than diastole as HR rises).
3. **Image controls**: gain, TGC (near/far or 6 sliders), dynamic range, depth, sector width, focus; sensible defaults per view.
4. **Performance**: measure on a real GPU and on Intel Arc (fps overlay in `?dev=1`), adaptive quality to hold ≥50 fps;
   collapsed inset pane at 15–20 fps; readPixels ≤5 Hz (pitfall).
5. **LLD scores**: PSAX-MV and S4C ≥95 in LLD without breaking supine (data/views.json first, phantom only if needed).
6. Prepare the **expert calibration** session (Ramathibodi echo lab): 8 views × supine/LLD checklist; numbers with sources.

## Rules that must hold
- One source of truth (`phantom-normal.json` → `compile()` → `scene()`); ids not display strings; units cm; body frame.
- Self-contained build (three r0.158.0 inlined, no CDN, no `</script` in inlined code).
- `validate_data.py` 0 errors before a build; `test_lab.py` alone (~15 min); `test_embed.py` on a copy of the newest page.
- Every view ≥80 at target (supine and LLD), <60 at 25° off; no page/shader errors; no sideways scroll at 400 px.
- After P2: re-run `tools/integrate_heart_mesh.py <newest page> --out … --echo dist/echo-sim.html` so the site gets the new echo.
- Show before/after echo grids for all 8 views (supine + LLD) and an fps table; plain-English summary for Punnatorn.

## Prompt to start
> Start P2 (echo engine polish) of my echo simulator. Read `echo-sim/docs/P2-KICKOFF.md` in the repo
> punchotipurk-victis/Pun-CVS-sage (branch echo-sim/p1.5-heart) and the project doc `claude/echo-sim/P2-KICKOFF.md`, then
> AGENTS.md, P1-CONTEXT.md, P15-STATUS.md and ENGINE.md. Use the skills echo-sim-engine and echo-view-library. My newest page is
> `index-with-refined-heart-PREVIEW.html` in my Super Cardio App folder. Work on a new branch echo-sim/p2-engine, one item at a time
> (image quality first), test after each, and show me before/after echo grids. Don't merge anything without my approval.

## After P2 (one conversation each)
1. **3D heart page rework** (Heart Conduction lab): two subtabs, one per page: (a) Main 3D heart: large, rotatable and movable
   refined heart with the conduction pathways rebuilt on the refined atria (remove the warp), refined cut view; (b) Pathology simulator.
2. **MI lab**: infarct shading from the refined coronary tree (`infarctDownstream`), and a cut/lesion version of the refined heart
   for the complication views (VSD, papillary rupture, aneurysm/thrombus, free-wall rupture, RV infarct).
3. **Angiogram simulator** (new lab): from `vessels.arteries` centrelines at true radius; RAO/LAO projections (`tools/coronary_map.py`).
4. **P3 view library UI**, **P4 learning modes**, **P5 M-mode/Doppler/measurements**, **P6 pathology pack**.
5. **Expert review**: coronary branches and territories, valves, view calibration.
