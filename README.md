# FuelFinder Web ⛽🇮🇹

Versione web di FuelFinder per testare velocemente le funzionalità prima dell'app iOS nativa.

Trova i distributori di benzina più economici in Italia con dati ufficiali **MISE** (Ministero Imprese e Made in Italy) aggiornati ogni mattina.

## Funzionalità

- 🔍 **Ricerca per indirizzo** (city/via/CAP) — geocoding via Mapbox, ristretto all'Italia
- 📋 **Lista** dei distributori entro 10 km dal punto cercato, ordinati per distanza
- 🗺️ **Mappa interattiva** Mapbox con marker che mostrano il prezzo del carburante
- ⛽ **Filtro carburante**: Benzina / Gasolio / GPL / Metano / Benzina Plus / Gasolio Plus
- 📸 **Foto distributori** da Google Places API (cache lato server)
- 💰 **Tutti i prezzi** (self + servito) nella scheda dettaglio

## Stack

| | |
|---|---|
| Framework | Next.js 14 (App Router) |
| Lingua | TypeScript |
| Mappa | Mapbox GL + react-map-gl |
| Dati prezzi | MISE CSV pubblici (cache 4h in-memory) |
| Geocoding | Mapbox Geocoding API |
| Foto | Google Places API (New) |

## Avvio in locale

```bash
npm install
npm run dev
```

Apri **http://localhost:3000**.

Le chiavi API (Mapbox + Google) sono in `.env.local`.

## Come si usa

1. Scrivi un comune o un indirizzo nella search bar (es. `Milano`, `Roma`, `Via Roma 1 Bologna`)
2. Seleziona uno dei suggerimenti di geocoding
3. La lista si popola con i distributori entro 10 km, ordinati per distanza
4. Tap/click su un distributore per vederlo evidenziato sulla mappa con popup
5. Cambia carburante con i chip in alto: i prezzi si ricalcolano in tempo reale

## Struttura

```
fuelfinder-web/
├── app/
│   ├── layout.tsx           # Layout root
│   ├── page.tsx             # Single-page app (search + lista + mappa)
│   ├── globals.css
│   └── api/
│       ├── stations/route.ts # GET ?lat&lon&fuel&radiusKm → distributori vicini
│       ├── geocode/route.ts  # GET ?q → suggerimenti Mapbox
│       └── photo/route.ts    # GET ?id&name&address → redirect a Google Place Photo
├── lib/
│   ├── types.ts             # FuelType, FuelStation, matchesFuel()
│   └── mise.ts              # Download + parsing CSV ministeriali con cache 4h
├── .env.local               # MAPBOX_TOKEN + GOOGLE_API_KEY
└── package.json
```

## Note sui dati MISE

- I CSV `anagrafica_impianti_attivi.csv` e `prezzo_alle_8.csv` usano `|` come separatore (non `,` né `;`)
- Encoding **ISO-8859-1**
- Aggiornati ogni mattina alle 8:00
- **Bug noto del dataset**: alcuni record (~6) hanno coordinate placeholder `45.4642035, 9.189982` (Milano centro). Le filtriamo via.
- Altri record sporadici hanno coordinate vagamente sbagliate (es. distributori dichiarati in Sardegna ma con lat/lon vicino a Milano). Non c'è modo affidabile di correggerli senza un servizio di reverse-geocoding per ogni record.

## Costi API

- **Mapbox**: 50.000 caricamenti mappa + 100.000 geocode/mese gratis
- **Google Places**: $200/mese di credito gratuito (~25.000 foto). Le foto sono cachate in-memory finché il server gira.

In produzione, sposta la `GOOGLE_API_KEY` in un proxy + restringi a referer del tuo dominio.

## Da fare prima di mettere in produzione

- [ ] Persistere la cache MISE su Redis/Upstash invece che in-memory
- [ ] Cache foto Google Places su Vercel Blob o S3 invece che in-memory
- [ ] Rate limiting sulle API
- [ ] PWA manifest + service worker
- [ ] Restringere `GOOGLE_API_KEY` a HTTP referer del dominio
- [ ] Geolocalizzazione browser opzionale ("Usa la mia posizione")
