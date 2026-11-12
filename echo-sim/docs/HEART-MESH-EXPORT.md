# Heart mesh export (P1.5) — for the 3D-heart, MI and angiogram labs

`python tools/export_heart_mesh.py [--voxel 0.2] [--out export/heart-mesh.json]` bakes the phantom's `scene()` heart (no hand-made geometry) and writes one JSON file. `export/heart-mesh-loader.js` decodes it. To check an export by eye, run `python tools/build_export_preview.py`, open `export/preview.html`, and tap the heart or a vessel.

## Contents (format `pun-cvs heart mesh v1`)
| Part | What | Encoding |
|---|---|---|
| `mesh.positions` | outer surface vertices, heart frame (cm) | Int16, `x = q/32767·range + centre` |
| `mesh.normals` | unit normals | Int8/127 |
| `mesh.index` | triangles | Uint16 (< 65 536 verts) or Uint32 |
| `vertex.label` | structure id (index into `labelNames`, = the echo's label ids) | Uint8 |
| `vertex.wall` | 1 LV · 2 RV · 3 atria · 4 great vessels · 5 groove fat / surface vessel · 0 other | Uint8 |
| `vertex.aha` | AHA 17-segment (1–17), 0 = not LV | Uint8 |
| `vertex.territory` | standard AHA map (Cerqueira 2002): 1 LAD · 2 LCx · 3 RCA | Uint8 |
| `vertex.territoryModel` | nearest branch of this model's right-dominant tree | Uint8 |
| `vertex.vessel`, `vesselT` | nearest artery (index+1) and position along it (0–255) | Uint8 |
| `vertex.motion` | beat weight (255 ventricles, 46 atria/vessels), as the heart-3d-model `aMot` | Uint8 |
| `vessels.arteries[]` | id, name, SCCT segment(s), parent, territory, centreline (heart cm), true `r0/r1`, `displayR0/R1` (tappable) | JSON |
| `vessels.veins[]` | great, middle and small cardiac veins | JSON |
| `frames.heartToBody`, `heartToH3` | column-major 4×4 matrices: echo body frame (cm), heart-3d-model units/axes | JSON |

At 0.2 cm voxels the export is about 26 500 vertices and 1 MB. Use `--voxel 0.25` if a lab must stay small.

## In the site (done: `tools/integrate_heart_mesh.py`)
```bash
python tools/build_lab.py .
python tools/integrate_heart_mesh.py <site index.html> [--out OUT] --echo dist/echo-sim.html   # re-runnable
python tools/test_embed.py <copy of the output>
```
- The mesh JSON is stored **once** in the site page (`<script id="pun-heart-mesh" type="application/json">`, lazy getter
  `window.PUN_HEART_MESH`). The labs are same-origin `srcdoc` iframes and read it from `parent`. A lab opened on its own
  finds nothing and keeps its built-in H3 heart.
- `export/neo-heart-adapter.js` (`NEO`) is injected after each lab's `H3` module, plus 6 one-line hooks in `HeartScene`
  (marked `/*NEO-HOOK*/`): `buildHeart` (intact heart → refined mesh), `showHeart` (swap vessel sets), vessel build,
  `setCulprit` (grey refined vessels + extra branches), label layout, and `classifyOther` (Heart Conduction lab only).
- **Intact heart** (`showHeart({})`): refined mesh + refined coronaries. **Cut or lesion views** (`cut`, `vsd`, `papRupt`,
  `aneurysm`, `thrombus`, `rupture`, `rvDil`) keep the legacy H3 SDF heart, because the export is an outer surface only.
- The labs' vessel keys map onto the tree: LM; LADp/m/d = LAD 0–28 / 28–62 / 62–100 %; D1; LCxp/d = LCx 0–45 / 45–100 %;
  OM = OM1; PL = PLB; RCAp/m/d = RCA thirds; AM; PDA. `H3.VESSELS[k].pts` is replaced **in place** (callers keep the array).
  D2, OM2, conus, SA-nodal and RV branches, the cardiac veins and caval stubs are drawn too, not tappable, and grey with their
  parent segment.
- Walls: AHA → lab region (`ANT` 1, 7, 13 · `ANTSEP` 2, 8, 14 · `INF` 3, 4, 9, 10, 15 · `POST` 5, 11 · `HILAT` 6 · `LAT` 12, 16 ·
  `APEX` 17); `wall 2` → `RV`. The Heart Conduction lab's atrial class comes from `wall 3`.
- **Heart Conduction lab**: its conduction network, labels and cut view are built in H3 coordinates around the legacy (larger,
  more rightward) atria, so `NEO_CFG.warpToLegacy` bends the refined mesh with a smooth Gaussian RBF through 5 landmark pairs
  (RA, SVC top, IVC, LA, AV) with the ventricles pinned. The MI lab shows the unwarped geometry.
- `frames.heartToH3` (v1.1): body axes tilted by the smallest rotation (≈27°) that lays the LV long axis on H3's. v1 took the
  roll from H3's cut plane and swung the arch ≈22° to the right. Mesh data did not change.

## Interior export (phantom 0.5, 3D Heart rework step 3)
`python tools/export_heart_interior.py [--voxel 0.1] [--valve-voxel 0.05] [--tris 52000] [--valve-verts 360] [--cache bakes.npz]`
→ `export/heart-interior.json` (format `pun-cvs heart interior v1`, ≈1.2 MB) + `export/heart-landmarks.json`. Loader:
`export/heart-interior-loader.js` (`HeartInterior.load(json, THREE, {clippingPlanes, frame})` → `tissue`, `valves`, `setPhase(t)`,
`colourBy`, `pick`, `landmarkObject`). Check by eye: `python tools/build_interior_preview.py`, open `export/interior-preview.html`
(body + cardiac cut planes, stencil-capped cut, valve flip-book, conduction landmarks, tap to identify).
Needs `pip install scikit-image fast-simplification` (dev only; the site reads the JSON).

| Part | What |
|---|---|
| `tissue` | one closed surface of all heart tissue (myocardium, fibrous skeleton, vessel walls, groove fat) at end-diastole, from a 0.1 cm bake: smoothed signed distance → marching cubes → quadric decimation. Per vertex `label` (tissue under it), `cavity` (blood it faces; 0 = epicardium), `wall` (1 LV · 2 RV · 3 atria · 4 great vessels · 5 fat · 6 fibrous skeleton), `motion`. A clip plane shows the endocardium, septa, papillary muscles, crista, pectinate muscles…; the closed surface lets a stencil cap fill only tissue, so cavities stay open. |
| `capVolume` | End-diastolic heart-frame label grid. `lo` is the lower voxel corner in cm, `n` gives the voxel counts in x/y/z order, and `v` is 0.2 cm. Each 2×2×2 block of the 0.1 cm bake votes among its tissue labels. Ties go to the lower label index, and empty blocks are zero. `rle` is base64 of unsigned byte pairs [run length minus one, label index] in x-fastest order. `tissueByLabel` is indexed by `labelNames` and gives the most frequent tissue class for each cap label. |
| `valves` | MV (+ chordae), TV, AV, PV meshed from 0.05 cm bakes at 8 phases `[0, .09, .30, .36, .53, .62, .75, .93]` of the RR interval (ED, AV/PV wide open, late ejection, closing, E peak, E fall, diastasis, A peak). Flip-book on the ECG clock. |
| `landmarks` | points / paths / polygons in the heart frame, placed from the phantom and snapped onto the bake: SA-node site, compact AV node, CFB, membranous septum, His (AV node → CFB → crest of the muscular septum), LAF / LPF / septal fascicle, RBB, moderator band, three internodal routes, Bachmann's bundle, Koch's triangle, tendon of Todaro, TV septal hinge, CTI, crista, fossa, CS ostium, IVC orifice, SVC junction, PV ostia, papillary muscles. Every conduction point is checked to lie in heart tissue. |

New phantom parts it shows (0.5): SVC, pectinate muscles, Eustachian and Thebesian valves, tendon of Todaro, membranous septum,
central fibrous body (`tools/landmark_design.py`, from the existing anatomy). Blender: `mesh_to_gltf.py` / `gltf_to_mesh.py` accept the
interior file (node `interior_tissue`; valves and landmarks copied unchanged).

## Still to do
- Angiogram lab: use `vessels.arteries` centrelines with the true radii. `tools/coronary_map.py` already draws RAO caudal,
  LAO cranial and right-system projections.
- MI lab: paint from the model's own tree with `infarctDownstream(vesselId, t)` (today it still paints the lab's 8 regions).
- Rebuild the Heart Conduction network on the refined atria, then drop the warp.
- Lesion variants (VSD, papillary rupture, aneurysm, free-wall rupture, RV dilation) as phantom variants baked by the interior exporter (3D Heart step 8).

## Known limits
- Only the outer surface is exported, so septal segments show only where the septum reaches the surface. The basal anteroseptal segment (AHA 2) sits under the RVOT and has no surface vertices. A 4-chamber cut needs a clip plane plus a cap, or a second export.
- The coronary tree is a right-dominant teaching layout from Netter 223 / BP52, placed on this model's grooves. Have an expert check branch positions and territories.
- The two territory maps agree on about 85 % of LV vertices. The standard map is what students are tested on; the model map follows this tree.
