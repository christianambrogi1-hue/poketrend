// Lettura e scrittura dei dati come NDJSON ordinato per id.
//
// Perche' non un JSON unico: git salva ogni versione del file per intero e poi
// comprime a delta i blob simili fra loro. Un JSON minificato su riga singola
// e' una riga sola, quindi ogni aggiornamento produce un blob completamente
// diverso e il repository cresce di alcuni megabyte al giorno. Con una riga per
// carta, ordinata, cambiano solo le righe delle carte davvero riaggiornate e la
// compressione a delta fa il suo lavoro.
import fs from 'node:fs/promises';

export async function readNdjson(file) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch { return null; }
  const out = {};
  for (const line of text.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    try { out[line.slice(0, tab)] = JSON.parse(line.slice(tab + 1)); } catch { /* riga corrotta: saltata */ }
  }
  return Object.keys(out).length ? out : null;
}

export async function writeNdjson(file, obj) {
  const ids = Object.keys(obj).sort();
  const lines = ids.map((id) => `${id}\t${JSON.stringify(obj[id])}`);
  await fs.writeFile(file, lines.join('\n') + '\n', 'utf8');
}
