// Deterministic timeline: the renderer calls window.seek(t) for every frame.
// data-at="1.2" on an element delays its CSS animations to start at 1.2 s; data-count animates numbers.
window.__updaters = [];
window.onSeek = (fn) => window.__updaters.push(fn);
function prepare() {
  document.querySelectorAll('[data-at]').forEach((el) => { el.style.animationDelay = el.dataset.at + 's'; });
  document.querySelectorAll('[data-count]').forEach((el) => {
    const to = parseFloat(el.dataset.count), from = parseFloat(el.dataset.from || 0), at = parseFloat(el.dataset.at || 0), dur = parseFloat(el.dataset.dur || 1.2);
    const fmt = (v) => (el.dataset.decimals ? v.toFixed(+el.dataset.decimals) : Math.round(v).toString());
    window.onSeek((t) => { const k = Math.min(1, Math.max(0, (t - at) / dur)); const e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); });
  });
}
window.seek = (t) => {
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
  for (const fn of window.__updaters) fn(t);
};
window.addEventListener('DOMContentLoaded', prepare);
