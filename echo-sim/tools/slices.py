#!/usr/bin/env python3
"""python slices.py PAGE.html OUT.png [views] : 8 views (supine) echo + tissue tint, with quality."""
import asyncio, sys, os, base64, io, json
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
page, out = sys.argv[1], sys.argv[2]; views = sys.argv[3].split(",") if len(sys.argv) > 3 else None
pos = os.environ.get("POS", "supine"); t = float(os.environ.get("T", "0"))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); pg = await b.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + os.path.abspath(page)); await pg.wait_for_function("window.SL && SL.ready", timeout=120000)
        vs = views or await pg.evaluate("SL.views"); tiles = []; info = {}
        for v in vs:
            r = await pg.evaluate(f"SL.render('{v}', '{pos}', {{t: {t}}})"); r2 = await pg.evaluate(f"SL.render('{v}', '{pos}', {{t: {t}, tint: true, debugPal: true, phases: [0]}})")
            if r.get("err"): print("SHADER", r["err"][:2000]); break
            info[v] = {"q": round(r["q"]), "fails": r["fails"], "line": r["line"]}
            ims = [Image.open(io.BytesIO(base64.b64decode(x["img"].split(",")[1]))).convert("RGB") for x in (r, r2)]
            import math
            D = r2["depth"]; fit = max(1, 2*math.sin(math.radians(r2["sector"]/2))*.97/(520/400)); dr = ImageDraw.Draw(ims[1])
            for k, x in r2["labels"].items():
                if x["area"] < .5 or k in ("lungs", "chest_wall", "ribs", "liver", "pericardium"): continue
                X = 260 + x["cx"]/D*.97*400/fit; Y = x["cy"]/D*.97*400/fit; dr.text((X-12, Y-5), k.replace("papillary_muscles.","").replace("AV_cusps.","")[:10], fill=(255,255,255))
            tile = Image.new("RGB", (1040, 420), (15, 15, 15)); tile.paste(ims[0], (0, 20)); tile.paste(ims[1], (520, 20))
            ImageDraw.Draw(tile).text((6, 4), f"{v} {pos}  Q {r['q']:.0f}  {','.join(r['fails'])}", fill=(240, 240, 240)); tiles.append(tile)
        G = Image.new("RGB", (2080, 420*((len(tiles)+1)//2)))
        for i, tl in enumerate(tiles): G.paste(tl, ((i % 2)*1040, (i//2)*420))
        G.save(out); print(json.dumps({k: (v["q"], v["fails"]) for k, v in info.items()})); print("errors", errs)
        json.dump(info, open(out + ".json", "w"), indent=1)
        await b.close()
asyncio.run(main())
