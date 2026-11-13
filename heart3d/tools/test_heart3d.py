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
sys.stdout.reconfigure(encoding='utf-8')

ARGS = ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]
ap = argparse.ArgumentParser(); ap.add_argument("index"); ap.add_argument("--shots"); ap.add_argument("--baseline", action="store_true")
ap.add_argument("--quick", action="store_true", help="only 6 scenarios")
ap.add_argument("--b6", action="store_true", help="run the conduction picking/performance regression three times")
ap.add_argument("--redesign", action="store_true", help="run only the T6.2-C acceptance checks")
ap.add_argument("--activation-audit", help="write tissue map audit JSON independently of screenshots"); A = ap.parse_args()
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
    await fr.evaluate("EXPLORE_APP.labelMode('all')")
    order = await fr.evaluate("""(() => { const v = document.querySelector('.viewer').getBoundingClientRect(), p = document.querySelector('.panel').getBoundingClientRect();
        return {viewerH: Math.round(v.height), viewerW: Math.round(v.width), panelTop: Math.round(p.top), viewerBottom: Math.round(v.bottom), pageW: innerWidth, pageH: innerHeight}; })()""")
    check(order["panelTop"] >= order["viewerBottom"] - 1, f"[{tag}] structure card sits below the 3D view", str(order))
    check(order["viewerW"] >= order["pageW"]*0.5 and order["viewerH"] >= order["pageH"]*0.55, f"[{tag}] large 3D view", str(order))
    viewer = await fr.query_selector(".model-stage")
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
    await fr.evaluate("EXPLORE_APP.select(null,null);for (const k of ['chambers','valves','vessels','conduction','landmarks']) EXPLORE_APP.setLayer(k, false); EXPLORE_APP.render()")
    none = await fr.evaluate("EXPLORE_APP.visibleLabels().length")
    per = {}
    for k, mode in (("chambers", "ext"), ("vessels", "ext"), ("conduction", "ext"), ("valves", "xray"), ("landmarks", "cut")):
        await fr.evaluate(f"for (const k of ['chambers','valves','vessels','conduction','landmarks']) EXPLORE_APP.setLayer(k, k === '{k}'); EXPLORE_APP.setMode('{mode}'); {'EXPLORE_APP.setCut(\'a4c\')' if mode == 'cut' else 'EXPLORE_APP.setView(\'Front\')'}; EXPLORE_APP.render()")
        if k=='vessels':await fr.evaluate('EXPLORE_APP.setCoronaries(true);EXPLORE_APP.render()')
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
    await fr.locator('.viewer').scroll_into_view_if_needed()
    await fr.evaluate("scrollTo(0,Math.max(0,document.querySelector('.viewer').offsetTop-40))")
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
    await pg.mouse.move(cx, cy)
    for _ in range(4): await pg.mouse.wheel(0, 200); await pg.wait_for_timeout(60)
    d1 = (await fr.evaluate("EXPLORE_APP.camState()"))["dist"]
    for _ in range(8): await pg.mouse.wheel(0, -200); await pg.wait_for_timeout(60)
    d2 = (await fr.evaluate("EXPLORE_APP.camState()"))["dist"]
    await fr.click(".bZout"); d3 = (await fr.evaluate("EXPLORE_APP.camState()"))["dist"]
    await fr.click(".bZin"); await fr.click(".bZin"); d4 = (await fr.evaluate("EXPLORE_APP.camState()"))["dist"]
    check(d1 > d0*1.2 and d2 < d1*.7 and d3 > d2 and d4 < d3, f"[{tag}] zoom out / in inside the viewer with the wheel and − / + buttons",
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
    await pg.wait_for_timeout(600); await fr.evaluate("EXPLORE_APP.setLayer('chambers', true); EXPLORE_APP.setLayer('vessels', true); EXPLORE_APP.setCoronaries(true)"); await pg.wait_for_timeout(700)
    front = [l["id"] for l in await fr.evaluate("EXPLORE_APP.visibleLabels()")]
    await fr.evaluate("EXPLORE_APP.setView('Below')"); await pg.wait_for_timeout(700)
    below = [l["id"] for l in await fr.evaluate("EXPLORE_APP.visibleLabels()")]
    check("artery:RCA" in front and any(i in front for i in ("RA", "RV_cavity")) and "artery:PDA" in below, f"[{tag}] with the beat off, ticking layers refreshes labels; RCA (front) and PDA (below) show", f"front={front} below={below}")
    await fr.evaluate("for (const k of ['valves','conduction']) EXPLORE_APP.setLayer(k, true)")
    # T6.2-B: Relevant label sets (4–20 per view, essential vessels and conduction included) drive the "Find in this view" chips; most of them show in Relevant mode
    rel = await fr.evaluate("""(()=>{const out={},L0={...EXPLORE_APP.st.layers},b0=EXPLORE_APP.st.beat,m0=EXPLORE_APP.st.labelMode;for(const [k,ids] of Object.entries(EXPLORE_DATA.RELEVANT_LABELS)){if(!ids.length)continue;
      EXPLORE_APP.setBeat(false,0);if(k==='external'||k==='seeThrough'){EXPLORE_APP.setMode(k==='external'?'ext':'xray');EXPLORE_APP.setView('Front')}else{EXPLORE_APP.setMode('cut');EXPLORE_APP.setCut(k)}
      EXPLORE_APP.viewDefaults(k);EXPLORE_APP.labelMode('relevant');EXPLORE_APP.render();EXPLORE_APP.render();
      const shown=EXPLORE_APP.visibleLabels().map(x=>x.id).filter(id=>ids.includes(id)),chips=[...document.querySelectorAll('.panel [data-find]')].map(b=>b.dataset.find);
      out[k]={n:ids.length,shown:shown.length,chipsMatch:k==='external'||k==='seeThrough'||JSON.stringify(chips)===JSON.stringify(ids)}}
      EXPLORE_APP.labelMode(m0);EXPLORE_APP.setMode('ext');EXPLORE_APP.resetView();for(const k in L0)EXPLORE_APP.setLayer(k,L0[k]);EXPLORE_APP.setBeat(b0);return out})()""")
    check(all(4 <= v['n'] <= 20 and v['chipsMatch'] and v['shown'] >= min(3, v['n']) for v in rel.values()) and len(rel) == 9, f"[{tag}] Relevant sets: 4–20 per view, Find chips match, at least 3 shown per view", str(rel))
    leaf = await fr.evaluate("(()=>{EXPLORE_APP.select('MV_AML',null);const c=document.querySelector('.panel h2').textContent;EXPLORE_APP.select(null,null);return [c,EXPLORE_DATA.RELEVANT_LABELS.valves.includes('MV_AML'),EXPLORE_DATA.RELEVANT_LABELS.valves.includes('mitral_valve')]})()")
    check('anterior leaflet' in leaf[0].lower() and not leaf[1] and leaf[2], f"[{tag}] one name per valve on the model; a leaflet tap names the leaflet", str(leaf))
    lbl = await fr.evaluate("(()=>{const a=EXPLORE_APP.anchors,f=id=>a.find(x=>x.id===id&&x.where==='cav');return {LA:f('LA')?.home.toArray(),RV:f('RV_cavity')?.home.toArray()}})()")
    check(lbl['LA'] and lbl['RV'] and lbl['LA'][0] < 0 and lbl['RV'][0] > 2.5, f"[{tag}] chamber names point into their own cavity (exported label anchors)", str(lbl))
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


async def conduction_view_checks(pg, fr):
    """T6.2(b): visible graph, real pointer taps, playback and live strip. No muscle-map claims."""
    await fr.evaluate("EXPLORE_APP.playback({playing:false});EXPLORE_APP.setBeat(false,0);EXPLORE_APP.setMode('ext');EXPLORE_APP.setView('Front');EXPLORE_APP.conduction(false);EXPLORE_APP.seek(0);EXPLORE_APP.render()")
    before=await fr.evaluate("[document.querySelector('.viewer').getBoundingClientRect().height,document.querySelector('.conduction-panel').getBoundingClientRect().top+scrollY,document.querySelector('.conduction-panel').getBoundingClientRect().height]")
    if A.shots: await fr.locator('.viewer').screenshot(path=shot('conduction_off_ext.png'))
    await fr.evaluate("EXPLORE_APP.conduction(true);EXPLORE_APP.render()")
    after=await fr.evaluate("[document.querySelector('.viewer').getBoundingClientRect().height,document.querySelector('.conduction-panel').getBoundingClientRect().top+scrollY,document.querySelector('.conduction-panel').getBoundingClientRect().height]")
    check(before==after,"Conduction toggle reserves the ECG strip without layout shift",str([before,after]))
    check(await fr.evaluate("EXPLORE_APP.conductionState().opacity===.3 && document.querySelector('[data-layer=conduction]').checked"),
          "Conduction toggle and layer checkbox agree; External shell is 30% opaque")
    check(not await fr.evaluate("EXPLORE_APP.conductionMidpoint('ap').visible || EXPLORE_APP.conductionMidpoint('cti').visible"),
          "normal mode hides the accessory pathway and circuit-only CTI")
    bridge=await fr.evaluate("(()=>{const p=CONDUCTION_VIEW.parts.find(p=>p.edge?.id==='AVN-HIS'),times=p.pair[0].geometry.attributes.aTime.array.slice(p.offset,p.offset+p.count);return [Math.min(...times),Math.max(...times)]})()")
    check(abs(bridge[0]-65.6)<.01 and abs(bridge[1]-147.6)<.01,
          "AV bridge starts at AVN arrival and reaches His only after the full AV delay",str(bridge))
    errors=[];counts={};clipped=[]
    for mode in ('ext','xray','cut'):
        await fr.evaluate(f"EXPLORE_APP.setMode('{mode}');"+('EXPLORE_APP.setCut("a4c");' if mode=='cut' else 'EXPLORE_APP.setView("Front");')+"EXPLORE_APP.playback({playing:false});EXPLORE_APP.seek(100);EXPLORE_APP.render()")
        if A.shots: await fr.locator('.viewer').screenshot(path=shot(f'conduction_on_{mode}.png'))
        targets=await fr.evaluate("Object.keys(CGRAPH.spec.display.shortNames)")
        counts[mode]=0
        for tap in targets:
            point=await fr.evaluate("id=>EXPLORE_APP.conductionMidpoint(id)",tap)
            if not point or not point['visible']:
                if mode=='cut':clipped.append(tap)
                continue
            # Use a real pointer event on the viewer; locator scrolling preserves local coordinates.
            # Obtain viewport coordinates within the iframe; click stays relative to the viewer.
            origin=await fr.evaluate("(()=>{const e=document.querySelector('.viewer'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.left+parseFloat(s.borderLeftWidth),y:r.top+parseFloat(s.borderTopWidth)}})()")
            await fr.locator('.viewer').click(position={'x':point['x']-origin['x'],'y':point['y']-origin['y']})
            selected=await fr.evaluate("({selected:CONDUCTION_VIEW.state.selected,title:EXPLORE_APP.card()})")
            expected=await fr.evaluate("id=>CONTENT.STRUCT[CGRAPH.spec.display.pick.taps[id]]?.name||CGRAPH.spec.display.shortNames[id]",tap)   # T6.2-B: full name in the card
            if selected!={'selected':tap,'title':expected}:errors.append([mode,tap,selected])
            counts[mode]+=1
        # Every visible callout remains a pointer card target, including crowded fascicles.
        for tap in await fr.evaluate("CONDUCTION_VIEW.labels.filter(l=>!l.el.hidden).map(l=>l.id)"):
            await fr.locator(f'.conduction-label[data-tap="{tap}"]').click()
            if await fr.evaluate("CONDUCTION_VIEW.state.selected")!=tap:errors.append([mode,tap,'label'])
    check(not errors,"projected midpoint and label taps open the contract cards in External, X-ray and 4C",str(errors[:6]) if errors else str(counts))
    # T6.2-B: the 4C view draws only its own conduction parts (EXPLORE_DATA.VIEW_CONDUCTION.a4c) and only where they lie on the visible anatomy
    shown4c=await fr.evaluate("EXPLORE_DATA.VIEW_CONDUCTION.a4c")
    check(all(t in clipped for t in targets if t not in shown4c) and 'sa' not in clipped and 'his' not in clipped,"4C hides the conduction parts it does not teach and shows SA node + His on the cut anatomy",str(clipped))
    await fr.evaluate("EXPLORE_APP.setMode('ext');EXPLORE_APP.setView('Front');EXPLORE_APP.setMode({atrial:'sinus',ventricular:'wpw',blocks:[]});EXPLORE_APP.render()")
    ap=await fr.evaluate("EXPLORE_APP.conductionMidpoint('ap')")
    hit=await fr.evaluate("p=>EXPLORE_APP.tapAt(p.x,p.y)",ap)
    check(ap['visible'] and hit=='conduction:ap',"WPW mode exposes a tappable accessory pathway",str(hit))
    modes=await fr.evaluate("Object.keys(CGRAPH.spec.modes.ventricular)")
    for mode in modes:
        await fr.evaluate("m=>EXPLORE_APP.setMode({atrial:'sinus',ventricular:m,blocks:[]})",mode)
    check(await fr.evaluate("EXPLORE_APP.conductionState().cacheSize")>=len(modes),"every ventricular mode runs and caches lazily")
    await fr.evaluate("EXPLORE_APP.setMode({atrial:'sinus',ventricular:'normal',avDelay:120,blocks:['RBB','BACH']});EXPLORE_APP.seek(100);EXPLORE_APP.render()")
    blocked=await fr.evaluate("({rings:EXPLORE_APP.conductionState().rings,rb:CONDUCTION_VIEW.timing().v.RB1,bb:CONDUCTION_VIEW.timing().a.BB1})")
    check(set(blocked['rings'])=={'RBB','BACH'} and blocked['rb']==float('inf') and blocked['bb']==float('inf'),
          "explicit blocks change graph timing and draw red shape markers",str(blocked))
    await fr.evaluate("EXPLORE_APP.setMode({atrial:'sinus',ventricular:'normal',avDelay:82,blocks:[]});EXPLORE_APP.seek(100);EXPLORE_APP.render()")
    check(await fr.evaluate("document.querySelector('[data-phase=PR]').classList.contains('on') && CONDUCTION_VIEW.parts.find(p=>p.nodeId==='AVN').pair[0].material.userData.wave.uPulse.value>0"),
          "AV delay pulses the node and highlights the PR chip on the shared clock")
    await fr.evaluate("EXPLORE_APP.seek(40);EXPLORE_APP.render()")
    hashes=[]
    for ms,name in ((40,'mid_P'),(100,'AV_pause'),(220,'mid_QRS')):
        await fr.evaluate("ms=>{EXPLORE_APP.seek(ms);EXPLORE_APP.render()}",ms)
        image=await fr.locator('.viewer').screenshot(path=shot(f'conduction_{name}.png') if A.shots else None)
        hashes.append(hashlib.md5(image).hexdigest())
    check(len(set(hashes))==3,"network shaders show distinct mid-P, AV pause and QRS times")
    await fr.evaluate("EXPLORE_APP.seek(2000);EXPLORE_APP.render()")
    check(await fr.evaluate("document.querySelectorAll('.conduction-panel select option').length===12 && document.querySelector('.rHR').textContent==='72'"),
          "live strip contains all 12 leads and heart-rate readout")
    if A.shots:await fr.locator('.conduction-panel').screenshot(path=shot('conduction_ecg_12.png'))
    await fr.locator('.conduction-panel [data-step="5"]').click()
    check(await fr.evaluate("EXPLORE_APP.now()===2005 && !CONDUCTION_VIEW.state.playing"),"+5 ms step advances the single paused clock exactly")
    await fr.locator('.conduction-panel [data-step="-5"]').click()
    check(await fr.evaluate("EXPLORE_APP.now()===2000"),"−5 ms step reverses the clock exactly")
    check(await fr.evaluate("Math.abs(document.querySelector('.conTrace').getAnimations()[0].currentTime-EXPLORE_APP.now())<.01"),
          "ECG compositor cursor and 3D use the same paused millisecond clock")
    speeds=[]
    for speed in ('0.1','0.25','1'):
        await fr.locator(f'.conduction-panel [data-speed="{speed}"]').click()
        speeds.append(await fr.evaluate('CONDUCTION_VIEW.state.speed'))
    check(speeds==[.1,.25,1],"playback offers 0.1×, 0.25× and 1×")
    # Reuse hook remains explicit about the next task instead of inventing circuit behavior.
    check(await fr.evaluate("(()=>{try{CONDUCTION_VIEW.playCircuit('flutterCCW')}catch(e){return e.message==='T8.2'}return false})()"),"circuit playback remains a T8.2 stub")
    await fr.evaluate("EXPLORE_APP.select(null,null);EXPLORE_APP.labelMode('explore');EXPLORE_APP.setBeat(true);EXPLORE_APP.playback({playing:true,speed:1});scrollTo(0,0)")
    # Locator clicks on ECG controls scroll the OUTER page as well as the iframe.
    # Measure an actually visible viewer, with its visibility observer settled.
    await pg.evaluate('scrollTo(0,0)');await fr.locator('.viewer').scroll_into_view_if_needed();await pg.wait_for_timeout(400)
    # Warm both the network and its compositor layers before comparing steady work.
    await fr.evaluate("EXPLORE_APP.conduction(true)")
    await fr.evaluate("async()=>new Promise(resolve=>{let n=0;function frame(){if(++n<32)requestAnimationFrame(frame);else resolve()}requestAnimationFrame(frame)})")
    frame_times={False:[],True:[]}
    for on in (False,True,False,True):
        await fr.evaluate("on=>EXPLORE_APP.conduction(on)",on)
        times=await fr.evaluate("""async()=>new Promise(resolve=>{
            const times=[];let last=0;function frame(t){if(last)times.push(t-last);last=t;
                if(times.length<64)requestAnimationFrame(frame);else resolve(times.slice(16));}
            requestAnimationFrame(frame);
        })""")
        frame_times[on].extend(times)
    # Arithmetic means across interleaved samples retain the same 1.3× limit
    # without the old 5-versus-7 vsync median-quantisation jump.
    off=sum(frame_times[False])/len(frame_times[False])
    on=sum(frame_times[True])/len(frame_times[True])
    check(on<=off*1.3,"SwiftShader Conduction frame interval is at most 1.3× off after warmup",f"off={off:.1f} ms on={on:.1f} ms ratio={on/off:.2f}")
    await fr.evaluate("EXPLORE_APP.conduction(false);EXPLORE_APP.setBeat(true);EXPLORE_APP.playback({playing:true,speed:1});scrollTo(0,0)")

async def redesign_checks(pg,fr):
    """T6.2-C: rendering, display isolation, labels and moving valve frames."""
    original_viewport=pg.viewport_size;await pg.set_viewport_size({'width':1440,'height':1050})
    await pg.evaluate("location.hash='#heart3d'")
    await fr.evaluate("EXPLORE_APP.playback({playing:false});EXPLORE_APP.setBeat(false,0);EXPLORE_APP.setMode('ext');EXPLORE_APP.conduction(true);EXPLORE_APP.seek(600);EXPLORE_APP.render()")
    await pg.wait_for_timeout(350)
    await fr.evaluate('EXPLORE_APP.activationReady().then(()=>true)')
    geometry=await fr.evaluate('''()=>{
      const parts=CONDUCTION_VIEW.parts,tree=parts.filter(p=>p.illustrative),g=CGRAPH;
      const tapered=parts.filter(p=>p.curve&&p.edge).every(p=>{
        const P=p.geometry.attributes.position,C=p.geometry.attributes.aCenter;
        return Math.abs(Math.hypot(P.getX(0)-C.getX(0),P.getY(0)-C.getY(0),P.getZ(0)-C.getZ(0))-p.radii[0])<1e-5;
      });
      const w=parts[0].pair[0].material.userData.wave;
      return {tapered,tree:tree.length,lv:tree.filter(p=>p.ventricle==='LV').length,rv:tree.filter(p=>p.ventricle==='RV').length,
        isolated:tree.every(p=>p.seed===false&&p.tappable===false&&!p.picker&&!p.edge&&p.depthCm>=.05&&p.depthCm<=.15&&g.nodes[p.terminalId]?.purkinje&&
          (/^(RB|MOD)/.test(p.terminalId)?'RV':'LV')===p.ventricle),
        caps:parts.some(p=>p.cap),fan:parts.some(p=>p.ribbon&&p.alpha===.35),av:parts.find(p=>p.nodeId==='AVN').radius,
        rest:w.uRest.value,restInk:w.uRestInk.value.getHexString(),playingInk:parts[0].colour};
    }''')
    check(geometry['tapered'] and geometry['caps'] and geometry['fan'] and geometry['av']==.24,
          'T6.2-C: tapered tubes, round caps, AV bead and translucent LBB fan',str(geometry))
    check(geometry['tree']>=100 and geometry['lv']>geometry['rv']>0 and geometry['isolated'],
          'T6.2-C: illustrative tree is subendocardial, ventricle-owned and has no seed or picker',str(geometry))
    shell=await fr.evaluate('''()=>CONDUCTION_VIEW.parts.filter(p=>p.illustrative).every(p=>p.controlPoints.every((q,j)=>{
      const v=EXPLORE_APP.activationAt(p.surfaceIndices[j],'interior'),distance=Math.hypot(...q.map((x,k)=>x-v.p[k]));
      return v.cavity===(p.ventricle==='LV'?'LV_cavity':'RV_cavity')&&distance>=.04999&&distance<=.15001&&
        !(p.ventricle==='LV'&&v.p[2]<1.8&&v.label!=='IVS')&&!(p.ventricle==='RV'&&v.p[2]<1.5);
    }))''')
    check(shell,'T6.2-C: every tree control point lies .05–.15 cm under its own endocardium, outside free zones')
    deterministic=await fr.evaluate("JSON.stringify(CONDUCTION_VIEW.treeRecipe())===JSON.stringify(CONDUCTION_VIEW.treeRecipe())")
    check(deterministic,'T6.2-C: rebuilding the illustrative tree repeats the fixed-seed geometry')
    isolated=await fr.evaluate('''async()=>{
      const before=JSON.stringify(await EXPLORE_APP.activationSeedSources()),times=JSON.stringify(CGRAPH.times('V',{HIS:0}));
      const extras=['A','V'].map(side=>({...CGRAPH.edges.find(e=>e.side===side),T_ms:0,illustrative:true}));
      CGRAPH.edges.push(...extras);
      try{return times===JSON.stringify(CGRAPH.times('V',{HIS:0}))&&before===JSON.stringify(await EXPLORE_APP.activationSeedSources())}
      finally{CGRAPH.edges.splice(-extras.length)}
    }''')
    check(isolated,'T6.2-C: illustrative edges cannot change muscle seeds')
    pickable=await fr.evaluate('''()=>{
      const tree=CONDUCTION_VIEW.parts.filter(p=>p.illustrative),saved=CONDUCTION_VIEW.parts.filter(p=>!p.illustrative).map(p=>[p,p.samples]);
      // Remove every real hit surface: decorative tubes alone must never win a tap.
      for(const [p] of saved)p.samples=[];
      try{return tree.every(p=>{const q=EXPLORE_APP.screenOf(p.anchor.toArray());return EXPLORE_APP.tapAt(...q)?.startsWith('conduction:')!==true})}
      finally{for(const [p,samples] of saved)p.samples=samples}
    }''')
    check(pickable,'T6.2-C: illustrative segments alone never pick')
    fade=await fr.evaluate('''()=>{const v=CONDUCTION_VIEW,w=v.parts[0].pair[0].material.userData.wave;
      EXPLORE_APP.select(null,null);EXPLORE_APP.playback({playing:true});const f=v.fadeState();
      v.update(v.state.ms,f.start+150);const halfway=w.uRest.value;
      v.update(v.state.ms,f.start+300);return {halfway,playing:w.uRest.value,duration:f.durationMs};
    }''')
    await fr.evaluate('EXPLORE_APP.playback({playing:false});EXPLORE_APP.seek(600)')
    await pg.wait_for_timeout(350)
    rest=await fr.evaluate('CONDUCTION_VIEW.parts[0].pair[0].material.userData.wave.uRest.value')
    check(geometry['restInk']=='f3dfa2' and geometry['rest']==1 and abs(fade['halfway']-.5)<.001 and fade['playing']==0 and fade['duration']==300 and rest==1,
          'T6.2-C: cream-gold ↔ teal fades for 300 ms, including when paused',str([fade,rest]))
    await fr.evaluate("EXPLORE_APP.setMode('xray');EXPLORE_APP.viewDefaults('seeThrough');EXPLORE_APP.labelMode('all');EXPLORE_APP.render()")
    group=fr.locator('.lab[data-id="group:avJunction"]')
    check(await group.is_visible() and not await fr.locator('.conduction-label[data-tap="his"]').is_visible(),
          'T6.2-C: All collapses the AV junction to one label')
    await group.click(); await fr.evaluate('EXPLORE_APP.render()')
    check(await group.is_hidden() and await fr.locator('.conduction-label[data-tap="his"]').is_visible(),
          'T6.2-C: tapping AV junction fans out its member labels')
    fade=await fr.evaluate("[...document.querySelectorAll('.lab-landmarks:not([hidden])')].map(e=>getComputedStyle(e).opacity)")
    check(bool(fade) and all(x=='0.55' for x in fade),'T6.2-C: fade layers dim All labels to .55',str(fade))
    await fr.evaluate("EXPLORE_APP.labelMode('relevant');EXPLORE_APP.tapStruct('avn');EXPLORE_APP.render()")
    check(await group.is_hidden() and await fr.evaluate("getComputedStyle(document.querySelector('[data-tap=avn]')).borderColor==='rgb(255, 255, 255)'"),
          'T6.2-C: Relevant stays ungrouped and selected label border is white')
    valve=await fr.evaluate('''()=>{
      const a=EXPLORE_APP;a.setMode('cut');a.setCut('a4c');const frames=[];
      for(const t of [0,.15,.4,.7]){a.setBeat(false,t);a.render();frames.push(a.anchors.filter(x=>x.where==='valve').map(x=>[x.id,x.valveFrame,x.home.toArray()]));}
      return {frames:new Set(frames.map(x=>JSON.stringify(x))).size,all:frames.every(x=>x.every(y=>y[1]))};
    }''')
    check(valve['frames']>=3 and valve['all'],'T6.2-C: valve and leaflet anchors follow current exported frames',str(valve))
    await fr.evaluate('EXPLORE_APP.isochrones(true);EXPLORE_APP.render()');await fr.evaluate('EXPLORE_APP.activationReady().then(()=>true)')
    wording=await fr.evaluate("(()=>{const t=CGRAPH.spec.display.tissueWave.timingMapText;return document.querySelector('.bIsochrones').textContent.includes(t.button)&&[...document.querySelectorAll('[data-timing-text]')].every(e=>e.textContent===t[e.dataset.timingText])})()")
    check(wording,'T6.2-C: timing map uses all approved timingMapText wording')
    for view in ('external','seeThrough','a4c','raOpen'):
        for playing in (False,True):
            await fr.evaluate("({view,playing})=>{const a=EXPLORE_APP;a.playback({playing:false});a.setBeat(false,0);a.isochrones(false);a.setMode(view==='external'?'ext':view==='seeThrough'?'xray':'cut');if(!['external','seeThrough'].includes(view))a.setCut(view);else a.setView('Front');a.viewDefaults(view);a.conduction(true);a.select(null,null);a.labelMode('all');a.seek(playing?220:600);a.playback({playing});a.render()}",{'view':view,'playing':playing})
            await pg.wait_for_timeout(350)
            cut=view in ('a4c','raOpen')
            check(await fr.evaluate('''({cut,view})=>{const p=CONDUCTION_VIEW.parts[0],w=p.pair[0].material.userData.wave;return p.pair[0].visible===(view==='seeThrough')&&w.uPull.value===(cut?(CGRAPH.spec.display.cutPullCm??.45):0)&&w.uWidth.value===(cut?.8:1)&&CONDUCTION_VIEW.group.children.filter(m=>m.material?.blending===THREE.AdditiveBlending).every(m=>m.visible===!cut)}''',{'cut':cut,'view':view}),
                  f'T6.2-C: {view} preserves cut subsets, uPull and no hidden-wall pass ({"playing" if playing else "rest"})')
            if A.shots:
                # Avoid locator stability polling against a live WebGL stage.
                await fr.locator('.model-stage').evaluate("e=>e.scrollIntoView({block:'start'})")
                box=await fr.locator('.model-stage').bounding_box();scroll=await pg.evaluate('({x:scrollX,y:scrollY})')
                box['x']+=scroll['x'];box['y']+=scroll['y']
                await pg.screenshot(path=shot(f'T6.2-C-{view}-{"playing" if playing else "rest"}.png'),clip=box)
    await fr.evaluate("EXPLORE_APP.labelMode('explore');EXPLORE_APP.setMode('ext');EXPLORE_APP.setBeat(false,0);EXPLORE_APP.playback({playing:false});EXPLORE_APP.conduction(false)")
    await pg.set_viewport_size(original_viewport)

async def activation_checks(pg,fr):
    """T6.2(c): technical checks plus strict, uncalibrated medical-contract audit.
    Contract mismatches stay failures until the spec owner resolves them.
    """
    await fr.evaluate("EXPLORE_APP.playback({playing:false});EXPLORE_APP.setBeat(false,0);EXPLORE_APP.conduction(true);EXPLORE_APP.setMode({atrial:'sinus',ventricular:'normal'});EXPLORE_APP.isochrones(false)")
    await fr.evaluate('EXPLORE_APP.activationReady().then(()=>true)')
    state=await fr.evaluate('EXPLORE_APP.activationState()')
    check(state['ready'] and state['worker'] and state['diagnostics']['solver']=='geodesic-26','activation uses the capVolume geodesic worker; precompute ms',str(state))
    synthetic=await fr.evaluate('''async()=>{
      const names=['','PW','LV_cavity'],positions=new Float32Array([.1,.1,.1,.5,.1,.1]);
      const m={positions,names,walls:{1:'LV'},labels:new Uint8Array([1,1]),wall:new Uint8Array([1,1]),cavity:new Uint8Array([2,2])};
      const job={meshes:[m,m],spec:CGRAPH.spec,landmarks:{},mode:{},seeds:{a:[{p:[.1,.1,.1],t:0}],v:[{p:[.1,.1,.1],t:0,chamber:3}]},
        cap:{n:[3,3,1],lo:[0,0,0],v:.2,labels:new Uint8Array([1,0,1,1,0,1,1,1,1])}};
      const geo=await ACTIVATION.solve(job);delete job.cap;const euclid=await ACTIVATION.solve(job);
      return {around:geo.meshes[0].tV[1],wrongSide:geo.meshes[0].tA[1],fallback:euclid.meshes[0].tV[1]};
    }''')
    check(synthetic['around']>10 and synthetic['wrongSide']==1e9 and abs(synthetic['fallback']-32)<.01,
          'solver routes around a blood gap, rejects wrong-side seeds, and keeps the legacy fallback penalty',str(synthetic))
    maps={}
    for mode in ('normal','rbbb','lbbb','lafb','lpfb','wpw'):
        await fr.evaluate("m=>EXPLORE_APP.setMode({atrial:'sinus',ventricular:m})",mode)
        await fr.evaluate('EXPLORE_APP.activationReady().then(()=>true)')
        result=await fr.evaluate('''()=>{const app=EXPLORE_APP,all=[],near={},errors={insulation:0,excluded:0,sleeves:0};
          const pv=Object.values(parent.PUN_HEART_INTERIOR.landmarks.pv_ostia.points),svc=['svc_junction','sa_node'].map(k=>parent.PUN_HEART_INTERIOR.landmarks[k].p);
          for(const mesh of ['outer','interior'])for(let i=0;i<app.activationCount(mesh);i++){
            const v=app.activationAt(i,mesh);v.mesh=mesh;v.i=i;all.push(v);
            if(v.class===1&&v.tV<1e9||v.class>1&&v.tA<1e9)errors.insulation++;
            if(v.class===0&&Math.abs(v.strength-.4)>.00001&&(v.tA<1e9||v.tV<1e9))errors.excluded++;
            if(v.class===1&&['SVC','pulmonary_veins'].includes(v.label)&&!(v.label==='SVC'?svc:pv).some(q=>Math.hypot(...v.p.map((x,k)=>x-q[k]))<=1.00001))errors.sleeves++;
            if(mesh==='interior')for(const id of ['SA','IAS','BB2','AVN','LAA','LAP','AP_A','LAI']){
              if(v.class!==1)continue;const d=Math.hypot(...v.p.map((x,k)=>x-CGRAPH.nodes[id].p[k]));if(!near[id]||d<near[id].distance)near[id]={distance:d,time:v.tA,label:v.label};
            }
          }
          const summary=items=>{const a=items.filter(v=>v.tV<1e9).map(v=>v.tV).sort((a,b)=>a-b);return {n:a.length,min:a[0],median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)}};
          const atria=all.filter(v=>v.class===1&&v.tA<1e9).map(v=>v.tA),vent=all.filter(v=>v.class>1&&v.tV<1e9).sort((a,b)=>a.tV-b.tV);
          return {state:app.activationState(),errors,near,atrialMin:Math.min(...atria),atrialMax:Math.max(...atria),first:vent[0],
            allV:summary(vent),RV:summary(vent.filter(v=>v.wall==='RV')),LV:summary(vent.filter(v=>v.wall==='LV')),
            septum:summary(vent.filter(v=>v.label==='IVS')),rvBreakthrough:summary(vent.filter(v=>v.mesh==='outer'&&v.wall==='RV')),
            rvSeptal:summary(vent.filter(v=>v.mesh==='interior'&&v.label==='IVS'&&['RV_cavity','RVOT'].includes(v.cavity))),
            lvSeptal:summary(vent.filter(v=>v.mesh==='interior'&&v.label==='IVS'&&['LV_cavity','LVOT'].includes(v.cavity))),
            lvEndocardium:summary(vent.filter(v=>v.mesh==='interior'&&v.label==='PW'&&['LV_cavity','LVOT'].includes(v.cavity))),
            lvMidApex:summary(vent.filter(v=>v.mesh==='outer'&&v.wall==='LV'&&v.aha>=7)),
            anterolateral:summary(vent.filter(v=>v.mesh==='outer'&&[6,12].includes(v.aha))),inferior:summary(vent.filter(v=>v.mesh==='outer'&&[4,10,15].includes(v.aha)))};
        }''')
        maps[mode]=result
        check(not any(result['errors'].values()),f'{mode}: both meshes preserve insulation, never-activate tissue and 1 cm sleeves',str(result['errors']))
        check(result['state']['ready'],f'{mode}: cached map is ready',str(result['state']['diagnostics']))
        if mode in ('normal','lbbb'):
            await fr.evaluate("EXPLORE_APP.setMode('cut');EXPLORE_APP.setCut('a4c');EXPLORE_APP.isochrones(true);EXPLORE_APP.render()")
            if A.shots:await fr.locator('.viewer').screenshot(path=shot(f'activation_iso_{mode}.png'))
    normal=maps['normal']
    reference={'normal':[81.4,34.9,97.6,66.7,66.0,50.3],'rbbb':[117.2,34.9,125.1,66.7,66.0,54.3],
               'lbbb':[140.9,40.0,157.5,110.0,147.8,50.3],'lafb':[90.9,34.9,102.6,66.7,88.4,50.3],
               'lpfb':[81.4,34.9,97.6,74.4,66.0,50.3]}
    for mode,expected in reference.items():
        m=maps[mode];actual=[m['allV']['max']-m['allV']['min'],m['allV']['min'],m['allV']['p95'],m['inferior']['median'],m['anterolateral']['median'],m['rvBreakthrough']['min']]
        check(all(abs(a-e)<.15 for a,e in zip(actual,expected)),f'T6.2-C: {mode} preserves every audit number in T6.2-B-timing.md',str(actual))
    def contract(ok,msg,value):check(ok,'CONTRACT: '+msg,str(value))
    def window(value,bounds):
        if not isinstance(bounds,list):bounds=[bounds,bounds]
        tolerance=max(8,max(bounds)*.15)
        return value is not None and bounds[0]-tolerance<=value<=bounds[1]+tolerance
    targets=[('SA',[0,10]),('IAS',48.7),('BB2',67.6),('AVN',65.6),('LAA',85.5),('LAP',100),('AP_A',103.2),('LAI',[75,110])]   # T6.2-B: LAI revised (regions.regionTiming)
    for node,bounds in targets:contract(window(normal['near'][node]['time'],bounds),f'normal nearest atrial tissue at {node} meets regionTiming',normal['near'][node])
    contract(window(normal['atrialMax']-normal['atrialMin'],[90,120]),'normal total atrial activation 90–120 ms',normal['atrialMax']-normal['atrialMin'])
    contract(window(normal['allV']['min'],[26,34]) and normal['first']['label']=='IVS','first ventricular muscle is LV septum at 26–34 ms',normal['first'])
    contract(window(normal['rvSeptal'].get('median'),[30,50]),'RV septal endocardium 30–50 ms',normal['rvSeptal'])
    contract(window(normal['lvEndocardium'].get('median'),[30,50]),'LV free-wall endocardium 30–50 ms representative window',normal['lvEndocardium'])
    contract(window(normal['rvBreakthrough']['min'],[45,60]),'RV epicardial breakthrough 45–60 ms',normal['rvBreakthrough'])
    contract(window(normal['lvMidApex']['median'],[50,75]),'LV mid/apical epicardial tissue 50–75 ms',normal['lvMidApex'])
    contract(window(normal['allV']['p95'],[95,125]),'normal last 5% enters 95–125 ms window',normal['allV'])
    contract(window(normal['allV']['max']-normal['allV']['min'],[80,100]),'normal ventricular activation duration 80–100 ms',normal['allV'])
    # T6.2-B: RBBB = normal + 30 ms and >= 110 ms (muscle map; the surface QRS >= 120 ms comes from the VCG template)
    normalDuration=normal['allV']['max']-normal['allV']['min']
    for mode,minimum,wall in [('rbbb',max(110,normalDuration+30),'RV'),('lbbb',130,'LV')]:
        m=maps[mode];duration=m['allV']['max']-m['allV']['min']
        contract(duration>=minimum and m[wall]['p95']>=m['allV']['p95'],f'{mode}: duration >= {minimum} ms and delayed {wall} tail',{'duration':duration,'tail':m[wall],'all':m['allV']})
    blocked=maps['lbbb'];right,left=blocked['rvSeptal'].get('min'),blocked['lvSeptal'].get('min')
    contract(right is not None and left is not None and right<left and blocked['septum']['min']>normal['septum']['min'],'LBBB activates septum right-to-left instead of retaining normal left-side entry',{'normal':normal['septum'],'lbbb':blocked['septum'],'right':blocked['rvSeptal'],'left':blocked['lvSeptal']})
    for mode,region in [('lafb','anterolateral'),('lpfb','inferior')]:
        m=maps[mode];contract(m[region]['median']>normal[region]['median']+.01 and m['allV']['max']-m['allV']['min']<120,f'{mode}: target LV region later than normal; total < 120 ms',{'normal':normal[region],'blocked':m[region],'duration':m['allV']['max']-m['allV']['min']})
    wpw=maps['wpw']['first'];ap=await fr.evaluate('CGRAPH.nodes.AP_V.p')
    contract(sum((a-b)**2 for a,b in zip(wpw['p'],ap))**.5<=1,'WPW starts within 1 cm of AP_V',wpw)
    if A.shots or A.activation_audit:
        with open(A.activation_audit or shot('activation_audit.json'),'w',encoding='utf8') as f:json.dump(maps,f,indent=2)
    # Static isochrones ignore seek; wave uses the same clock and changes at fixed times.
    await fr.evaluate("EXPLORE_APP.setMode({atrial:'sinus',ventricular:'normal'});EXPLORE_APP.setMode('ext');EXPLORE_APP.setView('Front');EXPLORE_APP.seek(40);EXPLORE_APP.isochrones(true);EXPLORE_APP.render()")
    await fr.evaluate('CONDUCTION_VIEW.group.visible=false')
    hashes=[]
    for ms in (40,220):
        await fr.evaluate('ms=>{EXPLORE_APP.seek(ms);EXPLORE_APP.render()}',ms)
        hashes.append(hashlib.md5(await fr.locator('.viewer').screenshot()).hexdigest())
    check(hashes[0]==hashes[1],'isochrone map stays static across the playback clock')
    await fr.evaluate('CONDUCTION_VIEW.group.visible=true')
    check(await fr.evaluate("(()=>{const a=EXPLORE_APP.activationState().clocks,w=CONDUCTION_VIEW.parts[0].pair[0].material.userData.wave;return a.a===w.uNowA.value&&a.v===w.uNowV.value})()"),'tissue and network shaders read identical atrial and ventricular clocks')
    await fr.evaluate('EXPLORE_APP.isochrones(false)')
    for ms,name in ((40,'mid_P'),(100,'AV_pause'),(220,'mid_QRS')):
        await fr.evaluate('ms=>{EXPLORE_APP.seek(ms);EXPLORE_APP.render()}',ms)
        if A.shots:await fr.locator('.viewer').screenshot(path=shot(f'activation_{name}.png'))
    # All reuse keys must solve, including silent/no-muscle and ectopic maps.
    for mode in ('hocm','bifasc','hisOnly','vesc','pvc','rvot'):
        await fr.evaluate('m=>EXPLORE_APP.setMode({ventricular:m})',mode);await fr.evaluate('EXPLORE_APP.activationReady().then(()=>true)')
        check(await fr.evaluate('EXPLORE_APP.activationState().ready'),f'{mode}: lazy activation mode computes')
    await fr.evaluate("document.querySelector('.conduction-panel').scrollIntoView();EXPLORE_APP.setMode({atrial:'sinus',ventricular:'lbbb',avDelay:83})")
    offscreen=await fr.evaluate("Promise.race([EXPLORE_APP.activationReady().then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),15000))])")
    check(offscreen,'an explicit map readiness request completes after scrolling to the ECG')
    await fr.evaluate("EXPLORE_APP.setMode({avDelay:82})")
    await fr.evaluate("EXPLORE_APP.setMode({atrial:'sinus',ventricular:'normal'});EXPLORE_APP.isochrones(false);EXPLORE_APP.conduction(false);EXPLORE_APP.setBeat(true);EXPLORE_APP.playback({playing:true,speed:1});scrollTo(0,0)")

async def ui_phase_a_checks(pg,fr):
    await pg.evaluate("location.hash='#heart3d'")
    await fr.wait_for_function('EXPLORE_APP.ready')
    await fr.locator('details.advanced').evaluate('e=>e.open=true')
    await fr.locator('.bIsochrones').wait_for(state='visible')
    initial=await fr.evaluate('EXPLORE_APP.uiState()')
    check(initial['labelMode']=='explore' and not initial['coronaries'] and not initial['callouts'],
          'UI: Explore starts without labels and coronaries are off')
    await fr.evaluate("EXPLORE_APP.isochrones(true);EXPLORE_APP.render()")
    check(initial['timingMapEnabled'] and not await fr.locator('.bIsochrones').is_hidden() and
          await fr.evaluate('EXPLORE_APP.activationState().isochrones'),
          'UI: Activation timing map is available with the shipped flag on')
    await fr.evaluate('EXPLORE_APP.isochrones(false)')
    await fr.locator('details.advanced').evaluate('e=>e.open=false')
    check(initial['colours']=={'impulse':'ffffff','muscle':'ffc83d','after':'ffe9a8'},
          'UI: white impulse, amber muscle wave and faint fading tint uniforms',str(initial['colours']))
    check(await fr.evaluate("[...document.querySelectorAll('.outside-legends .legend,.signalLegend')].every(e=>!e.closest('.viewer'))"),
          'UI: legends sit outside the canvas')
    await fr.evaluate("EXPLORE_APP.playback({playing:false});EXPLORE_APP.conduction(true);EXPLORE_APP.seek(180)")
    for width,height,name in [(1920,1000,'desktop'),(400,860,'phone')]:
        await pg.set_viewport_size({'width':width,'height':height})
        await fr.evaluate("EXPLORE_APP.setMode('ext');EXPLORE_APP.resetView();EXPLORE_APP.labelMode('explore');EXPLORE_APP.select(null,null);EXPLORE_APP.render();document.querySelector('.model-stage').scrollIntoView({block:'center'})")
        await pg.wait_for_timeout(300)
        point=await fr.evaluate("EXPLORE_APP.conductionMidpoint('sa')")
        origin=await fr.locator('.viewer').evaluate('e=>{const r=e.getBoundingClientRect();return {x:r.left,y:r.top}}')
        await fr.locator('.viewer').click(position={'x':point['x']-origin['x'],'y':point['y']-origin['y']})
        await fr.evaluate('EXPLORE_APP.render()')
        labels=await fr.evaluate('EXPLORE_APP.visibleLabels()')
        check([x['id'] for x in labels]==['conduction:sa'] and await fr.evaluate("['SA node','Sinoatrial (SA) node'].includes(EXPLORE_APP.card())"),   # T6.2-B: the card shows the full name
              f'UI {name}: a real Explore tap opens one SA callout and card',str(labels))
        tap=await fr.evaluate("(()=>{const v=document.querySelector('.viewer').getBoundingClientRect();return {v:v.toJSON(),b:EXPLORE_APP.uiState().callouts}})()")
        check(len(tap['b'])==1 and all(c['overHeart']==0 and c['nearHeart']==0 and c['box']['left']>=tap['v']['left'] and c['box']['right']<=tap['v']['right'] and
              c['box']['top']>=tap['v']['top'] and c['box']['bottom']<=tap['v']['bottom'] for c in tap['b']),
              f'UI {name}: the tapped callout sits inside the viewer, clear of the heart',str(tap['b']))
        fill=await fr.evaluate('EXPLORE_APP.heartFill()')
        check(fill['inside'] and 0.6<=fill['short']<=1.0,f'UI {name}: reset view frames the heart to fill the viewer',str(fill))
        async def capture(suffix):
            await fr.evaluate("EXPLORE_APP.render();document.querySelector('.model-stage').scrollIntoView({block:'center'})")
            if A.shots:
                await fr.locator('.model-workspace' if width>1700 else '.model-stage').screenshot(path=shot(f'ui_{name}_{suffix}.png'))
                if suffix in ('explore_tap','relevant','all','wave'):
                    await fr.locator('.toolbar').evaluate("e=>e.scrollIntoView({block:'start'})")
                    await pg.screenshot(path=shot(f'ui_{name}_{suffix}_context.png'))
        await capture('explore_tap')
        await fr.evaluate("EXPLORE_APP.select('RA',null);EXPLORE_APP.render()")
        check((await fr.evaluate('EXPLORE_APP.uiState().focusVertices'))>0,f'UI {name}: anatomy selection highlights existing mesh vertices')
        await fr.evaluate("window.__rel=EXPLORE_DATA.RELEVANT_LABELS.external.splice(0);EXPLORE_DATA.RELEVANT_LABELS.external.push('RA');EXPLORE_APP.labelMode('relevant');EXPLORE_APP.select(null,null);EXPLORE_APP.render()")
        relevantIds=await fr.evaluate('EXPLORE_APP.labelListIds()') if width==400 else [x['id'] for x in await fr.evaluate('EXPLORE_APP.visibleLabels()')]
        check(relevantIds==['RA'],f'UI {name}: Relevant reads the per-view list',str(relevantIds))
        await fr.evaluate("EXPLORE_DATA.RELEVANT_LABELS.external.length=0;EXPLORE_APP.tapStruct('sa');EXPLORE_APP.render()")
        check(await fr.locator('.labelStatus').inner_text()=='No labels configured for this view. Tap a structure to explore.' and
              [x['id'] for x in await fr.evaluate('EXPLORE_APP.visibleLabels()')]==['conduction:sa'],
              f'UI {name}: Relevant preserves an unlisted tapped structure and explains an empty list')
        await fr.evaluate("EXPLORE_DATA.RELEVANT_LABELS.external.push(...window.__rel)")
        await capture('relevant')
        await fr.evaluate("EXPLORE_APP.labelMode('all');EXPLORE_APP.render()")
        boxes=await fr.evaluate("(()=>{const v=document.querySelector('.viewer').getBoundingClientRect();return {v:v.toJSON(),c:EXPLORE_APP.uiState().callouts}})()")
        boxes['b']=[c['box'] for c in boxes['c']]
        inside=all(b['left']>=boxes['v']['left'] and b['right']<=boxes['v']['right'] and b['top']>=boxes['v']['top'] and b['bottom']<=boxes['v']['bottom'] for b in boxes['b'])
        offHeart=sum(c['overHeart']==0 for c in boxes['c'])
        overlap=any(a['left']<b['right'] and b['left']<a['right'] and a['top']<b['bottom'] and b['top']<a['bottom'] for i,a in enumerate(boxes['b']) for b in boxes['b'][i+1:])
        def cross(c1,c2):
            def seg(c):
                b=c['box'];x,y=c['anchor']['x'],c['anchor']['y'];return (x,y,min(b['right'],max(b['left'],x)),min(b['bottom'],max(b['top'],y)))
            (a,b_,c_,d),(e,f,g,h)=seg(c1),seg(c2)
            o=lambda px,py,qx,qy,rx,ry:(qx-px)*(ry-py)-(qy-py)*(rx-px)
            return o(a,b_,c_,d,e,f)*o(a,b_,c_,d,g,h)<0 and o(e,f,g,h,a,b_)*o(e,f,g,h,c_,d)<0
        crossings=sum(cross(a,b) for i,a in enumerate(boxes['c']) for b in boxes['c'][i+1:])
        if width==400:
            ids=await fr.evaluate('EXPLORE_APP.labelListIds()')
            check(len(boxes['b'])==1 and len(ids)>4 and 'conduction:sa' in ids and inside and offHeart==1,
                  f'UI {name}: All shows one callout in the viewer plus a tappable list of label names',f'{len(boxes["b"])} callouts, list {len(ids)}')
            await fr.locator('.labelList .chip[data-id="group:avJunction"]').click();await fr.evaluate('EXPLORE_APP.render()')
            await fr.locator('.labelList .chip[data-id="conduction:his"]').click();await fr.evaluate('EXPLORE_APP.render()')
            check(await fr.evaluate("EXPLORE_APP.card()")!='SA node' and [c['id'] for c in await fr.evaluate('EXPLORE_APP.uiState().callouts')]==['conduction:his'],
                  f'UI {name}: tapping a name in the list shows its callout and card')
            await fr.evaluate("EXPLORE_APP.tapStruct('sa');EXPLORE_APP.render()")
        else:
            edge=min(min(b['left']-boxes['v']['left'],boxes['v']['right']-b['right'],boxes['v']['bottom']-b['bottom']) for b in boxes['b'])
            crowding=sum(c['nearHeart']>0 for c in boxes['c'])
            check(edge>=24 and crowding==0,f'UI {name}: All callouts keep a clear gap from the heart and from the box edge',f'edge {edge:.0f}px, {crowding} too close to the heart')
            check(len(boxes['b'])>4 and inside and not overlap and offHeart>=len(boxes['b'])-1 and crossings<=1,
                  f'UI {name}: All callouts sit inside the viewer, off the heart, without overlaps or crossing lines',
                  f"{len(boxes['b'])} callouts, {len(boxes['b'])-offHeart} over the heart, {crossings} crossings")
        layout=await fr.evaluate("(()=>{const p=document.querySelector('.panel').getBoundingClientRect(),s=document.querySelector('.model-stage').getBoundingClientRect();return {side:p.left>=s.right,below:p.top>=s.bottom}})()")
        check(layout['side'] if width>1700 else layout['below'],f'UI {name}: card uses the appropriate side/below placement',str(layout))
        await capture('all')
        await fr.evaluate("EXPLORE_APP.seeThrough(true);EXPLORE_APP.render()")
        check(await fr.evaluate('EXPLORE_APP.uiState().seeThrough') and await fr.locator('.bSeeThrough').is_visible(),f'UI {name}: See-through is available in External')
        for cut in await fr.evaluate('Object.keys(EXPLORE_APP.CUTS)'):
            state=await fr.evaluate("cut=>{EXPLORE_APP.setMode('cut');EXPLORE_APP.setCut(cut);EXPLORE_APP.labelMode('explore');EXPLORE_APP.seeThrough(true);EXPLORE_APP.render();return EXPLORE_APP.uiState()}",cut)
            check(state['cutOpacity']==1 and not state['cutTransparent'] and not state['seeThrough'] and not state['coronaries'] and await fr.locator('.bSeeThrough').is_hidden(),f'UI {name} {cut}: opaque cut, coronaries off, no See-through')
            await capture('cut_'+cut)
        await fr.evaluate("EXPLORE_APP.setCut('a4c');EXPLORE_APP.setBeat(true);EXPLORE_APP.seek(220);EXPLORE_APP.render()")
        await fr.evaluate('EXPLORE_APP.activationReady()')
        await fr.evaluate("EXPLORE_APP.seek(220);EXPLORE_APP.render()")
        await capture('wave')
        await fr.evaluate("EXPLORE_APP.seek(700);EXPLORE_APP.render()")
        await capture('diastole')
        check(await fr.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'UI {name}: no horizontal overflow')
    await pg.set_viewport_size({'width':1440,'height':900})
    await fr.evaluate("EXPLORE_APP.setMode('ext');EXPLORE_APP.select(null,null);EXPLORE_APP.labelMode('explore');EXPLORE_APP.conduction(false);EXPLORE_APP.resetView();EXPLORE_APP.playback({playing:true,speed:1});scrollTo(0,0)")

async def main():
    url = "file://" + os.path.abspath(A.index)
    if A.shots: os.makedirs(A.shots, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={"width": 1440, "height": 900}, color_scheme="dark"); pg = await ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append("page: " + str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append("console: " + m.text))
        await pg.goto(url); await pg.wait_for_timeout(600)
        if A.b6 or A.redesign:
            await pg.evaluate("location.hash='#heart3d'"); await pg.wait_for_timeout(700)
            fr=await lab_frame(pg,'heart3d');await fr.wait_for_function('window.EXPLORE_APP',timeout=180000)
            if A.redesign:await redesign_checks(pg,fr)
            else:
                for run in range(3):
                    print(f'B6 consecutive run {run+1}/3',flush=True)
                    await conduction_view_checks(pg,fr)
            check(not errs,'no page or console errors',str(errs[:4]));await b.close();print(f'\n{len(fails)} failure(s)');sys.exit(1 if fails else 0)
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
            await ui_phase_a_checks(pg,await lab_frame(pg,"heart3d"))
            await conduction_core_checks(await lab_frame(pg, "heart3d"), await lab_frame(pg, "pathology"))
            await pg.evaluate("location.hash = '#heart3d'"); await explore_checks(pg, await lab_frame(pg, "heart3d"), "3D Heart")
            await conduction_view_checks(pg,await lab_frame(pg,"heart3d"))
            await redesign_checks(pg,await lab_frame(pg,"heart3d"))
            await activation_checks(pg,await lab_frame(pg,"heart3d"))
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
                if key=='heart3d':
                    await fr.evaluate("EXPLORE_APP.playback({playing:false});EXPLORE_APP.conduction(false);EXPLORE_APP.render()")
                    before_phone=await fr.evaluate("(()=>{const r=document.querySelector('.conduction-panel').getBoundingClientRect();return [r.top+scrollY,r.height]})()")
                    await fr.evaluate("EXPLORE_APP.playback({playing:false});EXPLORE_APP.conduction(true);EXPLORE_APP.seek(2000);EXPLORE_APP.render()")
                    after_phone=await fr.evaluate("(()=>{const r=document.querySelector('.conduction-panel').getBoundingClientRect();return [r.top+scrollY,r.height]})()")
                    check(before_phone==after_phone,"phone Conduction toggle keeps the reserved ECG panel height and position",str([before_phone,after_phone]))
                    await fr.evaluate("EXPLORE_APP.tapStruct('sa');EXPLORE_APP.render()")
                    phone=await fr.evaluate("({leads:document.querySelector('.conduction-panel').dataset.leadCount,selected:document.querySelector('.conLead select').value,labels:CONDUCTION_VIEW.labels.filter(l=>!l.el.hidden).map(l=>l.id),width:[document.documentElement.scrollWidth,innerWidth]})")
                    check(phone['leads']=='1' and phone['selected']=='II' and phone['width'][0]<=phone['width'][1],
                          "phone Conduction strip collapses to lead II without horizontal scroll",str(phone))
                    check(phone['labels']==['sa'],
                          "phone Explore shows only the tapped conduction callout",str(phone['labels']))
                    if A.shots:await fr.locator('.conduction-panel').screenshot(path=shot('phone_conduction_ecg.png'))
            await ctx.close()
            ctx=await b.new_context(viewport={"width":400,"height":860},reduced_motion='reduce');pg=await ctx.new_page()
            await pg.goto(url);await pg.evaluate("location.hash='#heart3d'");await pg.wait_for_function('LABS.heart3d.frame');fr=await lab_frame(pg,'heart3d')
            await fr.wait_for_function("window.EXPLORE_APP && EXPLORE_APP.ready",timeout=180000)
            reduced_state=await fr.evaluate("EXPLORE_APP.conductionState()")
            check(not reduced_state['playing'] and reduced_state['speed']==.25,"reduced motion starts paused at 0.25×",str(reduced_state))
            await ctx.close()
        await b.close()
    print(f"\n{len(fails)} failure(s)"); [print("  -", f) for f in fails]; sys.exit(1 if fails else 0)

asyncio.run(main())
