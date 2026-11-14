#!/usr/bin/env python3
"""Render heart3d/data/structures.json as a stand-alone preview page (content review; reference look for T7.1).

    python heart3d/tools/preview_cards.py [--out heart3d/dist/cards-preview.html] [--ids a,b,c]

Desktop: 3D canvas placeholder on the left, the "At a glance" side panel on the right (stats, high-yield bites with icons,
watch-outs, two pearls for the chosen level), the deep-dive card below. Phone (< 760 px): stacked, glance first.
No external files; icons are inline SVG.
"""
import argparse, html, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]

CSS = """
:root{--bg:#0f1115;--card:#171a21;--card2:#1d212a;--line:#2a2f3a;--txt:#e8e6e1;--mut:#9aa0ab;--acc:#d9b45a;--chip:#232834;
--where:#7aa7ff;--does:#3fc1a5;--supply:#e0645c;--danger:#ff8a5c;--ecg:#c38bff;--echo:#58c7e6;--exam:#e7c14f;--key:#d9b45a}
@media (prefers-color-scheme: light){:root{--bg:#f6f4ef;--card:#fff;--card2:#faf8f3;--line:#e2ded5;--txt:#22201c;--mut:#6b675f;--acc:#9a6b12;--chip:#f0ece3;
--where:#2f5fc4;--does:#0f8a70;--supply:#b8322a;--danger:#c4501f;--ecg:#7a3fc4;--echo:#1b84a3;--exam:#8a6a00;--key:#9a6b12}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
b,strong{font-weight:650}
header{padding:12px 18px;border-bottom:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap;align-items:center}
header .t{font-weight:650;margin-right:6px}.pill{background:var(--chip);color:var(--txt);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font:inherit;font-size:13px;cursor:pointer}
.pill.on{border-color:var(--acc);color:var(--acc)}.pill.empty{opacity:.45}
main{padding:16px;max-width:1280px;margin:0 auto}
.stage{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:14px;align-items:stretch}
.canvas{min-height:560px;border:1px dashed var(--line);border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--mut);font-size:13px;text-align:center;padding:12px}
.canvas .lit{margin-top:10px;color:var(--acc);min-height:20px}
.side{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px;max-height:560px;overflow:auto}
.cat{font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--acc)}h2{margin:2px 0 4px;font-size:20px;font-weight:650;line-height:1.25}
.core{margin:0 0 10px;font-size:14.5px}
.stats{display:flex;gap:8px;margin:0 0 12px}.stat{flex:1;background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:8px 8px 6px;text-align:center}
.stat .v{font-size:16px;font-weight:700;color:var(--acc);line-height:1.2}.stat .l{font-size:11.5px;color:var(--mut);line-height:1.25;margin-top:2px}
.qh{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:12px 0 6px}
.bite{display:flex;gap:10px;align-items:flex-start;padding:7px 8px;border-radius:10px;font-size:14px;line-height:1.4}
.bite:hover{background:var(--card2)}.bite.f{cursor:pointer}
.ic{flex:0 0 26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center}
.ic svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.watch{border-left:3px solid var(--danger);padding:4px 0 4px 10px;margin:4px 0;font-size:13.5px}.watch .n{font-weight:650}.watch .h{color:var(--mut)}
.chip{display:inline-block;font-size:11.5px;border-radius:999px;padding:1px 8px;margin-left:4px;vertical-align:1px}.chip.run{background:var(--does);color:#08231c}.chip.soon{border:1px dashed var(--line);color:var(--mut)}
.lv{display:flex;gap:6px;margin:4px 0 8px;flex-wrap:wrap}
.pearl{background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:9px 11px;margin:6px 0;font-size:14px}
.pearl .ph{font-weight:650;display:block;margin-bottom:2px}.pearl .pt.hide{filter:blur(5px);cursor:pointer;user-select:none}
.more{margin-top:12px;width:100%}
.deep{margin-top:16px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
.deep h3{margin:0 0 8px;font-size:16px}
.sec{border-top:1px solid var(--line);padding:10px 0}
.sec .st{display:flex;gap:10px;align-items:baseline;cursor:pointer}.sec .st b{min-width:140px}
.sec .det{color:var(--mut);margin:6px 0 0 150px;font-size:14px;display:none}.sec.open .det{display:block}
.cxrow{border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin:6px 0;cursor:pointer}
.cxrow .n{font-weight:650}.cxrow .h{color:var(--mut);font-size:13.5px}.flow{display:none;grid-template-columns:1fr 24px 1fr;gap:6px;align-items:center;margin-top:8px;font-size:13.5px}
.cxrow.open .flow{display:grid}.flow .bx{background:var(--card2);border-radius:10px;padding:7px 9px}.flow .bx i{display:block;font-style:normal;font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}
.flow .ar{text-align:center;color:var(--acc);font-size:18px}
.parts{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 0 150px}.part{background:var(--chip);border-radius:999px;padding:2px 10px;font-size:12.5px}
.seen{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 0 150px}.sn{background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:5px 8px;font-size:13px;max-width:330px}.sn i{font-style:normal;color:var(--acc);font-size:11.5px;display:block}
.src{color:var(--mut);font-size:12.5px;margin-top:10px}
.frame.phone{max-width:400px;margin:0 auto}.frame.phone .stage{grid-template-columns:1fr}.frame.phone .canvas{min-height:260px}.frame.phone .side{max-height:none}
.frame.phone .sec .det,.frame.phone .parts,.frame.phone .seen{margin-left:0}.frame.phone .sec .st{flex-direction:column;gap:2px}.frame.phone .flow{grid-template-columns:1fr}.frame.phone .flow .ar{transform:rotate(90deg)}
"""

