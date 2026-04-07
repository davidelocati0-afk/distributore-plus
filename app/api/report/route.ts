import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/report — append a user price report to Supabase.
 * The official MISE price is NEVER overwritten.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      stationId, stationName, fuelDescription, isSelf,
      reportedPrice, officialPrice, note,
    } = body;

    if (typeof stationId !== 'number'
        || typeof fuelDescription !== 'string'
        || typeof reportedPrice !== 'number'
        || reportedPrice <= 0
        || reportedPrice > 10) {
      return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
    }

    const sb = getSupabase();
    const { data, error } = await sb
      .from('price_reports')
      .insert({
        station_id: stationId,
        station_name: String(stationName || ''),
        fuel_description: fuelDescription,
        is_self: Boolean(isSelf),
        reported_price: reportedPrice,
        official_price: typeof officialPrice === 'number' ? officialPrice : null,
        note: typeof note === 'string' ? note.slice(0, 280) : null,
        user_agent: req.headers.get('user-agent') || null,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0] || null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({ error: 'db error' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: data.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** GET /api/report — admin only (requires ADMIN_TOKEN env var match). */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sb = getSupabase();
  const { data, error } = await sb
    .from('price_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ total: data.length, reports: data });
}
