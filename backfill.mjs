#!/usr/bin/env node
// Backfill: due punti storici approssimati, per non aprire una scheda carta e
// trovare un grafico con un solo punto finche' la raccolta non prende corpo.
//
// COSA FA. Cardmarket pubblica, dentro ogni risposta, la media delle vendite
// degli ultimi 7 e degli ultimi 30 giorni. Non sono prezzi di una data: sono
// medie di una finestra. Il valore rappresentativo di una media uniforme sta al
// centro della sua finestra, non al suo bordo: avg7 descrive il mercato di circa
// 4 giorni fa, avg30 quello di circa 15 giorni fa. Metterli a -7 e -30, come
// verrebbe naturale, sposterebbe indietro di giorni ogni movimento.
//
// COSA NON FA. Non ricostruisce lo storico. Un anno di prezzi passati non
// esiste da nessuna parte: Cardmarket non pubblica archivi e nessuna fonte
// gratuita li vende. Questi sono due punti, coprono un paio di settimane, e
// sono stime: finiscono in file separati con prefisso 'est-', il grafico li
// disegna tratteggiati e il calcolo delle variazioni pubblicate li ignora.
// Nessuna percentuale mostrata in dashboard nasce da questi numeri.
//
// PERCHE' NON BASTANO PER LE PERCENTUALI. Il trend e' una stima del mercato
// corrente, avg7 e avg30 sono medie del venduto reale: sono due stimatori di
// cose diverse, e la loro differenza contiene sia il movimento del prezzo sia
// lo scarto fra i due metodi. Va bene per dare forma a un grafico, non per
// scriverci sopra un "+33%".
//
// Uso: node scripts/backfill.mjs [--force]
// Idempotente: rigenera gli stessi file, non ne accumula di nuovi.

import fs from 'node:fs/promises';
import path from 'node:path';
import { readNdjson } from './lib/store.mjs';
import { addDays } from './lib/trend.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');

// Centro della finestra di ciascuna media, arrotondato al giorno.
export const OFFSETS = [
  { field: 'avg7', days: -4 },
  { field: 'avg30', days: -15 },
];

async function main() {
  const prices = await readNdjson(path.join(DATA, 'prices.ndjson'));
  if (!prices) {
    console.error('Manca data/prices.ndjson: esegui prima l\'ingest.');
    process.exit(1);
  }

  // La data di riferimento e' l'ultimo giorno in cui abbiamo davvero letto
  // qualcosa, non la data di oggi: se il backfill gira a distanza di giorni
  // dall'ultimo ingest, ancorarlo a oggi sposterebbe in avanti tutte le stime.
  const ref = referenceDate(prices);
  const dir = path.join(DATA, 'history');
  await fs.mkdir(dir, { recursive: true });
  const real = new Set((await fs.readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(f)).map((f) => f.slice(0, 10)));

  for (const { field, days } of OFFSETS) {
    const date = addDays(ref, days);
    if (real.has(date)) {
      console.log(`${date}: esiste gia' una rilevazione vera, la stima non serve`);
      continue;
    }
    const rows = [];
    for (const [id, p] of Object.entries(prices)) {
      const v = p?.[field];
      if (typeof v === 'number' && v > 0 && p.trend > 0) rows.push(`${id}\t${round(v)}`);
    }
    rows.sort();
    const file = path.join(dir, `est-${date}.ndjson`);
    await fs.writeFile(file, rows.join('\n') + '\n', 'utf8');
    console.log(`est-${date}.ndjson: ${rows.length} punti stimati da ${field}`);
  }

  console.log(`riferimento: ${ref}. I punti stimati non entrano nelle percentuali pubblicate.`);
}

export function referenceDate(prices) {
  let max = null;
  for (const p of Object.values(prices)) {
    const d = p?.fetched;
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && (max === null || d > max)) max = d;
  }
  return max || new Date().toISOString().slice(0, 10);
}

function round(n) { return Math.round(n * 100) / 100; }

if (import.meta.filename === process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
