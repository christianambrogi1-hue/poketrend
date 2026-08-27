// Immagine verticale da pubblicare, generata dal dato reale.
//
// Regole che l'immagine rispetta sempre, perche' sono il motivo per cui vale la
// pena generarla invece di copiare il formato che gira sui social:
//  1. la percentuale non compare mai da sola: accanto c'e' sempre la variazione
//     in euro e i due prezzi da cui nasce. Su una carta da 6 euro un gradino di
//     un euro vale il sedici per cento, e senza il valore assoluto un "+33%"
//     dice molto meno di quanto sembra;
//  2. il periodo e' scritto con le date vere, non con la parola "sempre";
//  3. se il numero e' una stima, l'immagine lo dice sopra, non in nota;
//  4. la fonte e il suo limite (prezzo di prodotto, non di lingua) stanno in
//     fondo, sempre.
//
// La tavolozza qui e' fissa e chiara: l'immagine esce uguale a chiunque la
// generi, anche con la dashboard in tema scuro.

import { layout, tickDecimals } from './chart.mjs';
import { fmtEur, fmtPct, fmtSignedEur, fmtDay } from './insight.mjs';

const W = 1080;
const Hh = 1350;
const P = { // tavolozza fissa dell'immagine
  bg: '#f7f6f2', card: '#ffffff', ink: '#111111', ink2: '#55534e', muted: '#8a8782',
  grid: '#e3e1d9', up: '#1f7a4d', down: '#c23b39', accent: '#2a78d6', badge: '#f4e2b8',
};

/**
 * @param {object} o
 * @param {object} o.card    riga carta della dashboard
 * @param {object} o.insight risultato di computeInsight
 * @param {Array}  o.points  punti del grafico [{date, v, est}]
 * @param {string} o.periodLabel  etichetta leggibile del periodo
 * @param {string} o.generated    data del dato
 * @returns {Promise<Blob>}
 */
export async function buildImage({ card, insight, points, periodLabel, generated }) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = Hh;
  const c = cv.getContext('2d');
  c.textBaseline = 'alphabetic';

  bg(c);
  let y = 72;
  y = header(c, y, generated);
  y = title(c, y, card);

  const art = await loadArt(card);
  y = hero(c, y, insight, periodLabel, art, card);
  y = chart(c, y, points);
  footer(c);

  return await new Promise((res) => cv.toBlob(res, 'image/png'));
}

function bg(c) {
  c.fillStyle = P.bg;
  c.fillRect(0, 0, W, Hh);
}

function header(c, y, generated) {
  c.fillStyle = P.muted;
  c.font = '600 26px system-ui, -apple-system, "Segoe UI", sans-serif';
  c.textAlign = 'left';
  c.fillText('POKETREND · MARKET INSIGHT', 72, y);
  c.textAlign = 'right';
  c.fillText(fmtDay(generated).toUpperCase(), W - 72, y);
  c.textAlign = 'left';
  c.strokeStyle = P.grid; c.lineWidth = 2;
  line(c, 72, y + 22, W - 72, y + 22);
  return y + 76;
}

function title(c, y, card) {
  const name = card.ni || card.n || '';
  c.fillStyle = P.ink;
  const size = name.length > 26 ? 52 : name.length > 18 ? 62 : 72;
  c.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const lines = wrap(c, name, W - 144, 2);
  for (const l of lines) { c.fillText(l, 72, y); y += size + 8; }

  c.fillStyle = P.ink2;
  c.font = '400 30px system-ui, -apple-system, "Segoe UI", sans-serif';
  const sub = `${card.l}/${card.so ?? card.st ?? '?'} · ${card.sn}`;
  c.fillText(clip(c, sub, W - 144), 72, y + 10);
  return y + 62;
}

