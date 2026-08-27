import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCardmarket } from '../scripts/lib/tcgdex.mjs';
import { trendFromHistory, trendFromCardmarketAverages, computeTrend, bandOf, isSignificant, winsorize, rank, addDays } from '../scripts/lib/trend.mjs';
import { parseQuery, sameLocalId, searchCards, normalize } from '../scripts/lib/search.mjs';
import { estimateByCondition, estimateGraded, eraOf, psa10Multiplier, cardmarketLink } from '../scripts/lib/estimate.mjs';
import { readNdjson, writeNdjson } from '../scripts/lib/store.mjs';
import { CARDMARKET_SAMPLES, CARDS } from './fixtures.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bandsCfg = JSON.parse(fs.readFileSync(new URL('../config/bands.json', import.meta.url)));
const gradingCfg = JSON.parse(fs.readFileSync(new URL('../config/grading.json', import.meta.url)));
const condCfg = JSON.parse(fs.readFileSync(new URL('../config/conditions.json', import.meta.url)));
const BANDS = bandsCfg.bands;
const NOISE = bandsCfg.noise;

test('normalizzazione Cardmarket: usa la serie base, non il massimo fra base e holo', () => {
  const p = normalizeCardmarket(CARDMARKET_SAMPLES['sv03.5-001']);
  assert.equal(p.variant, 'base');
  assert.equal(p.trend, 0.1);
  assert.equal(p.holo.trend, 0.32, 'la reverse resta disponibile a parte');
  assert.equal(p.cmProductId, 733596);
  assert.equal(p.updated, '2026-08-25');
});

test('normalizzazione Cardmarket: campi -holo a zero o null non rompono nulla', () => {
  const p = normalizeCardmarket(CARDMARKET_SAMPLES['sv03.5-006']);
  assert.equal(p.trend, 8.57);
  assert.equal(p.holo, null);
});

test('normalizzazione Cardmarket: carta senza prezzo viene scartata', () => {
  assert.equal(normalizeCardmarket(CARDMARKET_SAMPLES['senza-prezzo']), null);
  assert.equal(normalizeCardmarket(null), null);
  assert.equal(normalizeCardmarket({}), null);
});

test('volatilita: il vintage a bassi volumi risulta piu instabile della moderna', () => {
  const vintage = normalizeCardmarket(CARDMARKET_SAMPLES['base1-4']).volatility;
  const moderna = normalizeCardmarket(CARDMARKET_SAMPLES['sv03.5-006']).volatility;
  assert.ok(vintage > moderna);
  assert.ok(moderna < 0.05, 'una ex moderna con quattro misure allineate deve risultare stabile');
});

test('il trend a 7 giorni non usa avg1: su base1-4 avg1 e tre volte avg7', () => {
  const p = normalizeCardmarket(CARDMARKET_SAMPLES['base1-4']);
  const t = trendFromCardmarketAverages(p, 7);
  assert.ok(Math.abs(t.pct - (586.03 / 594.65 - 1)) < 1e-9);
  assert.ok(Math.abs(t.pct) < 0.05);
  assert.equal(t.source, 'cardmarket-avg');
});

test('lo storico proprio ha la precedenza sulla stima da medie', () => {
  const today = '2026-08-26';
  const history = [{ date: '2026-08-19', trend: 500 }, { date: '2026-08-26', trend: 586.03 }];
  const p = normalizeCardmarket(CARDMARKET_SAMPLES['base1-4']);
  const t = computeTrend(p, history, 7, today);
  assert.equal(t.source, 'history');
  assert.ok(Math.abs(t.pct - (586.03 / 500 - 1)) < 1e-9);
});

test('storico troppo corto: niente 3 e 12 mesi inventati', () => {
  const today = '2026-08-26';
  const history = [{ date: '2026-08-20', trend: 500 }, { date: '2026-08-26', trend: 586 }];
  assert.equal(trendFromHistory(history, 90, today), null);
  assert.equal(trendFromHistory(history, 365, today), null);
  const p = normalizeCardmarket(CARDMARKET_SAMPLES['base1-4']);
  assert.equal(computeTrend(p, history, 90, today), null);
  assert.equal(computeTrend(p, history, 365, today), null);
});

