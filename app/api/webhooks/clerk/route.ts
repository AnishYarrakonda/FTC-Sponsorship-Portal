import { NextResponse, type NextRequest } from 'next/server'
import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'
import * as Sentry from '@sentry/nextjs'

// Clerk webhooks are Svix-signed and authenticate themselves; this route is
// allowlisted in the root middleware (`/api/webhooks(.*)`) so it is reachable
// without a session. Profile *creation* is owned by the signup server actions
// (createCoachProfile / createSponsorApplication), so user.created is a no-op
// here. This handler keeps `profiles` in sync on deletion and email changes.

export async function POST(req: NextRequest) {
  let evt
  try {
    // verifyWebhook falls back to CLERK_WEBHOOK_SIGNING_SECRET when no signing
    // secret is passed; we pass it explicitly so a missing var fails loudly.
    evt = await verifyWebhook(req, { signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET })
  } catch (err) {
    console.error('[clerk-webhook] signature verification failed', err)
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createAdminClient()

  try {
    switch (evt.type) {
      case 'user.created':
        // Profile creation is owned by the signup actions — ignore (no-op 200).
        return NextResponse.json({ success: true, skipped: 'user.created' })

      case 'user.deleted': {
        const clerkUserId = evt.data.id
        if (!clerkUserId) break
        const { error } = await supabase
          .from('profiles')
          .delete()
          .eq('clerk_user_id', clerkUserId)
        if (error) {
          console.error('[clerk-webhook] failed to delete profile', error)
          Sentry.captureException(error)
          // P0-12: this used to fall through to the {success:true} below. Svix treats
          // any 2xx as delivered and NEVER retries, so a transient DB failure left the
          // Clerk identity deleted and the profile, team, submissions and personal data
          // orphaned — unreachable by any UI, because nothing can resolve a dead
          // clerk_user_id. Returning 500 makes Svix retry with backoff.
          return NextResponse.json({ error: 'profile delete failed' }, { status: 500 })
        }
        break
      }

      case 'user.updated': {
        const clerkUserId = evt.data.id
        const primaryId = evt.data.primary_email_address_id
        const primary = evt.data.email_addresses?.find((e) => e.id === primaryId)
        const email = primary?.email_address
        if (clerkUserId && email) {
          await syncProfileEmail(supabase, clerkUserId, email)
        }
        break
      }

      case 'email.created': {
        // Clerk delivers the destination address on the email event itself.
        const clerkUserId = evt.data.user_id
        const email = evt.data.to_email_address
        if (clerkUserId && email) {
          await syncProfileEmail(supabase, clerkUserId, email)
        }
        break
      }

      default:
        // Acknowledge unhandled events so Svix stops retrying.
        return NextResponse.json({ success: true, skipped: evt.type })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[clerk-webhook] processing error', error)
    Sentry.captureException(error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/** Update profiles.email for a Clerk user only when it actually changed. */
async function syncProfileEmail(
  supabase: ReturnType<typeof createAdminClient>,
  clerkUserId: string,
  email: string
) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()

  if (!profile || profile.email === email) return

  const { error } = await supabase
    .from('profiles')
    .update({ email } as never)
    .eq('clerk_user_id', clerkUserId)

  if (error) {
    console.error('[clerk-webhook] failed to sync profile email', error)
    Sentry.captureException(error)
  }
}
