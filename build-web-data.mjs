#!/usr/bin/env node
// Trasforma data/ nel pacchetto che la PWA scarica.
// Formato a colonne per tenerlo leggero su rete mobile.

import fs from 'node:fs/promises';
import path from 'node:path';
import { computeTrend, bandOf, isSignificant, rank } from './lib/trend.mjs';
import { readNdjson } from './lib/store.mjs';
import { parseHistory, historyFileMeta } from './lib/history.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'web', 'data');
const PERIODS = { d7: 7, d30: 30, d90: 90, d365: 365 };

const today = process.env.POKETREND_TODAY || new Date().toISOString().slice(0, 10);

async function main() {
  const cards = await readNdjson(path.join(DATA, 'cards.ndjson'));
  const prices = await readNdjson(path.join(DATA, 'prices.ndjson'));
  const bandsCfg = await readJson(path.join(ROOT, 'config', 'bands.json'));
  const gradingCfg = await readJson(path.join(ROOT, 'config', 'grading.json'));
  const condCfg = await readJson(path.join(ROOT, 'config', 'conditions.json'));
  if (!cards || !prices) throw new Error('Mancano data/cards.ndjson o data/prices.ndjson: esegui prima l\'ingest.');

  const history = await loadHistory();
  const bands = bandsCfg.bands;
  const noise = bandsCfg.noise;

  const rows = [];
  for (const [id, c] of Object.entries(cards)) {
    const p = prices[id];
    if (!p || !(p.trend > 0)) continue;
    const bandId = bandOf(bands, p.trend);
    if (!bandId) continue;

    const hist = history.get(id) || [];
    const trends = {};
    for (const [key, days] of Object.entries(PERIODS)) {
      const t = computeTrend(p, hist, days, today);
      if (!t) { trends[key] = null; continue; }
      trends[key] = { pct: round4(t.pct), src: t.source, sig: isSignificant(t, p.trend, noise) };
    }

    rows.push({
      id,
      n: c.names?.en || '',
      ni: c.names?.it && c.names.it !== c.names.en ? c.names.it : '',
      l: c.localId,
      s: c.setId,
      sn: c.setName,
      so: c.setOfficial,
      st: c.setTotal,
      sr: c.setRelease,
      img: c.image,
      b: bandId,
      pr: { t: p.trend, lo: p.low, a7: p.avg7, a30: p.avg30, v: p.variant, u: p.updated, cm: p.cmProductId, vol: p.volatility ?? null, holo: p.holo || null },
      tr: trends,
      hist,
    });
  }

  const leaderboards = buildLeaderboards(rows, bands, noise);
  const coverage = buildCoverage(rows, history, prices);

  await fs.mkdir(OUT, { recursive: true });
  // i moduli condivisi con la PWA vengono copiati dal build, cosi' la copia che
  // gira nel browser e quella coperta dai test non possono divergere
  for (const m of ['search.mjs', 'insight.mjs']) {
    await fs.copyFile(path.join(ROOT, 'scripts', 'lib', m), path.join(ROOT, 'web', m));
  }

  const series = packSeries(rows);
  const seriesDir = path.join(OUT, 'series');
  await fs.rm(seriesDir, { recursive: true, force: true });
  await fs.mkdir(seriesDir, { recursive: true });
  let seriesBytes = 0;
  for (const [name, payload] of Object.entries(series.files)) {
    const file = path.join(seriesDir, `${name}.json`);
    await writeJson(file, payload);
    seriesBytes += (await fs.stat(file)).size;
  }

  await writeJson(path.join(OUT, 'cards.json'), pack(rows));
  await writeJson(path.join(OUT, 'leaderboards.json'), { generated: today, bands, leaderboards });
  await writeJson(path.join(OUT, 'config.json'), {
    generated: today, bands: bandsCfg, grading: gradingCfg, conditions: condCfg,
    coverage, seriesIndex: series.index,
  });

  const size = (await fs.stat(path.join(OUT, 'cards.json'))).size;
  const files = Object.keys(series.files).length;
  console.log(`carte pubblicate: ${rows.length} — cards.json ${(size / 1048576).toFixed(2)} MB (${Math.round(size / rows.length)} byte/carta)`);
  console.log(`serie storiche: ${files} file per set, ${(seriesBytes / 1048576).toFixed(2)} MB in totale, in media ${files ? Math.round(seriesBytes / files / 1024) : 0} kB per apertura di scheda`);
  console.log(`storico: ${coverage.historyDays} giorni reali, 3 mesi dal ${coverage.availableFrom.d90}, 12 mesi dal ${coverage.availableFrom.d365}`);
}

