/* At-a-glance UI. No render-loop work: selection and explicit UI actions only. */
window.H3PANEL = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const icons = {
    where: '<path d="M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12Z"/><circle cx="12" cy="9" r="2"/>',
    does: '<path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>',
    supply: '<path d="M12 3v9m0 0L5 20m7-8 7 8M7 8l5 4 5-4"/>',
    danger: '<path d="m12 3 10 18H2Z M12 9v5m0 3v1"/>',
    ecg: '<path d="M2 12h5l2-8 4 16 3-8h6"/>',
    echo: '<path d="m12 3-9 17h18Z M7 13q5 4 10 0M9 9q3 2 6 0"/>',
    exam: '<path d="M7 3v7a5 5 0 0 0 10 0V3M5 3h4m6 0h4M12 15v2a4 4 0 0 0 8 0v-3"/><circle cx="20" cy="12" r="2"/>',
    key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-4-4 3-3m-6 0 3-3"/>'
  };
  /* Delegated focus works for both glance bites and deep-dive neighbours.
     Touch scrolling cancels the 400 ms hold; none of these handlers selects. */
  function bindFocus(root) {
    let timer = 0, target = null, origin = null;
    const item = node => node?.closest?.('[data-focus]');
    const clear = () => { const active=!!target;clearTimeout(timer); timer=0; target=null; origin=null; if(active)window.EXPLORE_APP?.clearHighlight(); };
    const light = el => { if (el?.isConnected) window.EXPLORE_APP?.highlight(JSON.parse(el.dataset.focus)); };
    root.addEventListener('pointerover', e => { if(e.pointerType==='touch')return;const el=item(e.target);if(el&&el!==item(e.relatedTarget)){clear();target=el;light(el)} });
    root.addEventListener('pointerout', e => { if(item(e.target)!==item(e.relatedTarget))clear(); });
    root.addEventListener('focusin', e => { const el=item(e.target);if(el){clear();target=el;light(el)} });
    root.addEventListener('focusout', clear);
    root.addEventListener('pointerdown', e => { if(e.pointerType!=='touch')return;clear();target=item(e.target);origin={x:e.clientX,y:e.clientY};if(target)timer=setTimeout(()=>light(target),400); });
    root.addEventListener('pointermove', e => { if(origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>6)clear(); });
    for(const event of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(event,e=>{if(e.pointerType==='touch')clear()});
    root.addEventListener('scroll', clear, true);window.addEventListener('blur',clear);
    return clear;
  }
  function create({root, content, workspace, select, relevant, name, goSim, resize, onLevel, onMore}) {
    const toggle = root.querySelector('.x3-panel-toggle');
    let open = true, selected = null, current = null;
    const clearFocus=bindFocus(content);
    try { open = localStorage.getItem('h3.panelOpen') !== 'false'; } catch (e) {}
    function layout() {
      clearFocus();
      workspace.classList.toggle('panel-collapsed', !open);
      content.hidden = !open;
      toggle.textContent = open ? '«' : '»';
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', (open ? 'Collapse' : 'Expand') + ' card panel');
      requestAnimationFrame(resize);
    }
    toggle.onclick = () => {
      open = !open;
      try { localStorage.setItem('h3.panelOpen', String(open)); } catch (e) {}
      layout();
    };
    layout();
    function chip(key) {
      const s = H3CARDS.scenario(key);
      if (s.state === 'planned') return `<span class="chip x3-soon" aria-disabled="true" title="Coming with the Pathology simulator">Coming soon</span>`;
      return s.state === 'run' ? `<button type="button" class="chip x3-run" data-go="${esc(key)}" title="${esc(s.name)}">Run ▸</button>` : '';
    }
    function render(id) {
      clearFocus();
      selected = id; current = H3CARDS.byTap(id);
      content.scrollTop = 0;
      if (!id) {
        content.innerHTML = '<span class="eyebrow">At a glance</span><h2>Tap a structure</h2><div class="chips">' + relevant().map(id => `<button type="button" class="chip" data-select="${esc(id)}">${esc(name(id))}</button>`).join('') + '</div>';
        content.querySelectorAll('[data-select]').forEach(b => b.onclick = () => select(b.dataset.select));
        return true;
      }
      if (!current) return false;
      const {card: c, part} = current, level = H3CARDS.level(), pearls = c.pearls[level] || [];
      const q = c.saq.find(q => q.level === level) || c.saq.find(q => q.level === 'student');
      content.innerHTML = `<span class="eyebrow">${esc(c.category)}</span><h2>${esc(c.name)}</h2><p class="x3-core">${text(c.core)}</p>` +
        (part ? `<div class="x3-part"><b>${esc(part.name)}</b><p>${text(part.note)}</p></div>` : '') +
        `<div class="x3-stats">${c.stats.map(s => `<div><strong>${text(s.value)}</strong><span>${text(s.label)}</span></div>`).join('')}</div>` +
        `<section data-section="high-yield"><h3>High yield</h3><div class="x3-bites">${c.quick.map(q => `<div class="x3-bite" ${q.focus?.length ? `tabindex="0" data-focus="${esc(JSON.stringify(q.focus))}"` : ''}><span class="x3-icon" data-icon="${esc(q.icon)}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[q.icon] || icons.key}</svg></span><span>${text(q.text)}</span></div>`).join('')}</div></section>` +
        `<section data-section="watch"><h3>Watch out for</h3>${c.complications.slice(0,3).map(x => `<div class="x3-watch"><b>${text(x.name)}</b> ${chip(x.scenario)}<p>${text(x.hook)}</p></div>`).join('')}</section>` +
        `<section data-section="pearls"><h3>Pearls</h3><div class="x3-levels" role="group" aria-label="Pearl level">${['student','resident','fellow'].map(l => `<button type="button" data-level="${l}" aria-pressed="${l === level}" ${!(c.pearls[l] || []).length ? `disabled title="${l[0].toUpperCase()+l.slice(1)} pearls coming later"` : ''}>${l[0].toUpperCase()+l.slice(1)}</button>`).join('')}</div>${pearls.length ? pearls.slice(0,2).map(p => `<div class="x3-pearl"><b>${text(p.hook)}</b><p>${text(p.text)}</p></div>`).join('') : `<p>${esc(level[0].toUpperCase()+level.slice(1))} pearls coming later</p>`}</section>` +
        (q ? `<section data-section="saq"><h3>Check yourself</h3><div class="x3-saq"><p>${text(q.q)}</p><textarea aria-label="Type your answer" placeholder="Type your answer"></textarea><button type="button" class="x3-check" aria-expanded="false">Check</button><div class="x3-answer" hidden><p>${text(q.a)}</p>${q.keys.map(k => `<label><input type="checkbox"> <span>${text(k)}</span></label>`).join('')}<output class="x3-score" aria-live="polite">0 / ${q.keys.length} key points</output></div></div></section>` : '') +
        `<button class="x3-more" type="button" aria-controls="structure-deep" ${onMore ? '' : 'disabled hidden'}>Deep dive ↓</button>`;
      content.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { if (!goSim(b.dataset.go)) b.classList.add('nogo'); });
      content.querySelectorAll('[data-level]').forEach(b => b.onclick = () => { H3CARDS.setLevel(b.dataset.level); render(selected); onLevel?.(); });
      content.querySelector('.x3-more').onclick=()=>onMore?.();
      const check = content.querySelector('.x3-check'), answer = content.querySelector('.x3-answer');
      if (check) check.onclick = () => { answer.hidden = false; check.setAttribute('aria-expanded', 'true'); };
      answer?.querySelectorAll('input').forEach(b => b.onchange = () => {
        answer.querySelector('output').textContent = `${answer.querySelectorAll('input:checked').length} / ${q.keys.length} key points`;
      });
      content.scrollTop = 0;
      window.__lastCard = c.name;
      return true;
    }
    return {render, partName: () => current?.part?.name || null, callout: () => current ? current.card.name + (current.part ? ' — ' + current.part.name : '') : null,
      state: () => ({open, cardId: current?.card.id || null, partName: current?.part?.name || null, level: H3CARDS.level(), sections: [...content.querySelectorAll('[data-section]')].map(e => e.dataset.section)})};
  }
  return {create, esc, text, bindFocus};
})();
