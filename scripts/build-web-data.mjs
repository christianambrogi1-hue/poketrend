#!/usr/bin/env node
// Trasforma data/ nel pacchetto che la PWA scarica.
// Formato a colonne per tenerlo leggero su rete mobile.

import fs from 'node:fs/promises';
import path from 'node:path';
import { computeTrend, bandOf, isSignificant, rank } from './lib/trend.mjs';
import { readNdjson } from './lib/store.mjs';

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
      trends[key] = { pct: round4(t.pct), src: t.source, sig: isSignificant(t, p, noise) };
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
  // la PWA importa lo stesso modulo di ricerca che gira nei test: copiato qui
  // dal build, cosi' le due copie non possono divergere
  await fs.copyFile(path.join(ROOT, 'scripts', 'lib', 'search.mjs'), path.join(ROOT, 'web', 'search.mjs'));
  await writeJson(path.join(OUT, 'cards.json'), pack(rows));
  await writeJson(path.join(OUT, 'series.json'), packSeries(rows));
  await writeJson(path.join(OUT, 'leaderboards.json'), { generated: today, bands, leaderboards });
  await writeJson(path.join(OUT, 'config.json'), { generated: today, bands: bandsCfg, grading: gradingCfg, conditions: condCfg, coverage });

  const size = (await fs.stat(path.join(OUT, 'cards.json'))).size;
  const ssize = (await fs.stat(path.join(OUT, 'series.json'))).size;
  console.log(`carte pubblicate: ${rows.length} — cards.json ${(size / 1048576).toFixed(2)} MB (${Math.round(size / rows.length)} byte/carta), series.json ${(ssize / 1048576).toFixed(2)} MB`);
  console.log(`storico: ${coverage.historyDays} giorni, 3 mesi dal ${coverage.availableFrom.d90}, 12 mesi dal ${coverage.availableFrom.d365}`);
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
 * Le serie storiche vanno in un file a parte, caricato solo quando si apre una
 * scheda carta: sono il campo piu' pesante e servono a una carta per volta.
 */
const SERIES_MIN_EUR = 2;
function packSeries(rows) {
  const out = {};
  for (const r of rows) {
    if (!(r.pr.t >= SERIES_MIN_EUR)) continue;
    const d = downsample(r.hist, 30);
    if (d) out[r.id] = d;
  }
  return { generated: today, minEur: SERIES_MIN_EUR, series: out };
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
  let days = 0;
  for (const h of history.values()) if (h.length > days) days = h.length;
  const firstDate = [...history.values()].flat().map((p) => p.date).sort()[0] || today;
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
    refreshedToday: fresh,
    totalPriced: rows.length,
    bySource,
    availableFrom: { d90: addDays(firstDate, 90), d365: addDays(firstDate, 365) },
  };
}

async function loadHistory() {
  const dir = path.join(DATA, 'history');
  const map = new Map();
  let files = [];
  try { files = (await fs.readdir(dir)).filter((f) => f.endsWith('.ndjson')).sort(); } catch { return map; }
  for (const f of files) {
    const date = f.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const text = await fs.readFile(path.join(dir, f), 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const id = line.slice(0, tab);
      const trend = Number(line.slice(tab + 1));
      if (!(trend > 0)) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push({ date, trend });
    }
  }
  for (const arr of map.values()) arr.sort((a, b) => (a.date < b.date ? -1 : 1));
  return map;
}

/** Serie storica ridotta, per non gonfiare il pacchetto. */
function downsample(hist, maxPoints = 30) {
  if (!hist || hist.length < 2) return null;
  const step = Math.ceil(hist.length / maxPoints);
  const out = [];
  for (let i = 0; i < hist.length; i += step) out.push([hist[i].date.slice(5), hist[i].trend]);
  const last = hist[hist.length - 1];
  if (out[out.length - 1][0] !== last.date.slice(5)) out.push([last.date.slice(5), last.trend]);
  return out;
}

function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function round4(n) { return Math.round(n * 10000) / 10000; }
async function readJson(p) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; } }
async function writeJson(p, v) { await fs.writeFile(p, JSON.stringify(v), 'utf8'); }

main().catch((e) => { console.error(e.message); process.exit(1); });