/**
 * Formato a colonne. Un oggetto per carta, con le sue chiavi ripetute
 * ventunomila volte, costa piu' in nomi di campo che in dati: su tutte le carte
 * censite il pacchetto arriverebbe a decine di megabyte, che su rete mobile
 * significa una dashboard che non si apre. Qui le chiavi stanno scritte una
 * volta sola in COLS, i set in una tabella a parte, e ogni carta e' un array.
 */
const COLS = ['id', 'n', 'ni', 'l', 's', 'b', 't', 'lo', 'a7', 'a30', 'vol', 'cm', 'v', 'holoT', 'img',
  'd7', 'd7s', 'd30', 'd30s', 'd90', 'd90s', 'd365', 'd365s'];

function pack(rows) {
  const sets = {};
  for (const r of rows) if (!sets[r.s]) sets[r.s] = [r.sn, r.so, r.st, r.sr];
  const IMG = 'https://assets.tcgdex.net/';
  const packed = rows.map((r) => {
    const t = (k) => (r.tr[k] ? r.tr[k].pct : null);
    const s = (k) => (r.tr[k] ? (r.tr[k].src === 'history' ? 1 : 0) : null);
    return [
      r.id, r.n, r.ni, r.l, r.s, r.b,
      r.pr.t, r.pr.lo, r.pr.a7, r.pr.a30, r.pr.vol, r.pr.cm,
      r.pr.v === 'holo' ? 1 : 0, r.pr.holo ? r.pr.holo.trend : null,
      r.img && r.img.startsWith(IMG) ? r.img.slice(IMG.length) : r.img,
      t('d7'), s('d7'), t('d30'), s('d30'), t('d90'), s('d90'), t('d365'), s('d365'),
    ];
  });
  return { generated: today, currency: 'EUR', imgBase: IMG, cols: COLS, sets, rows: packed };
}

/**
 * Le serie storiche non stanno nel pacchetto principale: sono il campo piu'
 * pesante e servono a una carta per volta. Vanno in file separati, uno per set,
 * cosi' aprire una scheda scarica qualche decina di kilobyte invece di tutto lo
 * storico di ventimila carte. Un file per carta sarebbe ancora piu' mirato, ma
 * significherebbe migliaia di richieste HTTP e altrettanti file da rigenerare.
 * La soglia coincide con quella dell'ingest: sotto i 2 euro le carte sono in
 * rotazione lenta e una serie con un punto ogni quattro giorni ingannerebbe.
 */
const SERIES_MIN_EUR = 2;
const SERIES_MAX_POINTS = 150;

function packSeries(rows) {
  const bySet = new Map();
  for (const r of rows) {
    if (!(r.pr.t >= SERIES_MIN_EUR)) continue;
    const d = downsample(r.hist, SERIES_MAX_POINTS);
    if (!d) continue;
    if (!bySet.has(r.s)) bySet.set(r.s, {});
    bySet.get(r.s)[r.id] = d;
  }
  const files = {};
  const index = {};
  for (const [setId, series] of bySet) {
    const name = fileNameFor(setId, index);
    index[setId] = name;
    files[name] = { generated: today, minEur: SERIES_MIN_EUR, set: setId, series };
  }
  return { files, index };
}

