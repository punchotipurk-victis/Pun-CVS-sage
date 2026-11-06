<!-- Mirror of the Claude skill 'echo-view-library'. Keep in sync: edit both. -->

# Echo View Library (Pun CVS Lab)

This skill owns *which* views exist in the echo simulator, how a probe pose is judged against them, and what the learner is taught. The sister skill **echo-sim-engine** owns rendering, the probe maths and the UI shell. Load both for UI work.

Data lives in `echo-sim/data/views.json` and `phantom-normal.json`. The tested code this skill relies on (`src/engine/derive.js`, `scoring.js`, `tools/validate_data.py`) is in the repo. Snapshots are in the project docs `claude/echo-sim/engine/` and `claude/echo-sim/tools/`; copy them in rather than rewriting them. Copies are in the project docs `claude/echo-sim/…`. The design doc is `claude/echo-simulator-plan.md`.

- **Primary teaching reference:** POCUS101 "Cardiac Ultrasound (Echocardiography) Made Easy".
- **Fellow-level references:** the ASE TTE guideline (Mitchell 2019), ASE/EACVI chamber quantification (Lang 2015) and the ASE RV guideline (Rudski 2010).

## The learner and the tone
The audience runs from medical students who love cardiology, through residents, to cardiology fellows. Write **in depth, but friendly**: mechanism first, plain English, no wall of jargon. When the anatomy or physics explains a picture, say so. Use the cardiology-rotation skill's approach (Mechanism → Manifestation → Management → Meaning) for any clinical teaching added to a view card.

Every view card has 4 layers, and you should keep all of them:
1. **Core** (students): what you see, a "how do I know I'm there?" checklist, and the hand movement in plain words.
2. **Deeper** (residents): what the view is used for, plus measurements with normal values and a source tag (`ASE 2015`, `POCUS101`, `teaching (verify)`).
3. **Fellow pearl:** ASE nuances, traps, and how pathology changes the view.
4. **Why it looks like this:** the 3D-plane → 2D-picture mechanism, pointing at the Heart cutaway pane.

**Sources:**
- Tag every number. If POCUS101 and ASE differ (e.g. IVC → RAP), show **both, labelled**, and never merge them into one.
- Mark anything you are not sure of as `teaching (verify)`.
- Do not copy text or images from the references. Paraphrase and cite.

## v1 views (order = Guided tour)
| id | Window | Notch (ASE) | Derivation |
|---|---|---|---|
| `plax` | left parasternal | ~11 o'clock (R shoulder) | plane3: MV centre, LV apex, AV centre |
| `psax_pap` | left parasternal, ICS4 | ~1:30 | fanFromWindow: LV papillary level ⟂ LV axis |
| `psax_mv` | left parasternal, ICS3 | ~1:30 | fanFromWindow: LV mitral level |
| `psax_av` | left parasternal, ICS3 | ~2:00 | fanFromWindow: AV centre ⟂ aortic root axis |
| `a4c` | apical (LLD preferred) | 3 o'clock | plane3: LV apex, MV, TV |
| `a5c` | apical | 3–3:30 | tiltFrom a4c until the AV is in plane (≈6° toward the head) |
| `subxiphoid_4c` | subxiphoid, press 1.5 cm | 3 o'clock | planeThroughSkin: crux + lateralHint = patient's left |
| `ivc` | subxiphoid right of midline | 12 o'clock (POCUS marker-left: 6) | planeThroughSkin: IVC points |

**v2 backlog (fellow layer):** A2C, A3C/APLAX, RV inflow, PSAX apex, suprasternal arch, subcostal SAX.

