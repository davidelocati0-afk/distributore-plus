import { NextRequest, NextResponse } from 'next/server';
import { loadStations, haversineMeters } from '@/lib/mise';
import { FuelType, matchesFuel } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = parseFloat(sp.get('lat') || '');
  const lon = parseFloat(sp.get('lon') || '');
  const radiusKm = parseFloat(sp.get('radiusKm') || '10');
  const fuel = (sp.get('fuel') || 'benzina') as FuelType;
  const limit = parseInt(sp.get('limit') || '50', 10);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'lat/lon required' }, { status: 400 });
  }

  try {
    const all = await loadStations();
    const radiusM = radiusKm * 1000;
    const CLOSE_RADIUS = 5000; // within 5km -> sort by price, beyond -> by distance
    const enriched = all
      .map((s) => {
        const distanceMeters = haversineMeters(lat, lon, s.lat, s.lon);
        if (distanceMeters > radiusM) return null;
        const matching = s.prices
          .filter((p) => matchesFuel(p.fuelDescription, fuel))
          .sort((a, b) => (a.isSelf === b.isSelf ? a.price - b.price : a.isSelf ? -1 : 1));
        const best = matching[0];
        return {
          ...s,
          distanceMeters,
          bestPrice: best ? best.price : null,
          bestPriceIsSelf: best ? best.isSelf : null,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    // Hybrid sort:
    //  - stations within 5 km sorted by price ascending (cheapest first, null prices last)
    //  - stations beyond 5 km sorted by distance ascending
    //  - the "close" group comes before the "far" group
    const close = enriched
      .filter((s) => s.distanceMeters <= CLOSE_RADIUS)
      .sort((a, b) => {
        const pa = a.bestPrice ?? Number.POSITIVE_INFINITY;
        const pb = b.bestPrice ?? Number.POSITIVE_INFINITY;
        if (pa !== pb) return pa - pb;
        return a.distanceMeters - b.distanceMeters;
      });
    const far = enriched
      .filter((s) => s.distanceMeters > CLOSE_RADIUS)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    const sorted = [...close, ...far].slice(0, limit);

    return NextResponse.json({ stations: sorted, total: sorted.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
