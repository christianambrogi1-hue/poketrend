#!/usr/bin/env node
// Dataset dimostrativo, per vedere la dashboard prima che il primo ingest finisca.
// I nomi delle carte sono reali, i prezzi NO: sono generati con la stessa
// distribuzione osservata sul campione vero (429 carte di sv03.5, base1, me05
// lette il 26/08/2026: mediana trend/avg30 -4,2%, quinto percentile -25%,
// novantacinquesimo +52%). Servono a provare l'interfaccia, non a decidere acquisti.
// Il file generato si riconosce: data/DEMO esiste finche' non giri l'ingest vero.

import fs from 'node:fs/promises';
import path from 'node:path';
import { writeNdjson } from './lib/store.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const today = new Date().toISOString().slice(0, 10);

// generatore deterministico: due esecuzioni danno lo stesso risultato
let seed = 20260826;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const SETS = [
  { id: 'base1', name: 'Base Set', release: '1999-01-09', official: 102, total: 102, floor: 1.5, ceil: 900 },
  { id: 'neo1', name: 'Neo Genesis', release: '2000-12-16', official: 111, total: 111, floor: 0.8, ceil: 320 },
  { id: 'xy12', name: 'Evolutions', release: '2016-11-02', official: 108, total: 113, floor: 0.2, ceil: 90 },
  { id: 'sv03.5', name: '151', release: '2023-09-22', official: 165, total: 207, floor: 0.05, ceil: 240 },
  { id: 'sv08', name: 'Surging Sparks', release: '2024-11-08', official: 191, total: 252, floor: 0.03, ceil: 400 },
  { id: 'me05', name: 'Pitch Black', release: '2026-08-01', official: 120, total: 120, floor: 0.02, ceil: 180 },
];
const NOMI = ['Bulbasaur','Charmander','Squirtle','Pikachu','Charizard','Blastoise','Venusaur','Gengar','Mewtwo','Mew','Eevee','Snorlax','Dragonite','Lugia','Ho-Oh','Rayquaza','Lucario','Greninja','Sylveon','Umbreon','Espeon','Gardevoir','Tyranitar','Metagross','Garchomp','Zoroark','Mimikyu','Toxtricity','Miraidon','Koraidon'];
const SUFFIX = ['', '', '', ' ex', ' VMAX', ' V', ' GX'];

const cards = {};
const prices = {};

for (const s of SETS) {
  for (let i = 1; i <= s.total; i++) {
    const id = `${s.id}-${String(i).padStart(3, '0')}`;
    const nome = pick(NOMI) + pick(SUFFIX);
    cards[id] = {
      id, localId: String(i),
      names: { en: nome, it: nome },
      setId: s.id, setName: s.name, setSerie: '', setRelease: s.release,
      setOfficial: s.official, setTotal: s.total, image: null,
    };
    // prezzo: distribuzione log-uniforme fra il pavimento e il tetto del set,
    // con una coda corta di carte molto sopra la media, come nella realta'
    const t = Math.exp(Math.log(s.floor) + rnd() * (Math.log(s.ceil) - Math.log(s.floor)));
    const trend = round2(rnd() > 0.97 ? t * (2 + rnd() * 4) : t);
    // scostamenti coerenti col campione reale
    const drift30 = gauss(-0.042, 0.23);
    const drift7 = gauss(-0.014, 0.16);
    const avg30 = round2(trend / (1 + drift30));
    const avg7 = round2(trend / (1 + drift7));
    const avg = round2((avg7 + avg30) / 2 * (0.96 + rnd() * 0.08));
    prices[id] = {
      trend, avg, low: round2(trend * (0.15 + rnd() * 0.45)),
      avg1: round2(avg7 * (0.7 + rnd() * 0.9)), avg7, avg30,
      variant: 'base',
      volatility: round3(dispersion([trend, avg, avg7, avg30])),
      unit: 'EUR', updated: today, cmProductId: 700000 + Math.floor(rnd() * 200000),
      holo: rnd() > 0.6 ? { trend: round2(trend * (1.2 + rnd() * 2)), avg7: null, avg30: null, low: null } : null,
      fetched: today,
    };
  }
}

await fs.mkdir(path.join(DATA, 'history'), { recursive: true });
await writeNdjson(path.join(DATA, 'cards.ndjson'), cards);
await writeNdjson(path.join(DATA, 'prices.ndjson'), prices);
await fs.writeFile(path.join(DATA, 'DEMO'), `Dataset dimostrativo generato il ${today}. Prezzi NON reali.\nCancella data/ ed esegui "npm run bootstrap" per i dati veri.\n`);
await fs.writeFile(path.join(DATA, 'state.json'), JSON.stringify({ rotation: 0, lastMetadata: today, runs: [], demo: true }));

console.log(`demo: ${Object.keys(cards).length} carte in ${SETS.length} set. Prezzi non reali.`);

function gauss(mu, sigma) {
  const u = Math.max(rnd(), 1e-9), v = rnd();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function dispersion(v) {
  const x = v.filter((n) => n > 0);
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length) / m;
}
function round2(n) { return Math.max(0.01, Math.round(n * 100) / 100); }
function round3(n) { return Math.round(n * 1000) / 1000; }
