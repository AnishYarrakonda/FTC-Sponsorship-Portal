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
    'transactions_ledger',
    'notifications',
    'submission_access_tokens',
    'pitch_sponsor_targets',
    'submissions',
    'pitches',
    'team_achievements',
    'teams',
    'profiles',
  ]
  for (const table of tablesToClear) {
    const { error } = await admin.from(table).delete().filter('id', 'not.is', null)
    if (error) warn(`Could not clear ${table}: ${error.message}`)
    else log(`Cleared ${table}`)
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
  await upsertProfile(adminClerkId, ACCOUNTS.admin.email, ACCOUNTS.admin.fullName, {
    role: 'admin',
    coppa_acknowledged: true,
    tos_accepted: true,
  })

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
║  SPONSOR                                                      ║
║    Email:    sponsor+clerk_test@example.com                  ║
║    Password: SponsorTest123!                                  ║
║    Company:  dev testing  ($5,000 cap, active)               ║
╚══════════════════════════════════════════════════════════════╝

Email verification (if prompted): use the Clerk test code 424242.

Next steps:
  1. Log in as coach → create a submission/portfolio targeting "dev testing"
  2. Log in as admin → approve the submission
  3. Check sponsor inbox / email to confirm delivery
`)
}

main().catch(err => { console.error('\n❌ ', err.message); process.exit(1) })
