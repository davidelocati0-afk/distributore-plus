import { FuelStation, FuelPrice } from './types';
import { getSupabase } from './supabase';

const ANAGRAFICA_URL = 'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv';
const PREZZI_URL = 'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv';

const TTL_MS = 60 * 60 * 1000; // 1h TTL — allows mid-day MISE regenerations to be picked up

// In-process memory cache: avoids hitting Supabase on every request within the same
// serverless function instance. Supabase is the persistent layer across cold starts.
let memory: { stations: FuelStation[]; fetchedAt: number } | null = null;
let inflight: Promise<FuelStation[]> | null = null;

export async function loadStations(): Promise<FuelStation[]> {
  const now = Date.now();
  if (memory && now - memory.fetchedAt < TTL_MS) return memory.stations;
  if (inflight) return inflight;

  inflight = (async () => {
    // 1. Try persistent cache from Supabase
    try {
      const sb = getSupabase();
      const { data } = await sb
        .from('mise_cache')
        .select('stations, fetched_at')
        .eq('id', 1)
        .maybeSingle();
      if (data && data.fetched_at) {
        const age = now - new Date(data.fetched_at).getTime();
        if (age < TTL_MS) {
          memory = { stations: data.stations as FuelStation[], fetchedAt: now - age };
          inflight = null;
          return memory.stations;
        }
      }
    } catch (e) {
      console.warn('Supabase cache read failed, falling back to live fetch:', (e as Error).message);
    }

    // 2. Fetch fresh from MISE with retry
    const fetchWithRetry = async (url: string, attempts = 3): Promise<ArrayBuffer> => {
      let lastErr: unknown;
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await fetch(url, {
            cache: 'no-store',
            signal: AbortSignal.timeout(120_000),
            headers: { 'User-Agent': 'DistributorePlus/1.0' },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.arrayBuffer();
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
      }
      throw lastErr;
    };
    const [anaBuf, priceBuf] = await Promise.all([
      fetchWithRetry(ANAGRAFICA_URL),
      fetchWithRetry(PREZZI_URL),
    ]);
    const decoder = new TextDecoder('iso-8859-1');
    const stations = parseCSV(decoder.decode(anaBuf), decoder.decode(priceBuf));

    // 3. Persist back to Supabase (fire and forget — don't block the response)
    try {
      const sb = getSupabase();
      await sb.from('mise_cache').upsert({ id: 1, stations, fetched_at: new Date().toISOString() });
    } catch (e) {
      console.warn('Supabase cache write failed:', (e as Error).message);
    }

    memory = { stations, fetchedAt: now };
    inflight = null;
    return stations;
  })();
  return inflight;
}

function parseCSV(anagraficaCSV: string, prezziCSV: string): FuelStation[] {
  const pricesById = new Map<number, FuelPrice[]>();
  const priceLines = prezziCSV.split(/\r?\n/).slice(2);
  for (const line of priceLines) {
    if (!line) continue;
    const cols = line.split('|');
    if (cols.length < 5) continue;
    const id = parseInt(cols[0], 10);
    const price = parseFloat(cols[2].replace(',', '.'));
    if (!Number.isFinite(id) || !Number.isFinite(price)) continue;
    const arr = pricesById.get(id) || [];
    arr.push({
      fuelDescription: cols[1],
      price,
      isSelf: cols[3] === '1',
      updatedAt: cols[4],
    });
    pricesById.set(id, arr);
  }

  const stations: FuelStation[] = [];
  const anaLines = anagraficaCSV.split(/\r?\n/).slice(2);
  for (const line of anaLines) {
    if (!line) continue;
    const cols = line.split('|');
    if (cols.length < 10) continue;
    const id = parseInt(cols[0], 10);
    const lat = parseFloat(cols[8].replace(',', '.'));
    const lon = parseFloat(cols[9].replace(',', '.'));
    if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat === 0 || lon === 0) continue;
    if (Math.abs(lat - 45.4642035) < 1e-6 && Math.abs(lon - 9.189982) < 1e-6) continue;
    if (lat < 35 || lat > 48 || lon < 6 || lon > 19) continue;
    const prices = pricesById.get(id);
    if (!prices || prices.length === 0) continue;
    stations.push({
      id,
      manager: cols[1],
      flag: cols[2],
      type: cols[3],
      name: cols[4],
      address: cols[5],
      city: cols[6],
      province: cols[7],
      lat,
      lon,
      prices,
    });
  }
  return stations;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
