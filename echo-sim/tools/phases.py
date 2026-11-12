import asyncio, sys, os, base64, io
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); pg = await b.new_page()
        await pg.goto("file://" + os.path.abspath(sys.argv[1])); await pg.wait_for_function("window.SL && SL.ready", timeout=120000)
        v = sys.argv[3]; ph = [0, .1, .2, .3, .38, .5, .62, .75, .9]; ims = []
        for t in ph:
            r = await pg.evaluate(f"SL.render('{v}', 'supine', {{t: {t}, phases: [{t}]}})")
            im = Image.open(io.BytesIO(base64.b64decode(r["img"].split(",")[1]))).convert("RGB"); ImageDraw.Draw(im).text((6, 6), f"t={t}", fill=(255, 255, 0)); ims.append(im)
        G = Image.new("RGB", (520*3, 400*3))
        for i, im in enumerate(ims): G.paste(im, ((i % 3)*520, (i//3)*400))
        G.save(sys.argv[2]); await b.close()
asyncio.run(main())
