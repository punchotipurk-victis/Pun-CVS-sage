#!/usr/bin/env python3
"""Site shell checks (home page + section-scoped lab switcher). python tools/test_site.py <index.html> [--shots DIR]
   - Home offers three paths: 3D Heart (#heart3d), Deep dive (#topics), Echo Simulator (#echo); the echo hero image loads.
   - The lab switcher only shows the pages of the current section:
       heart3d → [heart3d] · bradycardia/narrow/wide/mi → [bradycardia, narrow, wide, mi] · echo → [echo]
   - Back to Home works; no sideways scroll at 400 px; no page errors."""
import asyncio, sys, os, argparse
from playwright.async_api import async_playwright

ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
ap = argparse.ArgumentParser(); ap.add_argument("page"); ap.add_argument("--shots", default=None); A = ap.parse_args()
fails = []
def check(ok, msg, extra=""):
    print(("  ok   " if ok else "  FAIL ") + msg, extra)
    if not ok: fails.append(msg)
TOPICS = ["bradycardia", "narrow", "wide", "mi"]
EXPECT = {"heart3d": ["heart3d"], "echo": ["echo"], **{k: TOPICS for k in TOPICS}}

async def main():
    url = "file://" + os.path.abspath(A.page)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        for scheme in ["dark", "light"]:
            ctx = await b.new_context(viewport={"width": 1440, "height": 900}, color_scheme=scheme); pg = await ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            await pg.goto(url); await pg.wait_for_timeout(800)
            cards = await pg.evaluate("[...document.querySelectorAll('#home .path')].map(a => [a.getAttribute('href'), a.querySelector('h2').textContent.trim()])")
            check([c[0] for c in cards] == ["#heart3d", "#topics", "#echo"], f"[{scheme}] home offers 3D Heart, Deep dive, Echo", str(cards))
            img = await pg.evaluate("(() => { const i = document.querySelector('.path.echo img'); return i && i.complete ? [i.naturalWidth, i.naturalHeight] : null; })()")
            check(bool(img) and img[0] > 300, f"[{scheme}] echo hero image (PLAX supine) loads", str(img))
            cols = await pg.evaluate("getComputedStyle(document.querySelector('.paths')).gridTemplateColumns.split(' ').length")
            check(cols == 3, f"[{scheme}] three cards side by side at 1440 px", f"({cols} columns)")
            if A.shots: os.makedirs(A.shots, exist_ok=True); await pg.screenshot(path=os.path.join(A.shots, f"home_{scheme}.png"), full_page=True)
            if scheme == "dark":
                for key, exp in EXPECT.items():
                    await pg.evaluate(f"location.hash = '#{key}'"); await pg.wait_for_timeout(400)
                    vis = await pg.evaluate("[...document.querySelectorAll('.tabs a')].filter(a => !a.hidden && a.offsetParent).map(a => a.dataset.topic)")
                    cur = await pg.evaluate("(document.querySelector('.tabs a[aria-current=page]') || {}).dataset?.topic")
                    check(vis == exp and cur == key, f"#{key}: switcher shows only its section", f"{vis} current={cur}")
                    if A.shots and key in ("heart3d", "mi", "echo"):
                        await pg.screenshot(path=os.path.join(A.shots, f"bar_{key}.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 60})
                await pg.click("#lab .back"); await pg.wait_for_timeout(300)
                check(await pg.evaluate("!document.getElementById('home').hidden && document.getElementById('lab').hidden"), "← Home returns to the home page")
                await pg.click(".path.echo"); await pg.wait_for_timeout(400)
                check(await pg.evaluate("location.hash === '#echo' && !document.getElementById('lab').hidden"), "clicking the Echo card opens #echo")
                await pg.evaluate("location.hash = '#topics'"); await pg.wait_for_timeout(300)
                check(await pg.evaluate("!document.getElementById('topics').hidden"), "#topics page still opens")
            check(not errs, f"[{scheme}] no page errors", "; ".join(errs[:2])); await ctx.close()
        ctx = await b.new_context(viewport={"width": 400, "height": 860}, has_touch=True, is_mobile=True); pg = await ctx.new_page()
        await pg.goto(url); await pg.wait_for_timeout(800)
        sw = await pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
        check(sw[0] <= sw[1], "400 px home: no sideways scroll", str(sw))
        cols = await pg.evaluate("getComputedStyle(document.querySelector('.paths')).gridTemplateColumns.split(' ').length")
        check(cols == 1, "400 px: cards stack in one column", f"({cols})")
        if A.shots: await pg.screenshot(path=os.path.join(A.shots, "home_phone.png"), full_page=True)
        await pg.evaluate("location.hash = '#mi'"); await pg.wait_for_timeout(500)
        sw = await pg.evaluate("[document.querySelector('.bar').scrollWidth, document.querySelector('.bar').clientWidth]")
        check(sw[0] <= sw[1] + 1, "400 px #mi: switcher fits without overflow", str(sw))
        if A.shots: await pg.screenshot(path=os.path.join(A.shots, "bar_mi_phone.png"), clip={"x": 0, "y": 0, "width": 400, "height": 60})
        await b.close()
    print(f"\n{len(fails)} failure(s)"); sys.exit(1 if fails else 0)

asyncio.run(main())
