#!/usr/bin/env python3
"""3D Heart section test (Playwright + SwiftShader). Run on a COPY of the site page. Exit 1 on any failure.

  python heart3d/tools/test_heart3d.py <index.html> [--shots DIR]
  python heart3d/tools/test_heart3d.py <index.html> --baseline --shots DIR   # today's one-page lab (#heart3d holds both)

Checks (two-page mode):
  - #heart3d opens the 3D Heart page on the refined heart only (no legacy H3 heart); #pathology opens the Pathology simulator
  - 3D Heart: External / X-ray / Cut render; every cut plane renders; real vs label colours differ; each label layer shows labels
    and "none" hides them all; tapping a label or the model opens its card below the model; a card's simulator chip opens
    #pathology/<scenario>
  - the top-right switcher in this section shows exactly [heart3d, pathology]
  - no page or console errors in the site or the labs
  - explore: every viewpoint and External / Internal (cut) render; the structure card sits BELOW the 3D view
  - pathology: every scenario runs, its name shows and the 12-lead changes from normal
  - deep link #pathology/<scenario> opens that scenario
  - the hidden page stops its render loop and resumes when shown again
  - 400 px: no sideways scroll on either page; the switcher fits
"""
import argparse, asyncio, hashlib, os, sys
from playwright.async_api import async_playwright

ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
ap = argparse.ArgumentParser(); ap.add_argument("index"); ap.add_argument("--shots"); ap.add_argument("--baseline", action="store_true")
ap.add_argument("--quick", action="store_true", help="only 6 scenarios"); A = ap.parse_args()
fails = []
def check(ok, msg, extra=""):
    print(("  ok   " if ok else "  FAIL ") + msg, extra)
    if not ok: fails.append(msg)
def shot(name): return os.path.join(A.shots, name) if A.shots else None

VIEWS = ["Front", "Back", "Left", "Right", "Below"]

async def lab_frame(pg, key):
    h = await pg.evaluate_handle(f"LABS['{key}'].frame"); return await h.as_element().content_frame()

async def wait_lab(fr, lab):
    await fr.wait_for_function(f"window.LABS && LABS['{lab}'] && LABS['{lab}'].S", timeout=180000)
    await fr.wait_for_function(f"(() => {{ const b = document.querySelector('[data-lab={lab}] .busy'); return !b || b.hidden; }})()", timeout=180000)

async def ecg_sig(fr, lab):
    return await fr.evaluate(f"""(() => {{ const r = document.querySelector('[data-lab={lab}]');
        const c = r.querySelector('.ecg12'); return [r.querySelector('.rname').textContent.trim(), c.toDataURL().length + ':' + c.toDataURL().slice(-400)]; }})()""")

async def explore_checks_legacy(pg, fr, tag):
    await wait_lab(fr, "explore"); await pg.wait_for_timeout(800)
    root = "[data-lab=explore]"
    if not A.baseline:
        order = await fr.evaluate(f"""(() => {{ const r = document.querySelector('{root}'), v = r.querySelector('.viewer').getBoundingClientRect(),
            p = r.querySelector('.panel').getBoundingClientRect(), e = r.querySelector('.ecgcard').getBoundingClientRect();
            return {{viewerH: Math.round(v.height), viewerW: Math.round(v.width), panelTop: Math.round(p.top), viewerBottom: Math.round(v.bottom), ecgTop: Math.round(e.top), pageW: innerWidth, pageH: innerHeight}}; }})()""")
        check(order["panelTop"] >= order["viewerBottom"] - 1 and order["ecgTop"] >= order["panelTop"], f"[{tag}] structure card sits below the 3D view, ECG after it", str(order))
        check(order["viewerW"] >= order["pageW"] * 0.8 and order["viewerH"] >= order["pageH"] * 0.55, f"[{tag}] large 3D view", str(order))
    for mode in ["ext", "int"]:
        await fr.click(f"{root} .segView button[data-v={mode}]"); await pg.wait_for_timeout(1500)
        for v in VIEWS + (["Cut"] if mode == "int" else []):
            await fr.click(f"{root} .views button[data-v={v}]"); await pg.wait_for_timeout(900)
            if A.shots:
                el = await fr.query_selector(f"{root} .viewer"); await el.screenshot(path=shot(f"explore_{mode}_{v}.png"))
    await fr.click(f"{root} .segView button[data-v=ext]"); await fr.click(f"{root} .views button[data-v=Front]"); await pg.wait_for_timeout(600)
    card = await fr.evaluate(f"document.querySelector('{root} .panel h2') && document.querySelector('{root} .panel h2').textContent")
    check(bool(card), f"[{tag}] explore shows a card", repr(card))
    if A.shots and not A.baseline:
        await pg.screenshot(path=shot("page_heart3d.png"))

