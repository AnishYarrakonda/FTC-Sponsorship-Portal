import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createInAppNotification } from '@/lib/notify'
import { Webhook } from 'svix'
import { env } from '@/lib/env'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

const resendWebhookSchema = z.object({
  type: z.string(),
  data: z.object({
    email_id: z.string(),
    tags: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  }),
})

const EVENT_STATUS_MAP: Record<string, string> = {
  'email.bounced': 'bounced',
  'email.delivered': 'delivered',
  'email.opened': 'opened',
}

/**
 * A spam complaint is handled but deliberately has NO entry in EVENT_STATUS_MAP.
 *
 * The recipient DID receive the message — overwriting `delivered` would be a lie — and
 * routing it through `release_submission_reservation` (what email.bounced does) would turn
 * the "Report spam" button into a capacity-release primitive any recipient could pull.
 * So: audit row + admin alert, status and `sponsors.funding_used_cents` untouched.
 *
 * `email.delivery_delayed` is NOT handled, on purpose. It is a soft bounce (full mailbox,
 * transient 4xx); Resend retries and emits `email.bounced` if delivery ultimately fails.
 * Acting on a delay would release a sponsor's capacity because a mailbox was briefly full.
 * Do not "fix" this by adding it to either list.
 */
const COMPLAINT_EVENT = 'email.complained'

/**
 * Alert every admin that a recipient marked one of our emails as spam.
 *
 * `skipEmail` stays at its default `false`: an admin needs to hear about this out of band,
 * and emailing about a deliverability problem is fine here because the admin mailbox is not
 * the one that complained. Resend has already auto-suppressed the complaining address at the
 * account level — see docs/email-deliverability.md §7 before removing anything from it.
 */
async function notifyAdminsOfComplaint(
  supabase: ReturnType<typeof createAdminClient>,
  submissionId: string | null,
  resendEmailId: string
): Promise<void> {
  // Context for the alert body. A failure here must not cost us the alert itself, so
  // everything below degrades to a bare description.
  let context = submissionId
    ? `submission ${submissionId}`
    : 'an email that could not be matched to a submission (a notification, welcome, receipt or nudge)'
  if (submissionId) {
    try {
      const { data: submission } = await supabase
        .from('submissions')
        .select('id, teams:team_id(team_name), sponsors:sponsor_id(company_name)')
        .eq('id', submissionId)
        .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sponsorName = (submission as any)?.sponsors?.company_name as string | undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const teamName = (submission as any)?.teams?.team_name as string | undefined
      if (sponsorName || teamName) {
        context = `the pitch from ${teamName ?? 'a team'} to ${sponsorName ?? 'a sponsor'}`
      }
    } catch (err) {
      Sentry.captureException(
        err instanceof Error ? err : new Error('[resend-webhook] complaint context lookup failed')
      )
    }
  }

  const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
  if (!admins || admins.length === 0) {
    const err = new Error(`[resend-webhook] spam complaint on ${submissionId} but no admin profiles to notify`)
    console.error(err.message)
    Sentry.captureException(err)
    return
  }

  await Promise.all(
    admins.map((admin) =>
      createInAppNotification({
        recipientId: admin.id,
        type: 'general',
        title: 'Spam complaint on a sent email',
        body:
          `A recipient marked ${context} as spam. Resend has suppressed that address ` +
          `automatically, so they will receive nothing further until it is removed by hand.\n\n` +
          `${submissionId ? "The submission's status and the sponsor's reserved capacity are unchanged.\n\n" : ''}` +
          `Contact the recipient out of band — do not re-send. Three complaints in a month is a ` +
          `problem with the outreach itself, not with DNS. See docs/email-deliverability.md.\n\n` +
          `Resend email id: ${resendEmailId}`,
        ...(submissionId ? { submissionId } : {}),
      })
    )
  )
}