/** Blocco centrale: prezzo di partenza, prezzo di arrivo, variazione doppia. */
function hero(c, y, ins, periodLabel, art, card) {
  const h = ins ? 300 : 210;
  panel(c, 72, y, W - 144, h);

  const artW = 190;
  const boxX = 72 + 32;
  if (art) {
    const ratio = Math.min(artW / art.width, (h - 64) / art.height);
    const w = art.width * ratio, hh = art.height * ratio;
    c.drawImage(art, boxX, y + (h - hh) / 2, w, hh);
  }
  const left = art ? boxX + artW + 36 : boxX;

  // Senza due rilevazioni non c'e' una variazione. L'immagine allora mostra il
  // prezzo di oggi, che e' un dato vero, invece di un riquadro vuoto o di una
  // percentuale ricavata da qualcosa che non abbiamo.
  if (!ins) {
    c.fillStyle = P.muted;
    c.font = '600 26px system-ui, -apple-system, "Segoe UI", sans-serif';
    c.fillText('PREZZO DI OGGI', left, y + 62);
    c.fillStyle = P.ink;
    c.font = '700 84px system-ui, -apple-system, "Segoe UI", sans-serif';
    c.fillText(fmtEur(card?.pr?.t), left, y + 142);
    c.fillStyle = P.ink2;
    c.font = '400 26px system-ui, -apple-system, "Segoe UI", sans-serif';
    c.fillText('Storico troppo corto per una variazione onesta su questo periodo.', left, y + 182);
    return y + h + 32;
  }

  const positive = (ins.pct ?? 0) >= 0;
  const col = positive ? P.up : P.down;

  c.fillStyle = P.muted;
  c.font = '600 26px system-ui, -apple-system, "Segoe UI", sans-serif';
  c.fillText(periodLabel.toUpperCase(), left, y + 62);

  // Percentuale ed euro insieme, stessa riga, stesso peso visivo relativo.
  c.fillStyle = col;
  c.font = '700 96px system-ui, -apple-system, "Segoe UI", sans-serif';
  const pctText = fmtPct(ins.pct);
  c.fillText(pctText, left, y + 158);
  const pctW = c.measureText(pctText).width;
  c.font = '600 46px system-ui, -apple-system, "Segoe UI", sans-serif';
  c.fillText(fmtSignedEur(ins.abs), left + pctW + 22, y + 158);

  c.fillStyle = P.ink;
  c.font = '500 40px system-ui, -apple-system, "Segoe UI", sans-serif';
  c.fillText(`${fmtEur(ins.from)}  →  ${fmtEur(ins.to)}`, left, y + 218);

  c.fillStyle = P.ink2;
  c.font = '400 26px system-ui, -apple-system, "Segoe UI", sans-serif';
  // Senza data di partenza il numero non nasce da due rilevazioni: dirlo qui,
  // invece di scrivere "ultimi N giorni", che contraddirebbe l'etichetta sopra.
  const when = ins.fromDate
    ? `dal ${fmtDay(ins.fromDate)} al ${fmtDay(ins.toDate)}`
    : `confronto con la media Cardmarket a ${periodLabel.toLowerCase()}`;
  c.fillText(when, left, y + 262);

  y += h + 24;
  if (ins.estimated || ins.weak) y = warnings(c, y, ins);
  return y + 20;
}

function warnings(c, y, ins) {
  const msgs = [];
  if (ins.estimated) msgs.push('STIMA — non è la differenza fra due rilevazioni, ma lo scostamento fra il prezzo di oggi e la media delle vendite recenti pubblicata da Cardmarket.');
  if (ins.weak) msgs.push('Movimento assoluto sotto la soglia di rumore: a questo livello di prezzo la percentuale dice poco.');
  c.font = '500 24px system-ui, -apple-system, "Segoe UI", sans-serif';
  for (const m of msgs) {
    const lines = wrap(c, m, W - 200, 3);
    const h = 24 + lines.length * 32;
    c.fillStyle = P.badge;
    round(c, 72, y, W - 144, h, 12); c.fill();
    c.fillStyle = P.ink2;
    let ly = y + 38;
    for (const l of lines) { c.fillText(l, 96, ly); ly += 32; }
    y += h + 12;
  }
  return y;
}

