// Test della logica aggiunta con il grafico e l'immagine esportata.
// Tutto puro: nessuna rete, nessun file, nessun DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectTargets } from '../scripts/lib/select.mjs';
import { parseHistory, historyFileMeta } from '../scripts/lib/history.mjs';
import { computeInsight, windowPoints, niceScale, fmtEur, fmtPct, fmtSignedEur } from '../scripts/lib/insight.mjs';
import { trendFromHistory } from '../scripts/lib/trend.mjs';
import { OFFSETS, referenceDate } from '../scripts/backfill.mjs';

/* ---------- chi viene riletto oggi ---------- */

const POLICY = { hotMinEur: 2, rotationDays: 4, ids: ['pin-1'] };

test('select: la watchlist entra sempre, anche se la carta costa pochi centesimi', () => {
  const ids = ['pin-1', 'hot', 'cold-a'];
  const prices = { 'pin-1': { trend: 0.05 }, hot: { trend: 9 }, 'cold-a': { trend: 0.3 } };
  for (let r = 0; r < 4; r++) {
    assert.ok(selectTargets(ids, prices, { rotation: r }, POLICY).includes('pin-1'), `giro ${r}`);
  }
});

test('select: sopra la soglia si rilegge ogni giorno, sotto si ruota', () => {
  const ids = ['hot', 'c0', 'c1', 'c2', 'c3'];
  const prices = { hot: { trend: 5 }, c0: { trend: 1 }, c1: { trend: 1 }, c2: { trend: 1 }, c3: { trend: 1 } };
  const seen = new Set();
  for (let r = 0; r < 4; r++) {
    const t = selectTargets(ids, prices, { rotation: r }, POLICY);
    assert.ok(t.includes('hot'), 'la carta calda manca al giro ' + r);
    t.filter((x) => x.startsWith('c')).forEach((x) => seen.add(x));
  }
  assert.deepEqual([...seen].sort(), ['c0', 'c1', 'c2', 'c3'], 'in un ciclo completo la coda lunga va coperta tutta');
});

test('select: una carta mai letta entra subito, senza aspettare il suo turno', () => {
  const ids = ['nuova', 'c0', 'c1', 'c2', 'c3'];
  const prices = { c0: { trend: 1 }, c1: { trend: 1 }, c2: { trend: 1 }, c3: { trend: 1 } };
  assert.ok(selectTargets(ids, prices, { rotation: 0 }, POLICY).includes('nuova'));
});

test('select: usa avg30 quando il trend manca, invece di declassare la carta', () => {
  const ids = ['x'];
  assert.ok(selectTargets(ids, { x: { avg30: 8 } }, { rotation: 1 }, POLICY).includes('x'));
});

test('select: bootstrap prende tutto e ignora la rotazione', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(selectTargets(ids, {}, { rotation: 2 }, POLICY, true), ids);
});

test('select: id della watchlist inesistenti non inquinano la lista', () => {
  const out = selectTargets(['a'], { a: { trend: 9 } }, { rotation: 0 }, { ...POLICY, ids: ['fantasma'] });
  assert.deepEqual(out, ['a']);
});

/* ---------- lettura dello storico ---------- */

test('history: riconosce rilevazioni e stime, e scarta il resto', () => {
  assert.deepEqual(historyFileMeta('2026-08-26.ndjson'), { est: false, date: '2026-08-26' });
  assert.deepEqual(historyFileMeta('est-2026-08-11.ndjson'), { est: true, date: '2026-08-11' });
  assert.equal(historyFileMeta('appunti.txt'), null);
  assert.equal(historyFileMeta('2026-8-1.ndjson'), null);
});

test('history: legge sia le righe a due colonne sia quelle con l offerta minima', () => {
  const map = parseHistory([
    { name: '2026-08-01.ndjson', text: 'a\t1.50\n' },
    { name: '2026-08-02.ndjson', text: 'a\t1.80\t0.90\n' },
  ]);
  assert.deepEqual(map.get('a'), [
    { date: '2026-08-01', trend: 1.5 },
    { date: '2026-08-02', trend: 1.8, low: 0.9 },
  ]);
});

test('history: sulla stessa data la rilevazione vera batte la stima', () => {
  const map = parseHistory([
    { name: 'est-2026-08-05.ndjson', text: 'a\t9\n' },
    { name: '2026-08-05.ndjson', text: 'a\t4\n' },
  ]);
  assert.deepEqual(map.get('a'), [{ date: '2026-08-05', trend: 4 }]);
});

test('history: i punti stimati restano marcati e ordinati per data', () => {
  const map = parseHistory([
    { name: '2026-08-20.ndjson', text: 'a\t3\n' },
    { name: 'est-2026-08-01.ndjson', text: 'a\t2\n' },
  ]);
  assert.deepEqual(map.get('a').map((p) => [p.date, p.est === true]), [['2026-08-01', true], ['2026-08-20', false]]);
});

test('history: righe rotte o a zero non fanno perdere le altre', () => {
  const map = parseHistory([{ name: '2026-08-20.ndjson', text: 'a\t3\nrotta\nb\t0\nc\t1.2\n' }]);
  assert.deepEqual([...map.keys()], ['a', 'c']);
});

/* ---------- le stime non diventano mai percentuali ---------- */