export async function POST(req: Request) {
  try {
    const payload = await req.text()
    const svixHeaders = {
      'svix-id': req.headers.get('svix-id') || '',
      'svix-timestamp': req.headers.get('svix-timestamp') || '',
      'svix-signature': req.headers.get('svix-signature') || '',
    }

    if (!env.RESEND_WEBHOOK_SECRET) {
      if (process.env.NODE_ENV !== 'development') {
        const err = new Error('RESEND_WEBHOOK_SECRET is not configured')
        console.error(err.message)
        Sentry.captureException(err)
        return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
      }
      console.warn('[resend-webhook] RESEND_WEBHOOK_SECRET unset — skipping signature check (dev only)')
    } else {
      try {
        const webhook = new Webhook(env.RESEND_WEBHOOK_SECRET)
        webhook.verify(payload, svixHeaders)
      } catch (err) {
        console.error('Webhook signature verification failed', err)
        Sentry.captureException(err)
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
      }
    }

    const json = JSON.parse(payload)
    const result = resendWebhookSchema.safeParse(json)

    if (!result.success) {
      return NextResponse.json({ error: 'Invalid payload format' }, { status: 400 })
    }

    const { type, data } = result.data
    const newStatus = EVENT_STATUS_MAP[type]
    const isComplaint = type === COMPLAINT_EVENT

    // Only process events we care about. NEVER fail closed on an unrecognised type: a
    // non-200 makes svix retry it forever.
    if (!newStatus && !isComplaint) {
      return NextResponse.json({ success: true, skipped: true })
    }

    const supabase = createAdminClient()

    // Primary lookup: resend_message_id stored at dispatch time
    let submissionId: string | null = null
    const { data: byMessageId } = await supabase
      .from('submissions')
      .select('id')
      .eq('resend_message_id', data.email_id)
      .maybeSingle()

    submissionId = byMessageId?.id ?? null

    // Fallback: use submission_id tag injected by dispatch.ts
    if (!submissionId && data.tags) {
      const tag = data.tags.find((t) => t.name === 'submission_id')
      if (tag?.value) submissionId = tag.value
    }

    if (!submissionId) {
      if (isComplaint) {
        // A complaint on ANY of our mail is the same reputation event, and most of what we
        // send (notifications, welcome, receipts, nudges) carries no submission_id tag and
        // never stores a resend_message_id — so without this branch the majority of
        // complaints would be dropped, which is the exact failure this slice exists to fix.
        // Logged with no entity; deduped on (action, null entity, resend_email_id).
        const { data: alreadyLogged } = await supabase
          .from('audit_log')
          .select('id')
          .eq('action', `resend_webhook_${type}`)
          .is('entity_id', null)
          .contains('metadata', { resend_email_id: data.email_id })
          .maybeSingle()

        if (alreadyLogged) {
          return NextResponse.json({ success: true, duplicate: true })
        }

        await supabase.from('audit_log').insert({
          actor_id: null,
          action: `resend_webhook_${type}`,
          entity_type: 'emails',
          entity_id: null,
          metadata: { resend_email_id: data.email_id, webhook_type: type, new_status: null },
        })
        await notifyAdminsOfComplaint(supabase, null, data.email_id)
        return NextResponse.json({ success: true, matched: false, complained: true })
      }

      console.warn('[resend-webhook] No submission found for email_id', data.email_id)
      return NextResponse.json({ success: true, matched: false })
    }

    // Idempotency: svix retries deliver the same (email_id, type) repeatedly. If we have
    // already recorded this exact event, skip — never double-process or append dup audit rows.
    const { data: alreadyProcessed } = await supabase
      .from('audit_log')
      .select('id')
      .eq('action', `resend_webhook_${type}`)
      .eq('entity_id', submissionId)
      .contains('metadata', { resend_email_id: data.email_id })
      .maybeSingle()

    if (alreadyProcessed) {
      return NextResponse.json({ success: true, duplicate: true })
    }

    if (isComplaint) {
      // Intentionally no status write and no RPC — see COMPLAINT_EVENT above. The audit
      // row + admin fan-out below is the whole behaviour.
    } else if (type === 'email.bounced') {
      // A bounce releases the reservation back to the sponsor's cap — but the RPC is
      // guarded to live states only, so it can NEVER revert a funded ('approved') deal. (C-1)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc('release_submission_reservation', {
        p_submission_id: submissionId,
        p_new_status: 'bounced',
        p_reason: 'email_bounced',
      })
    } else {
      // delivered / opened are tracking-only; guard so a late event never overwrites a
      // terminal state (approved / declined / expired / bounced / changes_requested).
      await supabase
        .from('submissions')
        .update({ status: newStatus as never })
        .eq('id', submissionId)
        .in('status', ['dispatched', 'delivered', 'opened'])
    }

    await supabase.from('audit_log').insert({
      actor_id: null,
      action: `resend_webhook_${type}`,
      entity_type: 'submissions',
      entity_id: submissionId,
      metadata: { resend_email_id: data.email_id, webhook_type: type, new_status: newStatus ?? null },
    })

    if (isComplaint) {
      // Fan out AFTER the audit insert on purpose: that row is what the idempotency check
      // above reads, so a svix retry is deduped and admins are not re-alerted. A partial
      // fan-out failure is reported to Sentry inside createInAppNotification rather than
      // re-notifying everyone on the retry.
      await notifyAdminsOfComplaint(supabase, submissionId, data.email_id)
      return NextResponse.json({ success: true, matched: true, complained: true })
    }

    return NextResponse.json({ success: true, matched: true, status: newStatus })
  } catch (error) {
    console.error('Webhook processing error', error)
    Sentry.captureException(error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
