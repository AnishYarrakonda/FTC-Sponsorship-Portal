import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { resolveActiveSponsorId } from '@/lib/active-sponsor-org'
import type { Database } from '@/lib/supabase/types'
import {
  type SponsorRole,
  LEGACY_MEMBER_ROLE,
  hasSponsorRole,
  isSponsorRole,
} from '@/lib/sponsor-roles'
import { SPONSOR_PREVIEW, mockProfile, createMockSupabaseClient } from '@/lib/dev-preview'
import { isDevAuthBypass, MOCK_ADMIN_PROFILE, createMockSupabaseClient as createAdminMockClient } from '@/lib/dev-bypass'
import { COACH_PREVIEW, mockCoachProfile, createMockCoachClient } from '@/lib/dev-coach-preview'

// DEV-ONLY: when a preview flag is on, every auth guard resolves to a static mock
// profile backed by a fixture-serving Supabase client. Gated so it cannot activate
// in a production build. Admin → lib/dev-bypass.ts; sponsor → lib/dev-preview.ts;
// coach → lib/dev-coach-preview.ts.
type ServerClient = Awaited<ReturnType<typeof createClient>>
function previewAuthed() {
  return {
    supabase: createMockSupabaseClient() as unknown as ServerClient,
    user: mockProfile as unknown as Profile,
    clerkUserId: mockProfile.clerk_user_id,
  }
}
function adminBypassAuthed() {
  return {
    supabase: createAdminMockClient() as unknown as ServerClient,
    user: MOCK_ADMIN_PROFILE as unknown as Profile,
    clerkUserId: MOCK_ADMIN_PROFILE.clerk_user_id!,
  }
}
function coachPreviewAuthed() {
  return {
    supabase: createMockCoachClient() as unknown as ServerClient,
    user: mockCoachProfile as unknown as Profile,
    clerkUserId: (mockCoachProfile as unknown as Profile).clerk_user_id as string,
  }
}

type Profile = Database['public']['Tables']['profiles']['Row']

export async function getClientIp() {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

// Resolves the Clerk session to the caller's profile row.
//
// `user` is the profiles row, so `user.id` is the internal profile uuid —
// source-compatible with all existing callers that compared `user.id` against
// owner_id / recipient_id / reviewed_by. `clerkUserId` is the Clerk id, needed
// for storage paths (files partition by Clerk id).
export async function requireAuth(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>
  user: Profile
  clerkUserId: string
}> {
  if (isDevAuthBypass()) return adminBypassAuthed()
  if (SPONSOR_PREVIEW) return previewAuthed()
  if (COACH_PREVIEW) return coachPreviewAuthed()
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    throw new Error('Unauthorized')
  }

  const supabase = await createClient()
  const { data: user } = await supabase
    .from('profiles')
    .select('*')
    .eq('clerk_user_id', clerkUserId)
    .single()

  // Profile may not exist yet immediately after Clerk signup (webhook/profile
  // creation race) — treat as unauthorized so callers fall back to onboarding.
  if (!user) {
    throw new Error('Unauthorized')
  }

  return { supabase, user, clerkUserId }
}

// Non-throwing variant for Server Components / route handlers that want to
// redirect or branch instead of throwing. Returns null when unauthenticated or
// when no profile row exists yet. `user` is the profiles row (so `user.id` is
// the profile uuid — drop-in for the old `supabase.auth.getUser()` whose
// `user.id` equalled profiles.id).
export async function getAuthedProfile(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>
  user: Profile
  clerkUserId: string
} | null> {
  if (isDevAuthBypass()) return adminBypassAuthed()
  if (SPONSOR_PREVIEW) return previewAuthed()
  if (COACH_PREVIEW) return coachPreviewAuthed()
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return null

  const supabase = await createClient()
  const { data: user } = await supabase
    .from('profiles')
    .select('*')
    .eq('clerk_user_id', clerkUserId)
    .single()

  if (!user) return null
  return { supabase, user, clerkUserId }
}

export async function requireAdmin() {
  const { supabase, user, clerkUserId } = await requireAuth()
  if (user.role !== 'admin') {
    throw new Error('Forbidden')
  }
  return { supabase, user, clerkUserId, adminClient: createAdminClient() }
}

// The super-admin rung of profiles.admin_level (0084). Gates the acts that move money or
// mint privilege: funding caps, sponsor company creation/deletion, sponsor application
// decisions, the CSV export, and admin provisioning. Everything else an admin does —
// the moderation queue, coach verification — stays on requireAdmin(), which is UNCHANGED:
// a reviewer is still an admin.
//
// This is the REAL gate. The prevent_role_elevation() trigger early-returns for the
// service-role client that every server action writes through, so it is defence in depth
// against direct PostgREST calls, not the primary control.
export async function requireSuperAdmin() {
  const { supabase, user, clerkUserId } = await requireAuth()
  if (user.role !== 'admin' || user.admin_level !== 'super_admin') {
    throw new Error('Forbidden')
  }
  return { supabase, user, clerkUserId, adminClient: createAdminClient() }
}

