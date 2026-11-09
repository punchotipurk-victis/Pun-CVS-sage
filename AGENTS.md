# AGENTS.md (repo root)

This repo is the Pun CVS Lab / Cardio Super App: one self-contained `index.html` served by GitHub Pages.
Every lab is a self-contained HTML page stored as base64 in `const LABS = { … }` and opened in an iframe via `srcdoc`.

- Echo simulator work: read `echo-sim/AGENTS.md` first (rules, commands, tests).
- Never break existing labs (`heart3d`, `brady`, `narrow`, `wide`, `mi`): after any change to `index.html`, check every `#route` still opens.
- Keep `index.html` deployable at all times: no build step on GitHub Pages.
- Site shell (Nov 2026): the home page offers three paths: `#heart3d` (Interactive 3D Heart), `#topics` (Deep dive: bradycardia, narrow, wide, mi) and `#echo` (Echo Simulator).
  - Every switcher tab carries `data-group` (`heart` · `topics` · `echo`), and `route()` shows only the tabs of the current lab's group. A new lab needs a `data-group` (new section → also a home card).
  - Editable home text lives in `window.SITE` (heartCard, topicsCard, echoCard, …).
  - Check with `python echo-sim/tools/test_site.py index.html` and `echo-sim/tools/test_embed.py` on a copy.
