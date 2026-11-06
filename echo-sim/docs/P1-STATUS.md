# Echo simulator: P1 status (6 Nov 2026)

Branch `echo-sim/p1-scene-ui`. Not embedded in the real `index.html` yet.

## Decisions made during P1
- Quality is judged over one beat: content score = best single frame in the last R-R interval. A frozen image scores that one frame.
- POCUS targets: same beam with the lateral reversed, through `PROBE.anglesFrom`. This also flips the sign of rock, so "+180°" alone is not enough.
- Press is automatic per window until the user moves the Press slider.
- "Snap to a view" is available in all modes until P4 limits it to Guided mode.

## Engine fixes
- `echo.js` Pass C: x was scaled 2× relative to y. Images made before this fix (including `docs/prototype-views.png`) look narrower than they should.
- `phantom.js`: the left diaphragm dome was solid; it is now the 0.4 cm shell the data specifies, with soft tissue underneath.

## For expert review: content checks failing at the target (end of beat scoring)
| View | Position | Quality | Failing check |
|---|---|---|---|
| PLAX | supine | 89 | apex in the image; LV–aorta line not horizontal |
| PLAX | LLD | 94 | LV–aorta line not horizontal |
| PSAX-MV | both | 79 at ED; 100 supine, 86 LLD over a beat | no leaflets at ED; in LLD the LV is not round at the best frame |
| PSAX-AV | both | 93 | aortic root not round (oblique cut) |
| S4C | both | 94 | RV area below the check |

## Not done from the P1 list
On-probe gizmo; Ghost opacity slider; coronary and label toggles in the cutaway. In the GLSL, `uRibSpaceScale` is unused, so LLD does not widen rib spaces.

## P1.1 changes (7 Nov 2026, requested by Punnatorn)
- **View buttons** ("Go to view" bar): each moves the probe to the computed target (0.9 s glide) and opens the **ideal image** (picture-in-picture or side by side) with structure labels. Live match % shows on each button.
- **Probe handles:** drag the body to slide, the cyan tip to tilt/rock about the skin contact, the orange ring to rotate. One hand; Shift-drag kept as an alternative.
- **Body:** sculpted torso (shoulders, upper arms, neck, pectoralis, rectus, clavicles, nipples, umbilicus); new **Muscle** body view with fibre directions; realistic skeleton (flat ribs 1–12, costal arch, sternum with notches, S-clavicles, scapulae, humeri, vertebrae).
- **Landmarks** button (M): surface landmarks, ICS numbers, MCL/AAL, apex beat (moves in LLD) and acoustic window outlines; ribs show faintly through the skin while on.
- **Organs:** smoothed meshes and anatomical colours (myocardium, purple-red atria, pale great arteries, blue veins, epicardial fat in the grooves, glossy liver, mottled lungs). The cutaway's "Real / Label colours" toggle switches back to the teaching palette that matches the echo tint.
- Organ **shapes** still come only from the phantom (one source of truth). Making the heart itself look more anatomical (coronary arteries, auricles, truer chamber shapes) means changing `phantom-normal.json`, which changes the echo too, so it needs a separate pass with the expert check.
