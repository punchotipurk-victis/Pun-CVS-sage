# Claude ⇄ Codex hand-off guide (Pun CVS Lab / Cardio Super App)

One page that both agents read at the start of any conversation about this repo. It says who does what, where the truth lives,
how work moves between Claude, Codex and Punnatorn, and how to keep credit use low. Keep it short; update it when the process changes.

Repo: `punchotipurk-victis/Pun-CVS-sage` (public; GitHub Pages serves `index.html`). Owner and decision-maker: **Punnatorn**.

---

## 1. Read this first (both agents)
1. This file.
2. The `AGENTS.md` of the part you work on:
   - repo root `AGENTS.md`: site shell, routes, `data-group` tabs, `window.SITE`
   - `heart3d/AGENTS.md`: 3D Heart + Pathology pages
   - `echo-sim/AGENTS.md`: echo simulator, the phantom (anatomy), exports
3. The task queue of that part: `heart3d/TASKS.md` (others get one when they need it).
4. The current branch's PR description, which holds the status and the last test results.

**Do not explore the repo beyond these unless the task needs it.** Each `AGENTS.md` lists the files that matter.

## 2. Who does what
| | Codex | Claude | Punnatorn (+ cardiology staff) |
|---|---|---|---|
| Owns | code: viewer/UI, bug fixes, tests, refactors, build/embed, performance, data plumbing | anatomy (phantom + exports), conduction/landmark specs, **all teaching text** (cards, pearls, scenario scripts, MCQs), design decisions, review of risky PRs | priorities, approval, merging, testing previews, medical review with staff |
| Never | writes medical text (leaves `TODO(content)`), edits anatomy or exported JSON by hand, merges | re-explores the whole repo, runs long tests Codex can run, merges | — |

When a task needs both, split it: Claude writes the spec or data (a JSON or markdown file in the repo), then Codex wires it up.

## 3. Where the truth lives
| What | Where |
|---|---|
| Anatomy (single source) | `echo-sim/data/phantom-normal.json` → `PHANTOM.compile()` → GLSL `scene()` → exports `echo-sim/export/heart-mesh.json`, `heart-interior.json`, `heart-landmarks.json` |
| Rules + commands per part | the part's `AGENTS.md` |
| Tasks, owners, acceptance checks, bugs | `heart3d/TASKS.md` (ids T5.1…, bugs B1…) |
| What changed + screenshots + test lines | PR descriptions |
| Decisions, done list, expert-review list, what remains | Claude project doc `claude/heart3d/STATUS.md` (mirror the key lines into the PR when a step closes) |
| Teaching content | `heart3d/src/js/content.js`, `patho-content.js` (→ `heart3d/data/structures.json` from task T7.1) |
| The live site | `index.html` (every lab embedded as base64; no build step on Pages) |

Nothing important may live only in a chat.

