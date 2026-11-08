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

## Using it in the existing labs (next task; not done here)
- **3D heart lab (`heart3d`)**: `HeartMesh.load(json, THREE, {frame: "H3"})` puts the mesh in that lab's axes. Picking returns `{kind:'wall', aha, ahaName, territory, …}` or `{kind:'vessel', id, name, scct}`.
- **MI lab (`mi`)**: map its regions onto AHA segments, then paint with `infarctDownstream(vesselId, t)` (everything downstream of a clot at fraction `t`, branches included).
  - ANTSEP 2, 8
  - ANT 1, 7, 13
  - APEX 17 (+13–16)
  - HILAT 6
  - LAT 12, 16
  - INF 4, 10, 15
  - POST 5, 11
  - RV = `wall 2`
- **Angiogram lab**: use `vessels.arteries` centrelines with the true radii. `tools/coronary_map.py` already draws RAO caudal, LAO cranial and right-system projections.

## Known limits
- Only the outer surface is exported, so septal segments show only where the septum reaches the surface. The basal anteroseptal segment (AHA 2) sits under the RVOT and has no surface vertices. A 4-chamber cut needs a clip plane plus a cap, or a second export.
- The coronary tree is a right-dominant teaching layout from Netter 223 / BP52, placed on this model's grooves. Have an expert check branch positions and territories.
- The two territory maps agree on about 85 % of LV vertices. The standard map is what students are tested on; the model map follows this tree.
