import asyncio, os, sys, base64, io, json
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
async def m():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--enable-unsafe-swiftshader"]); pg = await (await b.new_context(viewport={"width": 700, "height": 700})).new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + os.path.abspath(sys.argv[1])); await pg.wait_for_function("window.PV", timeout=120000)
        tiles = []; picks = []
        for mode, title in [("real", "Real colours (wall class) + tappable vessels"), ("aha", "AHA 17 segments (per vertex)"), ("territory", "Territory: standard AHA map"), ("territoryModel", "Territory: this model's tree")]:
            for yaw, pitch, nm in [(0.2, 0.1, "front"), (-1.6, 0.0, "left"), (3.1, -0.5, "inferior/back")]:
                await pg.evaluate(f"PV.H.colourBy('{mode}'); PV.view({yaw},{pitch}); PV.draw()")
                d = await pg.evaluate("document.getElementById('c').toDataURL()"); im = Image.open(io.BytesIO(base64.b64decode(d.split(',')[1]))).convert('RGB').resize((340, 300))
                ImageDraw.Draw(im).text((5, 5), f"{title} — {nm}", fill=(255, 255, 255)); tiles.append(im)
        # clot demo: proximal LAD occlusion at 30 %
        await pg.evaluate("PV.H.colourBy('real'); PV.mark(PV.H.infarctDownstream('LAD', 0.3), [0.95, 0.75, 0.2]); PV.view(0.2, 0.1); PV.draw()")
        d = await pg.evaluate("document.getElementById('c').toDataURL()"); im = Image.open(io.BytesIO(base64.b64decode(d.split(',')[1]))).convert('RGB').resize((340, 300)); ImageDraw.Draw(im).text((5, 5), "infarctDownstream('LAD', 0.3) — front", fill=(255, 255, 255)); tiles.append(im)
        await pg.evaluate("PV.H.colourBy('real'); PV.mark(PV.H.infarctDownstream('RCA', 0.0), [0.95, 0.75, 0.2]); PV.view(3.1, -0.5); PV.draw()")
        d = await pg.evaluate("document.getElementById('c').toDataURL()"); im = Image.open(io.BytesIO(base64.b64decode(d.split(',')[1]))).convert('RGB').resize((340, 300)); ImageDraw.Draw(im).text((5, 5), "infarctDownstream('RCA', 0) — inferior", fill=(255, 255, 255)); tiles.append(im)
        await pg.evaluate("PV.H.colourBy('real'); PV.view(0.2, 0.1); PV.draw()")
        for x, y in [(0.1, -0.1), (0.25, 0.05), (-0.25, 0.1), (0.0, 0.25), (0.15, -0.35)]: picks.append(await pg.evaluate(f"PV.pickAt({x},{y})"))
        G = Image.new('RGB', (340*3, 300*5), (17, 20, 22))
        for i, t in enumerate(tiles): G.paste(t, ((i % 3)*340, (i//3)*300))
        G.save(sys.argv[2]); print(json.dumps(picks, indent=0)[:1500]); print("errors", errs); await b.close()
asyncio.run(m())
