import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Geocode an address using Mapbox Geocoding API (uses the public token).
 * Restricted to Italy for relevance.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 });

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return NextResponse.json({ error: 'no mapbox token' }, { status: 500 });

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=it&limit=5&language=it&access_token=${token}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const results = (data.features || []).map((f: any) => ({
      placeName: f.place_name,
      lon: f.center[0],
      lat: f.center[1],
    }));
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
