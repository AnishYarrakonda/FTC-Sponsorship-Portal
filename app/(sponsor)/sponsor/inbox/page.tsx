import { getAuthedProfile } from '@/lib/actions-utils'
import { redirect } from 'next/navigation'
import { SponsorInboxWrapper } from '@/components/sponsor/inbox-wrapper'

const INBOX_PAGE_SIZE = 200

export default async function SponsorInboxPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const { supabase, user } = authed

  // Bounded to the most recent page. `notifications` only ever grows — a sponsor who
  // has been on the platform for two seasons would otherwise have every notification
  // they have ever received re-fetched and re-rendered on each visit to this page.
  // The sponsor dashboard already caps its feed at 20; this is the same idea, wider.
  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(INBOX_PAGE_SIZE)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-muted-foreground mt-1">Notifications and communications from teams.</p>
      </div>

      <SponsorInboxWrapper notifications={(notifications as any) || []} />
    </div>
  )
}
