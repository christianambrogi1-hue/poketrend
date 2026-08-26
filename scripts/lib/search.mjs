// Parsing della query di ricerca e matching. Funzioni pure, usate sia
// dall'ingest (per i test) sia dalla PWA (import diretto nel browser).

/**
 * Riconosce nella stringa:
 *  - "201/196"  -> numero carta + totale stampato sul set
 *  - "#201" o "n.201" -> solo numero
 *  - il resto -> nome
 * Esempi: "charizard 201/196", "201/196", "pikachu", "#25 base"
 */
export function parseQuery(input) {
  const raw = String(input || '').trim();
  if (!raw) return { name: '', localId: null, printedTotal: null };

  let localId = null;
  let printedTotal = null;
  let rest = raw;

  const frac = rest.match(/(?:^|\s)([A-Za-z]{0,3}\d{1,4}[A-Za-z]?)\s*\/\s*(\d{1,4})(?=\s|$)/);
  if (frac) {
    localId = frac[1];
    printedTotal = Number(frac[2]);
    rest = (rest.slice(0, frac.index) + ' ' + rest.slice(frac.index + frac[0].length)).trim();
  } else {
    const hash = rest.match(/(?:^|\s)(?:#|n\.?\s?)(\d{1,4}[A-Za-z]?)(?=\s|$)/i);
    if (hash) {
      localId = hash[1];
      rest = (rest.slice(0, hash.index) + ' ' + rest.slice(hash.index + hash[0].length)).trim();
    } else if (/^\d{1,4}[A-Za-z]?$/.test(rest)) {
      localId = rest;
      rest = '';
    }
  }
  return { name: normalize(rest), localId, printedTotal };
}

/** Normalizzazione per confronto: minuscole, accenti via, punteggiatura via. */
export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Il numero stampato ammette zeri iniziali diversi: "001" deve trovare "1". */
export function sameLocalId(a, b) {
  const na = String(a || '').toLowerCase().replace(/^0+(?=\d)/, '');
  const nb = String(b || '').toLowerCase().replace(/^0+(?=\d)/, '');
  return na === nb;
}

/**
 * Filtra e ordina le carte.
 * cards: array di oggetti con { names: {it,en,...}, localId, setTotal, setOfficial, trend }
 */
export function searchCards(cards, query, { lang = 'it', limit = 60, filters = {} } = {}) {
  const q = parseQuery(query);
  const hasQuery = q.name || q.localId;
  const out = [];

  for (const c of cards) {
    if (filters.setId && c.setId !== filters.setId) continue;
    if (filters.rarity && c.rarity !== filters.rarity) continue;
    if (filters.bandId && c.bandId !== filters.bandId) continue;

    if (q.localId && !sameLocalId(c.localId, q.localId)) continue;
    if (q.printedTotal != null && c.setOfficial !== q.printedTotal && c.setTotal !== q.printedTotal) continue;

    let score = 0;
    if (q.name) {
      const candidates = [c.names?.[lang], c.names?.en].filter(Boolean).map(normalize);
      let best = -1;
      for (const cand of candidates) {
        if (cand === q.name) best = Math.max(best, 100);
        else if (cand.startsWith(q.name)) best = Math.max(best, 70);
        else if (cand.includes(q.name)) best = Math.max(best, 40);
      }
      if (best < 0) continue;
      score = best;
    }
    if (q.localId) score += 30;
    if (q.printedTotal != null) score += 20;
    out.push({ card: c, score });
  }

  if (hasQuery) out.sort((a, b) => b.score - a.score || (b.card.trend || 0) - (a.card.trend || 0));
  else out.sort((a, b) => (b.card.trend || 0) - (a.card.trend || 0));
  return out.slice(0, limit).map((x) => x.card);
}