async def explore_checks(pg, fr, tag):
    """3D Heart page on the refined heart (step 4)"""
    await fr.wait_for_function("window.EXPLORE_APP", timeout=180000)
    app = await fr.evaluate("JSON.stringify({r: EXPLORE_APP.ready, e: EXPLORE_APP.error || null, legacy: EXPLORE_APP.legacy, n: (EXPLORE_APP.anchors || []).length})")
    import json as _j; app = _j.loads(app)
    check(app["r"] and not app["legacy"] and app["n"] > 40, f"[{tag}] refined heart loaded (no legacy heart), {app['n']} label anchors", str(app))
    if not app["r"]: return
    order = await fr.evaluate("""(() => { const v = document.querySelector('.viewer').getBoundingClientRect(), p = document.querySelector('.panel').getBoundingClientRect();
        return {viewerH: Math.round(v.height), viewerW: Math.round(v.width), panelTop: Math.round(p.top), viewerBottom: Math.round(v.bottom), pageW: innerWidth, pageH: innerHeight}; })()""")
    check(order["panelTop"] >= order["viewerBottom"] - 1, f"[{tag}] structure card sits below the 3D view", str(order))
    check(order["viewerW"] >= order["pageW"]*0.8 and order["viewerH"] >= order["pageH"]*0.55, f"[{tag}] large 3D view", str(order))
    viewer = await fr.query_selector(".viewer")
    async def snap(name, js):
        await fr.evaluate(js + "; EXPLORE_APP.render()"); await pg.wait_for_timeout(200)
        b = await viewer.screenshot(path=shot(f"x3_{name}.png") if A.shots else None); return hashlib.md5(b).hexdigest()
    await fr.evaluate("EXPLORE_APP.setBeat(false, 0)")
    h = {}
    for m in ("ext", "xray", "cut"): h[m] = await snap(m, f"EXPLORE_APP.setMode('{m}'); EXPLORE_APP.{'setCut(\'a4c\')' if m == 'cut' else 'setView(\'Front\')'}")
    check(len(set(h.values())) == 3, f"[{tag}] External, X-ray and Cut look different")
    for v in ("Front", "Back", "Left", "Right", "Below", "Above"): await snap(f"ext_{v}", f"EXPLORE_APP.setMode('ext'); EXPLORE_APP.setView('{v}')")
    cuts = await fr.evaluate("Object.keys(EXPLORE_APP.CUTS)"); hc = []
    for c in cuts: hc.append(await snap(f"cut_{c}", f"EXPLORE_APP.setMode('cut'); EXPLORE_APP.setCut('{c}')"))
    check(len(set(hc)) == len(cuts), f"[{tag}] every cut plane renders its own view", f"({len(set(hc))}/{len(cuts)})")
    hr = await snap("ext_real", "EXPLORE_APP.setMode('ext'); EXPLORE_APP.setView('Front'); EXPLORE_APP.setColour('real')")
    hl = await snap("ext_labels", "EXPLORE_APP.setColour('labels')")
    await snap("cut_a4c_labels", "EXPLORE_APP.setMode('cut'); EXPLORE_APP.setCut('a4c'); EXPLORE_APP.setLayer('landmarks', true)")
    check(hr != hl and await fr.evaluate("!document.querySelector('.legend').hidden"), f"[{tag}] label colours repaint the heart and show the colour key")
    await fr.evaluate("EXPLORE_APP.setColour('real')")
    # layers
    await fr.evaluate("for (const k of ['chambers','valves','vessels','conduction','landmarks']) EXPLORE_APP.setLayer(k, false); EXPLORE_APP.render()")
    none = await fr.evaluate("EXPLORE_APP.visibleLabels().length")
    per = {}
    for k, mode in (("chambers", "ext"), ("vessels", "ext"), ("conduction", "ext"), ("valves", "xray"), ("landmarks", "cut")):
        await fr.evaluate(f"for (const k of ['chambers','valves','vessels','conduction','landmarks']) EXPLORE_APP.setLayer(k, k === '{k}'); EXPLORE_APP.setMode('{mode}'); {'EXPLORE_APP.setCut(\'a4c\')' if mode == 'cut' else 'EXPLORE_APP.setView(\'Front\')'}; EXPLORE_APP.render()")
        per[k] = await fr.evaluate("EXPLORE_APP.visibleLabels().filter(l => l.layer === '" + k + "').length")
    check(none == 0 and all(per.values()), f"[{tag}] each label layer shows its labels; 'None' hides all", f"none={none} {per}")
    await fr.evaluate("for (const k of ['chambers','valves','vessels','conduction']) EXPLORE_APP.setLayer(k, true); EXPLORE_APP.setLayer('landmarks', false); EXPLORE_APP.setMode('ext'); EXPLORE_APP.setView('Front'); EXPLORE_APP.render()")
    # tap a label → card
    labs = await fr.evaluate("EXPLORE_APP.visibleLabels()")
    ra = next((l for l in labs if l["id"] == "RA"), None)
    if ra: await fr.click('.labels .lab[data-id="RA"]:not([hidden])')
    await pg.wait_for_timeout(300); t1 = await fr.evaluate("document.querySelector('.panel h2').textContent")
    check(ra is not None and "Right atrium" in t1, f"[{tag}] tap the RA label → its card", repr(t1))
    # tap the model (LV surface) → wall card
    p = await fr.evaluate("EXPLORE_APP.screenOf('LV_cavity')")
    fbox = await (await pg.evaluate_handle("LABS.heart3d && LABS.heart3d.frame")).as_element().bounding_box() if await pg.evaluate("!!(window.LABS && LABS.heart3d && LABS.heart3d.frame)") else {"x": 0, "y": 0}
    await pg.mouse.click(fbox["x"] + p[0], fbox["y"] + p[1]); await pg.wait_for_timeout(400)
    t2 = await fr.evaluate("document.querySelector('.panel h2').textContent")
    check(t2 and t2 != t1, f"[{tag}] tap the model → a card for what was tapped", repr(t2))
    # conduction card chip → pathology deep link
    await fr.evaluate("EXPLORE_APP.select('av_node', null)"); await pg.wait_for_timeout(200)
    chip = await fr.query_selector(".panel [data-go]")
    if chip and not A.baseline:
        k = await chip.get_attribute("data-go"); await chip.click(); await pg.wait_for_timeout(1200)
        check(await pg.evaluate("location.hash") == f"#pathology/{k}", f"[{tag}] card chip opens the simulator on that condition", f"#pathology/{k}")
        await pg.evaluate("location.hash = '#heart3d'"); await pg.wait_for_timeout(600)
    await fr.evaluate("EXPLORE_APP.setBeat(true)")
    if A.shots: await pg.screenshot(path=shot("page_heart3d.png"))

