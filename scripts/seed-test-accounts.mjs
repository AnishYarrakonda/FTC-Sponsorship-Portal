/**
 * Seed test accounts for manual QA.
 * Run from project root: node scripts/seed-test-accounts.mjs
 *
 * Auth is now Clerk (Supabase keeps Postgres + Storage). This script:
 *   1. Deletes existing seeded Clerk test users + clears dependent public tables (clean slate)
 *   2. Creates coach / admin / sponsor users in Clerk via the Backend SDK
 *   3. Upserts the matching `profiles` row (service-role / RLS-bypass) with the
 *      Clerk user id stored in `profiles.clerk_user_id`, plus the right role /
 *      coach_verified / sponsor_id (profile rows are created by the app at runtime,
 *      not by a DB trigger, so the seeder writes them directly)
 *   4. Creates a "dev testing" sponsor company and links it to the sponsor user
 *   5. Marks the coach as verified and creates a starter team
 *
 * Required env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — Supabase DB seeding (bypasses RLS)
 *   CLERK_SECRET_KEY                                     — Clerk Backend SDK (create/delete test users)
 *
 * Test accounts use Clerk's `+clerk_test` email convention so they're deterministic
 * and email verification can be satisfied with the static test code 424242.
 */

import { createClient } from '@supabase/supabase-js'
// Import from @clerk/backend (not @clerk/nextjs/server): the Next wrapper's ESM
// export map breaks under plain `node` (routeMatcher subpath fails to resolve).
// createClerkClient is the same function, re-exported by the Next package.
import { createClerkClient } from '@clerk/backend'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
if (!CLERK_SECRET_KEY) {
  console.error('Missing CLERK_SECRET_KEY in .env.local (required to create Clerk test users)')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const clerk = createClerkClient({ secretKey: CLERK_SECRET_KEY })

// ─── Credentials ─────────────────────────────────────────────────────────────
// Uses Clerk's `+clerk_test` convention so accounts are deterministic test users
// (email verification can be satisfied with the static code 424242).
const ACCOUNTS = {
  coach: {
    email: 'coach+clerk_test@example.com',
    password: 'CoachTest123!',
    fullName: 'Dev Coach',
    role: 'coach',
  },
  admin: {
    email: 'admin+clerk_test@example.com',
    password: 'AdminTest123!',
    fullName: 'Dev Admin',
    role: 'admin',
  },
  sponsor: {
    email: 'sponsor+clerk_test@example.com',
    password: 'SponsorTest123!',
    fullName: 'Dev Sponsor',
    role: 'sponsor',
  },
  // Second member of the "dev testing" org (0082/0083 sponsor_members security-boundary
  // tests need multiple org members at different ladder ranks, plus a second, wholly
  // separate org). sponsor_members.role for this one is 'submitter'.
  sponsorMember: {
    email: 'sponsor-member+clerk_test@example.com',
    password: 'SponsorMemberTest123!',
    fullName: 'Dev Sponsor Teammate',
    role: 'sponsor',
  },
  // 0083 — a read-only member of "dev testing" (sponsor_members.role = 'viewer').
  sponsorViewer: {
    email: 'sponsor-viewer+clerk_test@example.com',
    password: 'SponsorViewerTest123!',
    fullName: 'Dev Sponsor Viewer',
    role: 'sponsor',
  },
  // 0083 — a second signature for "dev testing" (sponsor_members.role = 'approver'), so
  // approvals can be turned on (the two-approver floor: sponsor + this account).
  sponsorApprover: {
    email: 'sponsor-approver+clerk_test@example.com',
    password: 'SponsorApproverTest123!',
    fullName: 'Dev Sponsor Approver',
    role: 'sponsor',
  },
  sponsor2: {
    email: 'sponsor2+clerk_test@example.com',
    password: 'Sponsor2Test123!',
    fullName: 'Dev Sponsor Two',
    role: 'sponsor',
  },
}

const ALL_EMAILS = Object.values(ACCOUNTS).map(a => a.email)

// ─── Helpers ──────────────────────────────────────────────────────────────────
function log(msg) { console.log(`  ✓ ${msg}`) }
function warn(msg) { console.warn(`  ⚠ ${msg}`) }
function section(title) { console.log(`\n── ${title} ──`) }

// ─── Step 1: Wipe seeded Clerk users + dependent public tables ────────────────
async function wipeUsers() {
  section('Wiping public tables & existing seeded Clerk users')

  // Clean up dependent tables first to avoid foreign key constraint violations.
  // Order matters: children before parents. Supabase .delete() returns an error
  // object rather than throwing, so we check `error` directly.
  const tablesToClear = [
    // Fulfillment / money trail (0076-0080, 0087-0088) — added because the original list
    // predates them. Their FKs to profiles/teams/submissions made the `profiles` delete fail,
    // and that failure was only a warning, so every re-run silently ADDED another copy of
    // each account. `.single()` lookups later in this script then blew up on multiple rows.
    'agreement_signatures',
    'funding_fulfillment_events',
    'funding_receipts',
    'funding_fulfillments',
    'sponsor_decision_proposals',
    'sponsor_recognition_awards',
    'impact_report_snapshots',
    'submission_messages',
    'appeals',
    'transactions_ledger',
    'notifications',
    'submission_access_tokens',
    'pitch_sponsor_targets',
    'submissions',
    'pitches',
    'team_achievements',
    'team_payout_profiles',
    'team_verification_records',
    'teams',
    'sponsor_members',
    'profiles',
  ]
  for (const table of tablesToClear) {
    /**
     * Admin profiles survive this pass on purpose. 0084 installs a deferred constraint
     * trigger that refuses any transaction ENDING with zero super admins, and PostgREST
     * commits each request on its own — so "delete every profile" can never succeed. The
     * stale admins are removed later by pruneStaleAdmins(), once the new one exists.
     */
    const query = admin.from(table).delete()
    const { error } =
      table === 'profiles'
        ? await query.neq('role', 'admin')
        : await query.filter('id', 'not.is', null)
    // A table that does not exist in this database is fine (older schema); anything else
    // leaves the seed inconsistent, and `profiles` in particular must be empty.
    if (error && !/does not exist|schema cache/i.test(error.message)) {
      if (table === 'profiles') throw new Error(`Could not clear profiles: ${error.message}`)
      warn(`Could not clear ${table}: ${error.message}`)
    } else {
      log(`Cleared ${table}`)
    }
  }

  // Delete only the seeded test users from Clerk (matched by email), not every
  // user in the Clerk instance.
  for (const email of ALL_EMAILS) {
    try {
      const { data: matches } = await clerk.users.getUserList({ emailAddress: [email] })
      for (const u of matches) {
        await clerk.users.deleteUser(u.id)
        log(`Deleted Clerk user ${email}  [id: ${u.id}]`)
      }
    } catch (err) {
      warn(`Could not delete Clerk user ${email}: ${err.message}`)
    }
  }
}

// ─── Step 2: Create a Clerk user (email pre-verified via test convention) ─────
async function createUser(email, password, fullName) {
  const [firstName, ...rest] = fullName.split(' ')
  const lastName = rest.join(' ') || 'User'
  const user = await clerk.users.createUser({
    emailAddress: [email],
    password,
    firstName,
    lastName,
    skipPasswordChecks: true,
  })
  log(`Created Clerk user ${email}  [id: ${user.id}]`)
  return user.id
}

// ─── Clerk Organizations ─────────────────────────────────────────────────────
// `sponsors.clerk_org_id` and `sponsor_members.clerk_membership_id` used to be seeded with
// invented strings ('org_seed_dev_testing_a'). Anything that calls Clerk with those ids —
// inviting a teammate, listing pending invitations, reading enterprise connections — got a
// 404 from Clerk and failed in a way that looked like a product bug. These create the real
// organizations so the org surfaces are exercisable end to end.

/** Delete any org with this name, then create it fresh. Returns the Clerk org id. */
async function createOrg(name, createdByClerkUserId) {
  const existing = await clerk.organizations.getOrganizationList({ query: name, limit: 20 })
  for (const org of existing.data ?? []) {
    if (org.name === name) await clerk.organizations.deleteOrganization(org.id)
  }
  const org = await clerk.organizations.createOrganization({
    name,
    createdBy: createdByClerkUserId,
  })
  log(`Created Clerk organization "${name}"  [id: ${org.id}]`)
  return org.id
}

/**
 * Add a member. `createOrganization` already makes the creator an org:admin, so that one is
 * looked up rather than re-added. Clerk only knows two roles here; the portal's four-rung
 * ladder (org_admin / approver / submitter / viewer) lives in `sponsor_members.role`.
 */
async function addOrgMember(orgId, clerkUserId, clerkRole) {
  try {
    const m = await clerk.organizations.createOrganizationMembership({
      organizationId: orgId,
      userId: clerkUserId,
      role: clerkRole,
    })
    return m.id
  } catch {
    const list = await clerk.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      limit: 100,
    })
    const found = (list.data ?? []).find((m) => m.publicUserData?.userId === clerkUserId)
    return found?.id ?? null
  }
}

