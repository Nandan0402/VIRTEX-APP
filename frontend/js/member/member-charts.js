/** Virtex Member Portal — member-charts.js: small inline-SVG charts (no library, no CSP change).
 *  Styles live in css/member-progress.css (.pg-chart …). Charts only draw values they are given;
 *  with fewer than 2 values they show "Not Enough Data" instead of a line.
 */
import { esc } from './member-navigation.js';

const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const f1 = (v) => (n(v) === null ? '—' : (Math.round(n(v) * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }));
const toDate = (d) => (typeof d === 'string' && /^d{4}-d{2}-d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d));
const dShort = (d) => (d ? toDate(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');
const dLong = (d) => (d ? toDate(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const NED = (reason = '') => `<div class="pg-ned"><span class="pg-ned-badge">Not Enough Data</span>${reason ? `<span>${esc(reason)}</span>` : ''}</div>`;

export function lineChart(points, { unit, label, id }) {
  const pts = points.map((p) => ({ t: toDate(p.t), v: n(p.v) })).filter((p) => p.v !== null);
  if (pts.length < 2) return NED('A chart needs at least 2 recorded values.');
  const W = 640; const H = 210; const L = 46; const R = 16; const T = 14; const B = 28;
  let lo = Math.min(...pts.map((p) => p.v)); let hi = Math.max(...pts.map((p) => p.v));
  const pad = Math.max((hi - lo) * 0.15, 0.5); lo -= pad; hi += pad;
  const t0 = pts[0].t.getTime(); const t1 = Math.max(pts[pts.length - 1].t.getTime(), t0 + 1);
  const x = (t) => L + ((t.getTime() - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `<figure class="pg-chart" data-chart="${esc(id)}" data-unit="${esc(unit)}" data-points='${esc(JSON.stringify(pts.map((p) => [p.t.toISOString(), p.v])))}'>
    <div class="pg-chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}: ${f1(pts[0].v)} to ${f1(last.v)} ${esc(unit)}">
        ${[lo, (lo + hi) / 2, hi].map((v) => `<line class="pg-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="pg-axis" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${f1(v)}</text>`).join('')}
        <text class="pg-axis" x="${L}" y="${H - 8}">${esc(dShort(pts[0].t))}</text>
        <text class="pg-axis" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(dShort(last.t))}</text>
        <path class="pg-line" d="${path}"/>
        ${pts.map((p) => `<circle class="pg-dot" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4"/>`).join('')}
        <text class="pg-direct" x="${(x(last.t) - 6).toFixed(1)}" y="${(y(last.v) - 10).toFixed(1)}" text-anchor="end">${f1(last.v)} ${esc(unit)}</text>
        <rect class="pg-hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
      </svg>
      <div class="pg-tip" hidden></div>
    </div>
    <details class="pg-table-toggle"><summary>Show data table</summary>
      <table class="admin-table"><thead><tr><th>Date</th><th>${esc(label)} (${esc(unit)})</th></tr></thead>
      <tbody>${pts.slice().reverse().map((p) => `<tr><td>${esc(dLong(p.t))}</td><td>${f1(p.v)}</td></tr>`).join('')}</tbody></table></details>
  </figure>`;
}

/** Vertical bars; optional `planned` drawn as a dashed marker. Values are real counts. */
export function barChart(items, { label, unit }) {
  const W = 640; const H = 190; const L = 34; const R = 10; const T = 12; const B = 30;
  const max = Math.max(1, ...items.map((i) => Math.max(i.v || 0, i.planned || 0)));
  const bw = (W - L - R) / items.length;
  const y = (v) => T + (1 - v / max) * (H - T - B);
  return `<figure class="pg-chart pg-bars">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      <line class="pg-grid" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
      <text class="pg-axis" x="${L - 6}" y="${y(max) + 4}" text-anchor="end">${max}</text>
      ${items.map((it, i) => {
        const x0 = L + i * bw + bw * 0.18; const w = bw * 0.64;
        return `<g><title>${esc(it.title)}</title>
          <rect class="pg-bar${it.current ? ' current' : ''}" x="${x0.toFixed(1)}" y="${y(it.v).toFixed(1)}" width="${w.toFixed(1)}" height="${(y(0) - y(it.v)).toFixed(1)}" rx="3"/>
          ${it.planned ? `<line class="pg-plan" x1="${(x0 - 3).toFixed(1)}" x2="${(x0 + w + 3).toFixed(1)}" y1="${y(it.planned).toFixed(1)}" y2="${y(it.planned).toFixed(1)}"/>` : ''}
          <text class="pg-bar-val" x="${(x0 + w / 2).toFixed(1)}" y="${(y(it.v) - 4).toFixed(1)}" text-anchor="middle">${it.v}</text>
          <text class="pg-axis" x="${(x0 + w / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(it.label)}</text></g>`;
      }).join('')}
    </svg>
    <figcaption class="pg-legend"><span><i class="pg-key bar"></i>${esc(unit)}</span>${items.some((i) => i.planned) ? '<span><i class="pg-key plan"></i>Planned (programme days)</span>' : ''}</figcaption>
  </figure>`;
}

export function wireCharts(root) {
  root.querySelectorAll('.pg-chart[data-points]').forEach((fig) => {
    const svg = fig.querySelector('svg'); const tip = fig.querySelector('.pg-tip');
    const dots = [...fig.querySelectorAll('.pg-dot')]; const data = JSON.parse(fig.dataset.points); const unit = fig.dataset.unit;
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const sx = (ev.clientX - r.left) * (svg.viewBox.baseVal.width / r.width);
      let best = 0;
      dots.forEach((d, i) => { if (Math.abs(d.cx.baseVal.value - sx) < Math.abs(dots[best].cx.baseVal.value - sx)) best = i; });
      dots.forEach((d, i) => d.classList.toggle('is-active', i === best));
      tip.textContent = `${dLong(data[best][0])} · ${f1(data[best][1])} ${unit}`;
      tip.hidden = false;
      const px = (dots[best].cx.baseVal.value / svg.viewBox.baseVal.width) * r.width;
      tip.style.left = `${Math.min(Math.max(px, 80), r.width - 80)}px`;
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', () => { tip.hidden = true; dots.forEach((d) => d.classList.remove('is-active')); });
  });
}

