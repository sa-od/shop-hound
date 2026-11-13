import { NextResponse } from 'next/server';
import { getStatus } from '@/lib/server/status';

/** GET /api/status — active run, last finished run (with its error, if it failed), latest brief. */
export async function GET() {
  try {
    return NextResponse.json(await getStatus(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[/api/status] error:', err);
    return NextResponse.json({ error: 'Failed to load status' }, { status: 500 });
  }
}
