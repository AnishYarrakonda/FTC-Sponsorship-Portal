import { getAuthedProfile } from '@/lib/actions-utils'
import { NextResponse } from 'next/server'

export async function GET() {
  const authed = await getAuthedProfile()
  if (!authed) return NextResponse.json({ count: 0 }, { status: 401 })
  const { supabase, user } = authed

  if (user.role !== 'admin') {
    return NextResponse.json({ count: 0 }, { status: 403 })
  }

  const [submissionsResult, messagesResult, appealsResult] = await Promise.all([
    supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase
      .from('submission_messages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .eq('author_role', 'coach'),
    supabase
      .from('appeals')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'under_review']),
  ])

  if (submissionsResult.error) {
    return NextResponse.json({ count: 0, error: submissionsResult.error.message }, { status: 500 })
  }

  const submissions = submissionsResult.count ?? 0
  // A failed secondary count must not zero out the badge — the pitch queue is the oldest and
  // most important part of it. Degrade to what we have rather than 500ing the sidebar.
  const messages = messagesResult.error ? 0 : (messagesResult.count ?? 0)
  const appeals = appealsResult.error ? 0 : (appealsResult.count ?? 0)

  // `count` stays the SUM so components/admin/admin-sidebar.tsx (which reads data.count)
  // needs no change and the badge reflects total outstanding work. The breakdown is
  // alongside it so a caller can split the three without another round trip.
  return NextResponse.json({
    count: submissions + messages + appeals,
    submissions,
    messages,
    appeals,
  })
}
