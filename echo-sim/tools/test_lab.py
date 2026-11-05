#!/usr/bin/env python3
"""Headless acceptance test for dist/echo-sim.html (P1). Exit 1 on any failure.
   python tools/test_lab.py dist/echo-sim.html [--shots DIR]"""
import asyncio, sys, os, argparse
from playwright.async_api import async_playwright
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
ap = argparse.ArgumentParser(); ap.add_argument("lab"); ap.add_argument("--shots", default=None); A = ap.parse_args()
fails = []
def check(ok, msg):
    print(("  ok   " if ok else "  FAIL ") + msg)
    if not ok: fails.append(msg)

async def open_page(b, w, h, **kw):
    ctx = await b.new_context(viewport={"width": w, "height": h}, **kw); pg = await ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    await pg.goto("file://" + os.path.abspath(A.lab))
    await pg.wait_for_function("window.ECHO && ECHO.ready", timeout=180000)
    return pg, errs

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg, errs = await open_page(b, 1440, 860)
        info = await pg.evaluate("ECHO.info"); print("heart mesh", info); check(info["tris"] > 5000, "heart mesh baked from the phantom")
        async def shot(name, page=None):
            if A.shots: await (page or pg).screenshot(path=os.path.join(A.shots, name + ".png"))
        await pg.evaluate("ECHO.freeze(true)")
        for pos in ([] if os.environ.get("SKIP_VIEWS") else ["supine", "LLD"]):
            await pg.evaluate(f"ECHO.setPosition('{pos}')")
            for conv in (["ASE", "POCUS"] if pos == "supine" else ["ASE"]):
                await pg.evaluate(f"ECHO.setConvention('{conv}')")
                rows = await pg.evaluate("""() => ECHO.views.map(id => { ECHO.snap(id); ECHO.setPhase(0); ECHO.renderOnce();
                    const q = ECHO.quality(id), ed = q.atED, t = ECHO.target(id);
                    const off = d => { ECHO.setPose({notchDeg: t.notchDeg + d}); ECHO.renderOnce(); return ECHO.quality(id).quality };
                    const a = off(25), c = off(-25);
                    return {id, q: q.quality, ed: ed.quality, fails: q.fails, edFails: ed.fails, a, c, phase: q.phase}; })""")
                for r in rows:
                    print(f"     {pos:6} {conv:5} {r['id']:14} Q {r['q']:5.1f} (ED {r['ed']:5.1f}) off25 {r['a']:4.1f}/{r['c']:4.1f}  {','.join(r['fails'])}")
                    check(r["q"] >= 80, f"{pos} {conv} {r['id']} target >= 80 over a beat")
                    check(r["a"] < 60 and r["c"] < 60, f"{pos} {conv} {r['id']} 25 deg off < 60")
        await pg.evaluate("ECHO.setConvention('ASE'); ECHO.setPosition('supine')")

        # tissue line + ASE orientation
        line = await pg.evaluate("ECHO.snap('plax'); ECHO.setPhase(0); ECHO.renderOnce(); ECHO.tissueLine(ECHO.NL>>1)"); print("     PLAX line:", line)
        L = await pg.evaluate("ECHO.renderOnce(); ECHO.labels()")
        check(L["aortic_root"]["cx"] > L["LV_cavity"]["cx"], "PLAX: aorta on the notch side (screen right in ASE)")
        L = await pg.evaluate("ECHO.snap('a4c'); ECHO.renderOnce(); ECHO.labels()")
        check(L["LV_cavity"]["cx"] > L["RV_cavity"]["cx"], "A4C: LV on the notch side (screen right in ASE)")

        # round-trip
        rt = await pg.evaluate("""() => { const P = ECHO.pose(), f = PROBE.frame(P), a = PROBE.anglesFrom(P.x, P.y, f.beam, f.lateral);
            return Math.max(Math.abs(((a.notchDeg-P.notchDeg+540)%360)-180), Math.abs(a.tiltDeg-P.tiltDeg), Math.abs(a.rockDeg-P.rockDeg)); }""")
        check(rt < 1e-6, f"pose round-trips ({rt:.1e})")

        # interaction on the real page (unfrozen rAF loop running)
        await pg.evaluate("ECHO.freeze(false); ECHO.snap('plax')"); await pg.wait_for_timeout(400)
        before = await pg.evaluate("ECHO.pose()")
        sc = await pg.evaluate("""() => { const b = document.getElementById('stage').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }""")
        probe = await pg.evaluate("ECHO.probeScreen()")
        await pg.mouse.move(*probe); await pg.mouse.down(); await pg.mouse.move(probe[0] + 40, probe[1] + 30, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(100)
        after = await pg.evaluate("ECHO.pose()"); check(after["x"] > before["x"] + .5 and after["y"] < before["y"] - .5, f"drag slides the probe ({before['x']:.1f},{before['y']:.1f} -> {after['x']:.1f},{after['y']:.1f})")
        n0 = after["notchDeg"]; await pg.mouse.move(*probe); await pg.mouse.wheel(0, 100); await pg.wait_for_timeout(60)
        n1 = await pg.evaluate("ECHO.pose().notchDeg"); check(n1 != n0, "wheel rotates the probe")
        t0 = await pg.evaluate("ECHO.pose()"); await pg.keyboard.down("Shift"); await pg.mouse.move(sc[0] + sc[2]*.8, sc[1] + sc[3]*.5); await pg.mouse.down(); await pg.mouse.move(sc[0] + sc[2]*.8 + 30, sc[1] + sc[3]*.5 - 20, steps=4); await pg.mouse.up(); await pg.keyboard.up("Shift")
        t1 = await pg.evaluate("ECHO.pose()"); check(t1["tiltDeg"] > t0["tiltDeg"] and t1["rockDeg"] > t0["rockDeg"], "Shift+drag tilts and rocks")
        q0 = await pg.evaluate("ECHO.pose().notchDeg"); await pg.locator("#padKeys button").nth(1).click(); q1 = await pg.evaluate("ECHO.pose().notchDeg"); check(q1 > q0, "pad rotates the probe")
        await pg.fill("#probeSliders input[aria-label='Tilt']", "12"); check(abs(await pg.evaluate("ECHO.pose().tiltDeg") - 12) < .01, "slider sets tilt")
        await pg.evaluate("document.activeElement.blur()")

        # chip at the target, live
        await pg.evaluate("ECHO.snap('plax')"); await pg.wait_for_timeout(1800)
        chip = await pg.evaluate("ECHO.chip()"); check(chip.startswith("PLAX"), f"view chip follows the probe ({chip})")
        await pg.evaluate("ECHO.setPose({x: -12, y: -3, notchDeg: 170, tiltDeg: 60, rockDeg: 40})"); await pg.wait_for_timeout(1500)
        chip = await pg.evaluate("ECHO.chip()"); check(chip == "Searching…", f"far off every view -> Searching ({chip})")

        # body view, swap, positions
        await pg.evaluate("ECHO.snap('plax')"); await pg.wait_for_timeout(500); await shot("01-skin")
        await pg.click("#bodyBtn"); check(await pg.evaluate("ECHO.body()") == "ghost", "Body button -> Ghost"); await pg.wait_for_timeout(300); await shot("02-ghost")
        await pg.click("#bodyBtn"); check(await pg.evaluate("ECHO.body()") == "skeleton", "Body button -> Skeleton"); await pg.wait_for_timeout(300); await shot("03-skeleton")
        big = await pg.evaluate("ECHO.inset.big"); await pg.click(".pane.small", position={"x": 20, "y": 30}); await pg.wait_for_timeout(450)
        check(await pg.evaluate("ECHO.inset.big") != big, "tapping the small pane swaps"); await shot("04-torso-map")
        await pg.click(".pane.small", position={"x": 20, "y": 30}); await pg.wait_for_timeout(450)
        h0 = await pg.evaluate("ECHO.heartMatrix()"); await pg.click("#posLLD"); await pg.wait_for_timeout(1200)
        h1 = await pg.evaluate("ECHO.heartMatrix()"); check(h0 != h1, "LLD moves the heart")
        await pg.wait_for_function("Math.abs(ECHO.roll() - 40*Math.PI/180) < .02", timeout=90000); check(True, "LLD rolls the body 40 deg")
        await pg.evaluate("ECHO.snap('a4c')"); await pg.wait_for_timeout(500); await shot("05-lld-a4c")
        zl = await pg.evaluate("ECHO.zoneCentre('apical')"); await pg.click("#posSup"); await pg.wait_for_timeout(800); zs = await pg.evaluate("ECHO.zoneCentre('apical')")
        check(abs(zl[0] - zs[0] - 1.6) < .3 and 8 < zs[0] < 12, f"apical zone stays on the skin and shifts with the heart ({zs[0]:.1f} -> {zl[0]:.1f})")
        await pg.click("#insetMin"); await pg.wait_for_timeout(300); await pg.evaluate("ECHO.snap('psax_pap')"); await pg.wait_for_timeout(300); await shot("06-minimised"); await pg.click("#insetMin"); await pg.wait_for_timeout(300)
        await pg.click("#edBtn"); ph0 = await pg.evaluate("APP.phase"); check(ph0 == 0, "ED jumps to end-diastole and freezes"); await pg.wait_for_timeout(200); check(await pg.evaluate("APP.phase") == 0, "Freeze holds the phase")
        await pg.click("#esBtn"); await pg.wait_for_timeout(100); await shot("07-es-psax"); await pg.click("#freeze")
        await pg.click("#convPOCUS"); await pg.wait_for_timeout(200); await pg.click("#convASE")
        await pg.evaluate("document.documentElement.setAttribute('data-theme','dark')"); await pg.wait_for_timeout(300); await shot("08-dark"); await pg.evaluate("document.documentElement.removeAttribute('data-theme')")
        check(not await pg.evaluate("ECHO.shaderErr()"), "all shaders compile")
        check(not errs, "no page or console errors: " + "; ".join(errs[:4]))

        # phone
        ph, e2 = await open_page(b, 400, 800, has_touch=True, is_mobile=True, device_scale_factor=2)
        sw = await ph.evaluate("[document.documentElement.scrollWidth, innerWidth]"); check(sw[0] <= sw[1], f"400 px: no sideways scroll {sw}")
        await ph.wait_for_timeout(600); await shot("09-phone-top", ph)
        await ph.evaluate("window.scrollTo(0, 620)"); await ph.wait_for_timeout(500); await shot("10-phone-scrolled", ph)
        await ph.evaluate("window.scrollTo(0, 0)"); await ph.wait_for_timeout(200)
        # one-finger slide and two-finger twist, dispatched as real touch input
        cdp = await ph.context.new_cdp_session(ph)
        async def touch(kind, pts): await cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})
        await ph.evaluate("document.getElementById('stage').scrollIntoView({block:'center'})"); await ph.wait_for_timeout(300)
        pr = await ph.evaluate("ECHO.probeScreen()"); a0 = await ph.evaluate("ECHO.pose()")
        await touch("touchStart", [pr])
        for i in range(1, 6): await touch("touchMove", [[pr[0] + 6*i, pr[1] + 4*i]])
        await touch("touchEnd", []); a1 = await ph.evaluate("ECHO.pose()"); check(a1["x"] != a0["x"], f"touch: one finger slides ({a0['x']:.1f} -> {a1['x']:.1f})")
        bx = await ph.evaluate("(()=>{const b=document.getElementById('stage').getBoundingClientRect();return [b.left+b.width/2,b.top+b.height*.7]})()")
        await touch("touchStart", [[bx[0]-40, bx[1]], [bx[0]+40, bx[1]]]); import math
        for i in range(1, 9):
            f = i*.09; await touch("touchMove", [[bx[0]-40*math.cos(f), bx[1]-40*math.sin(f)], [bx[0]+40*math.cos(f), bx[1]+40*math.sin(f)]])
        await touch("touchEnd", []); a2 = await ph.evaluate("ECHO.pose()"); check(a2["notchDeg"] > a1["notchDeg"], f"touch: two-finger twist rotates ({a1['notchDeg']:.0f} -> {a2['notchDeg']:.0f})")
        check(not e2, "phone: no errors: " + "; ".join(e2[:3]))
        await b.close()
    print("\n%d failure(s)" % len(fails))
    for f in fails: print("  -", f)
    sys.exit(1 if fails else 0)
asyncio.run(main())