// ─── Step 3: Upsert the matching profile row (links clerk_user_id → role) ─────
// Profile rows are normally created by the app at runtime; the seeder writes them
// directly via the service-role client (bypasses RLS).
async function upsertProfile(clerkUserId, email, fullName, patch) {
  const { data, error } = await admin
    .from('profiles')
    .upsert(
      {
        clerk_user_id: clerkUserId,
        email,
        full_name: fullName,
        ...patch,
      },
      { onConflict: 'clerk_user_id' }
    )
    .select('id')
    .single()
  if (error) throw new Error(`upsertProfile(${email}) failed: ${error.message}`)
  log(`Upserted profile for ${email}  [profile id: ${data.id}]`)
  return data.id
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🚀  FTC Portal — test account seeder (Clerk)\n')

  // 1. Wipe
  await wipeUsers()

  // 2. Create Clerk users
  section('Creating Clerk users')
  const coachClerkId   = await createUser(ACCOUNTS.coach.email,   ACCOUNTS.coach.password,   ACCOUNTS.coach.fullName)
  const adminClerkId   = await createUser(ACCOUNTS.admin.email,   ACCOUNTS.admin.password,   ACCOUNTS.admin.fullName)
  const sponsorClerkId = await createUser(ACCOUNTS.sponsor.email, ACCOUNTS.sponsor.password, ACCOUNTS.sponsor.fullName)

  // 3. Upsert profiles with roles (no DB trigger — write them directly)
  section('Creating profiles & configuring roles')
  const coachProfileId = await upsertProfile(coachClerkId, ACCOUNTS.coach.email, ACCOUNTS.coach.fullName, {
    role: 'coach',
    coach_verified: true,
    coppa_acknowledged: true,
    tos_accepted: true,
  })
  const adminProfileId = await upsertProfile(
    adminClerkId, ACCOUNTS.admin.email, ACCOUNTS.admin.fullName,
    {
      role: 'admin',
      admin_level: 'super_admin',
      coppa_acknowledged: true,
      tos_accepted: true,
    }
  )

  // Now that a fresh super admin exists, the ones the wipe had to spare can go. Without
  // this, every run left the previous admin behind and duplicate emails accumulated until
  // `.single()` lookups elsewhere in this script started failing on multiple rows.
  const { error: pruneErr } = await admin
    .from('profiles')
    .delete()
    .eq('role', 'admin')
    .neq('id', adminProfileId)
  if (pruneErr) warn(`Could not prune stale admin profiles: ${pruneErr.message}`)
  else log('Pruned stale admin profiles')

  // 4. Create "dev testing" sponsor company.
  // `sponsors` has no unique constraint on company_name, so ON CONFLICT can't be
  // used. The wipe step also doesn't clear `sponsors`, so delete the prior test
  // company (and its application) first, then insert fresh — keeps this idempotent.
  section('Creating sponsor company')
  await admin.from('sponsor_applications').delete().eq('company_name', 'dev testing')
  await admin.from('sponsors').delete().eq('company_name', 'dev testing')

  const { data: sponsorRow, error: sponsorErr } = await admin
    .from('sponsors')
    .insert({
      company_name: 'dev testing',
      contact_name: ACCOUNTS.sponsor.fullName,
      contact_email: ACCOUNTS.sponsor.email,
      funding_cap_cents: 500000,   // $5,000
      status: 'active',
      source: 'admin_added',
    })
    .select('id')
    .single()

  if (sponsorErr) throw new Error(`sponsors insert failed: ${sponsorErr.message}`)
  log(`Created sponsor company "dev testing"  [id: ${sponsorRow.id}]`)

  // 5. Link sponsor profile → company
  section('Linking sponsor account to company')
  await upsertProfile(sponsorClerkId, ACCOUNTS.sponsor.email, ACCOUNTS.sponsor.fullName, {
    role: 'sponsor',
    sponsor_id: sponsorRow.id,
    coppa_acknowledged: true,
    tos_accepted: true,
  })

  // 6. Create a sponsor_application entry so the admin queue shows it
  await admin.from('sponsor_applications').insert({
    company_name: 'dev testing',
    contact_name: ACCOUNTS.sponsor.fullName,
    contact_email: ACCOUNTS.sponsor.email,
    proposed_cap_cents: 500000,
    message: 'Dev testing account — pre-approved',
    status: 'approved',
  }).then(({ error }) => {
    if (error && !error.message.includes('unique')) warn(`sponsor_applications insert: ${error.message}`)
    else log('Created sponsor_applications record (approved)')
  })

  // 6b. Sponsor Organizations (0082) fixtures — a second member of "dev testing" plus a
  // wholly separate second sponsor company, both needed by the cross-org RLS
  // security-boundary tests (tests/e2e/sponsor-organizations.spec.ts). clerk_org_id /
  // clerk_membership_id here are seeder-only placeholders — this script writes DB state
  // directly rather than driving the real Clerk Organizations API, since the tests only
  // need two distinct orgs with real RLS-scoped rows, not a live invite flow.
  section('Creating sponsor organization fixtures (0082/0083)')
  const sponsorMemberClerkId = await createUser(
    ACCOUNTS.sponsorMember.email, ACCOUNTS.sponsorMember.password, ACCOUNTS.sponsorMember.fullName
  )
  const sponsorViewerClerkId = await createUser(
    ACCOUNTS.sponsorViewer.email, ACCOUNTS.sponsorViewer.password, ACCOUNTS.sponsorViewer.fullName
  )
  const sponsorApproverClerkId = await createUser(
    ACCOUNTS.sponsorApprover.email, ACCOUNTS.sponsorApprover.password, ACCOUNTS.sponsorApprover.fullName
  )
  const sponsor2ClerkId = await createUser(
    ACCOUNTS.sponsor2.email, ACCOUNTS.sponsor2.password, ACCOUNTS.sponsor2.fullName
  )

  const ORG_A_CLERK_ID = await createOrg('dev testing', sponsorClerkId)

  await admin.from('sponsors').update({ clerk_org_id: ORG_A_CLERK_ID }).eq('id', sponsorRow.id)

  const sponsorMemberProfileId = await upsertProfile(
    sponsorMemberClerkId, ACCOUNTS.sponsorMember.email, ACCOUNTS.sponsorMember.fullName,
    { role: 'sponsor', sponsor_id: sponsorRow.id, coppa_acknowledged: true, tos_accepted: true }
  )
  const sponsorViewerProfileId = await upsertProfile(
    sponsorViewerClerkId, ACCOUNTS.sponsorViewer.email, ACCOUNTS.sponsorViewer.fullName,
    { role: 'sponsor', coppa_acknowledged: true, tos_accepted: true }
  )
  const sponsorApproverProfileId = await upsertProfile(
    sponsorApproverClerkId, ACCOUNTS.sponsorApprover.email, ACCOUNTS.sponsorApprover.fullName,
    { role: 'sponsor', coppa_acknowledged: true, tos_accepted: true }
  )

  const { data: sponsorProfile } = await admin
    .from('profiles').select('id').eq('email', ACCOUNTS.sponsor.email).single()

  // Role ladder for "dev testing": org_admin (owner), submitter, viewer, approver. Two
  // members at rank >= approver (org_admin + approver) so the two-approver floor lets
  // updateOrgApprovalSettings turn approvals on for manual QA.
  await admin.from('sponsor_members').insert([
    {
      sponsor_id: sponsorRow.id, profile_id: sponsorProfile.id, clerk_org_id: ORG_A_CLERK_ID,
      clerk_membership_id: await addOrgMember(ORG_A_CLERK_ID, sponsorClerkId, 'org:admin'),
      role: 'org_admin', joined_at: new Date().toISOString(),
    },
    {
      sponsor_id: sponsorRow.id, profile_id: sponsorMemberProfileId, clerk_org_id: ORG_A_CLERK_ID,
      clerk_membership_id: await addOrgMember(ORG_A_CLERK_ID, sponsorMemberClerkId, 'org:member'),
      role: 'submitter', invited_by: sponsorProfile.id,
      invited_at: new Date().toISOString(), joined_at: new Date().toISOString(),
    },
    {
      sponsor_id: sponsorRow.id, profile_id: sponsorViewerProfileId, clerk_org_id: ORG_A_CLERK_ID,
      clerk_membership_id: await addOrgMember(ORG_A_CLERK_ID, sponsorViewerClerkId, 'org:member'),
      role: 'viewer', invited_by: sponsorProfile.id,
      invited_at: new Date().toISOString(), joined_at: new Date().toISOString(),
    },
    {
      sponsor_id: sponsorRow.id, profile_id: sponsorApproverProfileId, clerk_org_id: ORG_A_CLERK_ID,
      clerk_membership_id: await addOrgMember(ORG_A_CLERK_ID, sponsorApproverClerkId, 'org:member'),
      role: 'approver', invited_by: sponsorProfile.id,
      invited_at: new Date().toISOString(), joined_at: new Date().toISOString(),
    },
  ])
  log(`Linked submitter/viewer/approver teammates of "dev testing"  [profile ids: ${sponsorMemberProfileId}, ${sponsorViewerProfileId}, ${sponsorApproverProfileId}]`)

  await admin.from('sponsor_applications').delete().eq('company_name', 'dev testing 2')
  await admin.from('sponsors').delete().eq('company_name', 'dev testing 2')

  const ORG_B_CLERK_ID = await createOrg('dev testing 2', sponsor2ClerkId)

  const { data: sponsor2Row, error: sponsor2Err } = await admin
    .from('sponsors')
    .insert({
      company_name: 'dev testing 2',
      contact_name: ACCOUNTS.sponsor2.fullName,
      contact_email: ACCOUNTS.sponsor2.email,
      funding_cap_cents: 500000,
      status: 'active',
      source: 'admin_added',
      clerk_org_id: ORG_B_CLERK_ID,
    })
    .select('id')
    .single()
  if (sponsor2Err) throw new Error(`sponsors (dev testing 2) insert failed: ${sponsor2Err.message}`)

  const sponsor2ProfileId = await upsertProfile(
    sponsor2ClerkId, ACCOUNTS.sponsor2.email, ACCOUNTS.sponsor2.fullName,
    { role: 'sponsor', sponsor_id: sponsor2Row.id, coppa_acknowledged: true, tos_accepted: true }
  )

  await admin.from('sponsor_members').insert({
    sponsor_id: sponsor2Row.id, profile_id: sponsor2ProfileId, clerk_org_id: ORG_B_CLERK_ID,
    clerk_membership_id: await addOrgMember(ORG_B_CLERK_ID, sponsor2ClerkId, 'org:admin'),
    role: 'org_admin', joined_at: new Date().toISOString(),
  })
  log(`Created second sponsor company "dev testing 2"  [id: ${sponsor2Row.id}]`)

  // 7. Create a starter team for the coach so they can immediately build a portfolio
  section('Creating starter team for coach')
  const { data: team, error: teamErr } = await admin
    .from('teams')
    .insert({
      owner_id: coachProfileId,
      status: 'existing',
      ftc_team_number: 99999,
      team_name: 'Dev Test Team',
      slug: 'dev-test-team-99999',
      organization: 'Dev School',
      city: 'Austin',
      state: 'TX',
      mission_statement: 'A test team for development and QA purposes.',
      tax_status: 'None',
      // Portfolio redesign fields (migration 0054)
      founded_year: 2021,
      team_size: 10,
      seasons_competed: 3,
      coach_experience: '3 seasons coaching FTC; QA engineer by day.',
      past_sponsors: ['Dev Hardware Supply', 'QA Community Fund'],
      press_links: [
        { label: 'Dev Gazette: Test team ships robots', url: 'https://example.com/dev-test-team' },
      ],
      community_endorsements: '“A reliable, well-run program.” — Dev School Principal',
      students_reached: 150,
      events_hosted: 4,
      volunteer_hours: 90,
      outreach_summary: 'Hosted 4 workshops for local middle-schoolers this season.',
      subteam_breakdown: 'Build, Programming, Outreach.',
      technical_summary: 'Mecanum drive with a two-stage lift and webcam-based scoring alignment.',
      github_link: 'https://github.com/example/dev-test-team',
    })
    .select('id')
    .single()

  if (teamErr) throw new Error(`teams insert failed: ${teamErr.message}`)
  log(`Created team "Dev Test Team"  [id: ${team.id}]`)

  // 8. Print credentials summary
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║               TEST ACCOUNT CREDENTIALS (Clerk)               ║
╠══════════════════════════════════════════════════════════════╣
║  COACH                                                        ║
║    Email:    coach+clerk_test@example.com                    ║
║    Password: CoachTest123!                                    ║
║    Status:   verified ✓  |  Team: Dev Test Team (#99999)     ║
╠══════════════════════════════════════════════════════════════╣
║  ADMIN                                                        ║
║    Email:    admin+clerk_test@example.com                    ║
║    Password: AdminTest123!                                    ║
╠══════════════════════════════════════════════════════════════╣
║  SPONSOR (org_admin of "dev testing")                         ║
║    Email:    sponsor+clerk_test@example.com                  ║
║    Password: SponsorTest123!                                  ║
║    Company:  dev testing  ($5,000 cap, active)               ║
╠══════════════════════════════════════════════════════════════╣
║  SPONSOR SUBMITTER (submitter of "dev testing")                ║
║    Email:    sponsor-member+clerk_test@example.com            ║
║    Password: SponsorMemberTest123!                             ║
╠══════════════════════════════════════════════════════════════╣
║  SPONSOR VIEWER (viewer of "dev testing")                     ║
║    Email:    sponsor-viewer+clerk_test@example.com             ║
║    Password: SponsorViewerTest123!                              ║
╠══════════════════════════════════════════════════════════════╣
║  SPONSOR APPROVER (approver of "dev testing")                 ║
║    Email:    sponsor-approver+clerk_test@example.com           ║
║    Password: SponsorApproverTest123!                             ║
╠══════════════════════════════════════════════════════════════╣
║  SPONSOR 2 (org_admin of "dev testing 2" — separate org)      ║
║    Email:    sponsor2+clerk_test@example.com                  ║
║    Password: Sponsor2Test123!                                  ║
╚══════════════════════════════════════════════════════════════╝

Email verification (if prompted): use the Clerk test code 424242.

Next steps:
  1. Log in as coach → create a submission/portfolio targeting "dev testing"
  2. Log in as admin → approve the submission
  3. Check sponsor inbox / email to confirm delivery
`)
}

main().catch(err => { console.error('\n❌ ', err.message); process.exit(1) })