test('storico: il punto piu vicino alla data obiettivo entro tolleranza', () => {
  const today = '2026-08-26';
  const history = [
    { date: '2026-07-25', trend: 400 },
    { date: '2026-07-28', trend: 420 },
    { date: '2026-08-26', trend: 500 },
  ];
  const t = trendFromHistory(history, 30, today);
  assert.equal(t.fromDate, '2026-07-28');
  assert.ok(Math.abs(t.pct - (500 / 420 - 1)) < 1e-9);
});

test('fasce di prezzo: estremi inclusi a sinistra ed esclusi a destra', () => {
  assert.equal(bandOf(BANDS, 0.99), 'b0');
  assert.equal(bandOf(BANDS, 1), 'b1');
  assert.equal(bandOf(BANDS, 4.99), 'b1');
  assert.equal(bandOf(BANDS, 5), 'b2');
  assert.equal(bandOf(BANDS, 499.99), 'b5');
  assert.equal(bandOf(BANDS, 500), 'b6');
  assert.equal(bandOf(BANDS, 12000), 'b6');
  assert.equal(bandOf(BANDS, 0), null);
});

test('filtro anti rumore: la carta da 3 centesimi che raddoppia non entra in classifica', () => {
  const t = { pct: 1.0, from: 0.03, to: 0.06 };
  assert.equal(isSignificant(t, 0.06, NOISE), false);
  const vero = { pct: 0.3, from: 100, to: 130 };
  assert.equal(isSignificant(vero, 130, NOISE), true);
});

test('filtro anti rumore: movimento assoluto piccolo su carta cara viene scartato', () => {
  const t = { pct: 0.0002, from: 1000, to: 1000.2 };
  assert.equal(isSignificant(t, 1000, NOISE), false, 'variazione dello 0,02% non e un segnale');
});

test('winsorize limita gli outlier senza cancellarli', () => {
  assert.equal(winsorize(12, 3), 3);
  assert.equal(winsorize(-3, 3), -0.95, 'un prezzo non puo perdere piu del 100%');
  assert.equal(winsorize(0.5, 3), 0.5);
});

test('classifica: dieci in salita e dieci in discesa, ordinate correttamente', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, pct: (i - 12) / 15 }));
  const { up, down } = rank(rows, { limit: 10 });
  assert.equal(up.length, 10);
  assert.equal(down.length, 10);
  assert.equal(up[0].id, 'c24');
  assert.equal(down[0].id, 'c0');
  assert.ok(up[0].pct > up[9].pct);
  assert.ok(down[0].pct < down[9].pct);
});

test('ricerca: il numero in formato 201/196 viene interpretato', () => {
  assert.deepEqual(parseQuery('201/196'), { name: '', localId: '201', printedTotal: 196 });
  assert.deepEqual(parseQuery('charizard 201/196'), { name: 'charizard', localId: '201', printedTotal: 196 });
  assert.deepEqual(parseQuery('  Charizard ex   201 / 196 '), { name: 'charizard ex', localId: '201', printedTotal: 196 });
  assert.deepEqual(parseQuery('#25'), { name: '', localId: '25', printedTotal: null });
  assert.deepEqual(parseQuery('pikachu'), { name: 'pikachu', localId: null, printedTotal: null });
  assert.deepEqual(parseQuery('4'), { name: '', localId: '4', printedTotal: null });
  assert.deepEqual(parseQuery(''), { name: '', localId: null, printedTotal: null });
});

test('ricerca: gli zeri iniziali del numero non contano', () => {
  assert.ok(sameLocalId('001', '1'));
  assert.ok(sameLocalId('006', '6'));
  assert.ok(!sameLocalId('16', '6'));
});

