// Grafico del prezzo nella scheda carta.
//
// Scelte che contano, e perche':
//  - asse x sul tempo, non sull'indice del punto. I punti non sono equidistanti
//    (rotazione della coda lunga, punti stimati a -15 e -4 giorni): disegnarli a
//    passo fisso allargherebbe i periodi vuoti e schiaccerebbe quelli densi.
//  - asse y che non parte da zero ma da un minimo arrotondato. Su una carta che
//    oscilla fra 6 e 8 euro, partire da zero appiattisce tutto contro il bordo;
//    partire dal minimo esatto trasforma il rumore in un dirupo. Le tacche
//    dichiarano sempre il valore, quindi la scala non e' nascosta.
//  - tratteggio solo per i punti stimati dal backfill. Nessun tratteggio sulla
//    griglia: li' sarebbe rumore, qui significa "questo non e' un dato".
//  - una serie sola, quindi nessuna legenda: il titolo dice gia' cosa e'.
//  - sotto il grafico c'e' la tabella dei valori: il tooltip non e' mai l'unico
//    modo di leggere un numero.
//
// Il disegno e' in pixel reali misurati sul contenitore, non in unita' scalate:
// un viewBox stirato deformerebbe il testo e gli spessori.

import { niceScale, fmtEur, fmtShortDay, fmtDay } from './insight.mjs';

const M = { l: 46, r: 14, t: 16, b: 26 };
const H = 236;

export function renderChart(host, { points, caption = '' } = {}) {
  if (!host) return { destroy() {} };
  const pts = (points || []).filter((p) => p && p.v > 0);
  if (pts.length < 2) {
    host.innerHTML = `<p class="sub">Un solo punto raccolto: il grafico compare appena c'è una seconda rilevazione.</p>`;
    return { destroy() {} };
  }

  host.innerHTML = `
    <div class="chart-wrap">
      <div class="chart-plot" tabindex="0" role="img" aria-label="${esc(ariaFor(pts))}"></div>
      <div class="chart-tip" hidden></div>
    </div>
    ${caption ? `<p class="sub chart-cap">${caption}</p>` : ''}
    <details class="chart-table"><summary>Valori del grafico</summary>
      <div class="tw"><table><thead><tr><th>Data</th><th>Prezzo</th><th>Tipo</th></tr></thead><tbody>
      ${[...pts].reverse().map((p) => `<tr><td>${fmtDay(p.date)}</td><td>${fmtEur(p.v)}</td><td>${p.est ? 'stima' : 'rilevato'}</td></tr>`).join('')}
      </tbody></table></div>
    </details>`;

  const plot = host.querySelector('.chart-plot');
  const tip = host.querySelector('.chart-tip');
  let geom = null;
  let active = -1;

  const draw = () => {
    const w = Math.max(260, plot.clientWidth || host.clientWidth || 320);
    geom = layout(pts, w);
    plot.innerHTML = svg(geom);
    if (active >= 0) highlight(active);
  };

  const highlight = (i) => {
    active = i;
    const p = geom.pts[i];
    const g = plot.querySelector('.cursor');
    if (!g || !p) return;
    // display, non l'attributo hidden: dentro un SVG hidden non nasconde nulla
    g.style.display = '';
    g.querySelector('line').setAttribute('x1', p.x);
    g.querySelector('line').setAttribute('x2', p.x);
    const dot = g.querySelector('circle');
    dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
    tip.hidden = false;
    tip.innerHTML = `<b>${fmtEur(p.v)}</b><span>${fmtDay(p.date)}${p.est ? ' · stima' : ''}</span>`;
    const w = plot.clientWidth;
    tip.style.left = Math.max(4, Math.min(w - tip.offsetWidth - 4, p.x - tip.offsetWidth / 2)) + 'px';
  };

  const clear = () => {
    active = -1;
    const g = plot.querySelector('.cursor');
    if (g) g.style.display = 'none';
    tip.hidden = true;
  };

  const at = (clientX) => {
    const box = plot.getBoundingClientRect();
    const x = clientX - box.left;
    let best = 0, bd = Infinity;
    geom.pts.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = i; } });
    return best;
  };

  plot.addEventListener('pointermove', (e) => highlight(at(e.clientX)));
  plot.addEventListener('pointerleave', clear);
  plot.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = active < 0 ? geom.pts.length - 1 : active + (e.key === 'ArrowRight' ? 1 : -1);
      highlight(Math.max(0, Math.min(geom.pts.length - 1, next)));
    } else if (e.key === 'Escape') clear();
  });
  plot.addEventListener('blur', clear);

  draw();
  const ro = new ResizeObserver(debounce(draw, 120));
  ro.observe(plot);
  return { destroy() { ro.disconnect(); } };
}

