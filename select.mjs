// Chi viene riletto oggi. Funzione pura: nessuna rete, nessun file, testata.
//
// Tre corsie, in ordine di priorita':
//  1. watchlist: le carte che segui di persona, sempre, qualunque sia il prezzo;
//  2. calde: trend >= hotMinEur, ogni giorno. Sono le stesse per cui il build
//     pubblica una serie storica, quindi devono avere un punto al giorno;
//  3. coda lunga: divisa in rotationDays fette, una al giorno.
// Piu' le carte mai lette prima, che non hanno ancora nessun prezzo.

export const DEFAULT_POLICY = { hotMinEur: 2, rotationDays: 4, ids: [] };

export function selectTargets(ids, prices, state, policy = DEFAULT_POLICY, bootstrap = false) {
  if (bootstrap) return ids;
  const p = { ...DEFAULT_POLICY, ...(policy || {}) };
  const known = new Set(ids);
  const pinned = (p.ids || []).filter((id) => known.has(id));
  const pinnedSet = new Set(pinned);

  const hot = [];
  const cold = [];
  for (const id of ids) {
    if (pinnedSet.has(id)) continue;
    const price = prices[id];
    const value = price?.trend ?? price?.avg30 ?? null;
    if (value != null && value >= p.hotMinEur) hot.push(id);
    else cold.push(id);
  }

  const rot = Math.max(1, Math.trunc(p.rotationDays) || 1);
  const turn = ((state?.rotation ?? 0) % rot + rot) % rot;
  const slice = cold.filter((_, i) => i % rot === turn);
  const never = ids.filter((id) => !prices[id]);
  return [...new Set([...pinned, ...hot, ...slice, ...never])];
}
