#!/usr/bin/env node
// Verifica end-to-end su storico simulato: simula 100 giorni di storico e
// controlla che i periodi lunghi si accendano davvero, che la fonte passi da
// stima a storico, e che i conti tornino rifacendoli a mano sui file grezzi.
// Uso: npm run verify   (sovrascrive data/history con dati simulati)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { readNdjson } from './lib/store.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const H = path.join(ROOT, 'data', 'history');
fs.rmSync(H, { recursive: true, force: true }); fs.mkdirSync(H, { recursive: true });

const prices = await readNdjson(path.join(ROOT, 'data', 'prices.ndjson'));
const ids = Object.keys(prices);
const today = new Date('2026-08-26T00:00:00Z');
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// serie con deriva lenta: dopo 100 giorni il prezzo e' cambiato in modo misurabile
const drift = Object.fromEntries(ids.map((id) => [id, (rnd() - 0.45) * 0.004]));
for (let d = 100; d >= 0; d--) {
  const date = new Date(today); date.setUTCDate(date.getUTCDate() - d);
  const iso = date.toISOString().slice(0, 10);
  const rows = ids.map((id) => {
    const base = prices[id].trend;
    const v = base * Math.exp(drift[id] * (100 - d)) * (1 + (rnd() - 0.5) * 0.01);
    return `${id}\t${Math.round(v * 100) / 100}`;
  });
  fs.writeFileSync(path.join(H, `${iso}.ndjson`), rows.sort().join('\n') + '\n');
}
execSync('node scripts/build-web-data.mjs', { cwd: ROOT, stdio: 'inherit', env: { ...process.env, POKETREND_TODAY: '2026-08-26' } });

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/cards.json')));
const ix = Object.fromEntries(pkg.cols.map((c, k) => [c, k]));
const cards = { rows: pkg.rows.map((r) => ({
  id: r[ix.id], pr: { t: r[ix.t] },
  tr: Object.fromEntries(['d7','d30','d90','d365'].map((k) => [k, r[ix[k]] == null ? null : { pct: r[ix[k]], src: r[ix[k+'s']] === 1 ? 'history' : 'cardmarket-avg' }])),
})) };
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/config.json')));
// le serie stanno in un file per set: qui vengono ricomposte per controllarle tutte
const series = Object.assign({}, ...[...new Set(Object.values(cfg.seriesIndex || {}))]
  .map((name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/series', `${name}.json`))).series));
const lb = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/leaderboards.json')));

const checks = [];
const ok = (n, c, d = '') => checks.push({ n, c, d });
ok('d7 passa a storico', cards.rows.every((r) => !r.tr.d7 || r.tr.d7.src === 'history'));
ok('d90 ora esiste', cards.rows.filter((r) => r.tr.d90).length > 0, cards.rows.filter((r) => r.tr.d90).length + ' carte');
ok('d90 e da storico', cards.rows.filter((r) => r.tr.d90).every((r) => r.tr.d90.src === 'history'));
ok('d365 resta vuoto', cards.rows.every((r) => !r.tr.d365), 'con 100 giorni non si puo calcolare un anno');
ok('classifica d90 popolata', Object.values(lb.leaderboards.d90).some((b) => b.pool > 0));
ok('classifica d365 vuota', Object.values(lb.leaderboards.d365).every((b) => b.pool === 0));
ok('serie storiche presenti', Object.keys(series).length > 0, Object.keys(series).length + ' carte');
ok('serie non oltre 150 punti', Object.values(series).every((h) => h.length <= 151));
ok('la finestra breve resta densa', Object.values(series).every((h) => {
  const ultimi = h.filter((p) => p[0] >= '2026-08-19');
  return h.length < 20 || ultimi.length >= 5;
}), 'ultimi 7 giorni con almeno 5 punti');
ok('serie con data completa di anno', Object.values(series).every((h) => h.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p[0]))));
ok('serie solo per le carte sopra soglia', Object.keys(series).every((id) => {
  const c = cards.rows.find((r) => r.id === id); return c && c.pr.t >= 2; }));
ok('coverage coerente', cfg.coverage.historyDays === 101, 'giorni=' + cfg.coverage.historyDays);
ok('nessun pct assurdo', cards.rows.every((r) => Object.values(r.tr).every((t) => !t || (t.pct > -1 && t.pct < 50))));

// verifica indipendente della matematica: rileggo i file di storico grezzi e
// rifaccio il conto a mano, senza passare dal codice sotto test.
const leggi = (iso, id) => {
  const l = fs.readFileSync(path.join(H, iso + '.ndjson'), 'utf8').split('\n').find((x) => x.startsWith(id + '\t'));
  return l ? Number(l.split('\t')[1]) : null;
};
const c30 = cards.rows.find((r) => r.tr.d30 && r.tr.d30.src === 'history');
const atteso30 = leggi('2026-08-26', c30.id) / leggi('2026-07-27', c30.id) - 1;
ok('matematica d30 rifatta a mano', Math.abs(c30.tr.d30.pct - atteso30) < 0.0002,
  `${c30.id}: ${c30.tr.d30.pct.toFixed(4)} vs ${atteso30.toFixed(4)}`);
const c90 = cards.rows.find((r) => r.tr.d90 && r.tr.d90.src === 'history');
const atteso90 = leggi('2026-08-26', c90.id) / leggi('2026-05-28', c90.id) - 1;
ok('matematica d90 rifatta a mano', Math.abs(c90.tr.d90.pct - atteso90) < 0.0002,
  `${c90.id}: ${c90.tr.d90.pct.toFixed(4)} vs ${atteso90.toFixed(4)}`);

const size = fs.statSync(path.join(ROOT, 'web/data/cards.json')).size;
const perCard = size / cards.rows.length;
console.log(`\ncards.json ${(size / 1048576).toFixed(2)} MB per ${cards.rows.length} carte = ${perCard.toFixed(0)} byte/carta`);
console.log(`proiezione a 21.000 carte: ${(perCard * 21000 / 1048576).toFixed(1)} MB non compressi, ~${(perCard * 21000 / 1048576 / 5).toFixed(1)} MB gzip`);

console.log('');
for (const c of checks) console.log(`${c.c ? '  ok' : 'FAIL'}  ${c.n}${c.d ? '  (' + c.d + ')' : ''}`);
process.exit(checks.every((c) => c.c) ? 0 : 1);
