#!/usr/bin/env node
// Ingest giornaliero. Tre velocita':
//  - watchlist (config/watchlist.json): sempre, qualunque sia il prezzo;
//  - carte "calde" (trend >= hotMinEur): ogni giorno. La soglia e' allineata a
//    SERIES_MIN_EUR del build: sono esattamente le carte per cui pubblichiamo
//    una serie storica, quindi ognuna deve avere un punto al giorno, altrimenti
//    il grafico della scheda avrebbe buchi di giorni;
//  - coda lunga: ruotata su rotationDays giorni.
// I trend a 7 e 30 giorni restano validi anche per la coda lunga, perche'
// avg7 e avg30 arrivano gia' calcolati da Cardmarket dentro ogni risposta.
//
// Perche' non tutto ogni giorno: sarebbero circa 23.500 richieste quotidiane a
// un'API gratuita che chiede esplicitamente di mettere in cache invece di
// rifare le stesse chiamate. Con questa ripartizione siamo intorno alle 10.000,
// e le carte che possono avere un grafico sono comunque tutte quotidiane.
//
// Uso:
//   node scripts/ingest.mjs --bootstrap   primo giro completo (lungo)
//   node scripts/ingest.mjs               giro giornaliero
//   node scripts/ingest.mjs --limit 300   giro ridotto, per provare

import fs from 'node:fs/promises';
import path from 'node:path';
import { Client, normalizeCardmarket } from './lib/tcgdex.mjs';
import { readNdjson, writeNdjson } from './lib/store.mjs';
import { selectTargets, DEFAULT_POLICY } from './lib/select.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const LANGS = ['en', 'it'];
const METADATA_MAX_AGE_DAYS = 7;

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const today = new Date().toISOString().slice(0, 10);
const log = (...m) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...m);

const client = new Client({ rps: Number(opt('rps', 4)), log });

async function main() {
  await fs.mkdir(DATA, { recursive: true });
  const state = await readJson(path.join(DATA, 'state.json')) || { rotation: 0, lastMetadata: null, runs: [] };

  const needMeta = flag('bootstrap') || !state.lastMetadata ||
    daysBetween(today, state.lastMetadata) >= METADATA_MAX_AGE_DAYS;

  let cards = await readNdjson(path.join(DATA, 'cards.ndjson'));
  if (needMeta || !cards) {
    log('aggiorno i metadati dei set...');
    cards = await fetchMetadata();
    await writeNdjson(path.join(DATA, 'cards.ndjson'), cards);
    state.lastMetadata = today;
    log(`metadati: ${Object.keys(cards).length} carte in ${new Set(Object.values(cards).map((c) => c.setId)).size} set`);
  }

  const watch = { ...DEFAULT_POLICY, ...(await readJson(path.join(ROOT, 'config', 'watchlist.json')) || {}) };
  const known = new Set(Object.keys(cards));
  const missing = (watch.ids || []).filter((id) => !known.has(id));
  if (missing.length) log(`watchlist: ${missing.length} id non esistono nel catalogo e vengono ignorati (${missing.slice(0, 5).join(', ')})`);

  const prices = (await readNdjson(path.join(DATA, 'prices.ndjson'))) || {};
  const ids = Object.keys(cards);
  const targets = selectTargets(ids, prices, state, watch, flag('bootstrap'));
  const limit = Number(opt('limit', 0));
  const list = limit > 0 ? targets.slice(0, limit) : targets;

  log(`aggiorno i prezzi di ${list.length} carte su ${ids.length} (rotazione ${state.rotation}/${watch.rotationDays}, soglia quotidiana ${watch.hotMinEur} EUR, watchlist ${(watch.ids || []).length})`);

  let ok = 0, empty = 0;
  for (let i = 0; i < list.length; i++) {
    const id = list[i];
    const card = await client.card(id, 'en');
    const cm = card && normalizeCardmarket(card.pricing);
    if (cm) {
      prices[id] = { ...cm, fetched: today };
      ok++;
    } else {
      empty++;
      if (prices[id]) prices[id].stale = true;
    }
    if ((i + 1) % 250 === 0) log(`  ${i + 1}/${list.length} — con prezzo ${ok}, senza ${empty}`);
  }

  await writeNdjson(path.join(DATA, 'prices.ndjson'), prices);
  await appendHistory(prices, list);

  state.rotation = (state.rotation + 1) % watch.rotationDays;
  state.runs = [...(state.runs || []), { date: today, fetched: list.length, ok, empty, ...client.stats }].slice(-30);
  await writeJson(path.join(DATA, 'state.json'), state);

  log(`fatto: ${ok} con prezzo, ${empty} senza, ${client.stats.failures} richieste fallite`);
  if (client.stats.failures > list.length * 0.2) {
    console.error('Piu\' del 20% delle richieste e\' fallito: dato inaffidabile, esco con errore.');
    process.exit(1);
  }
}

