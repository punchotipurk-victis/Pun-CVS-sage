# P3 kickoff: echo view library UI (handover for a new conversation)

Written 8 Nov 2026, at the end of P2; updated the same evening after the site re-organisation (PR #5). Paste "Prompt to start" into the new conversation.

## Where things are
- Repo `punchotipurk-victis/Pun-CVS-sage`. Chain of draft PRs, none merged, live site has no echo lab yet:
  - `echo-sim/p1-scene-ui` (PR #2 → main)
  - `echo-sim/p1.5-heart` (PR #3)
  - `echo-sim/p2-engine` (PR #4)
  - `site/home-echo` (PR #5, the site re-organisation)
- **Start P3 from `site/home-echo`** on a new branch `echo-sim/p3-views` (PR into `site/home-echo`). Never merge without Punnatorn's approval.
- **Site layout since PR #5:**
  - Home offers three paths: Interactive 3D Heart (`#heart3d`), Deep dive by topic (`#topics`: bradycardia, narrow, wide, mi), Echo Simulator (`#echo`, PLAX supine hero).
  - The top-right switcher only shows the tabs of the current section (`data-group` = `heart` · `topics` · `echo`); in the echo section it shows "Echo simulator" alone.
  - The home card, tab and site embed of the echo (the old P4 "Super App integration") are **done**. The site already carries the P2.5 echo.
- Newest site page: `index-site-home-PREVIEW.html` in Punnatorn's Super Cardio App folder (= repo `index.html` on `site/home-echo`).
- P3 does not edit the site shell. At the end, refresh the echo in the site with `tools/integrate_heart_mesh.py ../index.html --out ../index.html --echo dist/echo-sim.html`, then run `tools/test_site.py ../index.html` and `test_embed.py` on a copy.
- Read first: `echo-sim/AGENTS.md`, `docs/P1-CONTEXT.md`, the project doc `claude/echo-sim/P2-STATUS.md`, `docs/VIEWS.md` (the P2.5 lessons), `docs/ENGINE.md`, `docs/P2-PERF.md`.
- Skills: echo-view-library (owns this phase), echo-sim-engine, cardiology-rotation (teaching text).
- Expert calibration session: 9 Nov 2026 with a Ramathibodi cardiologist. Checklist = the Claude Doc "Echo Simulator — Expert Calibration Checklist". **Bring the filled checklist, phone photos and any `ECHO.pose()` numbers into the P3 conversation.**

## State at handover (end of P2)
- Image: PSF speckle, B-spline scan conversion, persistence, HR-scaled cycle, TGC ×6, focus, per-view presets, Reset image.
- Performance: adaptive tiers; async label read-back; `?dev=1` overlay. Intel Arc 140V: 60 fps at High.
- Scores: all 16 view × position targets score 100; 25° off < 60.
- Tests:
  - `tools/test_p2.py` 30 checks
  - `test_lab.py`, run alone (~25 min on SwiftShader)
  - `test_embed.py`
  - `tools/echo_grid.py`: before/after grids
- Already built:
  - View buttons + ideal image with labels (`refLabelList`, placed by `panels.placeRefLabels`)
  - View chip with live match %
  - Readout strip
- Not built: hints, live-echo labels, view cards, lock feedback, pitfall states, calibration save/export.

## P3 scope, in this order (one item at a time, test after each)
1. **Expert results → data.**
   - Turn the checklist into `data/views.overrides.json` (`poseOverride.supine/LLD`, `reviewedBy`, `reviewedOn`).
   - Fold number corrections into `views.json` teaching layers, with source tags, and set supine-only views in `patientPosition.allowed`.
   - Re-run the content checks at the expert poses: below 80 → fix the phantom or the check, never the expert pose.
2. **Calibration mode (`?dev=1`)**, so the next session saves poses directly:
   - "Save as target (view, position)" and "Save as pitfall example" (stores `poseDelta`), kept in localStorage behind try/catch.
   - "Export" downloads `views.overrides.json`; "Import" for a round-trip.
   - Show the full pose (x, y, notch, tilt, rock, press) in the dev overlay.
3. **Lock + hints.**
   - Lock at quality ≥ 80 held 0.5 s, unlock < 65 (`SCORING.makeLock`); chip turns ✓ with a short visual cue (sound opt-in, off by default).
   - One hint at a time: image-based hints first (rib shadow, lung, stomach gas, structure beyond depth), then `SCORING.hint()` pose hints in sonographer words.
   - Position deltas become words: "one rib space up", "slide medially 1 cm".
   - Hint strip under the echo; `aria-live="polite"`.
4. **Live-echo labels: Off → Text → Tint** (L key; button).
   - Text and Tint unlock when the view locks (always available in Free scan).
   - Text: `labelRules` thresholds; greedy placement with leader lines; re-place at 4–5 Hz from the async label map; ease positions so labels don't jitter with the beat; flip x for POCUS.
   - Tint: the engine's `tint:true` (palette_anatomyTint, 0.35 alpha).
   - Cross-highlight: hover/tap an echo label ↔ the same id in the Heart cutaway (and the reverse).
5. **View cards (4 teaching layers)**, opening on lock:
   - Core, Deeper, Fellow pearl, Why it looks like this.
   - Source tags shown; ASE and POCUS101 side by side when they differ (IVC → RAP).
   - "Why it looks like this" points at the Heart cutaway (button: camera to Follow beam).
   - Card text is data (`views.json`), never hard-coded.
6. **Pitfall states** (the full Pitfall hunt game is P4):
   - From `views.json` `pitfalls[]`: "Show this pitfall" moves the probe by `poseDelta` / `throughLandmark`, shows the symptom and the fix, and flags it in the chip (e.g. `unwanted:coronary_sinus`).
   - Each view has ≥ 2 pitfalls; check every one triggers its flag.
7. **Polish and handover:**
   - Keyboard map (L, M, B, F, Q/E, arrows); a11y labels; 400 px phone layout (cards become a bottom sheet).
   - Update VIEWS.md + the echo-view-library skill (propose the skill edit); write `P3-STATUS.md` + `P4-KICKOFF.md`.

## Rules that must hold
- Same as P2 (`AGENTS.md`):
  - one source of truth; ids, not display strings
  - self-contained build
  - `validate_data.py` 0 errors before a build
  - `test_lab.py` run alone
- New `tools/test_p3.py`. It grows per item: lock/unlock hysteresis, hint text for a known offset, label states and unlock, label placement (no overlaps, inside the pane), cross-highlight, card content per view, pitfall flags, overrides round-trip.
- Every view stays ≥ 95 at target (supine and LLD, with overrides applied), < 60 at 25° off; no page/shader errors; no sideways scroll at 400 px.
- Site checks whenever `index.html` changes: `tools/test_site.py` (home has three paths, section-only switcher, 400 px) and `test_embed.py`.
- Show screenshots after each item (echo with Text and Tint labels, a card, a hint, a pitfall) and an updated preview page (`integrate_heart_mesh.py <newest page> --out index-P3-echo-PREVIEW.html --echo dist/echo-sim.html`).
- What P4 becomes, now that the site integration is done: learning modes (Guided tour, Challenge, Label quiz, Pitfall hunt), and optionally more echo pages in the `echo` section (e.g. an "Echo basics" page) as extra switcher tabs.

## Decisions to ask Punnatorn at the start (only if not obvious)
- Card placement on desktop: right panel tab vs. drawer over the 3D view.
- Hint wording: ASE terms only, or with POCUS synonyms in brackets.

## Prompt to start
> Start P3 (echo view library UI) of my echo simulator. Read `echo-sim/docs/P3-KICKOFF.md` in the repo
> punchotipurk-victis/Pun-CVS-sage (branch site/home-echo) and the project docs `claude/echo-sim/P3-KICKOFF.md` and
> `claude/echo-sim/P2-STATUS.md`, then the root AGENTS.md, echo-sim/AGENTS.md, P1-CONTEXT.md, VIEWS.md and ENGINE.md. Use the skills
> echo-view-library and echo-sim-engine. Here are my notes from the expert session: [paste / attach]. My newest page is
> `index-site-home-PREVIEW.html` in my Super Cardio App folder. Work on a new branch echo-sim/p3-views, one item at a time (expert results first), test after each,
> and show me screenshots. Don't merge anything without my approval.
