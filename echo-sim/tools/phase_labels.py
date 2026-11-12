import asyncio, sys, os, json
from playwright.async_api import async_playwright
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); pg = await b.new_page()
        await pg.goto("file://" + os.path.abspath(sys.argv[1])); await pg.wait_for_function("window.SL && SL.ready", timeout=120000)
        for t in [0, .06, .2, .38, .53, .62, .75, .92]:
            r = await pg.evaluate(f"(() => {{ const r = SL.render('{sys.argv[2]}', '{os.environ.get('POS','supine')}', {{phases:[{t}]}}); return {{q: r.q, fails: r.fails, L: Object.fromEntries(Object.entries(r.labels).filter(([k,v]) => {sys.argv[3]!r}.split(',').includes(k)).map(([k,v]) => [k, +v.area.toFixed(1)]))}}; }})()")
            print(t, round(r['q']), r['fails'], r['L'])
        await b.close()
asyncio.run(main())
