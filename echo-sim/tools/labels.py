import asyncio, sys, os, json
from playwright.async_api import async_playwright
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); pg = await b.new_page()
        await pg.goto("file://" + os.path.abspath(sys.argv[1])); await pg.wait_for_function("window.SL && SL.ready", timeout=120000)
        for v in sys.argv[2].split(","):
            L = await pg.evaluate(f"SL.render('{v}', '{os.environ.get('POS','supine')}', {{phases:[0]}}).labels")
            print("==", v)
            for k, x in sorted(L.items(), key=lambda kv: -kv[1]['area']):
                if x['area'] > .2: print(f"  {k:26} A {x['area']:5.1f}  c ({x['cx']:5.1f},{x['cy']:5.1f})  {x['major']:4.1f}x{x['minor']:4.1f} ang {x['angleDeg']:5.0f}")
        await b.close()
asyncio.run(main())