async def sim_checks(pg, fr, tag):
    await wait_lab(fr, "sim"); await pg.wait_for_timeout(800)
    root = "[data-lab=sim]"
    keys = await fr.evaluate(f"[...document.querySelectorAll('{root} .panel [data-sc]')].map(b => b.dataset.sc)")
    if A.quick: keys = [k for k in keys if k in ("normal", "af", "flutter", "wenck", "wpw", "miInf")]
    check(len(keys) >= 6, f"[{tag}] simulator lists scenarios", f"({len(keys)})")
    base = await ecg_sig(fr, "sim"); same = []
    for k in keys:
        await fr.click(f"{root} .panel [data-sc={k}]"); await pg.wait_for_timeout(2200)
        sig = await ecg_sig(fr, "sim")
        if k != "normal" and sig[1] == base[1]: same.append(k)
        if A.shots:
            el = await fr.query_selector(f"{root} .main"); await el.screenshot(path=shot(f"sim_{k}.png"))
    check(not same, f"[{tag}] every scenario changes the 12-lead", f"unchanged: {same}" if same else f"({len(keys)-1} scenarios)")
    if A.shots and not A.baseline:
        await fr.click(f"{root} .panel [data-sc=normal]"); await pg.wait_for_timeout(500); await pg.screenshot(path=shot("page_pathology.png"))