JS = r"""
const D=JSON.parse(document.getElementById('data').textContent);let cur=0,lvl='student',recall=false;
try{lvl=localStorage.getItem('h3.pearlLevel')||'student';recall=localStorage.getItem('h3.recall')==='1'}catch(e){}
const E=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const MD=s=>E(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
const IC={where:'<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
 does:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',supply:'<path d="M12 3c3 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 3-6.5 6-11z"/>',
 danger:'<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',ecg:'<path d="M2 12h5l2-5 3 10 2-5h8"/>',
 echo:'<path d="M12 20 4 7a11 11 0 0 1 16 0z"/><path d="M12 20V10"/>',exam:'<path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v3a4 4 0 0 0 8 0v-2"/><circle cx="18" cy="12" r="2"/>',
 key:'<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>'};
const icon=k=>`<span class="ic" style="color:var(--${k});background:color-mix(in srgb,var(--${k}) 16%,transparent)"><svg viewBox="0 0 24 24">${IC[k]}</svg></span>`;
const chip=s=>!s?'':s.startsWith('planned:')?'<span class="chip soon">Coming with Pathology</span>':'<span class="chip run">Run ▸</span>';
const L={student:'Student',resident:'Resident',fellow:'Fellow'};
function pearls(P,max){const ps=(P[lvl]||[]).slice(0,max||9);if(!ps.length)return'<p style="color:var(--mut)">Fellow pearls coming later.</p>';
 return ps.map(p=>`<div class="pearl"><span class="ph">${E(p.hook)}</span><span class="pt ${recall?'hide':''}">${E(p.text)}</span></div>`).join('')}
function lvBtns(P){return '<div class="lv">'+['student','resident','fellow'].map(l=>`<button class="pill lvb ${l===lvl?'on':''} ${(P[l]||[]).length?'':'empty'}" data-l="${l}">${L[l]}</button>`).join('')+
 `<button class="pill rc ${recall?'on':''}" title="Hide the answers; tap one to reveal">Quiz me</button></div>`}
function render(){const c=D.cards[cur];
 let s=`<div class="cat">${E(c.category)}</div><h2>${E(c.name)}</h2><p class="core">${E(c.core)}</p>`;
 s+='<div class="stats">'+c.stats.map(x=>`<div class="stat"><div class="v">${E(x.value)}</div><div class="l">${E(x.label)}</div></div>`).join('')+'</div>';
 s+='<div class="qh">High yield</div>'+c.quick.map(q=>`<div class="bite ${q.focus?'f':''}" data-f="${E((q.focus||[]).join(', '))}">${icon(q.icon)}<span>${MD(q.text)}</span></div>`).join('');
 s+='<div class="qh">Watch out for</div>'+c.complications.slice(0,3).map(x=>`<div class="watch"><span class="n">${E(x.name)}</span>${chip(x.scenario)}<br><span class="h">${E(x.hook)}</span></div>`).join('');
 s+='<div class="qh">Pearls</div>'+lvBtns(c.pearls)+pearls(c.pearls,2)+'<button class="pill more">Deep dive ↓</button>';
 document.getElementById('side').innerHTML=s;
 let d=`<h3>Deep dive · ${E(c.name)}</h3>`;
 const sec=(t,o,extra)=>`<div class="sec"><div class="st"><b>${t} ▸</b><span>${E(o.summary)}</span></div><div class="det">${E(o.detail)}</div>${extra||''}</div>`;
 d+=sec('Anatomy',c.anatomy,(c.parts||[]).length?'<div class="parts">'+c.parts.map(p=>`<span class="part" title="${E(p.note)}">${E(p.name)}</span>`).join('')+'</div>':'');
 d+=sec('Function',c.function);d+=sec('Blood supply',c.supply);
 if((c.relations||[]).length)d+=`<div class="sec"><div class="st"><b>Neighbours ▸</b><span>${c.relations.map(r=>E(r.with)).join(' · ')}</span></div><div class="det">${c.relations.map(r=>`<b>${E(r.with)}</b>: ${E(r.why)}`).join('<br>')}</div></div>`;
 const so=c.seenOn||{},nm={echo:'Echo',cut:'3D cut',ct:'CT',ecg:'ECG'};let sn='';for(const k of ['echo','cut','ct','ecg'])for(const r of so[k]||[])sn+=`<div class="sn"><i>${nm[k]}${r.id?' · '+E(r.id):''}</i>${E(r.text)}</div>`;
 if(sn)d+=`<div class="sec"><div class="st"><b>Where you see it</b><span>${Object.keys(so).map(k=>nm[k]).join(' · ')}</span></div><div class="seen">${sn}</div></div>`;
 d+=`<div class="sec"><div class="st"><b>Complications · ${c.complications.length}</b><span style="color:var(--mut)">tap one: mechanism → what you see</span></div>`+c.complications.map(x=>
  `<div class="cxrow"><span class="n">${E(x.name)}</span>${chip(x.scenario)} <span class="h">— ${E(x.hook)}</span><div class="flow"><div class="bx"><i>Mechanism</i>${E(x.mechanism)}</div><div class="ar">→</div><div class="bx"><i>What you see</i>${E(x.presentation)}</div></div></div>`).join('')+'</div>';
 d+=`<div class="sec"><div class="st"><b>Pearls</b><span>${L[lvl]} level</span></div>${lvBtns(c.pearls)}${pearls(c.pearls)}</div>`;
 d+=`<p class="src">Sources: ${c.sources.map(E).join(' · ')}</p>`;
 document.getElementById('deep').innerHTML=d;
 document.querySelectorAll('.lvb').forEach(b=>b.onclick=()=>{lvl=b.dataset.l;try{localStorage.setItem('h3.pearlLevel',lvl)}catch(e){}render()});
 document.querySelectorAll('.rc').forEach(b=>b.onclick=()=>{recall=!recall;try{localStorage.setItem('h3.recall',recall?'1':'0')}catch(e){}render()});
 document.querySelectorAll('.pt.hide').forEach(p=>p.onclick=()=>p.classList.remove('hide'));
 document.querySelectorAll('.sec .st').forEach(t=>t.onclick=()=>t.parentNode.classList.toggle('open'));
 document.querySelectorAll('.cxrow').forEach(r=>r.onclick=()=>r.classList.toggle('open'));
 document.querySelector('.more').onclick=()=>document.getElementById('deep').scrollIntoView({behavior:'smooth'});
 const lit=document.querySelector('.lit');document.querySelectorAll('.bite.f').forEach(b=>{b.onmouseenter=()=>lit.textContent='Model lights up: '+b.dataset.f;b.onmouseleave=()=>lit.textContent=''});
 document.querySelectorAll('.pick .pill').forEach((b,i)=>b.classList.toggle('on',i===cur));}
document.querySelector('.pick').innerHTML=D.cards.map(c=>`<button class="pill">${E(c.name.replace(/ \(.*\)/,''))}</button>`).join('');
document.querySelectorAll('.pick .pill').forEach((b,i)=>b.onclick=()=>{cur=i;render()});
document.querySelectorAll('.w .pill').forEach(b=>b.onclick=()=>{document.querySelectorAll('.w .pill').forEach(x=>x.classList.toggle('on',x===b));document.querySelector('.frame').classList.toggle('phone',b.dataset.w==='phone')});
if(innerWidth<760)document.querySelector('.frame').classList.add('phone');
render();
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(ROOT / "data/structures.json"))
    ap.add_argument("--out", default=str(ROOT / "dist/cards-preview.html"))
    ap.add_argument("--ids", default="")
    ap.add_argument("--title", default="3D Heart cards preview")
    a = ap.parse_args()
    data = json.loads(pathlib.Path(a.src).read_text(encoding="utf-8"))
    if a.ids:
        keep = a.ids.split(",")
        data["cards"] = [c for c in data["cards"] if c["id"] in keep]
    blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    page = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(a.title)}</title><style>{CSS}</style></head><body>
<header><span class="t">{html.escape(a.title)}</span><span class="pick"></span><span class="w"><button class="pill on" data-w="desk">Desktop</button> <button class="pill" data-w="phone">Phone</button></span></header>
<main><div class="frame"><div class="stage"><div class="canvas">3D heart canvas<br>(hover a high-yield line to see what would light up)<div class="lit"></div></div><aside class="side" id="side"></aside></div>
<section class="deep" id="deep"></section></div></main>
<script type="application/json" id="data">{blob}</script><script>{JS}</script></body></html>"""
    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    print(f"wrote {out} ({len(data['cards'])} cards)")


if __name__ == "__main__":
    main()