test('ricerca: accenti e maiuscole non contano', () => {
  assert.equal(normalize('Pokémon  Sélection!'), 'pokemon selection');
});

test('ricerca: 201/196 non deve restituire il Charizard 006 dello stesso set', () => {
  const r = searchCards(CARDS, '201/196', { lang: 'it' });
  assert.equal(r.length, 0, 'nessun set nel campione ha totale stampato 196');
  const r2 = searchCards(CARDS, '201/165', { lang: 'it' });
  assert.equal(r2.length, 1);
  assert.equal(r2[0].id, 'sv03.5-201');
});

test('ricerca: per nome ordina prima la corrispondenza esatta, poi il valore', () => {
  const r = searchCards(CARDS, 'charizard', { lang: 'it' });
  assert.equal(r[0].id, 'base1-4', 'esatto e piu caro');
  assert.ok(r.some((c) => c.id === 'sv03.5-006'));
});

test('ricerca: senza query si ottengono le carte piu preziose, filtrabili per fascia', () => {
  const r = searchCards(CARDS, '', { filters: { bandId: 'b0' } });
  assert.deepEqual(r.map((c) => c.id), ['sv03.5-001', 'me05-001']);
});

test('stima per condizione: NM e il prezzo reale, il resto scende ma mai sotto la low', () => {
  const p = normalizeCardmarket(CARDMARKET_SAMPLES['base1-4']);
  const est = estimateByCondition(p, condCfg);
  assert.equal(est.NM.eur, 586.03);
  assert.equal(est.NM.estimated, false);
  assert.ok(est.EX.eur < est.NM.eur && est.EX.eur > est.GD.eur);
  assert.ok(est.PO.eur >= p.low, 'la stima peggiore non puo stare sotto la piu bassa offerta reale');
  assert.equal(est.PO.estimated, true);
});

test('era della carta dalla data di uscita del set', () => {
  assert.equal(eraOf('1999-01-09', gradingCfg.eras), 'vintage');
  assert.equal(eraOf('2016-02-03', gradingCfg.eras), 'retro');
  assert.equal(eraOf('2023-09-22', gradingCfg.eras), 'modern');
  assert.equal(eraOf('', gradingCfg.eras), 'modern');
});

test('moltiplicatore PSA 10: cresce col valore e con l anzianita', () => {
  const T = gradingCfg.psa10MultiplierOnRaw;
  assert.equal(psa10Multiplier(5, 'modern', T), 1.7);
  assert.equal(psa10Multiplier(50, 'modern', T), 3.0);
  assert.equal(psa10Multiplier(5000, 'modern', T), 4.0);
  assert.ok(psa10Multiplier(500, 'vintage', T) > psa10Multiplier(500, 'modern', T));
});

test('stima gradate: PSA 9 vale il 40% del PSA 10 e le case europee stanno sotto', () => {
  const g = estimateGraded(586.03, '1999-01-09', gradingCfg);
  const psa = g.houses.find((h) => h.id === 'psa');
  const graad = g.houses.find((h) => h.id === 'graad');
  assert.equal(g.era, 'vintage');
  assert.ok(Math.abs(psa.grades['9'] / psa.grades['10'] - 0.4) < 1e-6);
  assert.ok(graad.grades['10'] < psa.grades['10']);
  assert.equal(graad.confidence, 'molto bassa');
  assert.equal(g.estimated, true);
  assert.equal(estimateGraded(0, '1999-01-09', gradingCfg), null);
});

test('link Cardmarket: idProduct quando c e, ricerca per nome quando manca', () => {
  const conId = cardmarketLink({ cmProductId: 273699, nameEn: 'Charizard', localId: '4' }, { lang: 'it', condition: 'NM' });
  assert.ok(conId.includes('idProduct=273699'));
  assert.ok(conId.includes('idLanguage=5'), 'italiano e la lingua 5 su Cardmarket');
  assert.ok(conId.includes('minCondition=2'), 'NM e la condizione 2');
  const senzaId = cardmarketLink({ cmProductId: null, nameEn: 'Charizard', localId: '4' }, { lang: 'ja' });
  assert.ok(senzaId.includes('Search?searchString='));
  assert.ok(senzaId.includes('idLanguage=6'));
});

