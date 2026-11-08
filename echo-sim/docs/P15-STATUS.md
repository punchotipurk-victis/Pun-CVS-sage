# P1.5 status: heart refinement (phantom v0.4), 8 Nov 2026

Branch `echo-sim/p1.5-heart`, draft PR #3 into `echo-sim/p1-scene-ui`. Do not merge without Punnatorn's approval.

## Done, in the agreed order
1. **Mesh quality.** The 3D heart is meshed from the signed distance at 0.13 cm, and the bake skips the body wall.
2. **Base of the heart.** Re-laid round the aortic root:
   - LA behind the root (no false ASD in PLAX)
   - LVOT in line with the aorta, with aortomitral and septo-aortic continuity
   - RVOT conus wraps the aortic valve (Mercedes sign with chambers all round)
3. **Atria size.** Lang 2015 sizes, side by side in A4C with the IAS between them. The fossa ovalis drops out only intermittently over the beat.
4. **RV.** Lofted: a triangle in A4C, a crescent in short axis, filling the subcostal near field. Opens straight into the RA; moderator band in the lower third.
5. **Great vessels.** Sinuses of Valsalva and STJ, arch with 3 branches joined to the descending aorta, PA bifurcation (RPA under the arch).
6. **Atria detail.** Triangular RA appendage, crista terminalis, SVC/IVC/CS openings, fossa limbus, 4 pulmonary-vein ostia.
7. **LV.** Smooth bullet built from round cones, apical trabeculation, papillary muscles with heads, chordae.
8. **Valves.**
   - Fixed a muscle plate across the mitral orifice and a leaflet-width bug.
   - Saddle annulus; the closed MV and TV now seal. PML has P1–P3 scallops; the TV has 3 leaflets.
   - Aortic and pulmonary cusps are bellies with coaptation walls; PSAX-AV is derived through `AV_coaptation`.
9. **Surface.**
   - 19 coronary arteries (right-dominant, SCCT segments, territories), 3 cardiac veins and groove fat, designed on the baked heart by `tools/coronary_design.py`.
   - Detail levels: the echo and cut face show only the proximal coronaries and AV-groove fat. The 3D view sweeps the full tree as tubes from the same centrelines, drawn thicker than life (×2.2) so they can be tapped.
10. **Export.** `tools/export_heart_mesh.py` writes `export/heart-mesh.json`, and `export/heart-mesh-loader.js` loads it. Format in `docs/HEART-MESH-EXPORT.md`.

## Checks (last run)
- `validate_data.py`: 0 errors, 0 warnings.
- `test_lab.py`: 0 failures.
- Supine: every view scores 100 at target.
- LLD: PSAX-MV 86, S4C 88, all other views 100.
- Every view drops below 60 at 25° off target.

## Performance (SwiftShader, CPU) — still to measure on a real GPU and Windows Intel Arc
| Measure | Before P1.5 | After coronaries |
|---|---|---|
| Echo frame + label read-back | 113 ms | 138 ms |
| `renderOnce` | ~9 ms | ~13 ms |
| Heart bake | 2.4 s | ~6.7 s |

Targets: 50 fps echo and a bake under 2 s on a laptop GPU.

## Open
- Expert review of the coronary branch positions and territories, and of the valve shapes.
- RV front facet.
- Pericardium does not cover the roots of the great vessels.
- In A4C the chest wall still enters the near field.
- LLD PSAX-MV and S4C scores.
- Next task: wire the export into the heart3d and MI labs (map MI regions to AHA segments, use `infarctDownstream`), then the angiogram lab.

## Tools added
| Tool | Purpose |
|---|---|
| `src/dev/slice.html` | Engine-only renders and `SL.raycast` |
| `tools/slices.py`, `labels.py`, `phases.py`, `phase_labels.py`, `targets.js`, `base_clock.py`, `timing.py` | Slice, label, phase and timing checks |
| `tools/valve_views.py` | Valve ray-cast preview |
| `tools/anatomy_shots.py` | Labelled internal cuts |
| `tools/coronary_design.py`, `coronary_map.py` | Coronary design and map |
| `tools/shots.py` | Before/after grids |
| `tools/export_heart_mesh.py`, `build_export_preview.py`, `export_shots.py` | Mesh export and its preview |