/** Metadati: lista set + carte, con i nomi in ogni lingua configurata. */
async function fetchMetadata() {
  const cards = {};
  const setsEn = (await client.sets('en')) || [];
  for (const s of setsEn) {
    const full = await client.set(s.id, 'en');
    if (!full?.cards) continue;
    for (const c of full.cards) {
      cards[c.id] = {
        id: c.id,
        localId: String(c.localId ?? ''),
        names: { en: c.name || '' },
        setId: full.id,
        setName: full.name || '',
        setSerie: full.serie?.name || '',
        setRelease: full.releaseDate || '',
        setOfficial: full.cardCount?.official ?? null,
        setTotal: full.cardCount?.total ?? null,
        image: c.image || null,
      };
    }
  }
  for (const lang of LANGS.filter((l) => l !== 'en')) {
    const sets = (await client.sets(lang)) || [];
    for (const s of sets) {
      const full = await client.set(s.id, lang);
      if (!full?.cards) continue;
      for (const c of full.cards) {
        if (cards[c.id]) cards[c.id].names[lang] = c.name || '';
      }
    }
  }
  return cards;
}

/**
 * Storico: una riga per giorno in NDJSON, tre colonne: id, trend, offerta piu'
 * bassa. E' quello che sblocca i periodi 3 e 12 mesi col passare del tempo.
 * Vengono salvate solo le carte effettivamente rilette oggi, per non
 * duplicare all'infinito prezzi non aggiornati.
 *
 * Perche' anche 'low': costa pochi byte e non e' ricostruibile a posteriori.
 * Il grafico pubblicato usa il trend, che e' una stima smussata del mercato
 * corrente; il minimo e' la misura piu' rumorosa che esista (dipende da una
 * singola inserzione) ed e' proprio quella che i post di mercato usano per
 * gonfiare le percentuali. Tenerlo da parte permette di controllare, un domani,
 * quanto le due serie divergono. Chi legge la riga vecchia a due colonne
 * continua a funzionare: la terza colonna e' facoltativa.
 */
async function appendHistory(prices, updatedIds) {
  // Un file per giorno, non uno per mese: git salva ogni volta il file intero,
  // quindi riscrivere un file che cresce tutto il mese moltiplicherebbe lo
  // spazio occupato dal repository per il numero di giorni del mese.
  const file = path.join(DATA, 'history', `${today}.ndjson`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const rows = [];
  for (const id of updatedIds) {
    const p = prices[id];
    if (p?.trend > 0 && p.fetched === today) {
      rows.push(p.low > 0 ? `${id}\t${p.trend}\t${p.low}` : `${id}\t${p.trend}`);
    }
  }
  if (!rows.length) return;
  rows.sort();
  await fs.writeFile(file, rows.join('\n') + '\n', 'utf8');
  log(`storico: ${rows.length} punti aggiunti a ${path.basename(file)}`);
}

async function readJson(p) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; } }
async function writeJson(p, v) { await fs.writeFile(p, JSON.stringify(v), 'utf8'); }
function daysBetween(a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 86400000); }

main().catch((e) => { console.error(e); process.exit(1); });
