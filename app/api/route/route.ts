import { NextRequest, NextResponse } from 'next/server';
import { loadStations, haversineMeters } from '@/lib/mise';
import { FuelType, matchesFuel } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST body: { origin: {lat,lon}, destination: {lat,lon}, fuel, corridorKm }
 * Returns: { polyline: GeoJSON LineString, distance, duration, stations: [] }
 *
 * Strategy:
 *  1. Call Mapbox Directions API driving profile for origin→destination
 *  2. Get the polyline (array of [lon,lat] coordinates)
 *  3. For each station, compute the minimum distance to the polyline
 *  4. Keep stations within corridorKm (default 2km) of the route
 *  5. Sort by price (cheapest fuel first) as makes sense along a trip
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { origin, destination, fuel = 'benzina', corridorKm = 2 } = body as {
      origin: { lat: number; lon: number };
      destination: { lat: number; lon: number };
      fuel: FuelType;
      corridorKm?: number;
    };
    if (!origin || !destination) {
      return NextResponse.json({ error: 'origin and destination required' }, { status: 400 });
    }

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return NextResponse.json({ error: 'no mapbox token' }, { status: 500 });

    // 1. Directions API
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?geometries=geojson&overview=full&access_token=${token}`;
    const dirRes = await fetch(url);
    const dirData = await dirRes.json();
    const route = dirData?.routes?.[0];
    if (!route) {
      return NextResponse.json({ error: 'no route found' }, { status: 404 });
    }
    const polyline: [number, number][] = route.geometry.coordinates; // [lon, lat][]

    // 2. Build bounding box of the route (plus corridor padding) for fast pre-filter
    const corridorM = corridorKm * 1000;
    const padDeg = corridorKm / 111 + 0.02;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [lon, lat] of polyline) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    minLat -= padDeg; maxLat += padDeg; minLon -= padDeg; maxLon += padDeg;

    // 3. Build a sparse index of the polyline: sample every ~500m to make the
    //    "min distance to polyline" calculation O(polylineSamples) per station
    //    instead of O(polylinePoints). At Italian highway speeds 500m is fine
    //    granularity for a 2km corridor filter.
    const samples: [number, number][] = [];
    let acc = 0;
    samples.push(polyline[0]);
    for (let i = 1; i < polyline.length; i++) {
      const [lon1, lat1] = polyline[i - 1];
      const [lon2, lat2] = polyline[i];
      const seg = haversineMeters(lat1, lon1, lat2, lon2);
      acc += seg;
      if (acc >= 500) {
        samples.push([lon2, lat2]);
        acc = 0;
      }
    }
    samples.push(polyline[polyline.length - 1]);

    // 4. Filter stations
    const all = await loadStations();
    const matches: any[] = [];
    for (const s of all) {
      if (s.lat < minLat || s.lat > maxLat || s.lon < minLon || s.lon > maxLon) continue;
      // Min distance to any sample
      let minDist = Infinity;
      for (const [lon, lat] of samples) {
        const d = haversineMeters(s.lat, s.lon, lat, lon);
        if (d < minDist) minDist = d;
        if (minDist < corridorM * 0.2) break; // early out
      }
      if (minDist > corridorM) continue;

      const priceMatches = s.prices
        .filter((p) => matchesFuel(p.fuelDescription, fuel))
        .sort((a, b) => (a.isSelf === b.isSelf ? a.price - b.price : a.isSelf ? -1 : 1));
      const best = priceMatches[0];
      matches.push({
        ...s,
        distanceMeters: minDist,
        bestPrice: best ? best.price : null,
        bestPriceIsSelf: best ? best.isSelf : null,
      });
    }

    // Sort by price ascending (route mode = cheapest fuel first)
    matches.sort((a, b) => {
      const pa = a.bestPrice ?? Number.POSITIVE_INFINITY;
      const pb = b.bestPrice ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return a.distanceMeters - b.distanceMeters;
    });

    return NextResponse.json({
      polyline: route.geometry,
      distance: route.distance, // meters
      duration: route.duration, // seconds
      bbox: [minLon + padDeg, minLat + padDeg, maxLon - padDeg, maxLat - padDeg],
      stations: matches.slice(0, 150),
      total: matches.length,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
