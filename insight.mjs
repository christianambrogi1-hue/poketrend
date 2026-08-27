// Il numero che finisce in cima al grafico e sull'immagine esportata.
// Funzioni pure: nessuna rete, nessun DOM, nessun file. Girano identiche nei
// test e nel browser, perche' il build copia questo file dentro web/.
//
// La regola di fondo: una percentuale non viaggia mai da sola. Su una carta da
// 6 euro il gradino minimo di prezzo vale gia' il sedici per cento, quindi
// "+33%" senza "+2,00 €" accanto e' un titolo, non un'informazione. Qui la
// variazione assoluta esce sempre insieme a quella percentuale, e i movimenti
// troppo piccoli per contare vengono marcati.

/** Punti dentro la finestra richiesta. Se non ne restano abbastanza, li tiene tutti. */
export function windowPoints(points, days, today) {
  if (!Array.isArray(points) || !points.length) return [];
  if (!days) return points;
  const from = addDays(today, -days);
  const inside = points.filter((p) => p.date >= from);
  return inside.length >= 2 ? inside : points;
}

/**
 * Variazione su un periodo, con la fonte dichiarata.
 *  - 'history'  : differenza fra due rilevazioni vere. E' un dato.
 *  - 'estimate' : scostamento fra trend corrente e medie Cardmarket, usato
 *                 finche' lo storico non copre il periodo. E' una stima.
 * I punti stimati dal backfill non vengono mai usati per il calcolo.
 */
export function computeInsight({ points = [], price, days, today, fallbackPct = null, noise = {} }) {
  const real = points.filter((p) => p && !p.est && p.v > 0);
  const now = price?.t ?? (real.length ? real[real.length - 1].v : null);
  if (!(now > 0)) return null;

  const minAbs = noise.minAbsChangeEur ?? 0.2;
  const minTrend = noise.minTrend ?? 0.15;

  if (real.length >= 2) {
    const last = real[real.length - 1];
    const target = addDays(today, -days);
    const tol = Math.max(2, Math.round(days * 0.15));
    let best = null;
    let bestDist = Infinity;
    for (const p of real) {
      const dist = Math.abs(daysBetween(p.date, target));
      if (dist < bestDist) { bestDist = dist; best = p; }
    }
    if (best && bestDist <= tol && best.date !== last.date) {
      return finish({
        from: best.v, to: last.v, fromDate: best.date, toDate: last.date,
        days: daysBetween(last.date, best.date), source: 'history',
      }, minAbs, minTrend);
    }
  }

  if (fallbackPct != null && Number.isFinite(fallbackPct) && fallbackPct > -1) {
    const from = now / (1 + fallbackPct);
    return finish({
      from, to: now, fromDate: null, toDate: today, days, source: 'estimate',
    }, minAbs, minTrend);
  }
  return null;
}

function finish(o, minAbs, minTrend) {
  const abs = o.to - o.from;
  const pct = o.from > 0 ? o.to / o.from - 1 : null;
  return {
    ...o,
    abs: round2(abs),
    pct,
    estimated: o.source !== 'history',
    // Movimento troppo piccolo perche' la percentuale significhi qualcosa:
    // o la carta vale pochi centesimi, o si e' mossa di meno della soglia.
    weak: !(o.to >= minTrend) || Math.abs(abs) < minAbs,
  };
}

/**
 * Tacche dell'asse su valori tondi. Un asse che parte da zero schiaccia contro
 * il bordo superiore una serie che oscilla fra 6 e 8 euro; uno che parte dal
 * minimo esatto trasforma il rumore in un dirupo. Compromesso: si parte dal
 * minimo arrotondato in giu' al passo, e il passo e' un numero leggibile.
 */
export function niceScale(min, max, targetTicks = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max === min) { const pad = Math.abs(max) * 0.1 || 1; min -= pad; max += pad; }
  const step = niceStep((max - min) / Math.max(1, targetTicks));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(round2(v));
  return { min: lo, max: hi, step, ticks };
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return mult * mag;
}

/** Formattazioni condivise fra dashboard e immagine, cosi' non divergono. */
export function fmtEur(n, { decimals = null } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const d = decimals ?? (Math.abs(n) < 100 ? 2 : 0);
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
export function fmtPct(p, { decimals = 1 } = {}) {
  if (p == null || !Number.isFinite(p)) return '—';
  return (p >= 0 ? '+' : '−') + (Math.abs(p) * 100).toFixed(decimals).replace('.', ',') + '%';
}
export function fmtSignedEur(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '−') + fmtEur(Math.abs(n));
}
export function fmtDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return isNaN(d) ? iso : d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}
export function fmtShortDay(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return isNaN(d) ? iso : d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000);
}
function round2(n) { return Math.round(n * 100) / 100; }
