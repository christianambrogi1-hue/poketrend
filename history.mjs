// Lettura dello storico su disco. Separata dal build perche' e' la parte piu'
// facile da sbagliare in silenzio, ed e' l'unica che tocca due formati di file
// e tre formati di riga insieme.
//
// Nomi accettati nella cartella data/history:
//   2026-08-26.ndjson       rilevazione vera
//   est-2026-08-11.ndjson   punto stimato dal backfill
// Righe accettate:
//   id \t trend                 formato iniziale
//   id \t trend \t offertaMin   formato attuale
// Le colonne in piu' vengono ignorate invece di far scartare la riga: un file
// scritto da una versione futura non deve rendere illeggibile lo storico.

/** Riconosce un file dello storico. Ritorna null se il nome non e' dei nostri. */
export function historyFileMeta(name) {
  const m = /^(est-)?(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(String(name || ''));
  return m ? { est: Boolean(m[1]), date: m[2] } : null;
}

/**
 * @param {Array<{name:string, text:string}>} files
 * @returns {Map<string, Array<{date:string, trend:number, low?:number, est?:true}>>}
 *
 * A parita' di data la rilevazione vera vince sulla stima: i file 'est-' sono
 * ordinati per ultimi e il primo punto scritto per quella data e' quello buono.
 */
export function parseHistory(files) {
  const map = new Map();
  const seen = new Map();

  const ordered = (files || [])
    .map((f) => ({ ...f, meta: historyFileMeta(f.name) }))
    .filter((f) => f.meta)
    .sort((a, b) => (a.meta.date < b.meta.date ? -1 : a.meta.date > b.meta.date ? 1 : a.meta.est - b.meta.est));

  for (const { text, meta } of ordered) {
    for (const line of String(text || '').split('\n')) {
      if (!line) continue;
      const parts = line.split('\t');
      const id = parts[0];
      const trend = Number(parts[1]);
      if (!id || !(trend > 0)) continue;

      let dates = seen.get(id);
      if (!dates) { dates = new Set(); seen.set(id, dates); }
      if (dates.has(meta.date)) continue;
      dates.add(meta.date);

      const point = { date: meta.date, trend };
      const low = Number(parts[2]);
      if (low > 0) point.low = low;
      if (meta.est) point.est = true;

      if (!map.has(id)) map.set(id, []);
      map.get(id).push(point);
    }
  }
  for (const arr of map.values()) arr.sort((a, b) => (a.date < b.date ? -1 : 1));
  return map;
}
