import { getAuthedProfile } from '@/lib/actions-utils'
import { NextResponse } from 'next/server'

export async function GET() {
  const authed = await getAuthedProfile()

  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { supabase, user } = authed

  if (user.role !== 'coach') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .is('read_at', null)

  if (error) {
    // Never leak raw Postgres error messages to the client.
    return NextResponse.json({ error: 'Failed to load unread count' }, { status: 500 })
  }

  return NextResponse.json(
    { count: count ?? 0 },
    {
      headers: {
        'Cache-Control': 'private, max-age=15, stale-while-revalidate=30',
      },
    }
  )
}
