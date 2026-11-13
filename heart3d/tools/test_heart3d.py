#!/usr/bin/env python3
"""3D Heart section test (Playwright + SwiftShader). Run on a COPY of the site page. Exit 1 on any failure.

  python heart3d/tools/test_heart3d.py <index.html> [--shots DIR]
  python heart3d/tools/test_heart3d.py <index.html> --baseline --shots DIR   # today's one-page lab (#heart3d holds both)

Checks (two-page mode):
  - #heart3d opens the 3D Heart page on the refined heart only (no legacy H3 heart); #pathology opens the Pathology simulator
  - 3D Heart: External / X-ray / Cut render; every cut plane renders; real vs label colours differ; each label layer shows labels
    and "none" hides them all; tapping a label or the model opens its card below the model; a card's simulator chip opens
    #pathology/<scenario>
  - the embedded interior export is at most 1.5 MB and the four-chamber cap shows muscle, fibrous tissue and fat
  - tapping the cut face of the IVS in the four-chamber section opens the interventricular septum card
  - the top-right switcher in this section shows exactly [heart3d, pathology]
  - no page or console errors in the site or the labs
  - explore: every viewpoint and External / Internal (cut) render; the structure card sits BELOW the 3D view
  - pathology: every scenario runs, its name shows and the 12-lead changes from normal
  - deep link #pathology/<scenario> opens that scenario
  - the hidden page stops its render loop and resumes when shown again
  - 400 px: no sideways scroll on either page; the switcher fits
"""
import argparse, asyncio, hashlib, json, os, sys
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

async def cap_checks(fr, tag):
    result = await fr.evaluate("""() => {
        const interior = parent.PUN_HEART_INTERIOR, cap = interior.capVolume;
        const bytes = new Blob([parent.document.querySelector('#pun-heart-interior').textContent]).size;
        if (!cap) return {bytes};
        const app = EXPLORE_APP, canvas = document.querySelector('.viewer canvas'), gl = canvas.getContext('webgl2');
        const [nx, ny, nz] = cap.n, [x0, y0, z0] = cap.lo, v = cap.v;
        const y = app.CUTS.a4c.c.y, j = Math.floor((y - y0) / v);
        const names = interior.labelNames;
        const classes = Object.fromEntries(['SVC', 'MV_AML', 'MV_PML'].map(name =>
            [name, cap.tissueByLabel?.[names.indexOf(name)]]));
        const targets = ['IVS', 'central_fibrous_body', 'membranous_septum', 'epicardial_fat'];
        const counts = Object.fromEntries(targets.map(name => [name, 0]));
        const runs = atob(cap.rle), rgba = new Uint8Array(4);
        const labels = new Uint8Array(nx * ny * nz);
        let end = 0;
        for (let i = 0; i < runs.length; i += 2) {
            const next = end + runs.charCodeAt(i) + 1;
            labels.fill(runs.charCodeAt(i + 1), end, next);
            end = next;
        }
        app.setMode('cut'); app.setCut('a4c'); app.setColour('real'); app.render();
        const rect = canvas.getBoundingClientRect();
        const septalPixels = [];
        for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
            const name = names[labels[x + nx * (j + ny * z)]];
            if (!(name in counts)) continue;
            const [sx, sy] = app.screenOf([x0 + (x + .5) * v, y, z0 + (z + .5) * v]);
            const px = Math.floor((sx - rect.left) * canvas.width / rect.width);
            const py = Math.floor((rect.bottom - sy) * canvas.height / rect.height);
            if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
            gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
            const [r, g, b] = rgba;
            const match = name === 'IVS' ? r > 75 && r > g + 30 && Math.abs(g - b) < 25
                : name === 'epicardial_fat' ? r > 145 && g > 110 && g > b + 40
                : r > 165 && g > 145 && b > 120 && r > b + 10;
            if (match) counts[name]++;
            if (match && name === 'IVS') septalPixels.push([px, py, r, g, b]);
        }
        app.setColour('labels'); app.render();
        const tinted = septalPixels.filter(([x, y, r, g, b]) => {
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
            return rgba[0] > r + 4 && rgba[1] > g + 4 && rgba[2] > b + 8;
        }).length;
        app.setColour('real');
        return {bytes, v, decoded: end === labels.length, classes, counts, tinted};
    }""")
    check(result["bytes"] <= 1_500_000, f"[{tag}] interior export is at most 1.5 MB", f"{result['bytes']:,} bytes")
    check(result.get("v") == .2 and result.get("decoded"), f"[{tag}] 0.2 cm cap volume decodes to its declared dimensions")
    classes = result.get("classes")
    check(classes == {"SVC": "vessel_wall", "MV_AML": "valve", "MV_PML": "valve"},
          f"[{tag}] cap tissue classes identify the SVC wall and both mitral leaflets", str(classes))
    counts = result.get("counts", {})
    check(counts.get("IVS", 0) >= 5 and counts.get("epicardial_fat", 0) >= 1 and
          counts.get("central_fibrous_body", 0) + counts.get("membranous_septum", 0) >= 1,
          f"[{tag}] four-chamber cap shows red IVS, pale fibrous tissue and yellow groove fat", str(counts))
    check(result.get("tinted", 0) >= 5, f"[{tag}] label colours tint the IVS cap", str(result.get("tinted")))