## Conventions (get these exactly right)
- **notchDeg** is the direction the notch points *on the chest*, seen from the front with the head up. 0° = 12 o'clock (head), +90° = 3 o'clock (patient's left), −90° = 9 o'clock, 180° = feet. Clockwise as the examiner sees it means increasing degrees.
- **Tilt +** fans the beam toward the patient's head side, out of the image plane; this is "tail toward the feet". **Rock +** angles the beam toward the notch, within the plane.
- **Screen marker:**
  - ASE (default): marker on the **right**. Notch-side structures appear on screen right: the aorta in PLAX, the LV in A4C and S4C, the RA in the IVC view.
  - POCUS marker-left: the image is mirrored, so every expected notch target becomes `notchDeg + 180°` and the picture looks the same. The view card must explain this, and the classic trap is the IVC view: POCUS101 has the indicator toward the feet.
- **Readout text:** `"Left parasternal · 3rd ICS · notch → R shoulder (11:00) · tilt −12° · rock 5°"`.
  - ICS number from the rib formula: `n = round((-2.0 - slope - y)/2.25)`, where `slope = 0.25·max(0,|x|-3)`.
  - Clock from `PROBE.clock`. Line names by |x|: about 2.5–4 parasternal, 9–10 MCL, 12–13 AAL.

## views.json schema (per view)
`id, name, shortName, family, order, patientPosition{preferred, allowed, cue}, window, derivation{method,…}, seedPose{skinPoint_patient, landmarkText, notchDeg_ASE, approxTiltDeg, approxRockDeg, derived{supine, LLD}}, poseOverride{supine, LLD}, tolerance{positionCm, rotationDeg, tiltDeg, rockDeg}, image{depthCm, sectorDeg}, expectedScreen, contentChecks{mustSee[], mustNotSee[], shapeChecks[]}, labels[], segmentOverlay?, measurementTool?, pitfalls[], maneuverFromPrevious, teaching{core, deeper, fellowPearl[], whyItLooksLikeThis}`.

Global sections: `conventions`, `windows` (with `pressCm`), `derivationMethods`, `scoring`, `hintTemplates`, `labelRules`, `_calibration`.

**Ids:**
- `labels`, `mustSee` and `mustNotSee` use the **structure ids** that the engine's GLSL emits, e.g. `LV_cavity`, `MV_AML`, `AV_cusps` (a prefix that matches `AV_cusps.RCC`, `.LCC` and `.NCC`), `papillary_muscles`, `IVC`, `descending_aorta`.
- `mustNotSee` may also name a heart **landmark**, e.g. `LV_apex_endo`, which is checked geometrically.
- Display text comes from the engine's `LABEL_TEXT`.

### Adding a view (checklist)
1. **Pick a derivation that matches how sonographers scan it.**
   - If the view has a natural 3-point plane, use `plane3`.
   - If it is reached by fanning from a window, use `fanFromWindow`.
   - If it is a small tilt from another view, use `tiltFrom`.
   - If it is defined by window plus aim plus notch habit, use `planeThroughSkin` with `lateralHint`.
2. Write the content checks the *image* must pass: must-see areas and lengths, must-not-see (what it would be confused with), and shape checks (roundness, foreshortening).
3. Add labels, at least 2 pitfalls with a `poseDelta` or `throughLandmark`, `maneuverFromPrevious`, and all 4 teaching layers.
4. Run `validate_data.py` (no errors), run `derive.js` (target in an ICS, small `ribPath`), and render it in the engine.
5. Confirm quality is at least 80 at the target, below 60 at 25° off, and that the confusable pitfall view is flagged.

## Derivation (tested reference implementation)
`DERIVE.derive(viewsJson, phantom, 'supine'|'LLD')` returns `{viewId: {x, y, p, beam, lateral, notchDeg, tiltDeg, rockDeg, inICS, ribPath}}`. Run it at load and again on every position change, then apply `poseOverride` from calibration on top.
- **Choosing the skin point:** for `plane3`, the probe goes where a sonographer would put it. Cost = beam angle from the skin normal (°) + 2 × distance from the seed (cm) + 40 if the entry point is over a rib + 200 × the fraction of the first 3 cm of beam that runs through rib.
- **Choosing the tilt (`tiltFrom`):** use `atan`, not `atan2`. It picks the smallest rotation (|φ| < 90°). `atan2` once returned a mirror solution 174° away.

Prototype results with phantom v0.2 (supine, end-diastole):

| View | Quality at the derived target |
|---|---|
| PLAX | 100 |
| PSAX-PM | 100 |
| PSAX-MV | 86 |
| PSAX-AV | 86 |
| A4C | 100 |
| A5C | 90 (≈6° tilt from A4C, matching POCUS101's 5–10°) |
| S4C | 88 |
| IVC | 100 |

Rotating the probe 25° off target drops quality to 10–50. Tilting A4C toward the coronary sinus is flagged (`unwanted:coronary_sinus`) with the correct hint.

**Source:** `echo-sim/src/engine/derive.js` (snapshot: `claude/echo-sim/engine/derive.js`).
**API:** `DERIVE.derive(viewsJson, phantom, position)` · `heartToPatient(ph, position) → (heartPoint) → bodyPoint` · `ribGap(x,y)` (>0 = in an ICS) · `ribPath(p, beam)` (fraction of first 3 cm in rib) · `icsCentre(x,y)`.
Methods: `plane3`, `fanFromWindow` (u = axisRef × beam), `tiltFrom` (smallest φ), `planeThroughSkin` (2 landmarks, or 1 landmark + `lateralHint`).

## Scoring, locking and hints (tested)
- **Quality** = 0.5 × poseScore + 0.5 × contentScore.
  - poseScore = `100·exp(−½Σ(err/σ)²)` with σ = tolerance/1.5.
  - contentScore = the fraction of the view's content checks that pass on `eng.readLabels()`.
  
  Content checks let a different but valid pose still score well, and stop a near-target pose that hits a rib or lung from passing.
- **Locking:**
  - The view locks at quality ≥ 80 held for 0.5 s and unlocks below 65 (hysteresis, so it doesn't flicker).
  - Each frame, the view chip shows the best view at ≥ 40, otherwise "Searching…".
  - When the view locks, the chip turns ✓, the labels and view card unlock, and a short success cue plays (visual, and sound only if the user enabled it).
- **Hints:** show **one** hint, for the largest normalised error, in sonographer language (`hintTemplates`).
  - Rotation, tilt and rock come from `SCORING.hint()`.
  - Position: convert the skin delta to words. |Δy| ≈ 2.25 cm means "one rib space up/down". Moving toward |x| = 0 is "medially" and away from it is "laterally". Round to 0.5 cm.
  - Image-based hints take priority over pose hints when the content check explains the failure:
    - rib shadow (many `ribs` labels near the top of the fan)
    - lung (lung area at depth < 4 cm) → suggest LLD or sliding medially
    - gas (`stomach_gas`) → slide right and use the liver
    - a must-see structure beyond the depth → "Increase depth to see the {structure}"
- **Landmark checks for mustNotSee** (e.g. the apex must not appear in PLAX):
  ```js
  ctx.landmarkInImage = id => {           // null → not a landmark; caller falls back to label area
    const L = phantom.landmarks_heart[id]; if (!L) return null;
    const q = DERIVE.heartToPatient(phantom, position)(L), d = PROBE.v.sub(q, originWithPress);
    if (Math.abs(PROBE.v.dot(d, frame.elev)) > 0.6) return false;                 // not in the slice
    const a = Math.atan2(PROBE.v.dot(d, frame.lateral), PROBE.v.dot(d, frame.beam)), r = Math.hypot(...d);
    return Math.abs(a) < sectorRad/2 - 0.03 && r < depthCm;                       // inside the fan (not at its edge)
  };
  ```
  `ctx` also carries `trueLVLength` (8.5 cm at ED, the `LV_apex_endo` z) and `ivcRadius` (from the parameters).

**Source:** `echo-sim/src/engine/scoring.js` (snapshot: `claude/echo-sim/engine/scoring.js`).
**API:** `SCORING.poseScore(pose, target, tolerance) → {score, errs{pos,rot,tilt,rock}}` · `contentScore(view, labels, ctx) → {score, fails[]}` · `makeLock() → (quality, nowMs) → locked` · `hint(errs, hintTemplates, view) → string|null` · `CHECKS` (named shape checks: `lv_round, av_round, not_foreshortened, apex_at_top, septum_vertical, aorta_LV_horizontal, mv_av_both, fish_mouth, ias_perpendicular, lvot_aligned, not_cylinder_effect`). A new `shapeChecks` id needs a function here; unknown ids are skipped with a console warning.

## Labels (3-state button, L key)
- **Off → Text → Tint.** Text and Tint unlock once the view has locked; in Free scan they are available at any time.
- **Text labels:**
  - A structure is shown only if its cut area is at least `labelRules.minCutAreaCm2` (0.8 cm²), or its major length is at least 1.0 cm for thin parts (valves, septa, pericardium).
  - The anchor is the region centroid from `readLabels()` (cm in fan coordinates). Convert it to screen with the same mapping as Pass C, and flip x when the marker is on the left.
  - Placement: greedy, with leader lines to label slots outside the fan or in dark blood pools, and no overlaps. Re-place at 4–5 Hz, and ease positions so labels don't jitter with the heartbeat.
  - Abbreviations follow `LABEL_TEXT`. Tapping a label opens a micro-card (what it is, why it matters in this view).
- **Tint:** the engine overlay uses `palette_anatomyTint` at 0.35 alpha. These are the same colours as the cutaway's cut face, which is the visual link between the two.
- **Cross-highlight:** hovering or tapping an echo label highlights the same id in the Heart cutaway, and the reverse.
- **Segment overlay (PSAX levels):** draw the 6 AHA segments with their coronary territory colours (LAD, RCA, LCx; anterolateral is dual supply). It links to the coronary map in the 3D heart and the MI lab.

## Learning modes
1. **Free scan.** Everything is unlocked, and the chip shows the nearest view.
2. **Guided tour.** Follow the v1 order. Each step shows `maneuverFromPrevious`, gives hints, and lets "Snap to view" animate the probe to the target over 1 s. Once locked, the view card opens on Core.
   The "Go to view" buttons (added 7 Nov 2026) do the same in Free scan and open the ideal image beside the live one.
3. **Find-the-view challenge.**
   - Skin body view, inset minimised, labels off, timer running.
   - Score = time + final quality + number of hints used. Run it in both supine and LLD.
   - No snapping.
4. **Label quiz.** In a locked view, a label name appears and the learner taps the structure; the hit is tested against the label map. Use 5 per view.
5. **Pitfall hunt.**
   - The engine starts at a pitfall pose (`poseDelta` or `throughLandmark`, e.g. the CS view or a foreshortened A4C).
   - The learner names the problem, picking from the view's pitfalls.
   - Then they fix it until the view locks, and the pitfall's `symptom` and `fix` are shown.

Keep progress per viewer in `localStorage` only (try/catch); it is a convenience, not a record.

## Calibration with an expert (`?dev=1`)
1. An echo-lab fellow or cardiologist positions the probe in supine and then LLD. "Save as target" writes `poseOverride` for that view and position, plus `reviewedBy` and `reviewedOn`.
2. "Save as pitfall example" stores a `poseDelta`.
3. "Export" downloads `views.overrides.json`. Commit it to `echo-sim/data/`. `build_lab.py` inlines it as `viewsOverrides`, and the loader merges it over the derived targets.
4. Re-run the content checks at the overridden targets. If they fail at the expert's pose, fix the **phantom** (geometry) or the check, never the expert's pose.

Known calibration items in v0.2:
- PSAX-MV cut is about 23° oblique.
- The PSAX-AV cusp-count check fails at the target.
- The S4C RV area is borderline.
- The supine A4C beam is about 55° from the skin normal.

## Data validator
Run before every build. It checks:
- required fields and teaching layers
- that every id resolves into the phantom
- the heart-frame maths
- anatomy sanity (depths, A5C/CS tilt, PSAX obliquity, the PLAX beam angle, the LA → descending aorta gap)

**Source:** `echo-sim/tools/validate_data.py` (snapshot: `claude/echo-sim/tools/validate_data.py`).
`python tools/validate_data.py echo-sim/data` → exit 1 on any ERROR; WARN for anatomy values outside the expected ranges.
