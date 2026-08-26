# PokeTrend

Dashboard dei trend di prezzo delle carte Pokémon singole, in euro, da mettere nella home del telefono.
Classifiche delle dieci carte più in salita e più in discesa per fascia di prezzo, e ricerca su tutte le carte censite.

Gira tutta su servizi gratuiti: GitHub Actions scarica i prezzi ogni notte, GitHub Pages serve la dashboard. Nessuna chiave API, nessun server, nessun costo.

---

## Che cosa è rilevato e che cosa è stimato

Questa è la parte da leggere prima di usarla per decidere un acquisto.

| Dato | Origine | Affidabilità |
|---|---|---|
| Prezzo raw NM, offerta più bassa, medie 7 e 30 giorni | Cardmarket via TCGdex, aggiornato ogni giorno | **rilevato** |
| Variazione 7 giorni e 1 mese | scostamento fra trend corrente e medie Cardmarket, finché lo storico proprio non copre il periodo | stima, poi rilevato |
| Variazione 3 e 12 mesi | solo dallo storico che questa dashboard accumula da sola | disponibile dopo 90 e 365 giorni |
| Prezzo per qualità diversa da NM | interpolazione fra il trend e l'offerta più bassa reale | **stima** |
| Valori delle carte gradate | moltiplicatori sul prezzo raw, tarati su rapporti di mercato pubblicati | **stima** |
| Prezzo di una lingua specifica | non esiste come dato pubblico | **non disponibile** |

### I tre limiti veri

**1. La lingua non cambia il prezzo mostrato.** Cardmarket pubblica il prezzo trend *per prodotto*, e il prodotto è la carta di un certo set: la lingua è un attributo della singola inserzione, non del prodotto. Il prezzo storico di una 151 italiana non esiste come dato pubblico, e le API di Cardmarket sono chiuse a nuove richieste dal 2025. Il selettore lingua nella dashboard apre le offerte reali filtrate per lingua su Cardmarket: quello è il prezzo italiano vero.

**2. Le gradate sono un modello.** Nessuna fonte gratuita espone prezzi di carte gradate. Le stime partono dal raw NM e applicano moltiplicatori documentati in `config/grading.json`, tarati su dati di mercato pubblicati (PSA 10 vale 2-5× il raw sulle moderne, 5-10× sulle vintage; PSA 9 circa il 40% di un PSA 10; CGC il 10-20% sotto PSA di pari voto). Per GRAAD e AP Grading il mercato secondario è troppo sottile perché un numero significhi qualcosa: sono marcate "fiducia molto bassa" apposta. Ogni scheda carta ha il link alle vendite eBay concluse e a PriceCharting, che è dove si controlla il numero vero.

**3. Le variazioni brevi partono da una stima.** Finché lo storico proprio non copre il periodo, "7 giorni" è lo scostamento fra il trend corrente e la media delle vendite dell'ultima settimana. Si avvicina molto, ma non è una differenza punto a punto. Quando lo diventa, la riga della scheda dice "storico" invece di "stima da medie". `avg1` non viene mai usato: su carte a basso volume è una sola giornata di vendite e produce variazioni a tre cifre prive di senso.

---

## Installazione

Serve solo un account GitHub.

**1. Crea il repository.** Crea un repo **pubblico** su GitHub (i minuti di Actions sono illimitati sui repo pubblici; su uno privato consumeresti quasi tutti i 2.000 mensili del piano gratuito) e caricaci questa cartella.

**2. Attiva GitHub Pages.** Nel repo: *Settings → Pages → Source*, scegli **GitHub Actions**.

**3. Fai il primo giro completo.** Nel repo: *Actions → Aggiornamento prezzi → Run workflow*, spunta **bootstrap** e avvia. Scarica tutte le carte censite, ci mette circa un'ora e mezza. Da lì in poi parte da solo ogni notte alle 05:10 UTC.

**4. Metti la dashboard in home.** Apri `https://TUO-UTENTE.github.io/poketrend/`. Su iPhone: *Condividi → Aggiungi alla schermata Home*. Su Android: menu → *Installa app*. Funziona anche offline con l'ultimo dato scaricato.

### Prima di aspettare un'ora

```bash
npm run demo && npm run serve
```

Genera un dataset dimostrativo con **prezzi non reali** e apre la dashboard su `http://localhost:8080`. Serve solo a vedere com'è fatta. Il file `data/DEMO` esiste finché non giri l'ingest vero.

---

## Come funziona

