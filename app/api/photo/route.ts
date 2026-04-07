import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/photo — returns { url: string | null } for a fuel station photo.
 * Cached persistently in Supabase so we don't re-hit Places API across requests/deploys.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const idStr = sp.get('id');
  const name = sp.get('name') || '';
  const address = sp.get('address') || '';
  const city = sp.get('city') || '';
  const lat = parseFloat(sp.get('lat') || '');
  const lon = parseFloat(sp.get('lon') || '');

  if (!idStr) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const stationId = parseInt(idStr, 10);
  if (!Number.isFinite(stationId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  // 1. Check cache
  try {
    const sb = getSupabase();
    const { data } = await sb
      .from('photo_cache')
      .select('photo_url')
      .eq('station_id', stationId)
      .maybeSingle();
    if (data) return NextResponse.json({ url: data.photo_url });
  } catch (e) {
    console.warn('Photo cache read failed:', (e as Error).message);
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return NextResponse.json({ url: null, error: 'no google key' });

  // 2. Fetch from Google Places
  let photoUrl: string | null = null;
  try {
    const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.photos',
      },
      body: JSON.stringify({
        textQuery: `${name} ${address} ${city}`.trim() || `distributore ${city}`,
        locationBias: Number.isFinite(lat) && Number.isFinite(lon) ? {
          circle: { center: { latitude: lat, longitude: lon }, radius: 300 },
        } : undefined,
        maxResultCount: 1,
        includedType: 'gas_station',
      }),
    });
    if (searchRes.ok) {
      const data = await searchRes.json();
      const photoName = data?.places?.[0]?.photos?.[0]?.name;
      if (photoName) {
        photoUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=600&key=${apiKey}`;
      }
    } else {
      console.warn('Places search failed', searchRes.status, await searchRes.text());
    }
  } catch (e) {
    console.error('Places fetch error:', e);
  }

  // 3. Persist (even nulls, so we don't retry repeatedly for stations without photos)
  try {
    const sb = getSupabase();
    await sb.from('photo_cache').upsert({
      station_id: stationId,
      photo_url: photoUrl,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('Photo cache write failed:', (e as Error).message);
  }

  return NextResponse.json({ url: photoUrl });
}