function chart(c, y, points) {
  const pts = (points || []).filter((p) => p && p.v > 0);
  // Il pannello riempie lo spazio che resta fino al piede: cosi' l'immagine non
  // ha un vuoto in fondo quando il titolo sta su una riga sola.
  const h = Math.max(280, Hh - 150 - y);
  panel(c, 72, y, W - 144, h);

  c.fillStyle = P.muted;
  c.font = '600 26px system-ui, -apple-system, "Segoe UI", sans-serif';
  c.fillText('ANDAMENTO DEL PREZZO', 104, y + 50);

  if (pts.length < 2) {
    c.fillStyle = P.ink2;
    c.font = '400 28px system-ui, -apple-system, "Segoe UI", sans-serif';
    c.fillText('Raccolta appena iniziata: un solo punto disponibile.', 104, y + 120);
    return y + h + 28;
  }

  // La didascalia sul tratteggio si prende la sua fascia in fondo al pannello:
  // se il disegno arriva fin li', le date dell'asse e la didascalia si
  // sovrappongono e il grafico diventa illeggibile proprio dove spiega se stesso.
  const hasEst = pts.some((p) => p.est);
  const capBand = hasEst ? 46 : 10;
  const g = layout(pts, W - 144 - 64, h - 80 - capBand, { l: 96, r: 24, t: 20, b: 46 }, 11.5);
  const ox = 72 + 32, oy = y + 70;
  const X = (v) => ox + v, Y = (v) => oy + v;

  c.strokeStyle = P.grid; c.lineWidth = 1.5;
  c.fillStyle = P.muted;
  c.font = '400 22px system-ui, -apple-system, "Segoe UI", sans-serif';
  c.textAlign = 'right';
  for (const t of g.ticks) {
    line(c, X(g.margin.l), Y(t.y), X(g.width - g.margin.r), Y(t.y));
    c.fillText(fmtEur(t.v, { decimals: tickDecimals(g.scale.step) }), X(g.margin.l) - 12, Y(t.y) + 8);
  }
  c.textAlign = 'left';
  for (const l of g.xLabels) {
    c.textAlign = l.anchor === 'end' ? 'right' : l.anchor === 'middle' ? 'center' : 'left';
    c.fillText(fmtDay(l.date).slice(0, 5), X(l.x), Y(g.height - 10));
  }
  c.textAlign = 'left';

  // Segmenti: tratteggio dove almeno un estremo e' stimato.
  c.lineWidth = 3.5; c.lineJoin = 'round'; c.lineCap = 'round';
  for (let i = 1; i < g.pts.length; i++) {
    const a = g.pts[i - 1], b = g.pts[i];
    const est = a.est || b.est;
    c.strokeStyle = P.accent;
    c.globalAlpha = est ? 0.5 : 1;
    c.setLineDash(est ? [9, 8] : []);
    line(c, X(a.x), Y(a.y), X(b.x), Y(b.y));
  }
  c.setLineDash([]); c.globalAlpha = 1;

  const last = g.pts[g.pts.length - 1];
  c.fillStyle = P.accent;
  c.beginPath(); c.arc(X(last.x), Y(last.y), 9, 0, Math.PI * 2); c.fill();
  c.strokeStyle = P.card; c.lineWidth = 4;
  c.beginPath(); c.arc(X(last.x), Y(last.y), 9, 0, Math.PI * 2); c.stroke();

  if (hasEst) {
    c.fillStyle = P.muted;
    c.font = '400 21px system-ui, -apple-system, "Segoe UI", sans-serif';
    c.fillText('tratteggio: punti stimati dalle medie Cardmarket, non rilevazioni', 104, y + h - 20);
  }
  return y + h + 28;
}

function footer(c) {
  const y = Hh - 96;
  c.strokeStyle = P.grid; c.lineWidth = 2;
  line(c, 72, y - 34, W - 72, y - 34);
  c.fillStyle = P.muted;
  c.font = '400 23px system-ui, -apple-system, "Segoe UI", sans-serif';
  c.fillText('Prezzo trend Cardmarket in euro, letto da TCGdex. È il prezzo del prodotto,', 72, y);
  c.fillText('che aggrega tutte le lingue. Storico raccolto da PokeTrend, non da terzi.', 72, y + 32);
}

/* ---------- utilita' di disegno ---------- */

function panel(c, x, y, w, h) {
  c.fillStyle = P.card;
  round(c, x, y, w, h, 20); c.fill();
  c.strokeStyle = P.grid; c.lineWidth = 2;
  round(c, x, y, w, h, 20); c.stroke();
}
function round(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r);
  else c.rect(x, y, w, h);
}
function line(c, x1, y1, x2, y2) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }

function wrap(c, text, max, maxLines = 3) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const t = cur ? cur + ' ' + words[i] : words[i];
    if (c.measureText(t).width > max && cur) {
      lines.push(cur);
      if (lines.length === maxLines - 1) {
        // ultima riga disponibile: ci sta tutto il resto, tagliato se serve
        lines.push(clip(c, words.slice(i).join(' '), max));
        return lines;
      }
      cur = words[i];
    } else cur = t;
  }
  if (cur) lines.push(clip(c, cur, max));
  return lines;
}
function clip(c, text, max) {
  let t = String(text);
  if (c.measureText(t).width <= max) return t;
  while (t.length > 1 && c.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

/**
 * L'immagine della carta arriva da un altro dominio. Se quel dominio non manda
 * gli header CORS il canvas si "sporca" e toBlob smette di funzionare: qui la
 * scarichiamo prima come blob, cosi' un rifiuto e' un errore che possiamo
 * gestire e non un'immagine che non si salva piu'.
 */
async function loadArt(card) {
  if (!card?.img) return null;
  try {
    const res = await fetch(`${card.img}/low.webp`, { mode: 'cors' });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch { return null; }
}

/** Sul telefono il foglio di condivisione e' piu' utile di un download. */
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return 'shared'; } catch { /* annullato */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
