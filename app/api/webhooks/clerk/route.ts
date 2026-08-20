import { NextResponse, type NextRequest } from 'next/server'
import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { createAdminClient } from '@/lib/supabase/admin'
import { purgeUserStorage } from '@/lib/credentials-retention'
import { createInAppNotification } from '@/lib/notify'
import { isSponsorRole, reconcileMemberRole } from '@/lib/sponsor-roles'
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

        // Storage BEFORE the row. Deleting the profile first orphans every file the
        // user uploaded — the objects are keyed by Clerk id, but nothing is left to
        // tell us the id ever existed, so "delete my account" quietly kept their
        // photo ID on disk forever. Failing here returns 500 and Svix redelivers,
        // which is safe: prefix deletes are idempotent.
        const { removed, failedBuckets } = await purgeUserStorage(supabase, clerkUserId)
        if (failedBuckets.length > 0) {
          return NextResponse.json(
            { error: `storage purge failed: ${failedBuckets.join(', ')}` },
            { status: 500 }
          )
        }
        if (removed > 0) {
          console.log(`[clerk-webhook] purged ${removed} stored file(s) for ${clerkUserId}`)
        }

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

      // ── Sponsor Organizations (0082) — mirror Clerk Organization membership into
      // sponsor_members, and (prompt 10) just-in-time provision an enterprise-SSO user on
      // their first login. Error contract: a *database* failure returns 500 so Svix
      // redelivers, because a 200 on failure here is the same permanent, invisible data
      // loss the user.deleted comments describe. A structurally unfixable event (unknown
      // org, colliding email) returns 200 with an audit row and an admin alert instead —
      // retrying those forever only buries the signal.
      case 'organizationMembership.created': {
        const clerkUserId = evt.data.public_user_data.user_id
        const clerkOrgId = evt.data.organization.id
        const clerkMembershipId = evt.data.id
        const identifier = evt.data.public_user_data.identifier
        const emailDomain = identifier?.includes('@') ? identifier.split('@').pop()!.toLowerCase() : null

        // Sponsor FIRST (0083/prompt 10). Nothing below is safe without a sponsors row:
        // an unknown org must never mint a profile or a member row.
        const { data: sponsor } = await supabase
          .from('sponsors')
          .select('id, company_name')
          .eq('clerk_org_id', clerkOrgId)
          .maybeSingle()

        if (!sponsor) {
          // An org that exists in Clerk but maps to no sponsor — a personal org a user
          // created, or a stamp that never landed. 0082 returned 500 here to force a Svix
          // retry; with enterprise SSO in play an unmatched org is usually PERMANENT, so
          // the retry never succeeds and just buries the signal. Record it, alert admins,
          // and stop, rather than looping for hours. No orphan member is created.
          console.error('[clerk-webhook] organizationMembership.created: no sponsor for clerk_org_id', clerkOrgId)
          await supabase.from('audit_log').insert({
            actor_id: null,
            action: 'sponsor_member_sync_orphan_org',
            entity_type: 'sponsor_members',
            entity_id: null,
            metadata: { clerk_org_id: clerkOrgId, clerk_membership_id: clerkMembershipId, email_domain: emailDomain },
          })
          await notifyAdmins(
            supabase,
            'Unknown Clerk organization',
            `A membership was created in Clerk organization ${clerkOrgId}, which matches no sponsor company. No access was granted — check whether sponsors.clerk_org_id was ever stamped.`
          )
          return NextResponse.json({ success: true, skipped: 'no sponsor for clerk_org_id' })
        }

        let { data: profile } = await supabase
          .from('profiles')
          .select('id, role, sponsor_id')
          .eq('clerk_user_id', clerkUserId)
          .maybeSingle()

        if (!profile) {
          // JIT provisioning (prompt 10). An enterprise-SSO user never passes through the
          // signup actions that normally own profile creation — their first contact with
          // us IS this event — so without this branch they would land on
          // /complete-profile and be invited to apply as a *new* sponsor company, which
          // is exactly wrong. Safe because it is gated on a resolved sponsors row above:
          // Clerk only puts a user in that org via the org's own IdP or an invitation
          // from one of its admins. Legal acknowledgments stay FALSE — nobody accepted
          // anything on this person's behalf.
          if (!identifier) {
            return NextResponse.json({ success: true, skipped: 'no email identifier on membership event' })
          }
          // Account collision: Clerk normally LINKS an enterprise identity to an existing
          // user by verified email, so we would have found the profile above. Landing here
          // with the email already taken means Clerk minted a SECOND user (its
          // "Verify at sign-up" rule, on an unverified IdP email). Creating a second
          // profiles row for one human would break inviteSponsorMember's by-email lookup
          // and split their history — refuse and let an admin resolve it.
          const { data: emailTwin } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', identifier)
            .limit(1)
            .maybeSingle()

          if (emailTwin) {
            await supabase.from('audit_log').insert({
              actor_id: null,
              action: 'sso_jit_provision_conflict',
              entity_type: 'profiles',
              entity_id: emailTwin.id,
              metadata: { clerk_user_id: clerkUserId, clerk_org_id: clerkOrgId, email_domain: emailDomain },
            })
            await notifyAdmins(
              supabase,
              'SSO sign-in could not be linked',
              `${identifier} signed in through an identity provider but already has an account under a different Clerk user. No duplicate profile was created — resolve this manually.`
            )
            return NextResponse.json({ success: true, skipped: 'email already belongs to another profile' })
          }

          const fullName =
            [evt.data.public_user_data.first_name, evt.data.public_user_data.last_name]
              .filter(Boolean)
              .join(' ')
              .trim() || identifier
          // profiles.full_name is CHECK (char_length <= 200); an address longer than that
          // would fail the insert and start a retry loop over something unfixable.
          const safeName = fullName.slice(0, 200)

          const { data: created, error: createError } = await supabase
            .from('profiles')
            .insert({
              clerk_user_id: clerkUserId,
              email: identifier,
              full_name: safeName,
              role: 'sponsor',
              sponsor_id: sponsor.id,
            } as never)
            .select('id, role, sponsor_id')
            .single()

          if (createError || !created) {
            console.error('[clerk-webhook] organizationMembership.created JIT profile insert failed', createError)
            Sentry.captureException(createError ?? new Error('JIT profile insert returned no row'))
            return NextResponse.json({ error: 'jit profile insert failed' }, { status: 500 })
          }
          profile = created
        }

        if (profile.role !== 'sponsor') {
          await supabase.from('audit_log').insert({
            actor_id: null,
            action: 'sponsor_member_sync_rejected',
            entity_type: 'sponsor_members',
            entity_id: profile.id,
            metadata: { reason: 'profile role is not sponsor', role: profile.role, sponsor_id: sponsor.id },
          })
          await notifyAdmins(
            supabase,
            'Sponsor org invite rejected',
            `A ${profile.role} account accepted a sponsor organization invitation and was NOT added as a member — this needs investigation.`
          )
          return NextResponse.json({ success: true, skipped: 'profile role is not sponsor' })
        }

        const { data: otherMembership } = await supabase
          .from('sponsor_members')
          .select('sponsor_id')
          .eq('profile_id', profile.id)
          .neq('sponsor_id', sponsor.id)
          .maybeSingle()

        if ((profile.sponsor_id && profile.sponsor_id !== sponsor.id) || otherMembership) {
          await supabase.from('audit_log').insert({
            actor_id: null,
            action: 'sponsor_member_sync_rejected',
            entity_type: 'sponsor_members',
            entity_id: profile.id,
            metadata: {
              reason: 'already a member of a different sponsor organization',
              existing_sponsor_id: profile.sponsor_id ?? otherMembership?.sponsor_id,
              attempted_sponsor_id: sponsor.id,
            },
          })
          await notifyAdmins(
            supabase,
            'Sponsor org invite rejected',
            'A sponsor user already belonging to one organization accepted an invitation to a second — this needs investigation.'
          )
          return NextResponse.json({ success: true, skipped: 'already a member of a different organization' })
        }

        // Idempotency (prompt 10): SSO re-fires membership events, and an invitation this
        // org already mirrored locally has a row with the role its admin chose. Read that
        // row FIRST and reconcile — an upsert that hardcoded a role would silently demote
        // a returning approver to viewer on their next SSO login.
        const { data: existingMember } = await supabase
          .from('sponsor_members')
          .select('id, role, joined_at')
          .eq('sponsor_id', sponsor.id)
          .eq('profile_id', profile.id)
          .maybeSingle()

        const role = reconcileMemberRole(
          evt.data.role,
          isSponsorRole(existingMember?.role) ? existingMember.role : null
        )

        const { error: upsertError } = await supabase.from('sponsor_members').upsert(
          {
            sponsor_id: sponsor.id,
            profile_id: profile.id,
            clerk_org_id: clerkOrgId,
            clerk_membership_id: clerkMembershipId,
            role,
            joined_at: existingMember?.joined_at ?? new Date().toISOString(),
          },
          { onConflict: 'sponsor_id,profile_id' }
        )
        if (upsertError) {
          console.error('[clerk-webhook] organizationMembership.created upsert failed', upsertError)
          Sentry.captureException(upsertError)
          return NextResponse.json({ error: 'sponsor_members upsert failed' }, { status: 500 })
        }

        if (!existingMember) {
          // First membership row for this person in this org. Clerk's payload cannot tell
          // an enterprise-SSO first login apart from an invitation acceptance — both are
          // the same just-in-time path — so this one action covers both, with the domain
          // recorded so an SSO cohort is identifiable after the fact.
          await supabase.from('audit_log').insert({
            actor_id: null,
            action: 'sso_jit_provision',
            entity_type: 'sponsor_members',
            entity_id: profile.id,
            metadata: {
              sponsor_id: sponsor.id,
              clerk_org_id: clerkOrgId,
              clerk_membership_id: clerkMembershipId,
              clerk_role: evt.data.role,
              email_domain: emailDomain,
              role,
            },
          })
        }

        if (!profile.sponsor_id) {
          const { error: stampError } = await supabase
            .from('profiles')
            .update({ sponsor_id: sponsor.id } as never)
            .eq('id', profile.id)
          if (stampError) {
            console.error('[clerk-webhook] organizationMembership.created sponsor_id stamp failed', stampError)
            Sentry.captureException(stampError)
            return NextResponse.json({ error: 'profiles.sponsor_id stamp failed' }, { status: 500 })
          }
        }
        break
      }

      case 'organizationMembership.updated': {
        const clerkUserId = evt.data.public_user_data.user_id
        const clerkOrgId = evt.data.organization.id
        const clerkMembershipId = evt.data.id

        const { data: existing } = await supabase
          .from('sponsor_members')
          .select('id, role')
          .eq('clerk_membership_id', clerkMembershipId)
          .maybeSingle()

        if (existing) {
          const role = reconcileMemberRole(
            evt.data.role,
            isSponsorRole(existing.role) ? existing.role : null
          )
          if (role === existing.role) break // nothing Clerk told us changes the local rank
          const { error } = await supabase.from('sponsor_members').update({ role } as never).eq('id', existing.id)
          if (error) {
            console.error('[clerk-webhook] organizationMembership.updated failed', error)
            Sentry.captureException(error)
            return NextResponse.json({ error: 'sponsor_members update failed' }, { status: 500 })
          }
          break
        }

        // Missing row — Clerk is the source of truth for membership, so upsert rather
        // than drop the event (the .created event may have been skipped/rejected
        // earlier, or events arrived out of order).
        const [{ data: profile }, { data: sponsor }] = await Promise.all([
          supabase.from('profiles').select('id, role, sponsor_id').eq('clerk_user_id', clerkUserId).maybeSingle(),
          supabase.from('sponsors').select('id').eq('clerk_org_id', clerkOrgId).maybeSingle(),
        ])
        if (!profile || !sponsor || profile.role !== 'sponsor') {
          return NextResponse.json({ success: true, skipped: 'cannot upsert membership on update' })
        }
        // A pending invitation already carries the role its admin chose (clerk_membership_id
        // is NULL until acceptance, so the lookup above missed it) — reconcile, never clobber.
        const { data: pendingMember } = await supabase
          .from('sponsor_members')
          .select('role')
          .eq('sponsor_id', sponsor.id)
          .eq('profile_id', profile.id)
          .maybeSingle()
        const role = reconcileMemberRole(
          evt.data.role,
          isSponsorRole(pendingMember?.role) ? pendingMember.role : null
        )
        const { error: upsertError } = await supabase.from('sponsor_members').upsert(
          {
            sponsor_id: sponsor.id,
            profile_id: profile.id,
            clerk_org_id: clerkOrgId,
            clerk_membership_id: clerkMembershipId,
            role,
            joined_at: new Date().toISOString(),
          },
          { onConflict: 'sponsor_id,profile_id' }
        )
        if (upsertError) {
          console.error('[clerk-webhook] organizationMembership.updated upsert failed', upsertError)
          Sentry.captureException(upsertError)
          return NextResponse.json({ error: 'sponsor_members upsert failed' }, { status: 500 })
        }
        if (!profile.sponsor_id) {
          await supabase.from('profiles').update({ sponsor_id: sponsor.id } as never).eq('id', profile.id)
        }
        break
      }

      case 'organizationMembership.deleted': {
        const clerkMembershipId = evt.data.id

        const { data: existing } = await supabase
          .from('sponsor_members')
          .select('id, profile_id, sponsor_id')
          .eq('clerk_membership_id', clerkMembershipId)
          .maybeSingle()

        if (!existing) {
          return NextResponse.json({ success: true, skipped: 'no matching sponsor_members row' })
        }

        const { error: deleteError } = await supabase.from('sponsor_members').delete().eq('id', existing.id)
        if (deleteError) {
          console.error('[clerk-webhook] organizationMembership.deleted delete failed', deleteError)
          Sentry.captureException(deleteError)
          return NextResponse.json({ error: 'sponsor_members delete failed' }, { status: 500 })
        }

        // Offboarding: null profiles.sponsor_id ONLY when it pointed at this sponsor and
        // no other membership remains. Skipping this leaves a removed employee with full
        // portal access through the legacy branch of current_sponsor_ids().
        const { data: profile } = await supabase
          .from('profiles')
          .select('sponsor_id')
          .eq('id', existing.profile_id)
          .maybeSingle()

        if (profile?.sponsor_id === existing.sponsor_id) {
          const { data: otherMembership } = await supabase
            .from('sponsor_members')
            .select('id')
            .eq('profile_id', existing.profile_id)
            .limit(1)
            .maybeSingle()

          if (!otherMembership) {
            const { error: clearError } = await supabase
              .from('profiles')
              .update({ sponsor_id: null } as never)
              .eq('id', existing.profile_id)
            if (clearError) {
              console.error('[clerk-webhook] organizationMembership.deleted sponsor_id clear failed', clearError)
              Sentry.captureException(clearError)
              return NextResponse.json({ error: 'profiles.sponsor_id clear failed' }, { status: 500 })
            }
          }
        }

        await supabase.from('audit_log').insert({
          actor_id: null,
          action: 'remove_sponsor_member_webhook',
          entity_type: 'sponsor_members',
          entity_id: existing.id,
          metadata: { sponsor_id: existing.sponsor_id, profile_id: existing.profile_id },
        })
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

/** Best-effort in-app alert to every admin. Never throws — a notify failure must not
 * turn an otherwise-successful webhook processing run into a Svix retry storm. */
async function notifyAdmins(supabase: ReturnType<typeof createAdminClient>, title: string, body: string) {
  try {
    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
    for (const admin of admins ?? []) {
      await createInAppNotification({ recipientId: admin.id, type: 'general', title, body })
    }
  } catch (err) {
    console.error('[clerk-webhook] notifyAdmins failed', err)
    Sentry.captureException(err)
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
    // Must THROW, not swallow. Svix treats any 2xx as delivered and never retries, so
    // returning 200 here made every email-sync failure permanent and invisible — the
    // same defect as P0-12 (`user.deleted`), which was fixed while this path was not.
    // The caller's catch turns this into a 500 and Svix redelivers.
    throw new Error(`profile email sync failed: ${error.message}`)
  }
}
