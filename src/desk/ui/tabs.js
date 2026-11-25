// Helpers for the sector tabs.

// Tone for a group's tab: buying allowed → green, mixed → yellow, blocked → red, no data → grey.
export function groupTone(g) {
  if (!g || g.status !== 'ok' || !g.brief) return 'grey';
  if (g.brief.allowLong) return 'green';
  return g.brief.stance === 'Risk-off' ? 'red' : 'yellow';
}

// Remember the last selected tab per section (best effort).
export function rememberTab(section, id) {
  try { localStorage.setItem(`pp_tab_${section}`, id); } catch { /* ignore */ }
}
export function recallTab(section) {
  try { return localStorage.getItem(`pp_tab_${section}`); } catch { return null; }
}
