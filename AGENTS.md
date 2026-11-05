# AGENTS.md (repo root)

This repo is the Pun CVS Lab / Cardio Super App: one self-contained `index.html` served by GitHub Pages.
Every lab is a self-contained HTML page stored as base64 in `const LABS = { … }` and opened in an iframe via `srcdoc`.

- Echo simulator work: read `echo-sim/AGENTS.md` first (rules, commands, tests).
- Never break existing labs (`heart3d`, `brady`, `narrow`, `wide`, `mi`): after any change to `index.html`, check every `#route` still opens.
- Keep `index.html` deployable at all times: no build step on GitHub Pages.
