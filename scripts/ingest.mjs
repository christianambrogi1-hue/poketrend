#!/usr/bin/env node
// Ingest giornaliero. Due velocita':
//  - carte "calde" (trend >= HOT_MIN_EUR): aggiornate ogni giorno, sono quelle
//    su cui le classifiche hanno senso;
//  - coda lunga: ruotata su ROTATION_DAYS giorni.
// I trend a 7 e 30 giorni restano validi anche per la coda lunga, perche'
// avg7 e avg30 arrivano gia' calcolati da Cardmarket dentro ogni risposta.
//
// Uso:
//   node scripts/ingest.mjs --bootstrap   primo giro completo (lungo)
//   node scripts/ingest.mjs               giro giornaliero
//   node scripts/ingest.mjs --limit 300   giro ridotto, per provare
//   node scripts/ingest.mjs --force       rifa' il giro anche se oggi e' gia' stato fatto

import fs from 'node:fs/promises';
import path from 'node:path';
import { Client, normalizeCardmarket } from './lib/tcgdex.mjs';
import { readNdjson, writeNdjson } from './lib/store.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const LANGS = ['en', 'it'];
const HOT_MIN_EUR = 5;
const ROTATION_DAYS = 7;
const METADATA_MAX_AGE_DAYS = 7;

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const today = new Date().toISOString().slice(0, 10);
const log = (...m) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...m);

const client = new Client({ rps: Number(opt('rps', 4)), log });

async function main() {
  await fs.mkdir(DATA, { recursive: true });

  // Un giro al giorno, e basta. Serve perche' il workflow ha due orari di
  // partenza: GitHub dichiara che i lavori schedulati possono essere ritardati
  // o saltati, e il 27/08/2026 quello delle 05:10 non e' partito affatto. Due
  // sveglie danno due possibilita', questo controllo evita che nei giorni in
  // cui partono entrambe TCGdex venga interrogato due volte per niente.
  // --force lo scavalca, per rimediare a un giro andato storto.
  const fileOggi = path.join(DATA, 'history', `${today}.ndjson`);
  if (!flag('bootstrap') && !flag('force') && await esiste(fileOggi)) {
    log(`i prezzi di oggi (${today}) sono gia' stati scaricati: non rifaccio il giro.`);
    log('usa --force per rifarlo comunque.');
    return;
  }
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

  const prices = (await readNdjson(path.join(DATA, 'prices.ndjson'))) || {};
  const ids = Object.keys(cards);
  const targets = selectTargets(ids, prices, state);
  const limit = Number(opt('limit', 0));
  const list = limit > 0 ? targets.slice(0, limit) : targets;

  log(`aggiorno i prezzi di ${list.length} carte su ${ids.length} (rotazione ${state.rotation}/${ROTATION_DAYS})`);

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

  state.rotation = (state.rotation + 1) % ROTATION_DAYS;
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

/** Chi aggiorniamo oggi: tutte le calde, piu' la fetta di coda lunga di turno. */
function selectTargets(ids, prices, state) {
  if (flag('bootstrap')) return ids;
  const hot = [];
  const cold = [];
  for (const id of ids) {
    const p = prices[id];
    const value = p?.trend ?? p?.avg30 ?? null;
    if (value != null && value >= HOT_MIN_EUR) hot.push(id);
    else cold.push(id);
  }
  const slice = cold.filter((_, i) => i % ROTATION_DAYS === state.rotation);
  const never = ids.filter((id) => !prices[id]);
  return [...new Set([...hot, ...slice, ...never])];
}

/**
 * Storico: una riga per giorno, solo id e trend, in NDJSON.
 * E' quello che sblocca i periodi 3 e 12 mesi col passare del tempo.
 * Vengono salvate solo le carte effettivamente rilette oggi, per non
 * duplicare all'infinito prezzi non aggiornati.
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
    if (p?.trend > 0 && p.fetched === today) rows.push(`${id}\t${p.trend}`);
  }
  if (!rows.length) return;
  rows.sort();
  await fs.writeFile(file, rows.join('\n') + '\n', 'utf8');
  log(`storico: ${rows.length} punti aggiunti a ${path.basename(file)}`);
}

async function esiste(p) { try { await fs.access(p); return true; } catch { return false; } }
async function readJson(p) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; } }
async function writeJson(p, v) { await fs.writeFile(p, JSON.stringify(v), 'utf8'); }
function daysBetween(a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 86400000); }

main().catch((e) => { console.error(e); process.exit(1); });