test('date in UTC: addDays non slitta col fuso', () => {
  assert.equal(addDays('2026-08-26', -7), '2026-08-19');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01', '2026 non e bisestile');
});

test('store NDJSON: andata e ritorno, ordinato per id', async () => {
  const f = path.join(os.tmpdir(), `pt-${process.pid}.ndjson`);
  const obj = { 'sv1-9': { t: 2 }, 'base1-4': { t: 586.03, holo: null }, 'me05-1': { t: 0.03 } };
  await writeNdjson(f, obj);
  const text = fs.readFileSync(f, 'utf8');
  assert.deepEqual(text.trim().split('\n').map((l) => l.split('\t')[0]), ['base1-4', 'me05-1', 'sv1-9'],
    'l ordine stabile e cio che permette a git di comprimere a delta');
  assert.deepEqual(await readNdjson(f), obj);
  fs.unlinkSync(f);
});

test('store NDJSON: file mancante o vuoto non rompe l ingest', async () => {
  assert.equal(await readNdjson('/tmp/non-esiste-mai.ndjson'), null);
});

test('store NDJSON: una riga corrotta non fa perdere le altre', async () => {
  const f = path.join(os.tmpdir(), `pt-bad-${process.pid}.ndjson`);
  fs.writeFileSync(f, 'a\t{"t":1}\nrigaSenzaTab\nb\t{non json}\nc\t{"t":3}\n');
  const got = await readNdjson(f);
  assert.deepEqual(got, { a: { t: 1 }, c: { t: 3 } });
  fs.unlinkSync(f);
});

// --- plausibilita' rispetto alle offerte reali ---
// I casi qui sotto sono carte vere lette dalla dashboard il 26/08/2026, quando
// senza questo filtro l'89% delle carte in classifica era mercato sottile.
import { isPlausible } from '../scripts/lib/trend.mjs';

test('plausibilita: trend irraggiungibile rispetto alle offerte viene scartato', () => {
  // Trevenant & Dusknoir GX: trend 96,06 ma si compra a 2 euro. +806% falso.
  const t = { pct: 8.06, from: 10.6, to: 96.06 };
  assert.equal(isSignificant(t, { trend: 96.06, low: 2 }, NOISE), false);
});

test('plausibilita: offerta piu bassa sopra il trend viene scartata', () => {
  // Dark Steelix: trend 0,97 ma nessuna copia sotto 4,95. -98% falso.
  const t = { pct: -0.98, from: 44.47, to: 0.97 };
  assert.equal(isSignificant(t, { trend: 0.97, low: 4.95 }, NOISE), false);
});

test('plausibilita: anche il valore di confronto deve reggere le offerte', () => {
  // Zapdos: trend 5,24 e offerta 1, ma media 30 giorni 44,17. E la media a
  // essere rotta, non il prezzo a essere crollato.
  const t = { pct: -0.88, from: 44.17, to: 5.24 };
  assert.equal(isSignificant(t, { trend: 5.24, low: 1 }, NOISE), false);
});

test('plausibilita: un rialzo vero su carta liquida passa', () => {
  // M Tyranitar EX: trend 90,17, offerta 6, media 30 giorni 31,45.
  const t = { pct: 1.87, from: 31.45, to: 90.17 };
  assert.equal(isSignificant(t, { trend: 90.17, low: 6 }, NOISE), true);
});

test('plausibilita: senza offerta piu bassa non si scarta per mancanza di prova', () => {
  assert.equal(isPlausible(50, 25, null, NOISE), true);
  assert.equal(isPlausible(50, 25, 0, NOISE), true);
});

test('isSignificant accetta ancora il solo prezzo, senza controllo offerte', () => {
  const t = { pct: 0.3, from: 100, to: 130 };
  assert.equal(isSignificant(t, 130, NOISE), true);
});
