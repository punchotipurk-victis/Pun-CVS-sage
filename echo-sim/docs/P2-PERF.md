# P2 performance measurements

Build: commit `46bf55e` (P2.4), `echo-sim/dist/echo-sim.html?dev=1`, numbers from `ECHO.perf()`.

## Intel Arc 140V (Punnatorn's laptop), 8 Nov 2026
- Browser: Claude desktop app's built-in browser (Chromium 152, ANGLE → Direct3D 11), page served by raw.githack from the pushed commit.
- GPU string: `ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (16GB) Direct3D11 vs_5_0 ps_5_0, D3D11)`.
- Pane 713 × 727 CSS px, so the lab started in its narrow (phone) layout at pixel ratio 1. The device pixel ratio is 2.
- Auto quality started at the phone tier and climbed by itself (`headroom`): medium at 11 s, high at 21 s.
- The display is 60 Hz, so 60 fps is the ceiling.

| Situation | Tier | fps | Frame p50 / p95 (ms) | Echo GPU (ms) | Ideal image (/s) | Labels (/s, ms) |
|---|---|---|---|---|---|---|
| Steady, free scan | high 256×512 | 60 | 16.7 / 16.9 | 5.3 | — | 5.0 · 13 |
| A4C with the ideal image open | high | 60 | 16.7 / 16.9 | 5.1 | 16.7 | 4.9 · 11 |
| After swapping the inset panes | high | 60 | 16.7 / 17.0 | 5.1 | 16.0 | 5.0 · 12 |
| Forced tier | high 256×512 | 60 | — / 16.9 | 5.1 | | · 10.5 |
| Forced tier | medium 192×384 | 60 | — / 16.9 | 2.9 | | · 6.8 |
| Forced tier | low 160×320 | 60 | — / 16.9 | 2.4 | | · 5.6 |
| Forced tier | lowest 128×256 | 60 | — / 16.9 | 1.8 | | · 3.5 |

- "Echo GPU" = the live echo passes only (EXT_disjoint_timer_query_webgl2), not the 3D scene.
- "Labels ms" = CPU time to summarise the async label map; the read-back itself no longer stalls.
- The collapsed-pane counter read 0 because the narrow layout keeps the inset minimised.

**Reading:** High holds 60 fps with about 11 ms of each 16.7 ms frame spare. The echo costs 5 ms; the rest is the 3D scene and the UI. The adaptive ladder never needed to step down.

### Full desktop layout (pane emulated at 1440 × 860, pixel ratio 2)
| Situation | Tier | Pixel ratio | fps | Frame p50 / p95 (ms) | Echo GPU (ms) | Ideal image (/s) | Collapsed thumbnail (/s) | Labels (/s, ms) |
|---|---|---|---|---|---|---|---|---|
| Steady, free scan | high | 2 | 60 | 16.7 / 16.9 | 6.5 | — | 15 | 5 · 4.1 |
| A4C with the ideal image open | high | 2 | 60 | 16.7 / 16.9 | 4.9 | 17 | 15 | 5 · 3.6 |

- It started at High and never stepped down: no history entries.
- All budgets are met: thumbnail 15/s (target 15–20), labels 5 Hz, ideal image ≤20/s.

**Not measured yet:** a phone.

## SwiftShader (CPU, CI container)
- renderOnce: 2.0 ms (P1.5) → 3.5 ms (P2.1) → about 2.4–3.1 ms (P2.4 grids).
- Live page: about 1–1.6 fps.
  - Auto quality falls to lowest within about 1 s.
  - Sync label read-back took about 750 ms per call; async takes about 5 ms.
