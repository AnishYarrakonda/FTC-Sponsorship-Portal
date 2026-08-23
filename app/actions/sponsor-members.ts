'use server'

import { revalidatePath } from 'next/cache'
import { clerkClient } from '@clerk/nextjs/server'
import { requireSponsor, requireSponsorRole } from '@/lib/actions-utils'
import { createInAppNotification } from '@/lib/notify'
import { mapDbError } from '@/lib/errors'
import { jitMemberRole, type SponsorRole } from '@/lib/sponsor-roles'
import {
  inviteSponsorMemberSchema,
  updateSponsorMemberRoleSchema,
  removeSponsorMemberSchema,
} from '@/lib/schemas/sponsor-members'

import { writeAudit } from '@/lib/audit'
import { withdrawProposalsForDepartedMember, backfillOrgAdminIfHeadless } from '@/lib/sponsor-offboarding'
/** role gate shared by every mutating action in this file. Throws, like every other
 *  require* guard in lib/actions-utils.ts — callers catch and return { error }. */
function requireOrgAdmin() {
  return requireSponsorRole('org_admin')
}

// Clerk only recognizes two organization-level roles (org:admin / org:member); the two
// intermediate ranks (viewer, submitter) exist only in sponsor_members.role and are not
// mirrored into Clerk.
function clerkRole(role: SponsorRole) {
  return role === 'org_admin' ? 'org:admin' : 'org:member'
}

// Display-only, for Clerk-side pending invitations to people with no profile row yet.
// Uses the same rule the webhook applies when that invitation is accepted (jitMemberRole),
// so the list never promises a rank the member will not actually get.
function dbRole(clerkRole: string | null | undefined): SponsorRole {
  return jitMemberRole(clerkRole)
}

export async function inviteSponsorMember(data: { email: string; role: SponsorRole }) {
  // 1. VALIDATE
  const parsed = inviteSponsorMemberSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }
  const { email, role } = parsed.data

  // 2. AUTH / ROLE
  let user, sponsorId, adminClient, clerkUserId
  try {
    ;({ user, sponsorId, adminClient, clerkUserId } = await requireOrgAdmin())
  } catch (e: any) {
    return { error: e.message }
  }

  // 3. MUTATE
  const { data: sponsor, error: sponsorError } = await adminClient
    .from('sponsors')
    .select('clerk_org_id, company_name')
    .eq('id', sponsorId)
    .single()
  if (sponsorError || !sponsor) return { error: mapDbError(sponsorError, 'inviteSponsorMember.sponsor') }
  if (!sponsor.clerk_org_id) {
    return {
      error:
        'This organization does not have a Clerk organization yet. Ask an administrator to create one from the Sponsors page before inviting teammates.',
    }
  }

  const { data: existingProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, role, sponsor_id')
    .eq('email', email)
    .maybeSingle()
  if (profileError) return { error: mapDbError(profileError, 'inviteSponsorMember.lookupProfile') }

  if (existingProfile) {
    // P0-13 hazard (middleware.ts:20-28): never let an invite silently flip a
    // coach/admin account into a sponsor.
    if (existingProfile.role !== 'sponsor') {
      return { error: 'This email belongs to an existing coach or admin account and cannot be invited as a sponsor.' }
    }
    /**
     * A-12-01. Belonging to another sponsor organization is no longer a refusal.
     *
     * This used to reject anyone whose profiles.sponsor_id or sponsor_members row named a
     * different company — the application-level half of a one-org-per-person invariant the
     * SCHEMA never had (sponsor_members has always been many-to-many, and
     * current_sponsor_ids() has always returned an array). A person who genuinely sponsors
     * through two companies — an agency contact, a parent company and its subsidiary — had
     * to hold two logins.
     *
     * What is still refused is a DUPLICATE membership of THIS org, which is a mistake
     * rather than a second seat. Note the check is now scoped with .eq('sponsor_id', …)
     * rather than reading "their membership" and comparing: with N memberships,
     * maybeSingle() over an unscoped query would throw on the second org.
     */
    const { data: existingMembership } = await adminClient
      .from('sponsor_members')
      .select('sponsor_id')
      .eq('profile_id', existingProfile.id)
      .eq('sponsor_id', sponsorId)
      .maybeSingle()
    if (existingMembership) {
      return { error: 'This person is already part of your team.' }
    }
  }

  // Clerk FIRST — a failure here must not leave a half-written sponsor_members row.
  const clerk = await clerkClient()
  try {
    await clerk.organizations.createOrganizationInvitation({
      organizationId: sponsor.clerk_org_id,
      emailAddress: email,
      role: clerkRole(role),
      inviterUserId: clerkUserId,
    })
  } catch (err: any) {
    return { error: err?.errors?.[0]?.message ?? 'Could not send the invitation. Please try again.' }
  }

  // Mirror into Postgres only when the invitee already has a profile row — the schema
  // requires a non-null profile_id, so a genuinely new person (no FTC Portal account at
  // all) has no local row until they accept the Clerk invite and organizationMembership
  // .created fires. Their pending state is visible via listSponsorMembers's Clerk-side
  // merge in that case.
  if (existingProfile) {
    const { error: insertError } = await adminClient.from('sponsor_members').upsert(
      {
        sponsor_id: sponsorId,
        profile_id: existingProfile.id,
        clerk_org_id: sponsor.clerk_org_id,
        clerk_membership_id: null,
        role,
        invited_by: user.id,
        invited_at: new Date().toISOString(),
      },
      { onConflict: 'sponsor_id,profile_id' }
    )
    if (insertError) return { error: mapDbError(insertError, 'inviteSponsorMember.insert') }
  }

  // 4. AUDIT
  await writeAudit(adminClient, {
    actor_id: user.id,
    action: 'invite_sponsor_member',
    entity_type: 'sponsor_members',
    entity_id: sponsorId,
    metadata: { sponsor_id: sponsorId, email, role },
  })

  // 5. NOTIFY
  await createInAppNotification({
    recipientId: user.id,
    type: 'general',
    title: 'Invitation sent',
    body: `${email} has been invited to join ${sponsor.company_name} as ${role === 'org_admin' ? 'an admin' : 'a member'}.`,
  })

  revalidatePath('/sponsor/members')
  return { success: true }
}

