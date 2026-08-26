// Risposte reali osservate su api.tcgdex.net il 26/08/2026.
// Non sono inventate: servono a bloccare il contratto dei campi e a verificare
// che i calcoli reggano sui casi limite veri (vintage volatile, carte da
// 3 centesimi, ex moderne, campi -holo a null o a zero).

export const CARDMARKET_SAMPLES = {
  // Charizard Base Set: vintage, prezzi alti, avg1 fortemente sopra avg30
  // perche' su bassi volumi una sola giornata di vendite sposta tutto.
  'base1-4': {
    cardmarket: {
      updated: '2026-08-25T15:00:45.721Z', unit: 'EUR', idProduct: 273699,
      avg: 487.19, low: 102, trend: 586.03, avg1: 1552.5, avg7: 594.65, avg30: 445.32,
      'avg-holo': null, 'low-holo': null, 'trend-holo': 123.63,
      'avg1-holo': 207.4, 'avg7-holo': 129.55, 'avg30-holo': 202.71,
    },
    releaseDate: '1999-01-09',
  },
  // Carta comune di un set uscito da poco: prezzi in centesimi, la variante
  // reverse vale piu' della base.
  'me05-001': {
    cardmarket: {
      updated: '2026-08-25T15:00:45.722Z', unit: 'EUR', idProduct: 895789,
      avg: 0.03, low: 0.02, trend: 0.03, avg1: 0.02, avg7: 0.03, avg30: 0.03,
      'avg-holo': 0.07, 'low-holo': 0.02, 'trend-holo': 0.06,
      'avg1-holo': 0.09, 'avg7-holo': 0.06, 'avg30-holo': 0.07,
    },
    releaseDate: '2026-08-01',
  },
  // Bulbasaur 151: comune moderna, reverse tre volte la base.
  'sv03.5-001': {
    cardmarket: {
      updated: '2026-08-25T15:00:45.742Z', unit: 'EUR', idProduct: 733596,
      avg: 0.12, low: 0.02, trend: 0.1, avg1: 0.15, avg7: 0.09, avg30: 0.12,
      'avg-holo': 0.29, 'low-holo': 0.02, 'trend-holo': 0.32,
      'avg1-holo': null, 'avg7-holo': 0.29, 'avg30-holo': 0.29,
    },
    releaseDate: '2023-09-22',
  },
  // Charizard ex 151: campi -holo a zero e a null insieme, caso da non far esplodere.
  'sv03.5-006': {
    cardmarket: {
      updated: '2026-08-25T15:00:45.742Z', unit: 'EUR', idProduct: 733601,
      avg: 8.85, low: 5, trend: 8.57, avg1: 8.98, avg7: 8.77, avg30: 8.81,
      'avg-holo': 0, 'low-holo': null, 'trend-holo': null,
      'avg1-holo': null, 'avg7-holo': null, 'avg30-holo': null,
    },
    releaseDate: '2023-09-22',
  },
  // Carta senza alcun prezzo: deve essere scartata, non finire in classifica a zero.
  'senza-prezzo': { cardmarket: null, releaseDate: '2024-01-01' },
};

export const CARDS = [
  { id: 'sv03.5-006', localId: '006', names: { en: 'Charizard ex', it: 'Charizard ex' }, setId: 'sv03.5', setOfficial: 165, setTotal: 207, trend: 8.57, rarity: 'Double rare', bandId: 'b2' },
  { id: 'sv03.5-201', localId: '201', names: { en: 'Charizard ex', it: 'Charizard ex' }, setId: 'sv03.5', setOfficial: 165, setTotal: 207, trend: 120.0, rarity: 'Special illustration rare', bandId: 'b4' },
  { id: 'base1-4', localId: '4', names: { en: 'Charizard', it: 'Charizard' }, setId: 'base1', setOfficial: 102, setTotal: 102, trend: 586.03, rarity: 'Rare', bandId: 'b6' },
  { id: 'sv03.5-001', localId: '001', names: { en: 'Bulbasaur', it: 'Bulbasaur' }, setId: 'sv03.5', setOfficial: 165, setTotal: 207, trend: 0.1, rarity: 'Common', bandId: 'b0' },
  { id: 'me05-001', localId: '001', names: { en: 'Pikachu', it: 'Pikachu' }, setId: 'me05', setOfficial: 120, setTotal: 120, trend: 0.03, rarity: 'Common', bandId: 'b0' },
];