// A sponsor org member, resolved from `sponsor_members` via the RLS-respecting server
// client (its `sponsor_members_select_own_org` policy always admits the caller's own
// `profile_id = current_profile_id()` rows regardless of sponsor_id). Unioned with
// `user.sponsor_id` so an invited teammate whose profiles.sponsor_id has not yet been
// stamped (a brief window between accepting the Clerk invite and the webhook landing)
// still resolves — without this they would hit "Awaiting verification" forever.
export async function requireSponsor(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>
  user: Profile
  clerkUserId: string
  sponsorId: string
  sponsorIds: string[]
  membership: { id: string; role: SponsorRole } | null
  adminClient: ReturnType<typeof createAdminClient>
}> {
  const { supabase, user, clerkUserId } = await requireAuth()
  if (user.role !== 'sponsor') {
    throw new Error('Forbidden')
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('sponsor_members')
    .select('id, sponsor_id, role')
    .eq('profile_id', user.id)

  /**
   * Fail CLOSED on a read error. Discarding this error made `memberships` null, which is
   * indistinguishable from "this profile has no membership row" -- and that empty case is
   * exactly what requireSponsorRole() treats as a LEGACY_MEMBER_ROLE ('org_admin') seat.
   * So a transient failure on this one query silently PROMOTED a viewer to org admin for
   * the rest of the request. confirmSponsorDecisionProposal re-checks rank in SQL and was
   * safe, but updateOrgApprovalSettings and inviteSponsorMember trust memberRole alone.
   *
   * A genuine zero-row result still falls through to the legacy seat below, which is the
   * case the fallback was written for.
   */
  if (membershipError) {
    throw new Error('Could not verify your organization membership. Please try again.')
  }

  const rows = (memberships ?? []) as { id: string; sponsor_id: string; role: string }[]

  const sponsorIds = Array.from(
    new Set([...(user.sponsor_id ? [user.sponsor_id] : []), ...rows.map((m) => m.sponsor_id)])
  )
  const defaultSponsorId = user.sponsor_id ?? sponsorIds[0]

  if (!defaultSponsorId) {
    throw new Error('Forbidden')
  }

  /**
   * A-12-01. Multi-org membership is now supported, so `sponsorId` means "the org THIS
   * request is about" rather than "the caller's only org".
   *
   * The selection comes from a cookie, which is caller-controlled — so it is validated
   * against `sponsorIds`, the memberships this function has just resolved server-side from
   * the database. An unrecognised value falls back to the default org silently; it cannot
   * introduce an org the caller does not hold. See lib/active-sponsor-org.ts.
   *
   * `membership` follows the ACTIVE org, not profiles.sponsor_id: someone who is an
   * org_admin of company A and a viewer of company B must be a viewer while acting as B.
   * Reading the rank from the wrong org is exactly how a multi-org rollout leaks authority.
   */
  const sponsorId = await resolveActiveSponsorId(sponsorIds, defaultSponsorId)
  const ownMembership = rows.find((m) => m.sponsor_id === sponsorId) ?? null

  return {
    supabase,
    user,
    clerkUserId,
    sponsorId,
    sponsorIds,
    membership: ownMembership
      ? { id: ownMembership.id, role: isSponsorRole(ownMembership.role) ? ownMembership.role : 'viewer' }
      : null,
    adminClient: createAdminClient(),
  }
}

// Built on requireSponsor() — does not duplicate its resolution logic. The
// LEGACY_MEMBER_ROLE fallback (memberRole = membership?.role ?? LEGACY_MEMBER_ROLE) MUST
// agree with the SQL COALESCE fallback in current_sponsor_member_role() (0083); a test
// in lib/__tests__/sponsor-roles.test.ts pins LEGACY_MEMBER_ROLE === 'org_admin' so the
// two layers cannot silently drift apart.
export async function requireSponsorRole(minRole: SponsorRole): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>
  user: Profile
  clerkUserId: string
  sponsorId: string
  sponsorIds: string[]
  membership: { id: string; role: SponsorRole } | null
  memberRole: SponsorRole
  adminClient: ReturnType<typeof createAdminClient>
}> {
  const auth = await requireSponsor()
  const memberRole = auth.membership?.role ?? LEGACY_MEMBER_ROLE

  if (!hasSponsorRole(memberRole, minRole)) {
    const e: Error & { code?: string } = new Error('You do not have permission to do that.')
    e.code = 'INSUFFICIENT_ORG_ROLE'
    throw e
  }

  return { ...auth, memberRole }
}

export async function requireVerifiedCoach() {
  const { supabase, user, clerkUserId } = await requireAuth()
  if (user.role !== 'coach') throw new Error('Forbidden')
  if (!user.coach_verified) {
    const e: Error & { code?: string } = new Error('Awaiting credential verification')
    e.code = 'NEEDS_VERIFICATION'
    throw e
  }
  return { supabase, user, clerkUserId }
}
