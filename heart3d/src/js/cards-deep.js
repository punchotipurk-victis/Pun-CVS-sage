/* Full structure cards. Teaching strings come only from H3CARDS. */
window.H3DEEP = (() => {
  const {esc, text} = H3PANEL;
  const focus = ids => ids?.length ? `tabindex="0" data-focus="${esc(JSON.stringify(ids))}"` : '';
  function create({root, select, cut, goSim, onLevel}) {
    let current=null;
    const clearFocus=H3PANEL.bindFocus(root);
    function chip(key) {
      const s=H3CARDS.scenario(key);
      return s.state==='planned' ? '<span class="x3-deep-soon" aria-disabled="true" title="Coming with the Pathology simulator">Coming soon</span>' :
        s.state==='run' ? `<button type="button" class="x3-deep-run" data-go="${esc(key)}" title="${esc(s.name)}">Run ▸</button>` : '';
    }
    function levelChanged() {
      if(!current)return;
      const c=current.card,level=H3CARDS.level(),pearls=c.pearls[level]||[];
      root.querySelector('.x3-deep-pearls').innerHTML=`<div class="x3-deep-levels" role="group" aria-label="Deep dive pearl level">${['student','resident','fellow'].map(l=>`<button type="button" data-level="${l}" aria-pressed="${level===l}" ${(c.pearls[l]||[]).length ? '' : `disabled title="${l[0].toUpperCase()+l.slice(1)} pearls coming later"`}>${l[0].toUpperCase()+l.slice(1)}</button>`).join('')}</div>`+
        (pearls.length ? pearls.map(p=>`<div class="x3-deep-pearl"><b>${text(p.hook)}</b><p>${text(p.text)}</p></div>`).join('') : `<p>${esc(level[0].toUpperCase()+level.slice(1))} pearls coming later</p>`);
      root.querySelectorAll('[data-level]').forEach(b=>b.onclick=()=>{H3CARDS.setLevel(b.dataset.level);levelChanged();onLevel()});
    }
    function render(id) {
      clearFocus();current=H3CARDS.byTap(id);root.hidden=!current;
      root.closest('.x3').classList.toggle('has-deep',!!current);
      if(!current){root.replaceChildren();return}
      const {card:c,part}=current,phone=matchMedia('(max-width:759px)').matches;
      const section=(key,title,value)=>`<details class="x3-deep-section" data-detail="${key}"><summary><b>${title}</b><span>${text(value.summary)}</span></summary><div class="x3-deep-detail"><p>${text(value.detail)}</p>${key==='anatomy'&&c.parts?.length ? `<div class="x3-deep-parts">${c.parts.map(p=>`<div class="${part===p?'is-part':''}">${p.labelId ? `<button type="button" data-select="${esc(p.labelId)}">${text(p.name)}</button>` : `<b>${text(p.name)}</b>`}<p>${text(p.note)}</p></div>`).join('')}</div>` : ''}</div></details>`;
      const open=phone ? '' : 'open';
      root.innerHTML=`<div class="x3-deep-head"><div><span class="eyebrow">Deep dive</span><h2 tabindex="-1">${esc(c.name)}</h2></div><button type="button" class="x3-deep-back">Back to model ↑</button></div>`+
        section('anatomy','Anatomy',c.anatomy)+section('function','Function',c.function)+section('supply',['Cardiac vein','Great vein'].includes(c.category)?'Drainage':'Blood supply',c.supply)+
        (c.relations?.length ? `<details class="x3-deep-section" data-detail="neighbours"><summary><b>Neighbours</b><span>${c.relations.map(r=>text(r.with)).join(' · ')}</span></summary><div class="x3-deep-detail">${c.relations.map(r=>`<div class="x3-deep-neighbour" ${focus(r.focus)}><b>${text(r.with)}</b><p>${text(r.why)}</p></div>`).join('')}</div></details>` : '')+
        `<details class="x3-deep-section" data-detail="seen" ${open}><summary><b>Where you see it</b></summary><div class="x3-deep-tiles">${['echo','cut','ecg'].flatMap(kind=>(c.seenOn?.[kind]||[]).map(r=>{const label=kind==='cut'?'3D cut':kind==='echo'?'Echo':'ECG',tag=kind==='cut'?'button':'div';return `<${tag} class="x3-deep-tile" ${kind==='cut'?`type="button" data-cut="${esc(r.id)}"`:''}><span>${label}${r.id?' · '+esc(r.id):''}</span>${text(r.text)}</${tag}>`})).join('')}</div></details>`+
        `<details class="x3-deep-section" data-detail="complications" ${open}><summary><b>Complications · ${c.complications.length}</b></summary><div class="x3-deep-complications">${c.complications.map((x,i)=>`<details class="x3-deep-complication" data-complication="${i}"><summary><span><b>${text(x.name)}</b> ${chip(x.scenario)}<span class="x3-deep-hook">${text(x.hook)}</span></span></summary><div class="x3-deep-flow"><div><span>Mechanism</span><p>${text(x.mechanism)}</p></div><span class="x3-deep-arrow" aria-hidden="true">→</span><div><span>What you see</span><p>${text(x.presentation)}</p></div></div></details>`).join('')}</div></details>`+
        '<details class="x3-deep-section" data-detail="pearls" open><summary><b>Pearls</b></summary><div class="x3-deep-pearls"></div></details>'+
        `<details class="x3-deep-section" data-detail="saq" ${open}><summary><b>Check yourself · ${c.saq.length}</b></summary><div class="x3-deep-questions">${c.saq.map((q,i)=>`<div class="x3-deep-saq" data-saq="${i}"><span class="x3-deep-level">${esc(q.level)}</span><p class="x3-deep-question">${text(q.q)}</p><textarea aria-label="Type your answer" placeholder="Type your answer"></textarea><button type="button" class="x3-deep-check" aria-expanded="false" aria-controls="deep-answer-${i}">Check</button><div class="x3-deep-answer" id="deep-answer-${i}" hidden><p>${text(q.a)}</p>${q.keys.map(k=>`<label><input type="checkbox"><span>${text(k)}</span></label>`).join('')}<output aria-live="polite">0 / ${q.keys.length} key points</output></div></div>`).join('')}</div></details>`+
        `<p class="x3-deep-sources"><b>Sources</b> ${c.sources.map(s=>text(s)).join(' · ')}</p>`;
      root.querySelectorAll('[data-select]').forEach(b=>b.onclick=()=>select(b.dataset.select));
      root.querySelectorAll('[data-cut]').forEach(b=>b.onclick=()=>cut(b.dataset.cut));
      root.querySelectorAll('[data-go]').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();if(!goSim(b.dataset.go))b.classList.add('nogo')});
      root.querySelectorAll('.x3-deep-saq').forEach(box=>{
        const answer=box.querySelector('.x3-deep-answer'),button=box.querySelector('.x3-deep-check');
        button.onclick=()=>{answer.hidden=false;button.setAttribute('aria-expanded','true')};
        answer.querySelectorAll('input').forEach(b=>b.onchange=()=>{answer.querySelector('output').textContent=`${answer.querySelectorAll('input:checked').length} / ${answer.querySelectorAll('input').length} key points`});
      });
      root.querySelector('.x3-deep-back').onclick=()=>document.querySelector('.viewer').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});
      levelChanged();
    }
    return {render,levelChanged,scroll(){if(!root.hidden){root.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});root.querySelector('h2').focus({preventScroll:true})}}};
  }
  return {create};
})();
