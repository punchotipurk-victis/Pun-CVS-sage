import asyncio,os,sys
from playwright.async_api import async_playwright
async def m():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=["--use-angle=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--enable-unsafe-swiftshader"]);pg=await b.new_page()
        await pg.goto("file://"+os.path.abspath(sys.argv[1])); await pg.wait_for_function("window.SL&&SL.ready",timeout=200000)
        await pg.evaluate("SL.render('a4c','supine',{phases:[0]})")
        t=await pg.evaluate("(()=>{const e=SL._eng;const t0=performance.now();for(let i=0;i<10;i++){e.render(0,0,1,null,1);e.readLabels();}return (performance.now()-t0)/10})()")
        print(sys.argv[1], 'ms/frame', round(t,1)); await b.close()
asyncio.run(m())
