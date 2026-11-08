#!/usr/bin/env python3
"""P2 checks (grows with each P2 item). python tools/test_p2.py dist/echo-sim.html [--shots DIR]
   P2.3: image controls (TGC, gain, focus, presets, reset). P2.2: HR-scaled cycle (warp maths in page, live clock slope, ECG/slider note) and persistence (flicker drops, off = raw)."""
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
        check("sys " in note and "% RR" in note, "HR slider shows systole duration", note[note.find("sys "):note.find("sys ")+22] if "sys " in note else note[:80])
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

        print("P2.3 image controls")
        async def shot():
            await pg.evaluate("ECHO.renderOnce()"); bb = await pg.locator("#echoLive").bounding_box()
            return Image.open(io.BytesIO(await pg.screenshot(clip=bb, timeout=60000))).convert("L")
        def band(im, a, b):   # mean brightness of the fan between depth fractions a..b (centre column strip)
            w, h = im.size; return ImageStat.Stat(im.crop((int(w*.2), int(h*a), int(w*.8), int(h*b)))).mean[0]   # the 90° fan fills the top ~62% of the pane
        await pg.evaluate("ECHO.pauseLoop(true); ECHO.freeze(true); ECHO.goToView('psax_pap', true); ECHO.setPhase(0); APP.resetImage()")
        st = await pg.evaluate("({...APP.img, tgcDb: [...APP.img.tgcDb], uFocus: APP.eng.uniforms.uFocus.value, sl: [...document.querySelectorAll('#imageSliders .sl-l')].map(e => e.textContent), tgcN: document.querySelectorAll('#tgcBox input').length, reset: !!document.getElementById('imgReset')})")
        check("Focus" in st["sl"] and st["tgcN"] == 6 and st["reset"], "Focus slider, 6 TGC sliders and Reset image present", str(st["sl"]))
        check(st["focusCm"] == 6.5 and abs(st["uFocus"] - 6.5/14) < 1e-3, "PSAX-PM preset: focus 6.5 cm reaches the engine", f"(focus {st['focusCm']}, uFocus {st['uFocus']:.3f})")
        base = await shot()
        await pg.evaluate("APP.setImg({ tgcDb: [0, 0, 0, 0, 10, 10] })"); far = await shot()
        dn, df = band(far, .06, .2) - band(base, .06, .2), band(far, .44, .58) - band(base, .44, .58)
        check(df > 6 and abs(dn) < 2.5, "far TGC +10 dB brightens the far field only", f"(near Δ{dn:+.1f}, far Δ{df:+.1f} grey levels)")
        await pg.evaluate("APP.setImg({ tgcDb: [0, 0, 0, 0, 0, 0], gainDb: 8 })"); gn = await shot()
        check(band(gn, .06, .2) > band(base, .06, .2) + 3 and band(gn, .44, .58) > band(base, .44, .58) + 3, "gain +8 dB brightens near and far")
        await pg.evaluate("APP.setImg({ gainDb: 0, focusCm: 12 })"); fo = await shot()
        d = ImageStat.Stat(ImageChops.difference(fo, base)).mean[0]
        check(d > 0.3, "moving the focus changes the image (beam width / focal gain)", f"(mean |Δ| {d:.2f})")
        q = await pg.evaluate("() => { APP.setImg({ gainDb: 15, tgcDb: [-12, -12, 12, 12, 12, 12] }); ECHO.renderOnce(); return ECHO.quality('psax_pap').quality; }")
        check(q >= 80, "scoring is independent of gain/TGC (reads the tissue map)", f"({q:.0f})")
        g = await pg.evaluate("() => { APP.setImg({ gainDb: 5, tgcDb: [0,0,0,0,0,0] }); ECHO.goToView('a4c', true); return { ...APP.img }; }")
        check(g["depthCm"] == 18 and g["focusCm"] == 12.5 and g["gainDb"] == 5, "go-to-view applies depth/sector/focus and keeps the learner's gain", f"(depth {g['depthCm']}, focus {g['focusCm']}, gain {g['gainDb']})")
        r = await pg.evaluate("() => { APP.setImg({ tgcDb: [3,3,3,3,3,3], drDb: 40, persistence: .8 }); APP.resetImage(); return { ...APP.img }; }")
        check(r["gainDb"] == 0 and r["tgcDb"] == [0]*6 and r["drDb"] == 55 and abs(r["persistence"] - 0.3) < 1e-9 and r["focusCm"] == 12.5, "Reset image restores the view preset", str({k: r[k] for k in ("gainDb", "tgcDb", "drDb", "persistence", "focusCm")}))
        if A.shots:
            await pg.evaluate("APP.setImg({ tgcDb: [-6, -3, 0, 3, 6, 6], focusCm: 9 })"); (await shot()).save(os.path.join(A.shots, "tgc_focus.png"))
            await pg.click('[data-tab="imageTab"]'); await pg.wait_for_timeout(300); await pg.evaluate("ECHO.renderOnce()")
            await pg.screenshot(clip=await pg.locator("#imageTab").bounding_box(), path=os.path.join(A.shots, "image_panel.png"), timeout=60000)
            await pg.evaluate("APP.resetImage()")
        await pg.evaluate("ECHO.pauseLoop(false)")

        print("P2.4 performance")
        await pg.evaluate("ECHO.setQuality('auto')"); await pg.wait_for_timeout(9000)
        st = await pg.evaluate("ECHO.perf()")
        print("     ", {k: st[k] for k in ("gpu", "tier", "lines", "samples", "pixelRatio", "fps", "frameMsP50", "echoGpuMs", "refFps", "insetSmallFps", "readHz", "readMs")}, st["history"][:4])
        check(all(k in st for k in ("fps", "frameMsP50", "frameMsP95", "tier", "gpu", "readHz", "insetSmallFps", "refFps")), "ECHO.perf() reports fps, frame times, tier, GPU and budgets")
        check(st["readHz"] <= 5.5, "label read-back ≤ 5 Hz (readPixels pitfall)", f"({st['readHz']}/s)")
        check(st["insetSmallFps"] <= 20.5, "collapsed inset pane ≤ 20 fps", f"({st['insetSmallFps']}/s)")
        check(st["refFps"] <= 20.5, "ideal image ≤ 20 fps", f"({st['refFps']}/s)")
        check(len(st["history"]) >= 1, "slow renderer → adaptive quality steps down", str(st["history"][:3]))
        res = await pg.evaluate("""() => { ECHO.setQuality('lowest'); const out = { NL: ECHO.NL, q: {} }; ECHO.setPosition('supine');
            for (const v of ECHO.views){ ECHO.goToView(v, true); out.q[v] = Math.round(ECHO.quality(v).quality); } return out; }""")
        check(res["NL"] == 128 and all(q >= 80 for q in res["q"].values()), "every supine view still ≥80 at the lowest tier (128×256)", str(res))
        hi = await pg.evaluate("() => { ECHO.setQuality('high'); return [ECHO.NL, ECHO.perf().samples]; }")
        check(hi == [256, 512], "manual tier back to High (256×512) without a shader rebuild", str(hi))
        p2 = await ctx.new_page(); e3 = []; p2.on("pageerror", lambda e: e3.append(str(e)))
        await p2.goto("file://" + os.path.abspath(A.lab) + "?dev=1&quality=medium"); await p2.wait_for_function("window.ECHO && ECHO.ready", timeout=300000)
        await p2.wait_for_function("(document.getElementById('perfHud') || {}).textContent", timeout=60000)   # first 1-s window (slow under SwiftShader)
        hud = await p2.evaluate("(document.getElementById('perfHud') || {}).textContent || ''"); st2 = await p2.evaluate("ECHO.perf()")
        check("fps" in hud and "echo medium 192×384" in hud and not st2["auto"], "?dev=1 shows the fps overlay; ?quality=medium fixes the tier", hud.replace("\n", " | ")[:140])
        if A.shots: await p2.screenshot(clip=await p2.locator("#echoLive").bounding_box(), path=os.path.join(A.shots, "dev_overlay.png"), timeout=120000)
        check(not e3, "dev page: no errors", "; ".join(e3[:2])); await p2.close()
        check(not errs, "no page or shader errors", "; ".join(errs[:3]))
        await b.close()
    print(f"\n{len(fails)} failure(s)"); sys.exit(1 if fails else 0)

asyncio.run(main())
