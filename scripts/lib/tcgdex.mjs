// Client TCGdex: throttling, retry con backoff, User-Agent identificabile.
// TCGdex non pubblica limiti rigidi ma chiede esplicitamente di essere
// considerati e di mettere in cache invece di rifare le stesse chiamate:
// per questo l'ingest e' a due velocita' e non riscarica tutto ogni giorno.

const BASE = 'https://api.tcgdex.net/v2';
const UA = 'poketrend/1.0 (dashboard personale, uso non commerciale)';

export class Client {
  constructor({ rps = 4, retries = 4, timeoutMs = 20000, log = () => {} } = {}) {
    this.minGap = 1000 / rps;
    this.retries = retries;
    this.timeoutMs = timeoutMs;
    this.last = 0;
    this.log = log;
    this.stats = { requests: 0, retries: 0, failures: 0 };
  }

  async #throttle() {
    const wait = this.minGap - (Date.now() - this.last);
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
  }

  async get(path) {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this.#throttle();
      this.stats.requests++;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        const res = await fetch(BASE + path, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.status === 404) return null;
        if (res.status === 429) {
          const wait = Number(res.headers.get('retry-after') || 0) * 1000 || 5000 * (attempt + 1);
          this.stats.retries++;
          await sleep(wait);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        this.stats.retries++;
        if (attempt === this.retries) {
          this.stats.failures++;
          this.log(`fallito ${path}: ${err.message}`);
          return null;
        }
        await sleep(800 * Math.pow(2, attempt));
      }
    }
    return null;
  }

  sets(lang = 'en') { return this.get(`/${lang}/sets`); }
  set(id, lang = 'en') { return this.get(`/${lang}/sets/${encodeURIComponent(id)}`); }
  card(id, lang = 'en') { return this.get(`/${lang}/cards/${encodeURIComponent(id)}`); }
}

/**
 * Normalizza il blocco pricing.cardmarket di TCGdex.
 * Campi osservati sul vivo (26/08/2026): updated, unit, idProduct, avg, low,
 * trend, avg1, avg7, avg30 e le varianti -holo. I campi possono essere null.
 * La serie di riferimento e' quella base: su un campione reale di 429 carte
 * (sv03.5, base1, me05) tutte avevano un trend base valido, e i campi -holo
 * di Cardmarket descrivono la stampa reverse/holo, che e' un'altra carta con
 * un altro prezzo. Sceglierla col massimo, come sembra comodo, mescolerebbe
 * due prodotti diversi. Quindi: base come default, holo esposta a parte.
 */
export function normalizeCardmarket(pricing) {
  const cm = pricing?.cardmarket;
  if (!cm) return null;
  const base = { trend: n(cm.trend), avg: n(cm.avg), low: n(cm.low), avg1: n(cm.avg1), avg7: n(cm.avg7), avg30: n(cm.avg30) };
  const holo = { trend: n(cm['trend-holo']), avg: n(cm['avg-holo']), low: n(cm['low-holo']), avg1: n(cm['avg1-holo']), avg7: n(cm['avg7-holo']), avg30: n(cm['avg30-holo']) };
  const useHolo = !(base.trend > 0) && holo.trend > 0;
  const chosen = useHolo ? holo : base;
  if (!(chosen.trend > 0) && !(chosen.avg30 > 0)) return null;
  return {
    ...chosen,
    variant: useHolo ? 'holo' : 'base',
    volatility: volatility(chosen),
    unit: cm.unit || 'EUR',
    updated: cm.updated ? String(cm.updated).slice(0, 10) : null,
    cmProductId: cm.idProduct ?? null,
    holo: holo.trend > 0 && !useHolo ? { trend: holo.trend, avg7: holo.avg7, avg30: holo.avg30, low: holo.low } : null,
  };
}

/**
 * Indicatore di quanto e' sottile il mercato di quella carta.
 * Cardmarket non pubblica il numero di scambi, ma quando le vendite sono
 * poche le quattro misure (trend, avg, avg7, avg30) divergono molto fra loro.
 * Coefficiente di variazione: sul campione reale la mediana e' 0,09 e il
 * novantesimo percentile 0,22 — oltre 0,25 la carta va segnalata come
 * poco scambiata, perche' la sua variazione percentuale e' poco affidabile.
 */
export function volatility(p) {
  const v = [p.trend, p.avg, p.avg7, p.avg30].filter((x) => typeof x === 'number' && x > 0);
  if (v.length < 3) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  if (!(m > 0)) return null;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
  return Math.round((sd / m) * 1000) / 1000;
}

function n(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