async def main():
    url = "file://" + os.path.abspath(A.index)
    if A.shots: os.makedirs(A.shots, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={"width": 1440, "height": 900}, color_scheme="dark"); pg = await ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append("page: " + str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append("console: " + m.text))
        await pg.goto(url); await pg.wait_for_timeout(600)
        if A.baseline:
            await pg.evaluate("location.hash = '#heart3d'"); fr = await lab_frame(pg, "heart3d")
            await explore_checks_legacy(pg, fr, "baseline")
            await fr.evaluate("document.querySelector('[data-lab=sim]').scrollIntoView()"); await pg.wait_for_timeout(1500)
            await sim_checks(pg, fr, "baseline")
        else:
            keys = await pg.evaluate("Object.keys(LABS)")
            check("heart3d" in keys and "pathology" in keys, "LABS has heart3d and pathology", str(keys))
            for key in ("heart3d", "pathology"):
                await pg.evaluate(f"location.hash = '#{key}'"); await pg.wait_for_timeout(700)
                vis = await pg.evaluate("[...document.querySelectorAll('.tabs a')].filter(a => !a.hidden && a.offsetParent).map(a => a.dataset.topic)")
                cur = await pg.evaluate("(document.querySelector('.tabs a[aria-current=page]') || {}).dataset?.topic")
                check(vis == ["heart3d", "pathology"] and cur == key, f"#{key}: switcher shows 3D Heart · Pathology simulator", f"{vis} current={cur}")
                fr = await lab_frame(pg, key)
                labs = await fr.evaluate("[...document.querySelectorAll('[data-lab]')].map(e => e.dataset.lab)")
                if key == "heart3d":
                    await fr.wait_for_function("window.EXPLORE_APP", timeout=180000)
                    check(labs == [] and await fr.evaluate("!!window.EXPLORE_APP"), f"#{key} holds the refined 3D Heart page (no legacy lab)", str(labs))
                else: check(labs == ["sim"], f"#{key} holds only its own lab", str(labs))
            await pg.evaluate("location.hash = '#heart3d'"); await explore_checks(pg, await lab_frame(pg, "heart3d"), "3D Heart")
            await pg.evaluate("location.hash = '#pathology'"); await pg.wait_for_timeout(500); await sim_checks(pg, await lab_frame(pg, "pathology"), "Pathology")
            # deep link
            await pg.evaluate("location.hash = '#pathology/flutter'"); await pg.wait_for_timeout(2000)
            fr = await lab_frame(pg, "pathology")
            nm = (await ecg_sig(fr, "sim"))[0]
            check("flutter" in nm.lower(), "deep link #pathology/flutter opens atrial flutter", repr(nm))
            check(await pg.evaluate("(document.querySelector('.tabs a[aria-current=page]') || {}).dataset?.topic") == "pathology", "deep link keeps the Pathology tab current")
            # hidden page pauses, shown page resumes (count animation frames inside each lab)
            for key in ("heart3d", "pathology"):
                f2 = await lab_frame(pg, key)
                await f2.evaluate("(() => { if (window.__rafN === undefined) { window.__rafN = 0; const r = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => { window.__rafN++; return r(cb); }; } })()")
            await pg.evaluate("location.hash = '#heart3d'"); await pg.wait_for_timeout(1500)
            fh, fp = await lab_frame(pg, "heart3d"), await lab_frame(pg, "pathology")
            h0, p0 = await fh.evaluate("__rafN"), await fp.evaluate("__rafN"); await pg.wait_for_timeout(1500)
            h1, p1 = await fh.evaluate("__rafN"), await fp.evaluate("__rafN")
            check(p1 - p0 == 0 and h1 - h0 > 3, "hidden Pathology page stops rendering while 3D Heart runs", f"(pathology +{p1-p0}, heart +{h1-h0} frames)")
            await pg.evaluate("location.hash = '#pathology'"); await pg.wait_for_timeout(1500)
            h0, p0 = await fh.evaluate("__rafN"), await fp.evaluate("__rafN"); await pg.wait_for_timeout(1500)
            h1, p1 = await fh.evaluate("__rafN"), await fp.evaluate("__rafN")
            check(h1 - h0 == 0 and p1 - p0 > 3, "hidden 3D Heart page stops; Pathology resumes", f"(heart +{h1-h0}, pathology +{p1-p0} frames)")
            await pg.evaluate("location.hash = ''"); await pg.wait_for_timeout(300)
            check(await pg.locator("#home").is_visible(), "← Home still works")
        check(not errs, "no page or console errors", "; ".join(errs[:4]))
        await ctx.close()
        if not A.baseline:
            ctx = await b.new_context(viewport={"width": 400, "height": 860}, has_touch=True, is_mobile=True, color_scheme="dark"); pg = await ctx.new_page()
            await pg.goto(url); await pg.wait_for_timeout(500)
            for key in ("heart3d", "pathology"):
                await pg.evaluate(f"location.hash = '#{key}'"); await pg.wait_for_timeout(2500)
                fr = await lab_frame(pg, key)
                sw = await fr.evaluate("[document.documentElement.scrollWidth, innerWidth]")
                check(sw[0] <= sw[1], f"400 px #{key}: no sideways scroll in the page", str(sw))
                bw = await pg.evaluate("[document.querySelector('.bar').scrollWidth, document.querySelector('.bar').clientWidth]")
                check(bw[0] <= bw[1] + 1, f"400 px #{key}: switcher fits", str(bw))
                if A.shots: await pg.screenshot(path=shot(f"phone_{key}.png"))
            await ctx.close()
        await b.close()
    print(f"\n{len(fails)} failure(s)"); [print("  -", f) for f in fails]; sys.exit(1 if fails else 0)

asyncio.run(main())
