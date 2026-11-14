/* Structure-card indices are built once; missing data leaves the legacy cards usable. */
window.H3CARDS = (() => {
  let all = [], current = 'student';
  const levels = ['student', 'resident', 'fellow'], taps = new Map();
  try { all = JSON.parse(document.getElementById('h3cards').textContent).cards || []; } catch (e) {}
  for (const card of all) {
    for (const id of card.labelIds) taps.set(id, {card, part: null});
    for (const part of card.parts || []) if (part.labelId) taps.set(part.labelId, {card, part});
  }
  try { const saved = localStorage.getItem('h3.pearlLevel'); if (levels.includes(saved)) current = saved; } catch (e) {}
  return {
    all, byTap: id => taps.get(id) || null,
    scenario(key) {
      if (!key) return {state: 'none', key, name: ''};
      if (key.startsWith('planned:')) return {state: 'planned', key, name: key.slice(8)};
      const c = CONTENT.SC[key] || SIMC.EXTRA[key], mi = SIMC.MIS[key];
      return {state: c || mi ? 'run' : 'none', key, name: c?.name || mi?.[2] || key};
    },
    level: () => current,
    setLevel(value) {
      if (levels.includes(value)) {
        current = value;
        try { localStorage.setItem('h3.pearlLevel', value); } catch (e) {}
      }
      return current;
    }
  };
})();
