'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Map, { Marker, Popup, MapRef, NavigationControl, Source, Layer } from 'react-map-gl';
import type { FuelStation, FuelType } from '@/lib/types';
import { FUEL_LABELS } from '@/lib/types';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;
const FUELS: FuelType[] = ['benzina', 'diesel', 'gpl', 'metano', 'benzina_plus', 'diesel_plus'];

interface GeocodeResult { placeName: string; lat: number; lon: number; }
type Mode = 'place' | 'route';

/* Small debounced-geocode hook wrapped in a component so we can reuse it for 2 inputs */
function useGeocode(query: string) {
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (tRef.current) clearTimeout(tRef.current);
    if (query.length < 3) { setResults([]); return; }
    tRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
        const d = await res.json();
        setResults(d.results || []);
      } catch { setResults([]); }
    }, 300);
  }, [query]);
  return results;
}

function SearchBox({ value, onChange, onPick, placeholder }: {
  value: string; onChange: (v: string) => void; onPick: (r: GeocodeResult) => void; placeholder: string;
}) {
  const results = useGeocode(value);
  const [open, setOpen] = useState(false);
  return (
    <div className="searchBox">
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { onPick(results[0]); setOpen(false); } }}
      />
      {open && results.length > 0 && (
        <div className="suggestions">
          {results.map((r, i) => (
            <div key={i} onMouseDown={() => { onPick(r); setOpen(false); }}>{r.placeName}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const [mode, setMode] = useState<Mode>('place');

  // Place mode
  const [query, setQuery] = useState('');
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);

  // Route mode
  const [origQuery, setOrigQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [origin, setOrigin] = useState<GeocodeResult | null>(null);
  const [destination, setDestination] = useState<GeocodeResult | null>(null);
  const [routeGeo, setRouteGeo] = useState<any>(null);
  const [routeDistance, setRouteDistance] = useState<number | null>(null);
  const [routeDuration, setRouteDuration] = useState<number | null>(null);

  const [stations, setStations] = useState<FuelStation[]>([]);
  const [selectedFuel, setSelectedFuel] = useState<FuelType>('benzina');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FuelStation | null>(null);
  const [photos, setPhotos] = useState<Record<number, string | null>>({});
  const [reportFor, setReportFor] = useState<{ priceIdx: number } | null>(null);
  const [reportPrice, setReportPrice] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [reportStatus, setReportStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const mapRef = useRef<MapRef>(null);

  const fetchPhoto = useCallback(async (s: FuelStation) => {
    setPhotos((cur) => {
      if (cur[s.id] !== undefined) return cur;
      (async () => {
        try {
          const url = `/api/photo?id=${s.id}&name=${encodeURIComponent(s.flag || s.name)}&address=${encodeURIComponent(s.address)}&city=${encodeURIComponent(s.city)}&lat=${s.lat}&lon=${s.lon}`;
          const res = await fetch(url);
          const data = await res.json();
          setPhotos((p) => ({ ...p, [s.id]: data.url || null }));
        } catch {
          setPhotos((p) => ({ ...p, [s.id]: null }));
        }
      })();
      return { ...cur, [s.id]: null }; // placeholder so we don't refetch
    });
  }, []);

  const fetchStationsPlace = useCallback(async (lat: number, lon: number, fuel: FuelType) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stations?lat=${lat}&lon=${lon}&fuel=${fuel}&radiusKm=10&limit=50`);
      const data = await res.json();
      const list: FuelStation[] = data.stations || [];
      setStations(list);
      list.slice(0, 10).forEach((s) => fetchPhoto(s));
    } finally { setLoading(false); }
  }, [fetchPhoto]);

  const fetchStationsRoute = useCallback(async (o: GeocodeResult, d: GeocodeResult, fuel: FuelType) => {
    setLoading(true);
    try {
      const res = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: o.lat, lon: o.lon },
          destination: { lat: d.lat, lon: d.lon },
          fuel,
          corridorKm: 2,
        }),
      });
      const data = await res.json();
      if (data.error) { setStations([]); return; }
      setRouteGeo(data.polyline);
      setRouteDistance(data.distance);
      setRouteDuration(data.duration);
      const list: FuelStation[] = data.stations || [];
      setStations(list);
      list.slice(0, 10).forEach((s) => fetchPhoto(s));

      // Fit map to route bounds
      const coords: [number, number][] = data.polyline.coordinates;
      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      for (const [lon, lat] of coords) {
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      }
      mapRef.current?.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 60, duration: 1500 });
    } finally { setLoading(false); }
  }, [fetchPhoto]);

  // Refetch on fuel change
  useEffect(() => {
    if (mode === 'place' && center) fetchStationsPlace(center.lat, center.lon, selectedFuel);
    if (mode === 'route' && origin && destination) fetchStationsRoute(origin, destination, selectedFuel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFuel]);

  const pickPlace = (g: GeocodeResult) => {
    setQuery(g.placeName);
    setCenter({ lat: g.lat, lon: g.lon });
    setRouteGeo(null);
    fetchStationsPlace(g.lat, g.lon, selectedFuel);
    mapRef.current?.flyTo({ center: [g.lon, g.lat], zoom: 13, duration: 1200 });
  };

  const submitRoute = () => {
    if (origin && destination) fetchStationsRoute(origin, destination, selectedFuel);
  };

  const onSelectStation = (s: FuelStation) => {
    setSelected(s);
    setReportFor(null);
    setReportStatus('idle');
    mapRef.current?.flyTo({ center: [s.lon, s.lat], zoom: 14, duration: 800 });
    fetchPhoto(s);
  };

  const submitReport = async () => {
    if (!selected || reportFor == null) return;
    const p = selected.prices[reportFor.priceIdx];
    const reported = parseFloat(reportPrice.replace(',', '.'));
    if (!Number.isFinite(reported) || reported <= 0 || reported > 10) {
      setReportStatus('error');
      return;
    }
    setReportStatus('sending');
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stationId: selected.id,
          stationName: selected.flag || selected.name,
          fuelDescription: p.fuelDescription,
          isSelf: p.isSelf,
          reportedPrice: reported,
          officialPrice: p.price,
          note: reportNote || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setReportStatus('ok');
        setReportPrice('');
        setReportNote('');
        setTimeout(() => { setReportFor(null); setReportStatus('idle'); }, 1500);
      } else {
        setReportStatus('error');
      }
    } catch {
      setReportStatus('error');
    }
  };

  const formatRelative = (raw: string) => {
    // raw is "dd/MM/yyyy HH:mm:ss"
    const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return raw;
    const date = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
    const diffMs = Date.now() - date.getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'ora';
    if (mins < 60) return `${mins} min fa`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? 'ora' : 'ore'} fa`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} ${days === 1 ? 'giorno' : 'giorni'} fa`;
    return date.toLocaleDateString('it-IT');
  };

  const freshnessClass = (raw: string) => {
    const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return 'stale';
    const d = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
    const days = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
    if (days < 2) return 'fresh';
    if (days < 7) return 'medium';
    return 'stale';
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setStations([]);
    setSelected(null);
    setRouteGeo(null);
  };

  const formatDistance = (m: number | undefined) =>
    m == null ? '' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  const formatDuration = (s: number | null) => {
    if (s == null) return '';
    const h = Math.floor(s / 3600); const mi = Math.round((s % 3600) / 60);
    return h > 0 ? `${h}h ${mi}m` : `${mi} min`;
  };

  return (
    <div className="app">
      <header>
        <h1>⛽ FuelFinder <span className="badge">BETA</span></h1>
        <div className="modeTabs">
          <button className={mode === 'place' ? 'active' : ''} onClick={() => switchMode('place')}>📍 Luogo</button>
          <button className={mode === 'route' ? 'active' : ''} onClick={() => switchMode('route')}>🛣️ Tratta</button>
        </div>
        {mode === 'place' ? (
          <SearchBox
            value={query}
            onChange={setQuery}
            onPick={pickPlace}
            placeholder="Cerca città o indirizzo (es. Milano, Via Roma 1 Bologna)"
          />
        ) : (
          <div className="routeInputs">
            <SearchBox
              value={origQuery}
              onChange={setOrigQuery}
              onPick={(r) => { setOrigin(r); setOrigQuery(r.placeName); }}
              placeholder="Partenza (es. Milano)"
            />
            <SearchBox
              value={destQuery}
              onChange={setDestQuery}
              onPick={(r) => { setDestination(r); setDestQuery(r.placeName); }}
              placeholder="Destinazione (es. Roma)"
            />
            <button
              className="routeBtn"
              disabled={!origin || !destination || loading}
              onClick={submitRoute}
            >
              {loading ? '…' : 'Calcola'}
            </button>
          </div>
        )}
        <div className="fuelChips">
          {FUELS.map((f) => (
            <button key={f} className={selectedFuel === f ? 'active' : ''} onClick={() => setSelectedFuel(f)}>
              {FUEL_LABELS[f]}
            </button>
          ))}
        </div>
        {mode === 'route' && routeDistance != null && (
          <div className="routeInfo">
            🛣️ {(routeDistance / 1000).toFixed(0)} km · ⏱ {formatDuration(routeDuration)} · ⛽ {stations.length} distributori lungo il percorso
          </div>
        )}
      </header>
      <main>
        <div className="list">
          {stations.length === 0 && !loading && (
            <div className="empty">
              <div className="icon">{mode === 'place' ? '🔍' : '🛣️'}</div>
              <p>
                {mode === 'place'
                  ? 'Cerca un comune o un indirizzo per iniziare.'
                  : 'Imposta partenza e destinazione per vedere i distributori lungo il percorso.'}
              </p>
            </div>
          )}
          {loading && stations.length === 0 && <div className="loading">Caricamento…</div>}
          {stations.map((s) => (
            <div
              key={s.id}
              className={`station ${selected?.id === s.id ? 'selected' : ''}`}
              onClick={() => onSelectStation(s)}
            >
              {photos[s.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photos[s.id]!} alt={s.flag} onError={(e) => (e.currentTarget.style.display = 'none')} />
              ) : (
                <div className="imgPh">⛽</div>
              )}
              <div className="info">
                <div className="flag">{s.flag || s.name}</div>
                <div className="addr">{s.address}, {s.city}</div>
                <div className="dist">
                  {mode === 'route' ? `~${formatDistance(s.distanceMeters)} dal percorso` : formatDistance(s.distanceMeters)}
                </div>
              </div>
              <div className="price">
                {s.bestPrice != null ? (
                  <>
                    <div className="val">{s.bestPrice.toFixed(3)} €</div>
                    <div className="self">{s.bestPriceIsSelf ? 'Self' : 'Servito'}</div>
                  </>
                ) : (
                  <div className="none">—</div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mapWrap">
          <Map
            ref={mapRef}
            mapboxAccessToken={MAPBOX_TOKEN}
            initialViewState={{ latitude: 41.9028, longitude: 12.4964, zoom: 5 }}
            mapStyle="mapbox://styles/mapbox/streets-v12"
            style={{ width: '100%', height: '100%' }}
          >
            <NavigationControl position="top-right" />
            {routeGeo && (
              <Source id="route" type="geojson" data={{ type: 'Feature', geometry: routeGeo, properties: {} }}>
                <Layer
                  id="route-line-casing"
                  type="line"
                  paint={{ 'line-color': '#ffffff', 'line-width': 8 }}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                />
                <Layer
                  id="route-line"
                  type="line"
                  paint={{ 'line-color': '#007aff', 'line-width': 5 }}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                />
              </Source>
            )}
            {mode === 'place' && center && (
              <Marker latitude={center.lat} longitude={center.lon}>
                <div className="userMarker" />
              </Marker>
            )}
            {mode === 'route' && origin && (
              <Marker latitude={origin.lat} longitude={origin.lon} anchor="bottom">
                <div className="routeEndpoint"><span>A</span></div>
              </Marker>
            )}
            {mode === 'route' && destination && (
              <Marker latitude={destination.lat} longitude={destination.lon} anchor="bottom">
                <div className="routeEndpoint end"><span>B</span></div>
              </Marker>
            )}
            {stations.map((s) => (
              <Marker
                key={s.id}
                latitude={s.lat}
                longitude={s.lon}
                anchor="bottom"
                onClick={(e) => { e.originalEvent.stopPropagation(); onSelectStation(s); }}
              >
                <div className={`marker ${s.bestPrice == null ? 'none' : ''} ${selected?.id === s.id ? 'selected' : ''}`}>
                  {s.bestPrice != null ? s.bestPrice.toFixed(3) : '—'}
                </div>
              </Marker>
            ))}
            {selected && (
              <Popup
                latitude={selected.lat}
                longitude={selected.lon}
                anchor="top"
                offset={12}
                onClose={() => setSelected(null)}
                closeButton
                closeOnClick={false}
                maxWidth="280px"
              >
                <div className="popup">
                  {photos[selected.id] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photos[selected.id]!} alt={selected.flag} onError={(e) => (e.currentTarget.style.display = 'none')} />
                  )}
                  <h3>{selected.flag || selected.name}</h3>
                  <p className="addr">{selected.address}, {selected.city}</p>
                  <div className="priceList">
                    {selected.prices.map((p, i) => (
                      <div className="priceRow" key={i}>
                        <div className="rowMain">
                          <span className="name">{p.fuelDescription} <em>{p.isSelf ? 'self' : 'serv.'}</em></span>
                          <span className="v">{p.price.toFixed(3)} €</span>
                        </div>
                        <div className="rowMeta">
                          <span className={`freshness ${freshnessClass(p.updatedAt)}`}>
                            ● {formatRelative(p.updatedAt)}
                          </span>
                          <button className="reportBtn" onClick={() => { setReportFor({ priceIdx: i }); setReportPrice(''); setReportNote(''); setReportStatus('idle'); }}>
                            Segnala
                          </button>
                        </div>
                        {reportFor?.priceIdx === i && (
                          <div className="reportForm">
                            {reportStatus === 'ok' ? (
                              <div className="reportOk">✓ Segnalazione inviata, grazie!</div>
                            ) : (
                              <>
                                <input
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  max="10"
                                  placeholder={`Prezzo corretto (€/L) — es. ${p.price.toFixed(3)}`}
                                  value={reportPrice}
                                  onChange={(e) => setReportPrice(e.target.value)}
                                />
                                <input
                                  type="text"
                                  placeholder="Nota (opzionale)"
                                  maxLength={140}
                                  value={reportNote}
                                  onChange={(e) => setReportNote(e.target.value)}
                                />
                                <div className="reportActions">
                                  <button className="cancel" onClick={() => setReportFor(null)}>Annulla</button>
                                  <button className="send" disabled={reportStatus === 'sending'} onClick={submitReport}>
                                    {reportStatus === 'sending' ? 'Invio…' : 'Invia'}
                                  </button>
                                </div>
                                {reportStatus === 'error' && <div className="reportErr">Prezzo non valido o errore di invio</div>}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="disclaimer">
                    Dati ufficiali MISE. Le segnalazioni utente non sostituiscono il prezzo ufficiale.
                  </div>
                </div>
              </Popup>
            )}
          </Map>
        </div>
      </main>
    </div>
  );
}
