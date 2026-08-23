import { resolveW9Status } from '@/lib/w9-status'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthedProfile } from '@/lib/actions-utils'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { UploadW9Client } from './upload-w9-client'

export default async function W9UploadPage() {
  const authed = await getAuthedProfile()
  if (!authed) redirect('/login')
  const profile = authed.user

  if (!profile.coach_verified) redirect('/awaiting-verification')

  const supabase = await createClient()

  // Find team
  const { data: team } = await (supabase as any)
    .from('teams')
    .select('id')
    .eq('owner_id', profile.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (!team) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-4">
        <h1 className="text-2xl font-bold mb-4">No Team Found</h1>
        <p className="text-muted-foreground">You must create a team first.</p>
      </div>
    )
  }

  // Check if payout profile exists
  const { data: payoutProfile } = await supabase
    .from('team_payout_profiles')
    .select('legal_payee_name, w9_document_path, w9_verified_at, w9_rejected_reason')
    .eq('team_id', team.id)
    .single()

  if (!payoutProfile || !payoutProfile.legal_payee_name) {
    redirect('/team/payout')
  }

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Upload W-9</CardTitle>
          <CardDescription>
            Upload a signed W-9 for <strong>{payoutProfile.legal_payee_name}</strong>.
            Sponsors will not release funds without a verified W-9 on file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* B-03-13. `isVerified` used to be `!!w9_verified_at`, which is true even after
              the retention job destroys the document — so this page told a coach who had
              just been sent here by a "W-9 Missing" banner that there was nothing to do,
              and removed the file input. The shared resolver distinguishes 'verified'
              (document on file, nothing to do) from 'verified_purged' (verified, document
              deleted under our retention policy, upload control must stay). */}
          <UploadW9Client
            teamId={team.id}
            hasExistingW9={!!payoutProfile.w9_document_path}
            isVerified={resolveW9Status(payoutProfile) === 'verified'}
            isVerifiedPurged={resolveW9Status(payoutProfile) === 'verified_purged'}
            rejectedReason={payoutProfile.w9_rejected_reason}
          />
        </CardContent>
      </Card>
    </div>
  )
}
