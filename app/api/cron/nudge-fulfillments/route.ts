import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { nudgePlan } from '@/lib/fulfillment-aging'
import { OPEN_FULFILLMENT_STATUSES } from '@/lib/fulfillment-status'
import { createInAppNotification, sendFulfillmentNudgeEmail } from '@/lib/notify'
import { SUPPORT_EMAIL } from '@/lib/site-config'
import { env } from '@/lib/env'
import crypto from 'crypto'
import * as Sentry from '@sentry/nextjs'
import type { CronJobResult } from '@/lib/cron/authorize'
import { writeAudit } from '@/lib/audit'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const token = authHeader.split(' ')[1]
  const expectedToken = env.CRON_SECRET

  try {
    if (
      !expectedToken ||
      token.length !== expectedToken.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runNudgeFulfillments()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}

/**
 * The job itself, callable without an HTTP request so the consolidated daily-maintenance
 * dispatcher can run it too. Vercel Hobby honours only 2 cron entries, and this job is
 * one of the three sharing the second slot. Behaviour is unchanged from when this was
 * inline in GET.
 */
export async function runNudgeFulfillments(): Promise<CronJobResult> {
  const supabase = createAdminClient()
  const now = new Date()

  // Select open fulfillments with counterparty contact data
  const { data: fulfillments, error } = await supabase
    .from('funding_fulfillments')
    .select(`
      id, status, amount_cents, sponsor_id, team_id, last_nudged_at,
      pledged_at, agreement_signed_at, payment_sent_at, payment_received_at, receipted_at, cancelled_at,
      teams:team_id(team_name, ftc_team_number, owner_id, profiles:owner_id(email, full_name)),
      sponsors:sponsor_id(company_name, contact_email, contact_name)
    `)
    .in('status', [...OPEN_FULFILLMENT_STATUSES])

  if (error || !fulfillments) {
    return { ok: false, error: error?.message || 'Failed to fetch fulfillments' }
  }

  let scanned = 0
  let nudged_sponsor = 0
  let nudged_coach = 0
  let escalated_admin = 0
  let failed = 0

  for (const f of fulfillments) {
    scanned++
    const plan = nudgePlan(f as any, now)
    if (!plan.target) continue

    const team = (f.teams as any) || {}
    const sponsor = (f.sponsors as any) || {}
    const teamName = team.team_name || 'Team'
    const ftcTeamNumber = team.ftc_team_number ?? null
    const sponsorName = sponsor.company_name || 'Sponsor'
    const coachProfile = team.profiles || {}
    const coachEmail = coachProfile.email
    const sponsorEmail = sponsor.contact_email

    let rowSentSuccess = false

    try {
      if (plan.target === 'sponsor') {
        const { data: sponsorProfiles } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .eq('role', 'sponsor')
          .eq('sponsor_id', f.sponsor_id)

        for (const s of sponsorProfiles || []) {
          if (s.email) {
            const emailRes = await sendFulfillmentNudgeEmail({
              fulfillmentId: f.id,
              to: s.email,
              replyTo: coachEmail || SUPPORT_EMAIL,
              recipientName: s.full_name || 'Sponsor',
              audience: 'sponsor',
              sponsorName,
              teamName,
              ftcTeamNumber,
              amountCents: f.amount_cents,
              status: f.status as any,
              daysOpen: plan.ageDays,
            })
            if (emailRes.success) rowSentSuccess = true
          }

          const inAppRes = await createInAppNotification({
            recipientId: s.id,
            type: 'general',
            title: `Payment reminder for ${teamName}`,
            body: `Fulfillment of $${(f.amount_cents / 100).toLocaleString()} for ${teamName} requires attention.`,
            skipEmail: true,
          })
          if (inAppRes.success) rowSentSuccess = true
        }

        if (rowSentSuccess) nudged_sponsor++
      } else if (plan.target === 'coach') {
        const coachOwnerId = team.owner_id
        if (coachOwnerId) {
          if (coachEmail) {
            const emailRes = await sendFulfillmentNudgeEmail({
              fulfillmentId: f.id,
              to: coachEmail,
              replyTo: sponsorEmail || SUPPORT_EMAIL,
              recipientName: coachProfile.full_name || 'Coach',
              audience: 'coach',
              sponsorName,
              teamName,
              ftcTeamNumber,
              amountCents: f.amount_cents,
              status: f.status as any,
              daysOpen: plan.ageDays,
            })
            if (emailRes.success) rowSentSuccess = true
          }

          const inAppRes = await createInAppNotification({
            recipientId: coachOwnerId,
            type: 'general',
            title: `Payment confirmation needed for ${sponsorName}`,
            body: `${sponsorName} marked a payment as sent. Please confirm receipt when it lands.`,
            skipEmail: true,
          })
          if (inAppRes.success) rowSentSuccess = true
        }

        if (rowSentSuccess) nudged_coach++
      } else if (plan.target === 'admin') {
        const { data: admins } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .eq('role', 'admin')

        for (const admin of admins || []) {
          if (admin.email) {
            const emailRes = await sendFulfillmentNudgeEmail({
              fulfillmentId: f.id,
              to: admin.email,
              replyTo: SUPPORT_EMAIL,
              recipientName: admin.full_name || 'Admin',
              audience: 'admin',
              sponsorName,
              teamName,
              ftcTeamNumber,
              amountCents: f.amount_cents,
              status: f.status as any,
              daysOpen: plan.ageDays,
            })
            if (emailRes.success) rowSentSuccess = true
          }

          const inAppRes = await createInAppNotification({
            recipientId: admin.id,
            type: 'general',
            title: `Fulfillment escalation: ${sponsorName} → ${teamName}`,
            body: `Fulfillment open for ${plan.ageDays} days requiring human intervention.`,
            skipEmail: true,
          })
          if (inAppRes.success) rowSentSuccess = true
        }

        if (rowSentSuccess) escalated_admin++
      }

      if (rowSentSuccess) {
        await supabase
          .from('funding_fulfillments')
          .update({ last_nudged_at: now.toISOString() })
          .eq('id', f.id)
      } else {
        failed++
      }
    } catch (err) {
      Sentry.captureException(err, { extra: { fulfillmentId: f.id } })
      failed++
    }
  }

  // Durable single audit log row for the cron sweep
  await writeAudit(supabase, {
    action: 'cron_nudge_fulfillments',
    entity_type: 'funding_fulfillments',
    entity_id: null,
    metadata: {
      scanned,
      nudged_sponsor,
      nudged_coach,
      escalated_admin,
      failed,
    },
  })

  return { ok: true, scanned, nudged_sponsor, nudged_coach, escalated_admin, failed }
}

