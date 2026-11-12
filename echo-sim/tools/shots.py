#!/usr/bin/env python3
"""Before/after capture: 8 echo views (supine ASE, ED, frozen) + 4 heart angles + scores + bake/render timing.
   python shots.py LAB.html OUTDIR"""
import asyncio, sys, os, json, base64
from playwright.async_api import async_playwright
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
lab, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); ctx = await b.new_context(viewport={"width": 1440, "height": 860}); pg = await ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + os.path.abspath(lab)); await pg.wait_for_function("window.ECHO && ECHO.ready", timeout=240000)
        res = {"info": await pg.evaluate("ECHO.info"), "views": {}}
        await pg.evaluate("ECHO.freeze(true); ECHO.setLandmarks(false)")
        for pos in ([] if os.environ.get("HEART_ONLY") else ["supine", "LLD"]):
            await pg.evaluate(f"ECHO.setPosition('{pos}')")
            for v in await pg.evaluate("ECHO.views"):
                r = await pg.evaluate(f"""() => {{ ECHO.goToView('{v}', true); ECHO.snap('{v}'); ECHO.setPhase(0); ECHO.renderOnce(); const q = ECHO.quality('{v}');
                    return {{q: q.quality, ed: q.atED.quality, fails: q.fails, line: ECHO.tissueLine(ECHO.NL>>1)}}; }}""")
                res["views"][f"{pos}/{v}"] = r
                if pos == "supine":
                    await pg.evaluate("ECHO.renderOnce()"); await pg.locator("#echoLive").screenshot(path=os.path.join(out, f"echo_{v}.png"))
        await pg.evaluate("ECHO.setPosition('supine')")
        t = await pg.evaluate("() => { ECHO.goToView('a4c', true); const t0 = performance.now(); for (let i = 0; i < 20; i++) ECHO.renderOnce(); return (performance.now() - t0)/20; }")
        res["renderOnceMs_swiftshader"] = round(t, 1)
        CUST = {"right": None, "ra_open": "{n:[1,0,0], at:'RA_center', offset:-1.0, zoom:1.7}", "la_open": "{n:[0,0,1], at:'LA_center', offset:-1.3, zoom:1.7}"}
        for w in ["front", "back", "left", "right", "frontal", "cut", "ra_open", "la_open", "cut_plax", "cut_psax_av", "cut_psax_pap"]:
            v = {"cut": "a4c", "cut_plax": "plax", "cut_psax_av": "psax_av", "cut_psax_pap": "psax_pap"}.get(w)
            if v: await pg.evaluate(f"ECHO.goToView('{v}', true); ECHO.setPhase(0); ECHO.renderOnce()")
            arg = CUST.get(w) or f"'{'cut' if v else w}'"
            d = await pg.evaluate(f"ECHO.heartShot({arg})"); open(os.path.join(out, f"heart_{w}.png"), "wb").write(base64.b64decode(d.split(",")[1]))
        res["errors"] = errs
        if not os.environ.get("HEART_ONLY"): json.dump(res, open(os.path.join(out, "scores.json"), "w"), indent=1)
        print(json.dumps({k: (round(v["q"]), round(v["ed"]), v["fails"]) for k, v in res["views"].items()}, indent=0)); print(res["info"], res["renderOnceMs_swiftshader"], errs)
        await b.close()
asyncio.run(main())
