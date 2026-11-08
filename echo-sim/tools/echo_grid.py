#!/usr/bin/env python3
"""P2 before/after echo grid: 8 views x (supine, LLD) at end-diastole, frozen, ASE, labels off.
   Writes OUT/grid.png (2 rows x 8), OUT/<pos>_<view>.png, OUT/scores.json (quality, fails) and echo timing.
   python tools/echo_grid.py dist/echo-sim.html OUTDIR [--title "before"] [--dpr 1]"""
import asyncio, sys, os, json, argparse
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw, ImageFont

ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
ap = argparse.ArgumentParser(); ap.add_argument("lab"); ap.add_argument("out"); ap.add_argument("--title", default="")
ap.add_argument("--dpr", type=float, default=1.0); ap.add_argument("--phase", type=float, default=0.0); ap.add_argument("--fast", action="store_true"); ap.add_argument("--js", default="")
A = ap.parse_args(); os.makedirs(A.out, exist_ok=True)
QF = "({quality: -1, fails: []})"
NAMES = {"plax": "PLAX", "psax_av": "PSAX-AV", "psax_mv": "PSAX-MV", "psax_pap": "PSAX-PM", "a4c": "A4C", "a5c": "A5C",
         "subxiphoid_4c": "S4C", "ivc": "IVC"}

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={"width": 1440, "height": 860}, device_scale_factor=A.dpr); pg = await ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        await pg.goto("file://" + os.path.abspath(A.lab)); await pg.wait_for_function("window.ECHO && ECHO.ready", timeout=300000)
        await pg.evaluate("ECHO.freeze(true); ECHO.setLandmarks(false)")
        res = {"views": {}, "errors": errs}
        views = await pg.evaluate("ECHO.views"); tiles = {}
        for pos in ["supine", "LLD"]:
            await pg.evaluate(f"ECHO.setPosition('{pos}')")
            for v in views:
                r = await pg.evaluate(f"""() => {{ ECHO.goToView('{v}', true); ECHO.snap('{v}'); ECHO.setPhase({A.phase}); ECHO.renderOnce();
                    const q = {QF if A.fast else "ECHO.quality('" + v + "')"}; ECHO.setPhase({A.phase}); {A.js}; ECHO.renderOnce(); document.getElementById('refPane').hidden = true; return {{q: Math.round(q.quality), fails: q.fails}}; }}""")
                res["views"][f"{pos}/{v}"] = r
                f = os.path.join(A.out, f"{pos}_{v}.png"); await pg.locator("#echoLive").screenshot(path=f); tiles[(pos, v)] = f
        await pg.evaluate("ECHO.setPosition('supine'); ECHO.goToView('a4c', true)")
        res["renderOnceMs_swiftshader"] = round(await pg.evaluate(
            "() => { ECHO.renderOnce(); const t0 = performance.now(); for (let i = 0; i < 15; i++) ECHO.renderOnce(); return (performance.now()-t0)/15; }"), 1)
        res["NL"] = await pg.evaluate("ECHO.NL"); res["info"] = await pg.evaluate("ECHO.engineInfo ? ECHO.engineInfo() : null")
        await b.close()
    json.dump(res, open(os.path.join(A.out, "scores.json"), "w"), indent=1)
    # grid
    ims = {k: Image.open(f).convert("RGB") for k, f in tiles.items()}
    w0, h0 = next(iter(ims.values())).size; tw = 360; th = int(h0*tw/w0); pad = 28; top = 34
    G = Image.new("RGB", (len(views)*tw, top + 2*(th+pad)), (18, 18, 20)); d = ImageDraw.Draw(G)
    try: F = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 15)
    except Exception: F = ImageFont.load_default()
    d.text((8, 8), f"{A.title}   echo frame (renderOnce) {res['renderOnceMs_swiftshader']} ms SwiftShader", fill=(240, 240, 240), font=F)
    for ri, pos in enumerate(["supine", "LLD"]):
        for ci, v in enumerate(views):
            x, y = ci*tw, top + ri*(th+pad)
            G.paste(ims[(pos, v)].resize((tw, th), Image.LANCZOS), (x, y + pad))
            q = res["views"][f"{pos}/{v}"]["q"]
            d.text((x+6, y+6), f"{pos} {NAMES.get(v, v)}  {q}", fill=(120, 230, 160) if q >= 80 else (250, 120, 110), font=F)
    G.save(os.path.join(A.out, "grid.png"))
    print(json.dumps({k: (v["q"], v["fails"]) for k, v in res["views"].items()}), res["renderOnceMs_swiftshader"], errs[:5])

asyncio.run(main())