export async function updateSponsorMemberRole(data: { memberId: string; role: SponsorRole }) {
  // 1. VALIDATE
  const parsed = updateSponsorMemberRoleSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }
  const { memberId, role } = parsed.data

  // 2. AUTH / ROLE
  let callerId, sponsorId, adminClient
  try {
    const auth = await requireOrgAdmin()
    callerId = auth.user.id
    sponsorId = auth.sponsorId
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // 3. MUTATE — re-derive the target row scoped to the caller's own org. A memberId from
  // another organization must not be reachable here.
  const { data: target, error: targetError } = await adminClient
    .from('sponsor_members')
    .select('id, sponsor_id, profile_id, clerk_org_id, clerk_membership_id, role')
    .eq('id', memberId)
    .eq('sponsor_id', sponsorId)
    .maybeSingle()
  if (targetError) return { error: mapDbError(targetError, 'updateSponsorMemberRole.lookup') }
  if (!target) return { error: 'Member not found in your organization.' }

  if (target.role === 'org_admin' && role !== 'org_admin') {
    const { count } = await adminClient
      .from('sponsor_members')
      .select('id', { count: 'exact', head: true })
      .eq('sponsor_id', sponsorId)
      .eq('role', 'org_admin')
    if ((count ?? 0) <= 1) {
      return { error: 'An organization must keep at least one admin.' }
    }
  }

  // Approvals are on for this org and this demotion would leave fewer than two members
  // able to confirm a funding request — refuse, or the org locks itself out of ever
  // approving anything again until the 14-day reservation lapses.
  const targetWasEligible = target.role === 'approver' || target.role === 'org_admin'
  const roleStillEligible = role === 'approver' || role === 'org_admin'
  if (targetWasEligible && !roleStillEligible) {
    const { data: sponsorRow } = await adminClient
      .from('sponsors')
      .select('approval_required_above_cents')
      .eq('id', sponsorId)
      .single()
    if (sponsorRow?.approval_required_above_cents !== null && sponsorRow?.approval_required_above_cents !== undefined) {
      const { count } = await adminClient
        .from('sponsor_members')
        .select('id', { count: 'exact', head: true })
        .eq('sponsor_id', sponsorId)
        .in('role', ['approver', 'org_admin'])
      if ((count ?? 0) <= 2) {
        return {
          error: 'Approvals are on for this organization — keep at least two Approvers, or turn approvals off first.',
        }
      }
    }
  }

  if (target.clerk_membership_id) {
    const { data: targetProfile } = await adminClient
      .from('profiles')
      .select('clerk_user_id')
      .eq('id', target.profile_id)
      .single()
    if (targetProfile?.clerk_user_id) {
      const clerk = await clerkClient()
      try {
        await clerk.organizations.updateOrganizationMembership({
          organizationId: target.clerk_org_id,
          userId: targetProfile.clerk_user_id,
          role: clerkRole(role),
        })
      } catch (err: any) {
        return { error: err?.errors?.[0]?.message ?? 'Could not update the role in Clerk. Please try again.' }
      }
    }
  }

  const { error: updateError } = await adminClient
    .from('sponsor_members')
    .update({ role })
    .eq('id', memberId)
  if (updateError) return { error: mapDbError(updateError, 'updateSponsorMemberRole.update') }

  // 4. AUDIT
  await writeAudit(adminClient, {
    actor_id: callerId,
    action: 'update_sponsor_member_role',
    entity_type: 'sponsor_members',
    entity_id: memberId,
    metadata: { from: target.role, to: role },
  })

  // 5. NOTIFY
  await createInAppNotification({
    recipientId: target.profile_id,
    type: 'general',
    title: 'Your role was updated',
    body: `Your role was changed to ${role === 'org_admin' ? 'admin' : 'member'}.`,
  })

  revalidatePath('/sponsor/members')
  return { success: true }
}