test('trend: i punti stimati vengono ignorati dal calcolo pubblicato', () => {
  const solo = [
    { date: '2026-07-28', trend: 6, est: true },
    { date: '2026-08-27', trend: 8 },
  ];
  assert.equal(trendFromHistory(solo, 30, '2026-08-27'), null, 'una sola rilevazione vera non basta');

  const misto = [
    { date: '2026-07-28', trend: 6, est: true },
    { date: '2026-07-29', trend: 7 },
    { date: '2026-08-27', trend: 8 },
  ];
  const t = trendFromHistory(misto, 30, '2026-08-27');
  assert.equal(t.from, 7, 'deve ancorarsi alla rilevazione vera, non alla stima');
});

/* ---------- il numero in evidenza ---------- */

const NOISE = { minTrend: 0.15, minAbsChangeEur: 0.2 };

test('insight: due rilevazioni vere danno una variazione, non una stima', () => {
  const points = [{ date: '2026-07-28', v: 6 }, { date: '2026-08-27', v: 8 }];
  const i = computeInsight({ points, price: { t: 8 }, days: 30, today: '2026-08-27', noise: NOISE });
  assert.equal(i.source, 'history');
  assert.equal(i.estimated, false);
  assert.equal(i.from, 6);
  assert.equal(i.to, 8);
  assert.equal(i.abs, 2);
  assert.ok(Math.abs(i.pct - 1 / 3) < 1e-9);
});

// Intl usa spazi non separabili prima del simbolo di valuta: normalizzati qui,
// altrimenti il confronto fallisce per un carattere invisibile.
const norm = (s) => String(s).replace(/[  ]/g, ' ');

test('insight: la variazione assoluta esiste sempre accanto alla percentuale', () => {
  const points = [{ date: '2026-07-28', v: 6 }, { date: '2026-08-27', v: 8 }];
  const i = computeInsight({ points, price: { t: 8 }, days: 30, today: '2026-08-27', noise: NOISE });
  assert.equal(fmtPct(i.pct), '+33,3%');
  assert.equal(norm(fmtSignedEur(i.abs)), '+2,00 €');
});

test('insight: senza storico utile ricade sulla stima e lo dichiara', () => {
  const i = computeInsight({ points: [], price: { t: 8 }, days: 30, today: '2026-08-27', fallbackPct: 0.25, noise: NOISE });
  assert.equal(i.source, 'estimate');
  assert.equal(i.estimated, true);
  assert.equal(i.to, 8);
  assert.ok(Math.abs(i.from - 6.4) < 1e-9);
});

test('insight: i punti stimati da soli non producono una variazione', () => {
  const points = [{ date: '2026-08-12', v: 6, est: true }, { date: '2026-08-27', v: 8, est: true }];
  assert.equal(computeInsight({ points, price: { t: 8 }, days: 30, today: '2026-08-27', noise: NOISE }), null);
});

test('insight: un movimento sotto la soglia viene marcato come debole', () => {
  const points = [{ date: '2026-07-28', v: 0.5 }, { date: '2026-08-27', v: 0.6 }];
  const i = computeInsight({ points, price: { t: 0.6 }, days: 30, today: '2026-08-27', noise: NOISE });
  assert.equal(i.weak, true, '+20% ma dieci centesimi: non e un segnale');
});

test('insight: fuori tolleranza non inventa un punto di partenza', () => {
  const points = [{ date: '2026-08-25', v: 6 }, { date: '2026-08-27', v: 8 }];
  assert.equal(computeInsight({ points, price: { t: 8 }, days: 365, today: '2026-08-27', noise: NOISE }), null);
});

/* ---------- finestra e scala ---------- */

test('windowPoints: taglia sul periodo, ma non lascia mai un grafico con un punto', () => {
  const points = [{ date: '2026-01-01', v: 1 }, { date: '2026-08-20', v: 2 }, { date: '2026-08-27', v: 3 }];
  assert.equal(windowPoints(points, 30, '2026-08-27').length, 2);
  assert.equal(windowPoints(points, 1, '2026-08-27').length, 3, 'con meno di due punti tiene tutto');
  assert.equal(windowPoints(points, null, '2026-08-27').length, 3);
});

test('niceScale: tacche tonde che contengono davvero i dati', () => {
  const s = niceScale(6.1, 8.4, 4);
  assert.ok(s.min <= 6.1 && s.max >= 8.4);
  assert.ok(s.ticks.length >= 3);
  assert.equal(s.ticks[0], s.min);
});

test('niceScale: una serie piatta non fa esplodere la divisione', () => {
  const s = niceScale(5, 5, 4);
  assert.ok(s.max > s.min);
  assert.ok(Number.isFinite(s.step) && s.step > 0);
});

/* ---------- backfill ---------- */

test('backfill: le medie vengono messe al centro della loro finestra, non al bordo', () => {
  assert.deepEqual(OFFSETS, [{ field: 'avg7', days: -4 }, { field: 'avg30', days: -15 }]);
});

test('backfill: la data di riferimento e l ultima lettura vera, non oggi', () => {
  assert.equal(referenceDate({ a: { fetched: '2026-08-20' }, b: { fetched: '2026-08-26' } }), '2026-08-26');
});

/* ---------- formattazione ---------- */

test('formati: euro e percentuali in italiano, segno esplicito', () => {
  assert.equal(norm(fmtEur(8)), '8,00 €');
  assert.equal(fmtPct(-0.125), '−12,5%');
  assert.equal(norm(fmtSignedEur(-2)), '−2,00 €');
  assert.equal(fmtEur(null), '—');
});