async def cap_tap_check(fr, tag):
    viewer = fr.locator(".viewer")
    pos = await fr.evaluate("""() => {
        const app = EXPLORE_APP;
        app.setMode('cut'); app.setCut('a4c');
        for (const layer of ['chambers', 'landmarks', 'conduction']) app.setLayer(layer, false);
        app.render();
        // A voxel inside the lower IVS cap, in front of the RV free wall.
        const [x, y] = app.screenOf([2.3, app.CUTS.a4c.c.y, 5.7]);
        const rect = document.querySelector('.viewer canvas').getBoundingClientRect();
        return {x: x - rect.left, y: y - rect.top};
    }""")
    await viewer.click(position=pos)
    title = await fr.locator(".panel h2").text_content()
    check(title == "Interventricular septum", f"[{tag}] tap the IVS cut face → its card", repr(title))
    if A.shots:
        await fr.locator("#explore").screenshot(path=shot("x3_tap_ivs_cap.png"))

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
    await cap_checks(fr, tag)
    await cap_tap_check(fr, tag)
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
    # camera: the surface follows the cursor (turntable); zoom works over labels, with the wheel and with the buttons
    await fr.evaluate("EXPLORE_APP.select(null, null); EXPLORE_APP.setMode('ext'); EXPLORE_APP.resetView(); EXPLORE_APP.render()")
    fe = await pg.evaluate_handle("LABS.heart3d.frame"); fb = await fe.as_element().bounding_box()
    vb = await fr.evaluate("(() => { const r = document.querySelector('.viewer').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
    cx, cy = fb["x"] + vb[0] + vb[2]*.5, fb["y"] + vb[1] + vb[3]*.5
    c0 = await fr.evaluate("EXPLORE_APP.camState()")
    await pg.mouse.move(cx, cy); await pg.mouse.down(); await pg.mouse.move(cx + 60, cy, steps=6); await pg.mouse.move(cx + 120, cy, steps=6); await pg.mouse.up()
    c1 = await fr.evaluate("EXPLORE_APP.camState()")
    await pg.mouse.move(cx, cy); await pg.mouse.down(); await pg.mouse.move(cx, cy + 80, steps=8); await pg.mouse.up()
    c2 = await fr.evaluate("EXPLORE_APP.camState()")
    check(c1["theta"] < c0["theta"] - .3 and c1["x"] < c0["x"] and c2["phi"] < c1["phi"] - .2 and c2["y"] > c1["y"],
          f"[{tag}] drag right turns the heart right, drag down tilts it down (surface follows the cursor)", f"theta {c0['theta']:.2f}->{c1['theta']:.2f}, phi {c1['phi']:.2f}->{c2['phi']:.2f}")
    await fr.evaluate("EXPLORE_APP.resetView(); EXPLORE_APP.render()")
    labs = await fr.evaluate("EXPLORE_APP.visibleLabels()"); L0 = labs[0] if labs else {"x": vb[0] + vb[2]*.5, "y": vb[1] + vb[3]*.5}
    d0 = (await fr.evaluate("EXPLORE_APP.camState()"))["dist"]
    await pg.mouse.move(fb["x"] + L0["x"], fb["y"] + L0["y"])
    for _ in range(4): await pg.mouse.wheel(0, 200); await pg.wait_for_timeout(60)
    d1 = (await fr.evaluate("EXPLORE_APP.camState()"))["dist"]
    for _ in range(8): await pg.mouse.wheel(0, -200); await pg.wait_for_timeout(60)
    d2 = (await fr.evaluate("EXPLORE_APP.camState()"))["dist"]
    await fr.click(".bZout"); d3 = (await fr.evaluate("EXPLORE_APP.camState()"))["dist"]
    await fr.click(".bZin"); await fr.click(".bZin"); d4 = (await fr.evaluate("EXPLORE_APP.camState()"))["dist"]
    check(d1 > d0*1.2 and d2 < d1*.7 and d3 > d2 and d4 < d3, f"[{tag}] zoom out / in with the wheel (also over a label) and with − / + buttons",
          f"dist {d0:.1f} → out {d1:.1f} → in {d2:.1f} → − {d3:.1f} → + {d4:.1f} (label '{L0.get('text', '-')}')")
    # Below view and a dissection view: the up-axis never changes while dragging (no roll), and up/down drags both move (no sticking)
    for setup in ("EXPLORE_APP.setMode('ext'); EXPLORE_APP.setView('Below')", "EXPLORE_APP.setMode('cut'); EXPLORE_APP.setCut('raOpen')"):
        await fr.evaluate(setup + "; EXPLORE_APP.render()"); ups = set(); ph = []
        for dx, dy in ((150, 0), (0, 120), (0, -240)):
            await pg.mouse.move(cx, cy); await pg.mouse.down()
            for i in range(1, 9): await pg.mouse.move(cx + dx*i/8, cy + dy*i/8); st_ = await fr.evaluate("EXPLORE_APP.camState()"); ups.add(tuple(round(u, 4) for u in st_["up"]))
            await pg.mouse.up(); ph.append(st_["phi"])
        check(len(ups) == 1 and ph[1] < ph[0] - .2 and ph[2] > ph[1] + .4, f"[{tag}] smooth drag in {setup.split('(')[-1][1:-2]} (no roll, up and down both move)", f"phi {[round(x, 2) for x in ph]}, up-axes {len(ups)}")
    # labels refresh with the beat off; vessel labels (RCA, PDA) show when their surface faces you
    await fr.evaluate("EXPLORE_APP.setBeat(false, 0); EXPLORE_APP.setMode('ext'); EXPLORE_APP.setView('Front'); for (const k of ['chambers','valves','vessels','conduction','landmarks']) EXPLORE_APP.setLayer(k, false)")
    await pg.wait_for_timeout(600); await fr.evaluate("EXPLORE_APP.setLayer('chambers', true); EXPLORE_APP.setLayer('vessels', true)"); await pg.wait_for_timeout(700)
    front = [l["id"] for l in await fr.evaluate("EXPLORE_APP.visibleLabels()")]
    await fr.evaluate("EXPLORE_APP.setView('Below')"); await pg.wait_for_timeout(700)
    below = [l["id"] for l in await fr.evaluate("EXPLORE_APP.visibleLabels()")]
    check("artery:RCA" in front and any(i in front for i in ("RA", "RV_cavity")) and "artery:PDA" in below, f"[{tag}] with the beat off, ticking layers refreshes labels; RCA (front) and PDA (below) show", f"front={front} below={below}")
    await fr.evaluate("for (const k of ['valves','conduction']) EXPLORE_APP.setLayer(k, true)")
    # dissection views: a view card lists what to find, and its chips open cards
    await fr.evaluate("EXPLORE_APP.setMode('cut'); EXPLORE_APP.setCut('valves'); EXPLORE_APP.render()")
    vc = await fr.evaluate("[document.querySelector('.panel h2').textContent, document.querySelectorAll('.panel [data-find]').length]")
    check("Valves from above" in vc[0] and vc[1] >= 6, f"[{tag}] dissection view card lists what to find", str(vc))
    await fr.click(".panel [data-find]"); await pg.wait_for_timeout(200)
    check(await fr.evaluate("document.querySelector('.panel h2').textContent") != vc[0], f"[{tag}] a 'find' chip opens that structure's card")
    # turned dissection views stay labelled: back of the 4-chamber cut, side of the valve view (B3/B4)
    for k in ("a4c", "valves"):
        await fr.evaluate(f"EXPLORE_APP.setBeat(false, 0); EXPLORE_APP.setMode('cut'); EXPLORE_APP.setCut('{k}'); EXPLORE_APP.render()")
        await pg.mouse.move(cx, cy); await pg.mouse.down()
        for i in range(1, 13): await pg.mouse.move(cx + 390*i/12, cy)
        await pg.mouse.up(); await pg.wait_for_timeout(900)
        th = (await fr.evaluate("EXPLORE_APP.camState()"))["theta"]; labs = [l["id"] for l in await fr.evaluate("EXPLORE_APP.visibleLabels()")]
        check(len(labs) >= 2, f"[{tag}] turned {k} view still shows labels", f"theta {th:.2f} labels {labs}")
    await fr.evaluate("EXPLORE_APP.setMode('ext'); EXPLORE_APP.resetView(); EXPLORE_APP.setBeat(true)")
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
        if k != "normal" and sig[1] == base[1]:          # subtle changes (1st-degree block: PR only) may need another sweep
            await pg.wait_for_timeout(2500); sig = await ecg_sig(fr, "sim")
            if sig[1] == base[1]: same.append(k)
        if A.shots:
            el = await fr.query_selector(f"{root} .main"); await el.screenshot(path=shot(f"sim_{k}.png"))
    check(not same, f"[{tag}] every scenario changes the 12-lead", f"unchanged: {same}" if same else f"({len(keys)-1} scenarios)")
    if A.shots and not A.baseline:
        await fr.click(f"{root} .panel [data-sc=normal]"); await pg.wait_for_timeout(500); await pg.screenshot(path=shot("page_pathology.png"))


async def conduction_core_checks(heart, pathology):
    """T6.2(a): graph and ECG only. View/taps/strip and muscle maps belong to (b)/(c)."""
    await heart.wait_for_function("window.EXPLORE_APP && EXPLORE_APP.ready", timeout=180000)
    await wait_lab(pathology,"sim")
    result = await heart.evaluate("""() => {
        const g=CGRAPH, spec=g.spec, before=JSON.stringify(spec), errors=[];
        const near=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)<=Math.max(.05,Math.abs(b)*.05);
        const compare=(actual,ref,label)=>{
            for(const [id,t] of Object.entries(ref)){
                // _purkLV/RV summarize the omitted dense legacy cloud, not nodes of this graph.
                if(id.startsWith('_'))continue;
                if(!near(actual[id],t))errors.push([label,id,actual[id],t]);
            }
        };
        for(const [mode,ref] of Object.entries(spec.timing.legacy.atrialNodeTimes))
            compare(g.atrialTimes(mode),ref,'atrial '+mode);
        for(const [mode,ref] of Object.entries(spec.timing.legacy.ventricularNodeTimes))
            compare(g.ventGraph(mode),ref,'ventricular '+mode);
        const cache=g.ventGraph('normal')===g.ventGraph('normal')&&g.atrialTimes('sinus')===g.atrialTimes('sinus');
        const isolated=['none','saOnly','avnOnly'].every(mode=>{
            const t=g.atrialTimes(mode),ids=Object.keys(t).filter(id=>Number.isFinite(t[id]));
            return mode==='none'?ids.length===0:ids.length===1&&ids[0]===(mode==='saOnly'?'SA':'AVN');
        });
        const chain=g.times('A',{SA:0}),qrs=chain.HIS+spec.timing.legacy.qrsOnset_ms.normal;
        const blocked=g.times('A',{SA:0},['tracts','bach','avn']);
        const blocks=Object.values(spec.blockSites).filter(x=>typeof x==='object')
            .every(x=>x.node?!!g.nodes[x.node]:g.edges.some(e=>e.id===x.edge));
        const circuits=Object.values(spec.circuits).filter(x=>x.ms)
            .every(x=>x.ms.reduce((a,b)=>a+b,0)===x.CL_ms);
        const untouched=JSON.stringify(spec)===before&&g.nodes===spec.nodes&&g.edges===spec.edges;
        // Deliberately unequal segments and a duplicate point catch index-based interpolation.
        const custom={...spec,nodes:{A:{p:[0,0,0],side:'A'},B:{p:[1,3,0],side:'A'},C:{p:[5,5,5],side:'V'}},edges:[
            {id:'ab',a:'A',b:'B',side:'A',struct:'lane',points:[[0,0,0],[0,0,0],[1,0,0],[1,3,0]],T_ms:20},
            {id:'bc',a:'B',b:'C',side:'V',struct:'circuit',points:[[1,3,0],[5,5,5]],T_ms:null,circuitOnly:true}
        ]};
        let geometry=false,paths=false;
        try{
            g.load(custom);const e=g.edges[0],t={A:10,B:12};
            geometry=JSON.stringify(g.pointAt(e,.25))==='[1,0,0]'&&JSON.stringify(g.pointAt(e,.5))==='[1,1,0]'&&
                JSON.stringify(g.pointAt(e,-1))==='[0,0,0]'&&JSON.stringify(g.pointAt(e,2))==='[1,3,0]'&&
                g.edgeTimeAt(e,.75,t)===17&&g.edgeTimeAt(g.edges[1],.5,t)===Infinity;
            paths=g.times('A',{A:0}).B===20&&g.times('A',{B:0}).A===20&&
                g.times('A',{A:0},['lane']).B===Infinity&&g.times('V',{A:0}).B===Infinity&&
                g.times(null,{A:0}).C===Infinity&&g.times('A',{A:0},['ab']).B===Infinity&&
                g.times('A',{A:0,B:3}).B===3;
        }finally{g.load(spec)}
        return {errors,cache,isolated,chain:[chain.AVN,chain.HIS,qrs],blocked:blocked.AVN===Infinity,
            blocks,circuits,untouched,geometry,paths,
            reset:g.atrialTimes('sinus').SA===0,constants:g.constants};
    }""")
    check(not result["errors"], "conduction graph: sinus, IAB and every ventricular mode match legacy node times ±5%", str(result["errors"][:5]))
    check(all(abs(a-b) <= b*.05 for a,b in zip(result["chain"], [65.6,147.6,177.3])),
          "normal chain: AVN 65.6 → His 147.6 → QRS 177.3 ms", str(result["chain"]))
    for key, msg in [("cache","mode results cached lazily"),("isolated","silent and node-only atrial modes stay isolated"),
                     ("geometry","polyline arc length and bidirectional edge timing"),
                     ("paths","undirected multi-source paths, side/block filters, no circuit-only shortcuts"),
                     ("blocked","blocked atrial structures stop propagation"),
                     ("untouched","contract geometry preserved without mutation"),("reset","load resets mode caches"),
                     ("blocks","every block site resolves"),("circuits","numeric circuit step sums equal cycle lengths")]:
        check(result[key], "conduction graph: "+msg)
    check(result["constants"] == {"TA_AVN":65.6,"D0":82,"WPW_LEAD":45,"A_MUSCLE":1,"V_MUSCLE":.6,"JUNCTION_DELAY":4},
          "conduction constants use the timing contract")
    fixture_path = os.path.join(os.path.dirname(__file__), "fixtures", "ecg-legacy-normal.json")
    with open(fixture_path, encoding="utf-8") as f: fixture=json.load(f)
    traces=[]
    for name, fr in [("3D Heart",heart),("Pathology",pathology)]:
        actual=await fr.evaluate("""({leads,stepMs,durationMs,isPathology}) => {
            const samples=[];
            for(let ms=0;ms<durationMs;ms+=stepMs)samples.push(leads.map(lead=>isPathology?
                LABCORE.leadVal(LABCORE.vecAt(LABS.sim.cx,ms),lead):EXPLORE_APP.ecgSample(lead,ms)));
            return samples;
        }""", {**{k:fixture[k] for k in ("leads","stepMs","durationMs")},"isPathology":name=="Pathology"})
        diff=max(abs(a-b) for x,y in zip(actual,fixture["samples"]) for a,b in zip(x,y))
        check(len(actual)==len(fixture["samples"]) and diff<1e-9,
              f"{name} ECG: 12 leads every 2 ms over 3 beats identical to pre-change fixture", f"max abs diff {diff:.3g}")
        traces.append(actual)
        event_texts=await fr.evaluate("""({cases,isPathology}) => {
            const timing=isPathology?{TA_AVN:CS.TA_AVN,WPW_LEAD:CS.WPW_LEAD,onset:LABCORE.ONSET}:
                ECG.timingFromSpec(CGRAPH.spec.timing.legacy);
            const engine=ECG.init(timing);
            return cases.map(c=>JSON.stringify(engine.buildEvents(c.rhythm,c.scenario||{})));
        }""", {"cases":fixture["rhythmCases"],"isPathology":name=="Pathology"})
        bad=[c["rhythm"] for c,txt in zip(fixture["rhythmCases"],event_texts)
             if hashlib.sha256(txt.encode()).hexdigest()!=c["eventSHA256"]]
        check(not bad, f"{name} ECG: all 25 rhythm/event fixtures unchanged", str(bad))
    diff=max(abs(a-b) for x,y in zip(*traces) for a,b in zip(x,y))
    check(diff<1e-9,"3D Heart and Pathology ECG samples identical",f"max abs diff {diff:.3g}")
    independent=await heart.evaluate("""() => {
        const t=ECG.timingFromSpec(CGRAPH.spec.timing.legacy),a=ECG.init(t),b=ECG.init({...t,TA_AVN:t.TA_AVN+10});
        const r={type:'sinus',rate:72};const before=a.buildEvents(r,{}).V[0].t;b.buildEvents({type:'af'},{});
        const isolated=a.buildEvents(r,{}).V[0].t===before&&b.D0!==a.D0;
        let rejects=false;try{ECG.timingFromSpec({...CGRAPH.spec.timing.legacy,qrsOnset_ms:{}})}catch(e){rejects=true}
        return isolated&&rejects;
    }""")
    check(independent,"ECG engines isolate timing and reject stale precision calibration")

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
            await conduction_core_checks(await lab_frame(pg, "heart3d"), await lab_frame(pg, "pathology"))
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
