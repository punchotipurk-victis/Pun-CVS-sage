#!/usr/bin/env python3
"""Render heart3d/data/structures.json as a stand-alone preview page (for content review, not the site).

    python heart3d/tools/preview_cards.py [--out heart3d/dist/cards-preview.html] [--ids a,b,c]

Reference look for T7.1 (Codex builds the real renderer inside the 3D Heart page). No external files.
"""
import argparse, html, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]

CSS = """
:root{--bg:#0f1115;--card:#181b22;--line:#2a2f3a;--txt:#e8e6e1;--mut:#9aa0ab;--acc:#d9b45a;--chip:#232834;--run:#2f6f5e}
@media (prefers-color-scheme: light){:root{--bg:#f6f4ef;--card:#fff;--line:#e2ded5;--txt:#22201c;--mut:#6b675f;--acc:#9a6b12;--chip:#f0ece3;--run:#cfeadf}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
header{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;gap:10px;flex-wrap:wrap;align-items:center}
header b{font-weight:600;margin-right:8px}.pick button,.lv button,.w button{background:var(--chip);color:var(--txt);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font:inherit;font-size:13px;cursor:pointer}
.pick button.on,.lv button.on,.w button.on{border-color:var(--acc);color:var(--acc)}
.lv button.empty{opacity:.45}
main{padding:18px;display:flex;justify-content:center}.frame{width:100%;max-width:860px;transition:max-width .2s}.frame.phone{max-width:400px}
.heart{height:110px;border:1px dashed var(--line);border-radius:14px;display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:13px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.cat{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--acc)}h2{margin:2px 0 6px;font-size:21px;font-weight:600}
.core{font-size:15.5px;margin:0 0 10px}.part{background:var(--chip);border-radius:10px;padding:8px 10px;margin:0 0 10px;font-size:14px}
details{border-top:1px solid var(--line);padding:6px 0}summary::marker,summary::-webkit-details-marker{content:"";display:none}summary{cursor:pointer;font-weight:600;font-size:14px;padding:4px 0;list-style:none}
summary::after{content:" ▸";color:var(--mut)}details[open]>summary::after{content:" ▾"}
details p,details li{font-size:14px}ul{margin:4px 0 6px;padding-left:20px}
.cx{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:6px 0}.cx b{font-weight:600}
.chip{display:inline-block;font-size:12px;border-radius:999px;padding:2px 10px;margin-top:4px}.chip.run{background:var(--run)}.chip.soon{border:1px dashed var(--line);color:var(--mut)}
.lv{display:flex;gap:6px;margin:4px 0 8px}.soonp{color:var(--mut);font-style:italic;font-size:14px}.src{color:var(--mut);font-size:12.5px}
.k{color:var(--mut)}
"""

JS = """
const D=JSON.parse(document.getElementById('data').textContent);let cur=0,lvl='student';
try{lvl=localStorage.getItem('h3.pearlLevel')||'student'}catch(e){}
const E=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function chip(s){if(!s)return'';return s.startsWith('planned:')?'<span class="chip soon">Coming with the Pathology simulator</span>':'<span class="chip run">Run in simulator →</span>'}
function sec(t,body,open){return `<details${open?' open':''}><summary>${t}</summary>${body}</details>`}
function render(){const c=D.cards[cur];let h=`<div class="cat">${E(c.category)}</div><h2>${E(c.name)}</h2><p class="core">${E(c.core)}</p>`;
 if(window._part){const p=(c.parts||[]).find(p=>p.labelId===window._part);if(p)h+=`<div class="part"><b>${E(p.name)}</b> · ${E(p.note)}</div>`}
 h+=sec('Anatomy',`<p>${E(c.anatomy)}</p>`+((c.parts||[]).length?'<ul>'+c.parts.map(p=>`<li><b>${E(p.name)}</b>: ${E(p.note)}</li>`).join('')+'</ul>':''));
 h+=sec('Function',`<p>${E(c.function)}</p>`);h+=sec('Blood supply',`<p>${E(c.supply)}</p>`);
 if((c.relations||[]).length)h+=sec('Neighbours that matter','<ul>'+c.relations.map(r=>`<li><b>${E(r.with)}</b>: ${E(r.why)}</li>`).join('')+'</ul>');
 const so=c.seenOn||{},nm={echo:'Echo',cut:'3D cut',ct:'CT',ecg:'ECG'};let s='';for(const k of ['echo','cut','ct','ecg'])for(const r of so[k]||[])s+=`<li><span class="k">${nm[k]}${r.id?' · '+E(r.id):''}</span>: ${E(r.text)}</li>`;
 if(s)h+=sec('Where you see it','<ul>'+s+'</ul>');
 h+=sec(`Complications · ${c.complications.length}`,c.complications.map(x=>`<div class="cx"><b>${E(x.name)}</b><br><span class="k">Mechanism:</span> ${E(x.mechanism)}<br><span class="k">Presentation:</span> ${E(x.presentation)}<br>${chip(x.scenario)}</div>`).join(''));
 const P=c.pearls,lv=['student','resident','fellow'],L={student:'Student',resident:'Resident',fellow:'Fellow'};
 let pb='<div class="lv">'+lv.map(l=>`<button data-l="${l}" class="${l===lvl?'on':''} ${(P[l]||[]).length?'':'empty'}">${L[l]}</button>`).join('')+'</div>';
 pb+=(P[lvl]||[]).length?'<ul>'+P[lvl].map(p=>`<li>${E(p)}</li>`).join('')+'</ul>':'<p class="soonp">Fellow pearls coming later.</p>';
 h+=sec('Pearls',pb,true);h+=`<p class="src">Sources: ${c.sources.map(E).join(' · ')}</p>`;
 document.getElementById('card').innerHTML=h;
 document.querySelectorAll('.lv button').forEach(b=>b.onclick=()=>{lvl=b.dataset.l;try{localStorage.setItem('h3.pearlLevel',lvl)}catch(e){}render()});
 document.querySelectorAll('.pick button').forEach((b,i)=>b.classList.toggle('on',i===cur));}
document.querySelector('.pick').innerHTML=D.cards.map((c,i)=>`<button>${E(c.name.replace(/ \\(.*\\)/,''))}</button>`).join('');
document.querySelectorAll('.pick button').forEach((b,i)=>b.onclick=()=>{cur=i;window._part=null;render()});
document.querySelectorAll('.w button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.w button').forEach(x=>x.classList.toggle('on',x===b));document.querySelector('.frame').classList.toggle('phone',b.dataset.w==='phone')});
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
<header><b>{html.escape(a.title)}</b><span class="pick"></span><span class="w"><button class="on" data-w="desk">Desktop</button> <button data-w="phone">Phone 400 px</button></span></header>
<main><div class="frame"><div class="heart">3D heart canvas (tap a structure)</div><div class="card" id="card"></div></div></main>
<script type="application/json" id="data">{blob}</script><script>{JS}</script></body></html>"""
    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    print(f"wrote {out} ({len(data['cards'])} cards)")


if __name__ == "__main__":
    main()
