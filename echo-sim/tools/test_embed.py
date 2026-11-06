#!/usr/bin/env python3
"""Embed test: run on a COPY of the Super App's index.html (after tools/embed_lab.py). Exit 1 on any failure.
   Checks that #echo opens and works inside its srcdoc iframe, and that every other lab still routes.
   python tools/test_embed.py /path/to/index-copy.html [--shots DIR]"""
import argparse, asyncio, os, sys
from playwright.async_api import async_playwright
ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
ap = argparse.ArgumentParser(); ap.add_argument("index"); ap.add_argument("--shots", default=None); A = ap.parse_args()
fails = []
def check(ok, msg):
    print(("  ok   " if ok else "  FAIL ") + msg)
    if not ok: fails.append(msg)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS); pg = await b.new_page(viewport={"width": 1440, "height": 860}); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + os.path.abspath(A.index))
        keys = await pg.evaluate("Object.keys(LABS)"); print("labs:", keys); check("echo" in keys, "LABS.echo exists")
        check(await pg.locator('.tabs a[href="#echo"]').count() == 1, "exactly one Echo tab")
        check(await pg.locator("#home").is_visible(), "home page shows with no route")
        for k in [x for x in keys if x != "echo"] + ["echo"]:
            await pg.evaluate(f"location.hash = '#{k}'"); await pg.wait_for_timeout(1500)
            st = await pg.evaluate(f"""() => {{ const f = LABS['{k}'].frame; if (!f) return null; const r = f.getBoundingClientRect(), d = f.contentDocument;
                return {{ w: r.width, h: r.height, hidden: f.hidden, title: document.title, len: d && d.body ? d.body.innerText.length : 0,
                          others: Object.keys(LABS).filter(o => o !== '{k}' && LABS[o].frame && !LABS[o].frame.hidden) }}; }}""")
            check(bool(st) and st["w"] > 300 and st["h"] > 300 and not st["hidden"] and st["len"] > 20 and not st["others"], f"#{k} opens: {st}")
        handle = await pg.evaluate_handle("LABS.echo.frame"); frame = await handle.as_element().content_frame()
        await frame.wait_for_function("window.ECHO && ECHO.ready", timeout=180000); check(True, "echo engine ready inside the srcdoc iframe")
        check(not await frame.evaluate("ECHO.shaderErr()"), "echo shaders compile inside the iframe")
        await frame.wait_for_function("ECHO.chip().startsWith('PLAX')", timeout=60000); check(True, "view chip live inside the iframe: " + await frame.evaluate("ECHO.chip()"))
        await pg.wait_for_timeout(500)
        if A.shots: await pg.screenshot(path=os.path.join(A.shots, "20-embedded.png"))
        # theme sync, hidden-iframe pause and resume
        await pg.evaluate("document.documentElement.setAttribute('data-theme','dark')"); await pg.wait_for_timeout(200)
        check(await frame.evaluate("document.documentElement.getAttribute('data-theme')") == "dark", "parent theme reaches the lab")
        await pg.evaluate("location.hash = '#mi'"); await pg.wait_for_timeout(800)
        t0 = await frame.evaluate("APP.time"); await pg.wait_for_timeout(1200); t1 = await frame.evaluate("APP.time")
        print(f"     hidden: clock {t0:.2f} -> {t1:.2f}"); check(abs(t1-t0) < .05, "hidden lab stops its render loop")
        await pg.evaluate("location.hash = '#echo'"); await pg.wait_for_timeout(2500); t2 = await frame.evaluate("APP.time"); check(t2 > t1, "lab resumes when shown again")
        await pg.evaluate("location.hash = ''"); await pg.wait_for_timeout(300); check(await pg.locator("#home").is_visible(), "back to home")
        check(not errs, "no page errors: " + "; ".join(errs[:3]))
        await b.close()
    print("\n%d failure(s)" % len(fails)); [print("  -", f) for f in fails]; sys.exit(1 if fails else 0)
asyncio.run(main())