export async function removeSponsorMember(data: { memberId: string }) {
  // 1. VALIDATE
  const parsed = removeSponsorMemberSchema.safeParse(data)
  if (!parsed.success) {
    return { error: 'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', ') }
  }
  const { memberId } = parsed.data

  // 2. AUTH / ROLE
  let callerId, sponsorId, adminClient
  try {
    const auth = await requireOrgAdmin()
    callerId = auth.user.id
    sponsorId = auth.sponsorId
    adminClient = auth.adminClient
  } catch (e: any) {
    return { error: e.message }
  }

  // 3. MUTATE — re-derive the target row scoped to the caller's own org.
  const { data: target, error: targetError } = await adminClient
    .from('sponsor_members')
    .select('id, sponsor_id, profile_id, clerk_org_id, clerk_membership_id, role')
    .eq('id', memberId)
    .eq('sponsor_id', sponsorId)
    .maybeSingle()
  if (targetError) return { error: mapDbError(targetError, 'removeSponsorMember.lookup') }
  if (!target) return { error: 'Member not found in your organization.' }

  if (target.role === 'org_admin') {
    const { count } = await adminClient
      .from('sponsor_members')
      .select('id', { count: 'exact', head: true })
      .eq('sponsor_id', sponsorId)
      .eq('role', 'org_admin')
    if ((count ?? 0) <= 1) {
      return { error: 'An organization must keep at least one admin.' }
    }
  }

  if (target.role === 'approver' || target.role === 'org_admin') {
    const { data: sponsorRow } = await adminClient
      .from('sponsors')
      .select('approval_required_above_cents')
      .eq('id', sponsorId)
      .single()
    if (sponsorRow?.approval_required_above_cents !== null && sponsorRow?.approval_required_above_cents !== undefined) {
      const { count } = await adminClient
        .from('sponsor_members')
        .select('id', { count: 'exact', head: true })
        .eq('sponsor_id', sponsorId)
        .in('role', ['approver', 'org_admin'])
      if ((count ?? 0) <= 2) {
        return {
          error: 'Approvals are on for this organization — keep at least two Approvers, or turn approvals off first.',
        }
      }
    }
  }

  const { data: targetProfile } = await adminClient
    .from('profiles')
    .select('clerk_user_id, sponsor_id, email')
    .eq('id', target.profile_id)
    .single()

  const clerk = await clerkClient()
  try {
    if (target.clerk_membership_id && targetProfile?.clerk_user_id) {
      await clerk.organizations.deleteOrganizationMembership({
        organizationId: target.clerk_org_id,
        userId: targetProfile.clerk_user_id,
      })
    } else if (targetProfile?.email) {
      // Still-pending invite (never accepted) — best-effort revoke so the invitation
      // link stops working. Not fatal if it is already gone or was accepted through a
      // different path in the meantime.
      const pending = await clerk.organizations.getOrganizationInvitationList({
        organizationId: target.clerk_org_id,
        status: ['pending'],
      })
      const invitation = pending.data.find(
        (inv) => inv.emailAddress.toLowerCase() === targetProfile.email.toLowerCase()
      )
      if (invitation) {
        await clerk.organizations.revokeOrganizationInvitation({
          organizationId: target.clerk_org_id,
          invitationId: invitation.id,
        })
      }
    }
  } catch (err: any) {
    return { error: err?.errors?.[0]?.message ?? 'Could not remove the member in Clerk. Please try again.' }
  }

  const { error: deleteError } = await adminClient.from('sponsor_members').delete().eq('id', memberId)
  if (deleteError) return { error: mapDbError(deleteError, 'removeSponsorMember.delete') }

  // Offboarding: clear the primary-org pointer immediately (don't wait on the Clerk
  // webhook round trip) when it pointed at this sponsor. The webhook performs the same
  // clear defensively for removals that happen outside this action (e.g. Clerk dashboard).
  if (targetProfile?.sponsor_id === sponsorId) {
    await adminClient.from('profiles').update({ sponsor_id: null }).eq('id', target.profile_id)
  }

  // A-12-02: a departing member's in-flight funding proposals used to stay `pending`,
  // attributed to somebody no longer in the org, with no UI anywhere to reassign them.
  const { withdrawn } = await withdrawProposalsForDepartedMember(
    adminClient,
    sponsorId,
    target.profile_id,
    callerId
  )

  // A-12-03: this action already refuses to remove the last org_admin, so this is
  // belt-and-braces here — it earns its keep on the webhook path, which had no guard at
  // all. Kept on both so the two offboarding routes cannot drift apart again.
  await backfillOrgAdminIfHeadless(adminClient, sponsorId)

  // 4. AUDIT
  await writeAudit(adminClient, {
    actor_id: callerId,
    action: 'remove_sponsor_member',
    entity_type: 'sponsor_members',
    entity_id: memberId,
    metadata: { sponsor_id: sponsorId, profile_id: target.profile_id, proposals_withdrawn: withdrawn },
  })

  // 5. NOTIFY
  await createInAppNotification({
    recipientId: target.profile_id,
    type: 'general',
    title: 'Removed from organization',
    body: 'You have been removed from your sponsor organization and no longer have access to its portal.',
  })

  revalidatePath('/sponsor/members')
  return { success: true }
}

export async function listSponsorMembers() {
  let auth
  try {
    auth = await requireSponsor()
  } catch (e: any) {
    return { error: e.message }
  }
  const { sponsorId, adminClient, membership } = auth

  const { data: members, error } = await adminClient
    .from('sponsor_members')
    .select('id, role, joined_at, invited_at, clerk_membership_id, profile_id, profiles:profile_id(full_name, email)')
    .eq('sponsor_id', sponsorId)
    .order('created_at', { ascending: true })
  if (error) return { error: mapDbError(error, 'listSponsorMembers') }

  const rows = (members ?? []).map((m) => ({
    id: m.id,
    role: m.role as SponsorRole,
    joinedAt: m.joined_at,
    invitedAt: m.invited_at,
    pending: !m.clerk_membership_id,
    profileId: m.profile_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fullName: (m.profiles as any)?.full_name ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    email: (m.profiles as any)?.email ?? null,
  }))

  // Merge Clerk's own pending invitation list for invitees who have no FTC Portal
  // profile row yet (profile_id is NOT NULL on sponsor_members, so those invites cannot
  // be represented locally until organizationMembership.created fires).
  const { data: sponsor } = await adminClient.from('sponsors').select('clerk_org_id').eq('id', sponsorId).single()
  let clerkPending: { id: string; role: SponsorRole; email: string; invitedAt: string }[] = []
  if (sponsor?.clerk_org_id) {
    try {
      const clerk = await clerkClient()
      const invitations = await clerk.organizations.getOrganizationInvitationList({
        organizationId: sponsor.clerk_org_id,
        status: ['pending'],
      })
      const knownEmails = new Set(rows.map((r) => r.email?.toLowerCase()).filter(Boolean))
      clerkPending = invitations.data
        .filter((inv) => !knownEmails.has(inv.emailAddress.toLowerCase()))
        .map((inv) => ({
          id: `clerk-invite-${inv.id}`,
          role: dbRole(inv.role),
          email: inv.emailAddress,
          invitedAt: new Date(inv.createdAt).toISOString(),
        }))
    } catch {
      // Non-fatal — the DB-backed member list is still accurate; only the "someone with
      // no profile yet" pending row is missing until they accept and get a profile.
    }
  }

  return {
    success: true,
    membership,
    members: [
      ...rows,
      ...clerkPending.map((p) => ({
        id: p.id,
        role: p.role,
        joinedAt: null,
        invitedAt: p.invitedAt,
        pending: true,
        profileId: null,
        fullName: null,
        email: p.email,
      })),
    ],
  }
}
