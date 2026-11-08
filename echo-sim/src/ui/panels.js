/* ===== PANELS: top bar, Probe/Image tabs, sliders, ECG strip, echo overlay (depth scale + orientation dot) =====
   Sliders only emit deltas or imaging changes through APP; they read their values back every time the state changes. */
function makePanels(APP){
  const $ = id => document.getElementById(id), { ph, VJ } = APP;
  /* ---- sliders ---- */
  const P = () => APP.pose;
  const SL = {
    probe: [
      { id: "x", label: "Left–right", min: -14, max: 14, step: .1, unit: " cm", get: () => P().x, set: v => APP.applyDelta({ dx: v-P().x }) },
      { id: "y", label: "Head–feet", min: -30, max: -1, step: .1, unit: " cm", get: () => P().y, set: v => APP.applyDelta({ dy: v-P().y }) },
      { id: "notch", label: "Notch", min: -180, max: 180, step: 1, unit: "°", get: () => P().notchDeg, set: v => APP.applyDelta({ dNotch: v-P().notchDeg }), note: () => PROBE.clock(P().notchDeg) },
      { id: "tilt", label: "Tilt", min: -75, max: 75, step: 1, unit: "°", get: () => P().tiltDeg, set: v => APP.applyDelta({ dTilt: v-P().tiltDeg }) },
      { id: "rock", label: "Rock", min: -50, max: 50, step: 1, unit: "°", get: () => P().rockDeg, set: v => APP.applyDelta({ dRock: v-P().rockDeg }) },
      { id: "press", label: "Press", min: 0, max: 3, step: .1, unit: " cm", get: () => APP.press(), set: v => APP.setPress(v) } ],
    image: [
      { id: "depth", label: "Depth", min: 4, max: 24, step: 1, unit: " cm", get: () => APP.img.depthCm, set: v => APP.setImg({ depthCm: v }) },
      { id: "sector", label: "Sector", min: 30, max: 90, step: 1, unit: "°", get: () => APP.img.sectorDeg, set: v => APP.setImg({ sectorDeg: v }) },
      { id: "gain", label: "Gain", min: -20, max: 20, step: 1, unit: " dB", get: () => APP.img.gainDb, set: v => APP.setImg({ gainDb: v }) },
      { id: "dr", label: "Dynamic range", min: 30, max: 80, step: 1, unit: " dB", get: () => APP.img.drDb, set: v => APP.setImg({ drDb: v }) },
      { id: "persist", label: "Persistence", min: 0, max: .9, step: .05, unit: "", get: () => APP.img.persistence, set: v => APP.setImg({ persistence: v }), note: () => APP.img.persistence < .05 ? "off" : APP.img.persistence < .45 ? "low" : APP.img.persistence < .7 ? "medium" : "high" },
      { id: "hr", label: "Heart rate", min: 40, max: 140, step: 1, unit: " bpm", get: () => APP.hr, set: v => { APP.hr = v; drawEcgTrace(); drawOverlay(true); },
        note: () => { const w = APP.warp(); return `systole ${Math.round(w.systoleMs)} ms (${Math.round(100*w.systoleMs/w.rrMs)}% of RR)`; } } ] };
  const rows = {};
  for (const [tab, list] of Object.entries(SL)){ const host = $(tab === "probe" ? "probeSliders" : "imageSliders");
    for (const s of list){ const r = document.createElement("label"); r.className = "sl";
      r.innerHTML = `<span class="sl-l">${s.label}</span><output></output><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" aria-label="${s.label}">`;
      host.appendChild(r); const inp = r.querySelector("input"), out = r.querySelector("output"); rows[s.id] = { s, inp, out };
      inp.addEventListener("input", () => { s.set(+inp.value); syncSliders(); }); } }
  function syncSliders(){ for (const k in rows){ const { s, inp, out } = rows[k]; const v = s.get(); if (document.activeElement !== inp) inp.value = v;
      const dec = s.step < 1 ? 1 : 0; out.textContent = v.toFixed(dec).replace("-", "−") + s.unit + (s.note ? " · " + s.note() : ""); }
    $("pressAuto").setAttribute("aria-pressed", APP.pressAuto); $("depthVal").textContent = APP.img.depthCm + " cm"; }
  $("pressAuto").onclick = () => { APP.pressAuto = !APP.pressAuto; if (!APP.pressAuto) APP.pose.pressCm = APP.windowPress(); APP.markDirty(); };

  /* ---- tabs ---- */
  const tabBtns = [...document.querySelectorAll("#tabs button")];
  tabBtns.forEach(b => b.onclick = () => { tabBtns.forEach(o => { const on = o === b; o.setAttribute("aria-selected", on); $(o.dataset.tab).hidden = !on; }); });

  /* ---- top bar ---- */
  const seg = (ids, fn) => ids.forEach(([id, val]) => { $(id).onclick = () => fn(val); });
  seg([["posSup", "supine"], ["posLLD", "LLD"]], v => APP.setPosition(v));
  seg([["convASE", "ASE"], ["convPOCUS", "POCUS"]], v => APP.setConvention(v));
  seg([["modeProbe", "probe"], ["modeCam", "camera"]], v => APP.setMode(v));
  $("freeze").onclick = () => APP.setFrozen(!APP.frozen);
  $("edBtn").onclick = () => { APP.phase = ph.cycle.markers.ED; APP.setFrozen(true); };
  $("esBtn").onclick = () => { APP.phase = ph.cycle.markers.ES; APP.setFrozen(true); };
  $("bodyBtn").onclick = () => APP.cycleBody();
  $("fineBtn").onclick = () => APP.setFine(!APP.fine);
  $("depthDn").onclick = () => APP.setImg({ depthCm: Math.max(4, APP.img.depthCm-1) });
  $("depthUp").onclick = () => APP.setImg({ depthCm: Math.min(24, APP.img.depthCm+1) });
  /* view buttons: move the probe to the view's computed target (animated) and open its ideal image */
  const VIEW_NAMES = { plax: "PLAX", psax_av: "PSAX · aortic valve", psax_mv: "PSAX · mitral valve", psax_pap: "PSAX · papillary", a4c: "A4C", a5c: "A5C", subxiphoid_4c: "Subcostal 4C", ivc: "IVC" };
  const vbtn = {};
  for (const v of VJ.views){ const b = document.createElement("button"); b.type = "button"; b.dataset.view = v.id; b.title = `${v.name}: move the probe to the ideal position and show the ideal image`;
    b.innerHTML = `${VIEW_NAMES[v.id] || v.shortName}<b class="q"></b>`; b.onclick = () => APP.goToView(v.id); $("viewBtns").appendChild(b); vbtn[v.id] = b; }
  $("refToggle").onclick = () => APP.showRef(!APP.refShown);
  $("refClose").onclick = () => APP.showRef(false);
  $("refSplit").onclick = () => { APP.refSplit = !APP.refSplit; syncTop(); };
  $("lmBtn").onclick = () => APP.setLandmarks(!APP.landmarks);

  function syncTop(){
    const on = (id, v) => $(id).setAttribute("aria-pressed", v);
    on("posSup", APP.position === "supine"); on("posLLD", APP.position === "LLD"); on("convASE", APP.conv === "ASE"); on("convPOCUS", APP.conv === "POCUS");
    on("modeProbe", APP.mode === "probe"); on("modeCam", APP.mode === "camera"); on("freeze", APP.frozen); on("fineBtn", APP.fine);
    $("freeze").textContent = APP.frozen ? "Live" : "Freeze";
    $("bodyBtn").textContent = "Body: " + { skin: "Skin", muscle: "Muscle", ghost: "Ghost", skeleton: "Skeleton" }[APP.body];
    on("lmBtn", APP.landmarks); on("refToggle", APP.refShown);
    $("refPane").hidden = !APP.refShown; $("echoScreen").classList.toggle("split", !!APP.refSplit);
    for (const id in vbtn) vbtn[id].classList.toggle("sel", APP.refView === id);
    $("stage").style.touchAction = APP.mode === "probe" ? "none" : "pan-y";
  }
  let toastT = 0; function toast(msg){ const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 6500); }

  /* ---- view chip + readout ---- */
  const NOTCH_NAMES = [[0,"head"],[-45,"R shoulder"],[45,"L shoulder"],[90,"patient's L"],[-90,"patient's R"],[180,"feet"]];
  const ord = n => n + (n%100 >= 11 && n%100 <= 13 ? "th" : ["th","st","nd","rd"][n%10] || "th");
  function readout(){
    const p = P(), ax = Math.abs(p.x), w = APP.windowAt(p.x, p.y), sl = .25*Math.max(0, ax-3), n = Math.round((-2.0-sl-p.y)/2.25), parts = [];
    const lineName = ax < 2 ? "sternum" : ax <= 4.5 ? "parasternal" : ax >= 8.5 && ax <= 10.5 ? "MCL" : ax >= 11.5 && ax <= 13.5 ? "AAL" : null;
    parts.push(w ? w.w.label : (lineName ? `${p.x < 0 ? "R" : "L"} ${lineName}` : "Off window"));
    if (p.y < S_costal(ax)) parts.push("below costal margin");
    else if (DERIVE.ribGap(p.x, p.y) <= 0) parts.push("over a rib");
    else if (n >= 1 && n <= 10) parts.push(`${ord(n)} ICS`);
    let nm = null, wrap = d => ((d+540)%360)-180; for (const [a, t] of NOTCH_NAMES) if (Math.abs(wrap(p.notchDeg-a)) <= 16) nm = t;
    parts.push(`notch → ${nm ? nm + " " : ""}(${PROBE.clock(p.notchDeg)})`);
    parts.push(`tilt ${Math.round(p.tiltDeg)}°`.replace("-", "−"), `rock ${Math.round(p.rockDeg)}°`.replace("-", "−"));
    return parts.join(" · ");
  }
  const CM = [[0, ph.extracardiac_patient.sternum.landmarks.xiphoid_tip_y]].concat(ph.extracardiac_patient.ribs.costalMargin_polyline, [[16, -26]]);
  function S_costal(ax){ for (let i = 1; i < CM.length; i++) if (ax <= CM[i][0]){ const t = (ax-CM[i-1][0])/(CM[i][0]-CM[i-1][0]); return CM[i-1][1]+t*(CM[i][1]-CM[i-1][1]); } return -26; }
  function syncViewBtns(){ for (const id in vbtn){ const sc = APP.scores[id], q = sc ? Math.round(sc.q) : 0, b = vbtn[id];
      b.dataset.state = sc && sc.locked ? "locked" : (q >= 60 ? "near" : ""); b.querySelector(".q").textContent = sc && q >= 40 ? q + "%" : ""; }
    if (APP.refView){ const sc = APP.scores[APP.refView]; $("refMatch").textContent = sc ? `match ${Math.round(sc.q)}%${sc.locked ? " ✓" : ""}` : ""; } }
  function syncChip(best){ syncViewBtns();
    const chips = [$("chip"), $("chipInset")];
    for (const c of chips){ if (!best || best.q < 40){ c.textContent = "Searching…"; c.dataset.state = "search"; }
      else { c.textContent = `${best.view.shortName}${best.locked ? " ✓" : ""} ${Math.round(best.q)}%`; c.dataset.state = best.locked ? "locked" : "near"; } }
  }

  /* ---- ECG strip: 2D canvas, sum of Gaussians from cycle.ecg.waves, cursor at the phase ---- */
  const ecg = $("ecg"), ectx = ecg.getContext("2d"), trace = document.createElement("canvas");
  const ecgAt = t => { let v = 0; for (const w of ph.cycle.ecg.waves){ let d = t-w.center; d -= Math.round(d); v += w.amp*Math.exp(-.5*(d/w.width)**2); } return v; };
  function drawEcgTrace(){
    const b = ecg.getBoundingClientRect(), pr = Math.min(devicePixelRatio || 1, 2), W = Math.max(1, Math.round(b.width*pr)), H = Math.max(1, Math.round(b.height*pr));
    ecg.width = trace.width = W; ecg.height = trace.height = H; const c = trace.getContext("2d"), base = H*.68, A = H*.5;
    c.fillStyle = "#06090a"; c.fillRect(0, 0, W, H); c.strokeStyle = "#143028"; c.lineWidth = pr; c.beginPath(); for (let x = 0; x < W; x += 24*pr){ c.moveTo(x, 0); c.lineTo(x, H); } c.stroke();
    c.strokeStyle = "#66f0a8"; c.lineWidth = 1.5*pr; c.beginPath(); const wp = APP.warp(); for (let x = 0; x < W; x++){ const t = wp.toT((x/W-.12+1)%1), y = base-ecgAt(t)*A; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
    const mk = (t, lab, col) => { const x = ((wp.fromT(t)+.12)%1)*W; c.strokeStyle = col; c.lineWidth = pr; c.setLineDash([3*pr, 3*pr]); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); c.setLineDash([]); c.fillStyle = col; c.font = `${10*pr}px "JetBrains Mono",monospace`; c.fillText(lab, x+3*pr, 11*pr); };
    mk(ph.cycle.markers.ED, "ED", "#7fe9f0"); mk(ph.cycle.markers.ES, "ES", "#ffb066");
    ecgSize = W;
  }
  let ecgSize = 0, ecgW = 0, ecgHr = 0;
  function drawEcg(){
    const w = ecg.getBoundingClientRect().width; if (w && (w !== ecgW || APP.hr !== ecgHr)){ ecgW = w; ecgHr = APP.hr; drawEcgTrace(); } if (!ecgSize) return;
    ectx.drawImage(trace, 0, 0); const x = ((APP.warp().fromT(APP.phase)+.12)%1)*ecg.width; ectx.fillStyle = "#ffffff"; ectx.fillRect(x-1, 0, 2, ecg.height);
  }

  /* ---- echo overlay: depth scale and marker dot, using the same mapping as Pass C ---- */
  const ov = $("echoOverlay"), octx = ov.getContext("2d"); let ovKey = "";
  function drawOverlay(force){
    const b = ov.getBoundingClientRect(), pr = Math.min(devicePixelRatio || 1, 2), { depthCm: D, sectorDeg: sec } = APP.img, key = [b.width, b.height, D, sec, APP.conv, APP.hr, APP.frozen].join();
    if (key === ovKey && !force) return; ovKey = key; if (!b.width || !b.height) return;
    ov.width = Math.round(b.width*pr); ov.height = Math.round(b.height*pr); const W = ov.width, H = ov.height, asp = W/H;
    const fit = Math.max(1, 2*.97*Math.sin(Math.min(sec*Math.PI/180, 3.14)/2)/asp), scale = H*.97/fit;     // px per full depth
    octx.clearRect(0, 0, W, H); octx.font = `${11*pr}px "JetBrains Mono",monospace`; octx.textBaseline = "middle";
    const x0 = W-8*pr; octx.strokeStyle = octx.fillStyle = "#b9c7c4"; octx.lineWidth = pr; octx.beginPath();
    for (let d = 0; d <= D; d++){ const y = d/D*scale, big = d%5 === 0; octx.moveTo(x0, y); octx.lineTo(x0-(big ? 9 : 4)*pr, y); if (big && d) octx.fillText(String(d), x0-(big ? 26 : 0)*pr, y); }
    octx.stroke();
    const right = APP.conv === "ASE", a = sec*Math.PI/360, dotX = W/2 + (right ? 1 : -1)*Math.min(W/2-20*pr, Math.sin(a)*.22*scale + 14*pr), dotY = 15*pr;
    octx.fillStyle = "#ff8a3c"; octx.beginPath(); octx.arc(dotX, dotY, 5*pr, 0, 7); octx.fill();
    octx.fillStyle = "#b9c7c4"; octx.textAlign = "left"; octx.fillText(`${D} cm · ${Math.round(sec)}°`, 8*pr, 12*pr); octx.fillText(`HR ${APP.hr}${APP.frozen ? " · FROZEN" : ""}`, 8*pr, 28*pr);
    octx.fillText(APP.conv === "ASE" ? "ASE · marker right" : "POCUS · marker left", 8*pr, 44*pr); octx.textAlign = "start";
  }
  /* ideal image labels: anchors in fan cm → pane px with the same mapping as Pass C; greedy placement without overlaps */
  function placeRefLabels(list, conv, img){
    const host = $("refLabels"), b = $("refView").getBoundingClientRect(), W = b.width, H = b.height; host.innerHTML = ""; if (!W || !H) return;
    const asp = W/H, sec = img.sectorDeg*Math.PI/180, fit = Math.max(1, 2*.97*Math.sin(Math.min(sec, 3.14)/2)/asp), sc = H*.97/fit, sg = conv === "ASE" ? 1 : -1, boxes = [];
    const items = list.map(L => ({ ...L, x: W/2 + sg*L.cx/img.depthCm*sc, y: L.cy/img.depthCm*sc })).filter(L => L.y > 4 && L.y < H-4 && L.x > 2 && L.x < W-2).sort((a, c) => a.y - c.y);
    const hit = (x, y, w, h) => boxes.some(q => x < q[0]+q[2] && x+w > q[0] && y < q[1]+q[3] && y+h > q[1]) || x < 1 || x+w > W-1 || y < 1 || y+h > H-1;
    let svg = `<svg width="${W}" height="${H}" style="position:absolute;left:0;top:0">`;
    for (const L of items){ const w = L.text.length*6.4 + 12, h = 15, pref = L.x > W*.6 ? -1 : 1; let best = null;
      /* nearest free slot: both sides, then stepping up and down; draw a leader if the label had to move */
      for (const dy of [0, -1, 1, -2, 2, -3, 3, -4, 4]){ for (const sd of [pref, -pref]){ const bx = sd > 0 ? L.x + 6 : L.x - 6 - w, by = L.y - h/2 + dy*h; if (!hit(bx, by, w, h)){ best = [bx, by]; break; } } if (best) break; }
      if (!best) continue;
      boxes.push([best[0], best[1], w, h]);
      const ax = best[0] > L.x ? best[0] : best[0] + w, ay = best[1] + h/2;
      if (Math.abs(ay - L.y) > 3) svg += `<line x1="${L.x.toFixed(1)}" y1="${L.y.toFixed(1)}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="#7fe9f0" stroke-width="1" opacity=".8"/>`;
      const d = document.createElement("div"); d.className = "rl"; d.innerHTML = `<i style="left:${L.x.toFixed(1)}px;top:${L.y.toFixed(1)}px"></i><span style="left:${best[0].toFixed(1)}px;top:${best[1].toFixed(1)}px">${L.text}</span>`; host.appendChild(d); }
    host.insertAdjacentHTML("afterbegin", svg + "</svg>");
  }
  return { syncSliders, syncTop, syncChip, readout, drawEcg, drawOverlay, toast, placeRefLabels, VIEW_NAMES };
}