## 4. Branches and merging
- Long-running branch for the 3D Heart rework: `heart3d/rework` (draft PR #6 into `site/home-echo`).
- **Codex:** one task = branch `codex/<task-id>` from `heart3d/rework` → PR into `heart3d/rework`.
- **Claude:** content/anatomy work on `claude/<task-id>` → PR into `heart3d/rework` (or commits straight to `heart3d/rework` when Punnatorn asks).
- **Only Punnatorn merges.** Nobody merges into `site/home-echo` or the default branch.
- Commit messages: imperative summary line, then what and why in plain English.

## 5. Definition of done (any agent)
1. The task's acceptance checks are met and added to the part's test (`heart3d/tools/test_heart3d.py`, `echo-sim/tools/test_lab.py`…), not to a one-off script.
2. Tests print 0 failures:
   - always: `test_heart3d.py` and `test_site.py`
   - `test_embed.py` if the site shell changed
   - `validate_data.py` + `test_lab.py` if the phantom changed (Claude)
3. `index.html` re-integrated (`python heart3d/tools/integrate_heart3d.py index.html`) so the site stays deployable.
4. The PR description has:
   - a summary of 5 lines max
   - before/after screenshots
   - the test output lines
   - anything that needs a medical check marked **"For Claude/Punnatorn"**
5. The task line in `TASKS.md` is updated (status, PR number). Nobody edits other tasks.

## 6. The loop
```
Punnatorn picks a task in TASKS.md
   ├─ owner Codex → paste the Codex task prompt → PR with screenshots + tests
   │       └─ needs a medical/anatomy check? → short Claude review → approve / changes
   └─ owner Claude → paste the Claude job prompt → commit/PR + STATUS.md update
Punnatorn tries the preview → merges → ticks TASKS.md → one line in STATUS.md
Step finished → one short Claude "step close": check, STATUS, next step's Claude tasks
```

## 7. Bugs
Punnatorn reports a bug with a screenshot, what he did, what happened and what he expected.
- Log it as `B<n>` in `TASKS.md` (owner C).
- Codex first writes a failing check in the test, then fixes it.
- If the bug is about anatomy or wording, the owner is Claude.

## 8. Saving credit (Claude especially)
- Start each Claude conversation with the short job prompt (§9). It names 2–3 files to read, nothing else.
- One conversation per job (a review, a batch of 10 cards, one spec); end it with the STATUS update. Long chats re-send their history every turn.
- Give the result, not the search: paste the PR link, the exact error or a screenshot.
- Codex runs the tests and makes the screenshots; Claude reads them. The 15-min echo test runs only when the phantom changes.
- Ask for short replies when that's enough ("≤ 10 lines").
- Routine reviews and small fixes: a cheaper Claude model. Anatomy and medical content: the strongest model.
- Don't attach big copies of repo files to the Claude project; the repo is the source (see §10).

## 9. Prompts to paste

**Codex: run a task**
> Repo punchotipurk-victis/Pun-CVS-sage, branch `heart3d/rework`. Read `CLAUDE-CODEX.md` and `heart3d/AGENTS.md`, then do task
> **<T5.1>** from `heart3d/TASKS.md` on branch `codex/<T5.1>`. Follow the definition of done; open a PR into `heart3d/rework`.

**Codex: fix a bug**
> Same repo/branch. Read `CLAUDE-CODEX.md` and `heart3d/AGENTS.md`. Bug **B<n>**: <what I did / what happened / what I expected>
> (screenshot attached). Add it to TASKS.md, write a failing check in `test_heart3d.py`, fix it, open a PR into `heart3d/rework`.

**Claude: review a Codex PR**
> Review PR #<n> (task <id>) in punchotipurk-victis/Pun-CVS-sage. Read only `CLAUDE-CODEX.md`, `heart3d/AGENTS.md`, the PR diff and
> its screenshots. Check anatomy/medical correctness and the rules. Reply in ≤ 10 lines: approve, or what to change.

**Claude: content / anatomy job**
> 3D Heart rework, task <T6.1 | T7.2 batch 1 | T8.1>. Read `claude/heart3d/STATUS.md`, `CLAUDE-CODEX.md` and `heart3d/TASKS.md`
> only, then do the task (skills: cardiology-rotation, refined-heart-model, heart-3d-model as needed). Commit on `claude/<id>` with
> a PR into `heart3d/rework`, update STATUS.md and the task line, and tell me in ≤ 10 lines what changed.

**Claude: step close**
> Step <5> of the 3D Heart rework is merged. Read `claude/heart3d/STATUS.md` and `heart3d/TASKS.md`. Check the merged PRs' summaries,
> update STATUS.md (done, remaining, expert-review list), and list the Claude tasks for the next step. ≤ 15 lines.

## 10. Setting up a new conversation or project
**Codex**
- Connect the GitHub repo `punchotipurk-victis/Pun-CVS-sage` and choose branch `heart3d/rework`. Nothing to upload: it reads `CLAUDE-CODEX.md` and the `AGENTS.md` files from the repo.
- Environment setup command: `pip install playwright numpy && python -m playwright install --with-deps chromium`. Add `scipy scikit-image fast-simplification` only for anatomy exports.

**Claude, same project ("Cardio Super App")**
- Nothing to re-attach. Start with the job prompt (§9). Claude adds the repo itself.

**Claude, new project**
- Project instructions:
  > Cardio Super App (Pun CVS Lab): interactive cardiology learning platform. Repo punchotipurk-victis/Pun-CVS-sage is the source of
  > truth. Read CLAUDE-CODEX.md and the part's AGENTS.md first; Codex does most coding; I (Claude) do anatomy, medical content and
  > reviews. Use the skills cardiology-rotation, refined-heart-model, heart-3d-model, interactive-study-lab.
- Docs to attach (small, current):
  - `claude/heart3d/STATUS.md`
  - `claude/heart3d/CODEX-WORKFLOW.md`
  - this file
  - optionally `claude/heart3d/REWORK-PLAN.md`
- For echo work, add `claude/echo-sim/P2-STATUS.md` and `P3-KICKOFF.md`.
- Optional reference images, only for anatomy or content work: Netter plates, infographics.
- **Do not attach:**
  - copies of repo files (`phantom-normal.json`, `engine/*.js`, `tools/*.py`, `views.json`, `three.min.js`, `heart-conduction-lab.html`, `echo-sim-starter.zip`). They are stale duplicates; the repo is the source.
  - old kickoff docs for finished phases (P1-*, HEART-REFINE-KICKOFF, REWORK-KICKOFF).
