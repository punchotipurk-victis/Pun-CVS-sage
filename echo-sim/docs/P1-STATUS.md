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