/** Nome file sicuro e senza collisioni fra set diversi. */
function fileNameFor(setId, index) {
  const base = String(setId).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'set';
  const taken = new Set(Object.values(index));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function buildLeaderboards(rows, bands, noise) {
  const out = {};
  for (const period of Object.keys(PERIODS)) {
    out[period] = {};
    for (const b of [...bands, { id: 'all' }]) {
      const pool = rows
        .filter((r) => (b.id === 'all' || r.b === b.id) && r.tr[period]?.sig)
        .map((r) => ({ id: r.id, pct: r.tr[period].pct, src: r.tr[period].src, t: r.pr.t, vol: r.pr.vol }));
      const { up, down } = rank(pool, { limit: 10 });
      out[period][b.id] = { up, down, pool: pool.length };
    }
  }
  return out;
}

/** Che cosa e' davvero disponibile oggi: la UI lo dichiara, non lo nasconde. */
function buildCoverage(rows, history, prices) {
  // Solo i punti rilevati davvero: i punti stimati dal backfill non allungano
  // lo storico, e dire il contrario sposterebbe in avanti la data in cui i
  // periodi a 3 e 12 mesi diventano calcolabili sul serio.
  const realDates = new Set();
  let days = 0;
  let est = 0;
  for (const h of history.values()) {
    let n = 0;
    for (const p of h) {
      if (p.est) { est++; continue; }
      n++;
      realDates.add(p.date);
    }
    if (n > days) days = n;
  }
  const firstDate = [...realDates].sort()[0] || today;
  const bySource = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.tr)) {
    if (!v) continue;
    bySource[k] = bySource[k] || { history: 0, avg: 0 };
    bySource[k][v.src === 'history' ? 'history' : 'avg']++;
  }
  const fresh = Object.values(prices).filter((p) => p.fetched === today).length;
  return {
    historyDays: days,
    historyStart: firstDate,
    estimatedPoints: est,
    refreshedToday: fresh,
    totalPriced: rows.length,
    bySource,
    availableFrom: { d90: addDays(firstDate, 90), d365: addDays(firstDate, 365) },
  };
}

/** Storico su disco: lettura dei file, interpretazione in lib/history.mjs. */
async function loadHistory() {
  const dir = path.join(DATA, 'history');
  let names = [];
  try { names = await fs.readdir(dir); } catch { return new Map(); }
  const wanted = names.filter((n) => historyFileMeta(n));
  const files = [];
  for (const name of wanted) files.push({ name, text: await fs.readFile(path.join(dir, name), 'utf8') });
  return parseHistory(files);
}

/**
 * Serie storica ridotta, per non gonfiare il pacchetto.
 * Punto: [data, prezzo] oppure [data, prezzo, 1] se e' una stima del backfill.
 * La data resta completa di anno: troncarla al mese-giorno funziona finche' lo
 * storico e' corto, poi fa collassare due anni diversi sullo stesso punto.
 *
 * Il campionamento non e' uniforme. A un anno di distanza un punto ogni tre
 * giorni e' indistinguibile da uno al giorno, ma sulla finestra a 7 giorni un
 * campionamento uniforme lascerebbe due punti in croce e il grafico breve
 * diventerebbe inutile. Quindi: gli ultimi RECENT_DAYS giorni restano tutti (o
 * quasi), il resto viene diradato con quello che avanza del budget.
 * L'ultimo punto non si perde mai: e' il prezzo di oggi.
 */
const RECENT_DAYS = 60;

function downsample(hist, maxPoints = 150) {
  if (!hist || hist.length < 2) return null;
  const point = (p) => (p.est ? [p.date, p.trend, 1] : [p.date, p.trend]);
  if (hist.length <= maxPoints) return hist.map(point);

  const cut = addDays(today, -RECENT_DAYS);
  const older = hist.filter((p) => p.date < cut);
  const recent = hist.filter((p) => p.date >= cut);

  const recentBudget = Math.min(recent.length, Math.round(maxPoints * 0.6));
  const keptRecent = stride(recent, recentBudget);
  const keptOlder = stride(older, maxPoints - keptRecent.length);
  const out = [...keptOlder, ...keptRecent];

  const last = hist[hist.length - 1];
  if (!out.length || out[out.length - 1].date !== last.date) out.push(last);
  return out.map(point);
}

/** Al massimo n elementi equidistanti, ultimo incluso. */
function stride(arr, n) {
  if (!arr.length || n <= 0) return [];
  if (arr.length <= n) return arr.slice();
  const step = arr.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.min(arr.length - 1, Math.floor(i * step))]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out[out.length - 1] = arr[arr.length - 1];
  return out;
}

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function round4(n) { return Math.round(n * 10000) / 10000; }
async function readJson(p) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; } }
async function writeJson(p, v) { await fs.writeFile(p, JSON.stringify(v), 'utf8'); }

main().catch((e) => { console.error(e.message); process.exit(1); });