```
TCGdex API ──► scripts/ingest.mjs ──► data/*.ndjson ──► scripts/build-web-data.mjs ──► web/data/*.json ──► PWA
   (Cardmarket EUR)                    (nel repo)                                       (su Pages)
```

**L'ingest ha due velocità.** TCGdex non pubblica limiti rigidi ma chiede di essere usato con criterio, e i prezzi si leggono una carta alla volta. Quindi ogni notte vengono riaggiornate tutte le carte sopra i 5 € — quelle su cui una classifica ha senso — più un settimo della coda lunga a rotazione. Le variazioni a 7 e 30 giorni restano corrette anche per le carte della coda, perché `avg7` e `avg30` arrivano già calcolate da Cardmarket dentro ogni risposta.

**Lo storico è il motivo per cui vale la pena lasciarla girare.** Ogni notte viene scritto un file `data/history/AAAA-MM-GG.ndjson` con il prezzo trend di ogni carta riletta. È l'unico modo per avere 3 e 12 mesi di variazione reale senza pagare: nessuna fonte gratuita li vende già pronti.

**Perché NDJSON ordinato e non un JSON unico.** Git salva ogni versione di un file per intero e poi comprime a delta i blob simili. Un JSON minificato è una riga sola: ogni aggiornamento produrrebbe un blob completamente diverso e il repository crescerebbe di megabyte al giorno. Con una riga per carta, ordinata per id, cambiano solo le righe delle carte davvero riaggiornate.

**Perché il pacchetto della dashboard è a colonne.** Un oggetto per carta, con le sue chiavi ripetute ventunomila volte, costa più in nomi di campo che in dati: il pacchetto arrivava a 25 MB. A colonne sta sotto i 3 MB, circa mezzo mega compresso.

**Il filtro anti-rumore.** Una comune che passa da 0,03 a 0,09 € è un +200% che non significa niente. Entrano in classifica solo carte sopra 0,15 € che si sono mosse di almeno 0,20 € in valore assoluto. In più, quando le quattro misure di prezzo di una carta divergono troppo fra loro — segno che gli scambi sono pochi — la carta viene marcata "pochi scambi": la sua percentuale vale poco e la dashboard lo dice.

---

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm test` | 28 test sulla logica di calcolo, ricerca e persistenza |
| `npm run bootstrap` | primo giro completo su tutte le carte |
| `npm run ingest` | giro giornaliero |
| `npm run ingest -- --limit 200` | giro ridotto, per provare senza aspettare |
| `npm run build` | ricostruisce il pacchetto per la dashboard |
| `npm run demo` | dataset dimostrativo con prezzi finti |
| `npm run verify` | verifica end-to-end su 100 giorni di storico simulato |
| `npm run serve` | server locale su `:8080` |

## Cose da sapere

**Le classifiche stanno dentro le fasce di prezzo, non su tutte le carte insieme.** Le carte care e poco scambiate si muovono in percentuale molto più delle altre: senza le fasce, la classifica generale sarebbe sempre e solo vintage. La voce "tutte" c'è, ma è la meno informativa.

**Lo scheduler di GitHub si spegne da solo.** GitHub disattiva i workflow schedulati dopo 60 giorni senza attività umana nel repository, e i commit del bot non contano. `.github/workflows/keepalive.yml` scrive un file una volta al mese per evitarlo. Se lo cancelli, ricordati di fare un push ogni tanto.

**Le esecuzioni schedulate possono slittare.** GitHub non garantisce l'orario esatto sui repo gratuiti: nelle ore di punta il ritardo può essere di decine di minuti. Per una dashboard giornaliera non cambia niente.

**Se un giorno TCGdex cambia i campi.** L'ingest esce con errore se più del 20% delle richieste fallisce, così la dashboard resta ferma sull'ultimo dato buono invece di riempirsi di zeri. I test in `test/all.test.mjs` girano prima dell'ingest dentro il workflow e usano risposte reali dell'API come riferimento: se il contratto cambia, il workflow si ferma lì.

## Configurazione

| File | Cosa contiene |
|---|---|
| `config/bands.json` | fasce di prezzo e soglie anti-rumore |
| `config/conditions.json` | coefficienti per la stima per qualità |
| `config/grading.json` | case di gradazione, moltiplicatori e fonti dei moltiplicatori |

Sono JSON commentati: cambiali e rilancia `npm run build`.

## Dati e attribuzioni

Prezzi Cardmarket letti tramite [TCGdex](https://tcgdex.dev), gratuito e senza chiave. Dati delle carte di TCGdex. Questo progetto non è affiliato né a Cardmarket né a Nintendo, The Pokémon Company o Creatures.
