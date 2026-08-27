// Calcolo dei trend. Funzioni pure: nessuna rete, nessun file. Testate in test/all.test.mjs.

/** Periodi supportati, in giorni. */
export const PERIODS = { d7: 7, d30: 30, d90: 90, d365: 365 };

/**
 * Trend calcolato dallo storico proprio (snapshot giornalieri).
 * history: array [{date:'YYYY-MM-DD', trend:number}] ordinato crescente.
 * Ritorna null se non esiste un punto abbastanza vecchio entro la tolleranza.
 */
export function trendFromHistory(history, days, today, tolerance = null) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const tol = tolerance ?? Math.max(2, Math.round(days * 0.15));
  const now = history[history.length - 1];
  if (!now || !(now.trend > 0)) return null;

  const target = addDays(today, -days);
  let best = null;
  let bestDist = Infinity;
  for (const p of history) {
    if (!(p.trend > 0)) continue;
    const dist = Math.abs(daysBetween(p.date, target));
    if (dist < bestDist) { bestDist = dist; best = p; }
  }
  if (!best || bestDist > tol) return null;
  if (best.date === now.date) return null;
  return { pct: now.trend / best.trend - 1, from: best.trend, to: now.trend, fromDate: best.date, source: 'history' };
}

/**
 * Fallback quando lo storico proprio non copre ancora il periodo.
 * Usa le medie che Cardmarket pubblica gia' calcolate.
 *  - 7 giorni : trend corrente contro la media delle vendite degli ultimi 7 giorni
 *  - 30 giorni: trend corrente contro la media degli ultimi 30 giorni
 * Non e' la stessa cosa di una variazione punto-a-punto: e' uno scostamento
 * del mercato corrente rispetto al venduto recente. Va etichettato come stima.
 * avg1 non viene usato: su carte a basso volume e' una singola giornata di
 * vendite e produce oscillazioni a tre cifre prive di significato.
 */
export function trendFromCardmarketAverages(price, days) {
  if (!price) return null;
  const now = num(price.trend);
  if (!(now > 0)) return null;
  const base = days <= 7 ? num(price.avg7) : days <= 30 ? num(price.avg30) : null;
  if (!(base > 0)) return null;
  return { pct: now / base - 1, from: base, to: now, fromDate: null, source: 'cardmarket-avg' };
}

/** Sceglie la fonte migliore: storico proprio se c'e', altrimenti la stima. */
export function computeTrend(price, history, days, today) {
  return trendFromHistory(history, days, today) ?? trendFromCardmarketAverages(price, days);
}

/** Fascia di prezzo di appartenenza, calcolata sul trend raw. */
export function bandOf(bands, priceEur) {
  if (!(priceEur > 0)) return null;
  for (const b of bands) {
    const okMin = priceEur >= b.min;
    const okMax = b.max == null || priceEur < b.max;
    if (okMin && okMax) return b.id;
  }
  return null;
}

/**
 * Un movimento e' pubblicabile in classifica?
 *
 * Due sbarramenti, in ordine di importanza.
 *
 * 1. Rumore da centesimi: una comune che passa da 0,03 a 0,09 euro e' un
 *    +200% che non significa niente. Servono un prezzo minimo e un movimento
 *    assoluto minimo.
 *
 * 2. Plausibilita' rispetto alle offerte reali. E' il controllo che conta di
 *    piu', e nasce da un difetto osservato sui dati veri del 26/08/2026: senza
 *    di esso l'89% delle carte in classifica era mercato sottile, con valori
 *    tipo +806% e -98% privi di senso. Esempi reali scartati da questa regola:
 *      - Trevenant & Dusknoir GX: trend 96,06 euro, offerta piu' bassa 2 euro,
 *        media 30 giorni 10,60. Un mercato a 96 euro mentre si compra a 2 non
 *        e' un rialzo: e' il trend calcolato su pochissime vendite.
 *      - Dark Steelix: trend 0,97 euro ma nessuna copia sotto i 4,95. Se
 *        l'offerta piu' bassa sta sopra il prezzo di mercato, e' il prezzo a
 *        essere rotto, non il mercato a essere crollato.
 *    L'offerta piu' bassa e' l'unico fatto duro che abbiamo: e' un prezzo a cui
 *    la carta si compra adesso. Sia il valore attuale sia quello di confronto
 *    devono starle vicini, entro maxOfferMultiple volte.
 *
 * Cardmarket non pubblica il numero di scambi, quindi questo e' il miglior
 * discriminante disponibile finche' lo storico proprio non permette di
 * confrontare due giorni veri.
 */
export function isSignificant(t, price, noise) {
  if (!t || !Number.isFinite(t.pct)) return false;
  const trend = typeof price === 'number' ? price : price?.trend;
  const low = typeof price === 'number' ? null : price?.low;
  if (!(trend >= noise.minTrend)) return false;

  const abs = Math.abs(t.to - t.from);
  if (abs < noise.minAbsChangeEur) return false;
  if (Math.abs(t.pct) < noise.minAbsChangePctOfPrice) return false;

  return isPlausible(trend, t.from, low, noise);
}

/**
 * Il prezzo regge il confronto con le offerte reali sul mercato?
 * Senza offerta piu' bassa non possiamo verificare nulla: in quel caso
 * lasciamo passare, perche' scartare per assenza di prova sarebbe peggio.
 */
export function isPlausible(trend, riferimento, low, noise) {
  const K = noise.maxOfferMultiple;
  if (!K) return true;
  if (!(low > 0)) return true;
  if (low > trend * 1.05) return false;
  if (trend > low * K) return false;
  if (riferimento > 0 && riferimento > low * K) return false;
  return true;
}

/** Limita gli outlier estremi senza scartarli, cosi' non monopolizzano la classifica. */
export function winsorize(pct, cap) {
  if (!Number.isFinite(pct)) return pct;
  return Math.max(-0.95, Math.min(cap, pct));
}

/**
 * Classifica: top N in salita e in discesa, per fascia e periodo.
 * L'ordinamento usa la percentuale vera: winsorize serve solo a disegnare le
 * barre, e usarlo anche qui appiattirebbe tutti i valori estremi sullo stesso
 * numero, rendendo l'ordine fra loro arbitrario.
 */
export function rank(rows, { limit = 10 } = {}) {
  const valid = rows.filter((r) => Number.isFinite(r.pct));
  const sorted = [...valid].sort((a, b) => b.pct - a.pct || (b.t || 0) - (a.t || 0));
  return {
    up: sorted.slice(0, limit),
    down: sorted.slice(-limit).reverse(),
  };
}

// ---- utilita' date, in UTC, senza dipendenze ----
export function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((da - db) / 86400000);
}
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
