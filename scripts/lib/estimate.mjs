// Stime per condizione e per carta gradata.
// Tutto quello che esce da qui e' una STIMA MODELLATA, mai un prezzo rilevato.
// Ogni valore porta con se' la confidenza, e la UI e' tenuta a mostrarla.

/**
 * Stima del prezzo per condizione.
 * Due ancoraggi reali: trend (mercato corrente, di fatto NM) e low (offerta
 * piu' bassa in qualsiasi condizione). Le condizioni intermedie sono interpolate
 * col coefficiente, ma non scendono mai sotto l'offerta piu' bassa reale.
 */
export function estimateByCondition(price, cfg) {
  const trend = numOr(price?.trend, 0);
  const low = numOr(price?.low, 0);
  if (!(trend > 0)) return null;
  const out = {};
  for (const [cond, coef] of Object.entries(cfg.coefficients)) {
    const raw = trend * coef;
    out[cond] = {
      eur: round2(cond === 'NM' ? trend : Math.max(low, raw)),
      confidence: cfg.confidence[cond] ?? 'bassa',
      estimated: cond !== 'NM',
    };
  }
  return out;
}

/** Era della carta dalla data di uscita del set. */
export function eraOf(releaseDate, eras) {
  const year = Number(String(releaseDate || '').slice(0, 4)) || 9999;
  if (year <= eras.vintage.untilYear) return 'vintage';
  if (year <= eras.retro.untilYear) return 'retro';
  return 'modern';
}

/** Moltiplicatore PSA 10 sul raw, scaglionato per era e fascia di valore raw. */
export function psa10Multiplier(rawEur, era, table) {
  const tiers = table[era] || table.modern;
  for (const t of tiers) {
    if (t.maxRaw == null || rawEur <= t.maxRaw) return t.x;
  }
  return tiers[tiers.length - 1].x;
}

/**
 * Stima dei valori gradati per tutte le case configurate.
 * base = prezzo raw NM (trend Cardmarket).
 */
export function estimateGraded(rawNmEur, releaseDate, cfg) {
  if (!(rawNmEur > 0)) return null;
  const era = eraOf(releaseDate, cfg.eras);
  const psa10 = rawNmEur * psa10Multiplier(rawNmEur, era, cfg.psa10MultiplierOnRaw);
  const ratios = cfg.gradeRatioOfPsa10;
  const houses = [];
  for (const h of cfg.houses) {
    const grades = {};
    for (const g of h.grades) {
      const ratio = ratios[g];
      if (ratio == null) continue;
      grades[g] = round2(psa10 * ratio * h.factor);
    }
    houses.push({ id: h.id, name: h.name, country: h.country, confidence: h.confidence, note: h.note, grades });
  }
  return { era, psa10Reference: round2(psa10), houses, estimated: true };
}

/** Link a vendite reali: e' li' che si verifica la stima. */
export function verificationLinks(card, cfg) {
  const q = encodeURIComponent(`${card.nameEn} ${card.localId} ${card.setName} pokemon`);
  return {
    ebaySold: cfg.verificaReale.ebaySoldUrl.replace('{query}', q),
    priceCharting: cfg.verificaReale.priceChartingUrl.replace('{query}', q),
  };
}

/**
 * Deep link a Cardmarket. Se conosciamo idProduct puntiamo al prodotto esatto,
 * con i filtri di lingua e condizione applicati; altrimenti ripieghiamo sulla
 * ricerca per nome, che funziona sempre.
 * idLanguage Cardmarket: 1 EN, 2 FR, 3 DE, 4 ES, 5 IT, 6 JP, 7 SC, 8 KR, 9 RU, 10 TC, 11 NL, 12 PL, 13 PT.
 * minCondition: 1 MT, 2 NM, 3 EX, 4 GD, 5 LP, 6 PL, 7 PO.
 */
export const CM_LANG = { en: 1, fr: 2, de: 3, es: 4, it: 5, ja: 6, 'zh-cn': 7, ko: 8, ru: 9, 'zh-tw': 10, nl: 11, pl: 12, pt: 13 };
export const CM_COND = { MT: 1, NM: 2, EX: 3, GD: 4, LP: 5, PL: 6, PO: 7 };

export function cardmarketLink(card, { lang = 'it', condition = null } = {}) {
  const params = new URLSearchParams();
  const idLang = CM_LANG[lang];
  if (idLang) params.set('idLanguage', String(idLang));
  if (condition && CM_COND[condition]) params.set('minCondition', String(CM_COND[condition]));
  params.set('sortBy', 'price_asc');
  const qs = params.toString();
  if (card.cmProductId) {
    return `https://www.cardmarket.com/it/Pokemon/Products/Singles?idProduct=${card.cmProductId}&${qs}`;
  }
  const search = encodeURIComponent(`${card.nameEn} ${card.localId}`);
  return `https://www.cardmarket.com/it/Pokemon/Products/Search?searchString=${search}&${qs}`;
}

function numOr(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
function round2(n) { return Math.round(n * 100) / 100; }
