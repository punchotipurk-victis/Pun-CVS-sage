#!/usr/bin/env python3
"""P2 checks (grows with each P2 item). python tools/test_p2.py dist/echo-sim.html [--shots DIR]
   P2.2: HR-scaled cycle (warp maths in page, live clock slope, ECG/slider note) and persistence (flicker drops, off = raw)."""
import asyncio, sys, os, argparse, io
from playwright.async_api import async_playwright
from PIL import Image, ImageChops, ImageStat

ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
ap = argparse.ArgumentParser(); ap.add_argument("lab"); ap.add_argument("--shots", default=None); A = ap.parse_args()
fails = []
def check(ok, msg, extra=""):
    print(("  ok   " if ok else "  FAIL ") + msg, extra)
    if not ok: fails.append(msg)

async def flicker(pg, n=4):
    """mean absolute difference between consecutive live echo frames, heart beating, stepped at 50 fps"""
    ims = []
    await pg.evaluate("ECHO.freeze(false); ECHO.pauseLoop(true); ECHO.setPhase(0.5); for (let i = 0; i < 30; i++) ECHO.stepLive(1/50)")   # settle the history
    for _ in range(n):
        await pg.evaluate("ECHO.stepLive(1/50)")
        bb = await pg.locator("#echoLive").bounding_box()
        ims.append(Image.open(io.BytesIO(await pg.screenshot(clip=bb, timeout=60000))).convert("L"))
    d = [ImageStat.Stat(ImageChops.difference(a, b)).mean[0] for a, b in zip(ims, ims[1:])]
    await pg.evaluate("ECHO.pauseLoop(false); ECHO.freeze(true)")
    return sum(d)/len(d), ims[-1]

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); ctx = await b.new_context(viewport={"width": 1440, "height": 860}); pg = await ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        await pg.goto("file://" + os.path.abspath(A.lab)); await pg.wait_for_function("window.ECHO && ECHO.ready", timeout=300000)
        await pg.evaluate("ECHO.setLandmarks(false); ECHO.goToView('a4c', true); document.getElementById('refPane').hidden = true")

        print("P2.2 heart-rate scaling")
        W = await pg.evaluate("""() => [40, 70, 100, 140].map(hr => { APP.hr = hr; const w = APP.warp();
            return { hr, rr: w.rrMs, sys: w.systoleMs, es: w.fromT(PHANTOM_ES()), rt: Math.max(...[0, .1, .3, .47, .6, .9].map(t => Math.abs(w.toT(w.fromT(t)) - t))) }; })"""
            .replace("PHANTOM_ES()", "APP.ph.cycle.markers.ES"))
        for w in W: print("     ", {k: round(v, 3) for k, v in w.items()})
        check(all(w["rt"] < 1e-9 for w in W), "warp round-trips (toT∘fromT = identity)")
        check(abs(W[1]["es"] - 0.38) < 1e-6 and abs(W[1]["sys"] - 0.47*W[1]["rr"]) < 2, "70 bpm is the canonical cycle (ES at 0.38 of RR)")
        sysms = [w["sys"] for w in W]; dias = [w["rr"] - w["sys"] for w in W]
        check(sysms[0] > sysms[-1] and (dias[0] - dias[-1]) > 3*(sysms[0] - sysms[-1]), "faster HR shortens diastole much more than systole",
              f"sys {sysms[0]:.0f}→{sysms[-1]:.0f} ms, dias {dias[0]:.0f}→{dias[-1]:.0f} ms")
        check(all(300 <= s <= 420 for s in sysms), "systole clamped to 300–420 ms")
        # live clock: beat fraction u advances at HR/60 per second regardless of the warp
        for hr in (70, 130):
            await pg.evaluate(f"APP.hr = {hr}; ECHO.freeze(false)")
            S = await pg.evaluate("""() => new Promise(res => { const out = []; const t0 = performance.now();
                (function f(){ out.push([APP.time, APP.warp().fromT(APP.phase)]); if (performance.now() - t0 < 6000) requestAnimationFrame(f); else res(out); })(); })""")
            rate = []
            for (ta, ua), (tb, ub) in zip(S, S[1:]):
                du = (ub - ua) % 1.0
                if tb - ta > 0.005 and du < 0.5: rate.append(du/(tb - ta))
            r = sorted(rate)[len(rate)//2] if rate else 0
            check(abs(r - hr/60) < 0.15*hr/60, f"live beat clock runs at HR/60 at {hr} bpm", f"(median {r:.2f}/s vs {hr/60:.2f}/s, {len(S)} samples)")
        await pg.evaluate("ECHO.freeze(true); APP.hr = 70")
        note = await pg.evaluate("""() => { APP.hr = 120; APP.markDirty && APP.markDirty(); return new Promise(r => setTimeout(() => r(document.querySelector('#imageSliders').textContent), 400)); }""")
        check("systole" in note and "% of RR" in note, "HR slider shows systole duration", note[note.find("systole"):note.find("systole")+34] if "systole" in note else note[:80])
        await pg.evaluate("APP.hr = 70; APP.markDirty && APP.markDirty()")

        print("P2.2 persistence")
        await pg.evaluate("APP.setImg({ persistence: 0 })"); f0, im0 = await flicker(pg)
        await pg.evaluate("APP.setImg({ persistence: 0.7 })"); f7, im7 = await flicker(pg)
        check(f7 < 0.75*f0, "persistence 0.7 reduces frame-to-frame speckle flicker", f"(mean |Δ| {f0:.2f} → {f7:.2f})")
        m0, m7 = ImageStat.Stat(im0).mean[0], ImageStat.Stat(im7).mean[0]
        check(abs(m7 - m0) < 0.12*m0 + 1.5, "persistence keeps overall brightness", f"({m0:.1f} vs {m7:.1f})")
        sl = await pg.evaluate("[...document.querySelectorAll('#imageSliders .sl-l')].map(e => e.textContent)")
        check("Persistence" in sl, "Persistence slider present", str(sl))
        q = await pg.evaluate("() => { ECHO.setPhase(0); ECHO.renderOnce(); return ECHO.quality('a4c').quality; }")
        check(q >= 80, "A4C quality still ≥80 with persistence on", f"({q:.0f})")
        if A.shots:
            os.makedirs(A.shots, exist_ok=True); im0.save(os.path.join(A.shots, "persist_0.png")); im7.save(os.path.join(A.shots, "persist_07.png"))
            await pg.evaluate("APP.hr = 130; APP.markDirty && APP.markDirty()"); await pg.wait_for_timeout(500)
            await pg.screenshot(clip=await pg.locator("#ecg").bounding_box(), path=os.path.join(A.shots, "ecg_130.png"), timeout=60000)
            await pg.evaluate("APP.hr = 70; APP.markDirty && APP.markDirty()"); await pg.wait_for_timeout(500)
            await pg.screenshot(clip=await pg.locator("#ecg").bounding_box(), path=os.path.join(A.shots, "ecg_70.png"), timeout=60000)
        await pg.evaluate("APP.setImg({ persistence: APP.ph.imaging_defaults.persistence })")
        check(not errs, "no page or shader errors", "; ".join(errs[:3]))
        await b.close()
    print(f"\n{len(fails)} failure(s)"); sys.exit(1 if fails else 0)

asyncio.run(main())
