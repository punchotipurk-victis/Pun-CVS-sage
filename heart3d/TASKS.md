# 3D Heart: task queue

Owner: **C** = Codex (code with clear acceptance checks) · **CL** = Claude (anatomy, phantom, medical content, design review) ·
**P** = Punnatorn (+ cardiology staff: approval, review). Status: todo · doing · PR #n · done.
Each Codex task = one branch `codex/<id>` from `heart3d/rework`, one PR into `heart3d/rework`. Rules: `heart3d/AGENTS.md`.

## Step 5: cut views (mostly Codex)
| Id | Owner | Status | Task |
|---|---|---|---|
| T5.1 | C | todo | **Cap colour by tissue.** In `echo-sim/tools/export_heart_interior.py`, add `capVolume` to `heart-interior.json`: the heart label volume at 0.2 cm (`labels` from the 0.1 cm bake, downsampled by majority), run-length encoded, with `lo`, `n`, `v`. In `explore.js`, decode it to a `THREE.Data3DTexture` (R8, nearest) and colour each cap in its fragment shader by sampling the label at the fragment's heart-frame position: real mode = tissue class colour (myocardium, fibrous, valve, fat, vessel wall), label mode = `PAL`. **Accept:** in "Four-chamber section" the IVS cap is muscle, the CFB/membranous septum cap is pale, and fat in the AV groove is yellow (screenshot); the export stays ≤ 1.5 MB (now 1.23 MB); test passes. |
| T5.2 | C | todo | **Tap the cut face.** When a tap hits a cap (ray–plane hit on the kept boundary, inside tissue per `capVolume`), open the card of the label there. **Accept:** a test that taps the IVS cap in "Four-chamber section" and gets the IVS card. Depends on T5.1. |
| T5.3 | C | todo | **"Where am I" figure.** A small inset (bottom-right of `.viewer`, about 110 px, hidden ≤ 400 px wide): a simple torso silhouette (SVG or tiny three.js scene) with the heart outline and the current cut plane drawn as a translucent rectangle, plus the viewing direction arrow. Updates on view change and while orbiting (throttled). **Accept:** visible in every Cut view, hidden in External / X-ray; no layout shift; test passes. |
| T5.4 | C → CL review | todo | **Tune the dissection views.** Only change numbers in `CUTS` (planes `n/c/n2/c2`, `at`, `zoom`, `up`), never anatomy. Goals: (a) "Valves from above": all four valves visible; PV and the TV septal leaflet not hidden; anterior at the top. (b) "Right ventricle opened": moderator band label visible. (c) Each view framed so its region fills about 70 % of the viewer. **Accept:** a screenshot per view in the PR; Claude checks the anatomy, Punnatorn approves. |
| T5.5 | C | todo | **Share three.js with the parent** (site page ≈ −0.6 MB per page). Each lab page uses `window.parent.THREE` when present, with the inlined copy kept for standalone (built only with `--standalone`). Must keep one WebGL context per iframe and work offline. **Accept:** `test_embed.py` + `test_heart3d.py` pass; site page size reported in the PR. |

## Step 6: conduction on the refined heart
| Id | Owner | Status | Task |
|---|---|---|---|
| T6.1 | CL | todo | Write `heart3d/data/conduction.json`: nodes and paths from `heart-landmarks.json` with today's activation times (from the legacy `conduction.js`), plus the spec for the activation wave (which tissue activates when, by region). |
| T6.2 | C | todo | Activation wave on the refined heart: per-vertex activation time on the tissue and outer meshes (nearest-path / geodesic from T6.1), gold wave in the shader on the ECG clock; the live 12-lead strip back under the card on the 3D Heart page (reuse the ECG engine from `app.js`, extracted into its own module). **Accept:** SA→AV→His timings within ±5 % of the legacy model (test); the ECG traces identical to the legacy normal sinus rhythm. |
| T6.3 | C | todo | Remove the warp (`NEO_CFG.warpToLegacy`) once the pathology page no longer needs it (after step 8). |

## Step 7: cards
| Id | Owner | Status | Task |
|---|---|---|---|
| T7.1 | C | todo | Card renderer + schema (`heart3d/data/structures.json`: anatomy, function, supply, relations, seenOn, complications[] with scenario links, pearls.student/resident/fellow[], sources[]); Student / Resident / Fellow switch (remembered in localStorage, wrapped in try/catch); move the existing cards into the schema without changing their text. |
| T7.2 | CL + P | todo | Write ≈ 55 cards in batches of 10 (cardiology-rotation skill); P + staff review each batch. |

## Step 8: pathology simulator on the refined heart
| Id | Owner | Status | Task |
|---|---|---|---|
| T8.1 | CL | todo | Mechanism scripts (4 stages per scenario) as data, and the lesion variants in the phantom (VSD, papillary rupture, aneurysm, free-wall rupture, RV dilation, HOCM, effusion). |
| T8.2 | C | todo | Pathology page on the refined viewer: stage stepper, playback speed, ladder diagram component, 12-lead on the same clock; port every scenario; case MCQs (interactive-study-lab format). |

## Step 9
| Id | Owner | Status | Task |
|---|---|---|---|
| T9.1 | C | todo | Performance on a real GPU / phone (frame time, first render), fixes; docs; final re-embed into Punnatorn's newest site page. |

## Bug intake
Punnatorn reports a bug (screenshot + what he did) → add a line here as `B<n>` with owner C, then run it as a Codex task.
| Id | Owner | Status | Bug |
|---|---|---|---|
| B1 | CL | done | 4C cut: border below the RCA groove missing / not joined to the RA. Fix: coronaries + cardiac veins now fill their grooves in the interior tissue mesh (`export_heart_interior.py`); they never name a wall vertex. |
| B2 | CL | done | Right AV groove too flat. Fix: RV basal waist (`RV_cavity.loft.basalNarrow`, phantom.js): the lateral RV wall narrows to the TV annulus so it rounds into the groove and meets the RA; coronaries redesigned; echo tests pass. |
| B3 | CL | done | Labels vanish when a cut view is turned. Fix: in Cut mode outer-surface labels (chambers, vessels) also show, occlusion-tested; the view's "find" list filters only cut-face labels; one label per structure. Test: turned a4c / valves views show labels. |
| B4 | CL | done | Same as B3 in "Valves from above". Same fix and test. |
| B5 | CL | done | Hole at the fossa ovalis (looked like an ASD). Fix: exporter seals any right-heart / left-heart blood contact into a 0.2 cm wall (RA–LA contact labelled IAS), so the fossa is a thin depression. |