/**
 * Coordinate in pixel. Esportata perche' la usa anche l'immagine da esportare.
 * Il margine sinistro non e' fisso: viene allargato quanto serve all'etichetta
 * piu' lunga dell'asse. Con un margine fisso "11,50 €" perde la prima cifra e
 * il grafico mente sull'ordine di grandezza. charW e' la larghezza media di un
 * carattere alla dimensione usata da chi disegna.
 */
export function layout(pts, width, height = H, margin = M, charW = 6.3) {
  const t = (d) => new Date(d + 'T00:00:00Z').getTime();
  const t0 = t(pts[0].date);
  const t1 = t(pts[pts.length - 1].date);
  const span = t1 - t0 || 1;
  const vals = pts.map((p) => p.v);
  const scale = niceScale(Math.min(...vals), Math.max(...vals), 4);
  const dec = tickDecimals(scale.step);
  const longest = Math.max(...scale.ticks.map((v) => fmtEur(v, { decimals: dec }).length));
  margin = { ...margin, l: Math.max(margin.l, Math.round(longest * charW + 14)) };
  const iw = width - margin.l - margin.r;
  const ih = height - margin.t - margin.b;
  const x = (d) => margin.l + ((t(d) - t0) / span) * iw;
  const y = (v) => margin.t + ih - ((v - scale.min) / (scale.max - scale.min || 1)) * ih;
  return {
    width, height, margin, scale, iw, ih,
    pts: pts.map((p) => ({ ...p, x: round1(x(p.date)), y: round1(y(p.v)) })),
    ticks: scale.ticks.map((v) => ({ v, y: round1(y(v)) })),
    xLabels: xLabels(pts, x),
  };
}

/** Al massimo tre etichette sull'asse orizzontale: prima, ultima, una in mezzo. */
function xLabels(pts, x) {
  const idx = pts.length > 4 ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1] : [0, pts.length - 1];
  return [...new Set(idx)].map((i) => ({ date: pts[i].date, x: round1(x(pts[i].date)), anchor: i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle' }));
}

function svg(g) {
  const { margin } = g;
  const solid = [];
  const dashed = [];
  for (let i = 1; i < g.pts.length; i++) {
    const a = g.pts[i - 1], b = g.pts[i];
    (a.est || b.est ? dashed : solid).push(`M${a.x} ${a.y}L${b.x} ${b.y}`);
  }
  const last = g.pts[g.pts.length - 1];
  const estDots = g.pts.filter((p) => p.est);

  return `<svg width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    ${g.ticks.map((t) => `<line x1="${margin.l}" x2="${g.width - margin.r}" y1="${t.y}" y2="${t.y}" stroke="var(--grid)" stroke-width="1"/>
      <text x="${margin.l - 8}" y="${t.y + 4}" text-anchor="end" font-size="11" fill="var(--muted)" style="font-variant-numeric:tabular-nums">${fmtEur(t.v, { decimals: tickDecimals(g.scale.step) })}</text>`).join('')}
    ${g.xLabels.map((l) => `<text x="${l.x}" y="${g.height - 8}" text-anchor="${l.anchor}" font-size="11" fill="var(--muted)">${esc(fmtShortDay(l.date))}</text>`).join('')}
    ${dashed.length ? `<path d="${dashed.join('')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round" opacity=".55"/>` : ''}
    ${solid.length ? `<path d="${solid.join('')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${estDots.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.5" opacity=".7"/>`).join('')}
    <circle cx="${last.x}" cy="${last.y}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
    <g class="cursor" style="display:none">
      <line y1="${margin.t}" y2="${g.height - margin.b}" stroke="var(--axis)" stroke-width="1"/>
      <circle r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
    </g>
  </svg>`;
}

/**
 * Quante cifre sulle tacche. Si decide dal passo, non dal valore: con un passo
 * di mezzo euro e zero decimali due tacche diverse finiscono per stampare lo
 * stesso numero, e l'asse diventa illeggibile.
 */
export function tickDecimals(step) { return step >= 1 ? 0 : 2; }

function ariaFor(pts) {
  const a = pts[0], b = pts[pts.length - 1];
  return `Andamento del prezzo dal ${fmtDay(a.date)} al ${fmtDay(b.date)}, da ${fmtEur(a.v)} a ${fmtEur(b.v)}, ${pts.length} punti.`;
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function round1(n) { return Math.round(n * 10) / 10; }
function debounce(f, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; }
