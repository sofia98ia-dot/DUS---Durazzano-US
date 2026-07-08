# DUS — Durazzano Us (skeleton)

Multiplayer di deduzione sociale in stile impostore, con **stanze a codice**. Server autoritativo Node.js + Socket.io, grafica segnaposto (cerchi colorati).

## Avvio in locale
```bash
npm install
npm start
```
Apri http://localhost:3000

## Come si gioca
1. Scegli nome e colore.
2. **Crea una stanza** (ricevi un codice di 4 caratteri) oppure **entra** digitando il codice di un amico.
3. Condividi il codice; quando siete almeno 3, l'host avvia la partita.
4. Movimento: WASD/frecce (desktop) o joystick (mobile). Pulsanti: USA (task), UCCIDI (impostore, con cooldown), REPORT (vicino a un cadavere), EMERG (riunione).

## Deploy su Render
Web Service · Build `npm install` · Start `node server.js`. Nessun DB. Il piano gratuito va in standby dopo un po' di inattività e si risveglia alla prima visita (primo caricamento lento, poi regolare).

## Aggiornare una versione già online
Ricarica `server.js` e `public/index.html` nel repo GitHub: Render fa il redeploy in automatico.

## Novità v0.2
Stanze multiple con codice · più partite in parallelo, isolate tra loro · host per stanza · pulizia automatica delle stanze vuote · rebranding DUS.

## Prossimi passi possibili
Grafica/sprite originali · chat in riunione · sabotaggi · task come mini-giochi · mappa di Durazzano personalizzata.
