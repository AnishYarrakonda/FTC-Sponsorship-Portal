/**
 * Seed 3 fake dispatched pitches into the "dev testing" sponsor account
 * so you can browse the sponsor portal review queue on the live Vercel deployment.
 *
 * Run: node scripts/seed-fake-pitches.mjs
 *
 * Prerequisites: seed-test-accounts.mjs must have been run first
 * (needs the coach + sponsor accounts and the "dev testing" company to exist).
 *
 * Safe to re-run: removes any previously seeded fake pitch teams/submissions first.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function log(msg)  { console.log(`  ✓ ${msg}`) }
function warn(msg) { console.warn(`  ⚠ ${msg}`) }
function section(t){ console.log(`\n── ${t} ──`) }

// ── Look up prerequisite records ──────────────────────────────────────────────

section('Looking up dev accounts')

const { data: sponsor } = await admin
  .from('sponsors')
  .select('id, company_name, funding_cap_cents')
  .eq('company_name', 'dev testing')
  .maybeSingle()

if (!sponsor) {
  console.error('\n❌  Sponsor "dev testing" not found.\n   Run: node scripts/seed-test-accounts.mjs')
  process.exit(1)
}
log(`Sponsor: "${sponsor.company_name}"  [${sponsor.id}]`)

const { data: coachProfile } = await admin
  .from('profiles')
  .select('id, full_name')
  .eq('email', 'coach+clerk_test@example.com')
  .maybeSingle()

if (!coachProfile) {
  console.error('\n❌  Coach profile not found.\n   Run: node scripts/seed-test-accounts.mjs')
  process.exit(1)
}
log(`Coach: "${coachProfile.full_name}"  [${coachProfile.id}]`)

// ── Wipe any previously seeded fake pitch data ────────────────────────────────

section('Removing previously seeded fake pitches')

const FAKE_SLUGS = ['quantum-foxes-31579', 'iron-aviators-18420', 'volt-vanguard-22317']
const FAKE_COACH_IDS = ['fake_coach_qf_31579', 'fake_coach_ia_18420', 'fake_coach_vv_22317']

const { data: oldTeams } = await admin.from('teams').select('id').in('slug', FAKE_SLUGS)

if (oldTeams?.length) {
  const oldIds = oldTeams.map((t) => t.id)
  await admin.from('submissions').delete().in('team_id', oldIds)
  await admin.from('team_achievements').delete().in('team_id', oldIds)
  const { error: teamDelErr } = await admin.from('teams').delete().in('id', oldIds)
  if (teamDelErr) warn(`Could not remove old teams: ${teamDelErr.message}`)
  else log('Removed old teams + submissions + achievements')
} else {
  log('No previously seeded teams found')
}

// Remove ghost coach profiles (ignore errors — they may not exist yet)
await admin.from('profiles').delete().in('clerk_user_id', FAKE_COACH_IDS)
log('Removed old ghost coach profiles')

// ── Create 3 ghost coach profiles (one per team — DB enforces 1 team per owner) ──

section('Creating ghost coach profiles')

const GHOST_COACHES = [
  { clerk_user_id: 'fake_coach_qf_31579', email: 'qf31579@fake.seed', full_name: 'Quantum Foxes Coach', role: 'coach', coach_verified: true, coppa_acknowledged: true, tos_accepted: true },
  { clerk_user_id: 'fake_coach_ia_18420', email: 'ia18420@fake.seed', full_name: 'Iron Aviators Coach', role: 'coach', coach_verified: true, coppa_acknowledged: true, tos_accepted: true },
  { clerk_user_id: 'fake_coach_vv_22317', email: 'vv22317@fake.seed', full_name: 'Volt Vanguard Coach', role: 'coach', coach_verified: true, coppa_acknowledged: true, tos_accepted: true },
]

const { data: ghostProfiles, error: ghostErr } = await admin
  .from('profiles')
  .insert(GHOST_COACHES)
  .select('id, full_name')

if (ghostErr) {
  console.error('\n❌  Failed to create ghost profiles:', ghostErr.message)
  process.exit(1)
}
for (const p of ghostProfiles) log(`Ghost coach: "${p.full_name}"  [${p.id}]`)

const [foxCoach, aviCoach, vanCoach] = ghostProfiles

// ── Create 3 fake teams ───────────────────────────────────────────────────────

section('Creating fake teams')

const TEAMS = [
  {
    owner_id: foxCoach.id,
    team_name: 'Quantum Foxes',
    ftc_team_number: 31579,
    slug: 'quantum-foxes-31579',
    organization: 'Lincoln High School',
    city: 'San Jose',
    state: 'CA',
    status: 'existing',
    public: true,
    tax_status: '501c3',
    mission_statement:
      'A student-led FTC team building competitive robots while running STEM outreach for underrepresented communities in the South Bay.',
    technical_summary:
      'Custom swerve drive, dual-motor linear lift, and a vision-assisted auto routine using AprilTag localization.',
    github_link: 'https://github.com/example/quantum-foxes',
    outreach_summary:
      'Ran 6 community workshops reaching 200+ students this season; mentoring two new rookie teams in our district.',
    founded_year: 2019,
    team_size: 14,
    seasons_competed: 6,
    coach_experience: '6th season mentoring FTC; mechanical engineer with a decade in industry.',
    past_sponsors: ['Bay Area Machine Works', 'Rotary Club of San Jose'],
    press_links: [
      { label: 'Mercury News: Students build robots and futures', url: 'https://example.com/quantum-foxes-press' },
    ],
    community_endorsements:
      '“This team transformed our after-school STEM program.” — Principal, Lincoln High School',
    students_reached: 200,
    events_hosted: 6,
    volunteer_hours: 180,
    subteam_breakdown: 'Build, Programming, Outreach, Business.',
    financial_ask_cents: 750_000,
    seed_funding_goals_cents: 500_000,
    tagline: 'Engineering the future, one match at a time.',
  },
  {
    owner_id: aviCoach.id,
    team_name: 'Iron Aviators',
    ftc_team_number: 18420,
    slug: 'iron-aviators-18420',
    organization: 'Roosevelt STEM Academy',
    city: 'Austin',
    state: 'TX',
    status: 'existing',
    public: true,
    tax_status: '501c3',
    mission_statement:
      'Iron Aviators exists to show underrepresented students that engineering is for them. Every season we field a competitive robot AND mentor two rookie teams.',
    technical_summary:
      'Four-bar linkage endgame climber, dead-wheel odometry, and a custom vision pipeline for sample detection.',
    github_link: 'https://github.com/example/iron-aviators',
    outreach_summary:
      'Co-hosted a Saturday robotics camp with Roosevelt STEM Academy reaching 120 Title I students.',
    founded_year: 2021,
    team_size: 11,
    seasons_competed: 4,
    coach_experience: '4 seasons coaching FTC; controls engineer and Roosevelt STEM Academy alum.',
    past_sponsors: ['Austin Tooling Co.'],
    press_links: [
      { label: 'Austin Chronicle: STEM Academy camp feature', url: 'https://example.com/iron-aviators-press' },
    ],
    community_endorsements:
      '“Iron Aviators onboarded three rookie teams in our district — real leadership.” — District STEM Coordinator',
    students_reached: 120,
    events_hosted: 4,
    volunteer_hours: 140,
    subteam_breakdown: 'Mechanical, Software, Outreach.',
    financial_ask_cents: 600_000,
    seed_funding_goals_cents: 400_000,
    tagline: 'Lifting limits — on robots and on students.',
  },
  {
    owner_id: vanCoach.id,
    team_name: 'Volt Vanguard',
    ftc_team_number: 22317,
    slug: 'volt-vanguard-22317',
    organization: 'Westlake Academy',
    city: 'San Francisco',
    state: 'CA',
    status: 'existing',
    public: true,
    tax_status: '501c3',
    mission_statement:
      'A student-run team that blends rigorous engineering with community education, holding free quarterly workshops for Bay Area middle-schoolers.',
    technical_summary:
      'Differential swerve prototype, PIDF-tuned slides, and a Limelight 3 vision system for AprilTag targeting.',
    github_link: 'https://github.com/example/volt-vanguard',
    outreach_summary:
      'Quarterly STEM workshops at Title I middle schools across San Francisco, reaching 350+ students this season.',
    founded_year: 2017,
    team_size: 18,
    seasons_competed: 8,
    coach_experience: '8 seasons coaching; software lead at an SF robotics startup and FIRST alum.',
    past_sponsors: ['Bayline Software', 'Golden Gate Credit Union', 'Mission Hardware'],
    press_links: [
      { label: 'SF Standard: Free robotics workshops for middle-schoolers', url: 'https://example.com/volt-vanguard-press' },
      { label: 'FIRST spotlight: Volt Vanguard outreach', url: 'https://example.com/volt-vanguard-first' },
    ],
    community_endorsements:
      '“Volt Vanguard’s library clubs are the most requested program we run.” — SF Public Library, Branch Manager',
    students_reached: 350,
    events_hosted: 8,
    volunteer_hours: 320,
    subteam_breakdown: 'Design, Fabrication, Software, Community.',
    financial_ask_cents: 850_000,
    seed_funding_goals_cents: 600_000,
    tagline: 'High voltage. High ambition.',
  },
]

const { data: createdTeams, error: teamErr } = await admin
  .from('teams')
  .insert(TEAMS)
  .select('id, team_name, ftc_team_number')

if (teamErr) {
  console.error('\n❌  Failed to create teams:', teamErr.message)
  process.exit(1)
}
for (const t of createdTeams) log(`Team: "${t.team_name}" #${t.ftc_team_number}  [${t.id}]`)

const [foxes, aviators, vanguard] = createdTeams

// ── Create achievements ───────────────────────────────────────────────────────

section('Creating team achievements')

const ACHIEVEMENTS = [
  { team_id: foxes.id, event_name: 'NorCal Regional', award: 'Inspire Award – 2nd Place', season: '2025-2026', description: 'Top-tier judged award for overall team excellence.' },
  { team_id: foxes.id, event_name: 'Silicon Valley Qualifier', award: 'Winning Alliance Captain', season: '2025-2026', description: null },
  { team_id: aviators.id, event_name: 'Central TX Qualifier', award: 'Think Award', season: '2025-2026', description: 'Recognized for innovative engineering process documentation.' },
  { team_id: vanguard.id, event_name: 'Bay Area Qualifier', award: 'Inspire Award – 1st Place', season: '2025-2026', description: 'Top judged award for overall team excellence.' },
  { team_id: vanguard.id, event_name: 'NorCal Championship', award: 'Finalist Alliance', season: '2025-2026', description: null },
]

const { error: achErr } = await admin.from('team_achievements').insert(ACHIEVEMENTS)
if (achErr) warn(`team_achievements insert: ${achErr.message}`)
else log(`Created ${ACHIEVEMENTS.length} achievements`)

// ── Create 3 dispatched submissions ──────────────────────────────────────────

section('Creating fake submissions')

const now = new Date()
const daysAgo = (n) => new Date(now - n * 86_400_000).toISOString()

const SUBMISSIONS = [
  {
    sponsor_id: sponsor.id,
    team_id: foxes.id,
    status: 'dispatched',
    season: '2025-2026',
    requested_amount_cents: 750_000,
    reserved_amount_cents: 750_000,
    custom_pitch_alignment:
      "Helix Robotics Foundation's mission to expand underrepresented STEM access mirrors our own — over half our roster is first-generation college-bound and we recruit entirely from Title I feeder schools.",
    specific_needs_statement:
      'This grant covers a second REV Control Hub ($250), competition registration ($850), travel to the NorCal Regional Championship ($5,400), and a replacement intake roller kit ($1,000). Without this funding we cannot send the full team to regionals.',
    local_connection_notes:
      "Two of our mentors are dev testing company alumni. We already partner with your foundation's annual Tech-for-All day as a demo team.",
    submitted_at: daysAgo(12),
    sent_at: daysAgo(11),
  },
  {
    sponsor_id: sponsor.id,
    team_id: aviators.id,
    status: 'dispatched',
    season: '2025-2026',
    requested_amount_cents: 600_000,
    reserved_amount_cents: 600_000,
    custom_pitch_alignment:
      "Your company prioritizes industrial automation pathways — Iron Aviators' four-bar linkage climber and dead-wheel odometry system were designed end-to-end by students who want careers in mechanical and controls engineering. We are a direct pipeline for the talent you want to see in the field.",
    specific_needs_statement:
      'We are requesting $6,000 to cover: travel to the Austin Regional ($3,200), a Limelight 3 vision module upgrade ($400), replacement goBILDA structural parts ($800), and a team laptop for on-field programming and debugging ($1,600).',
    local_connection_notes:
      "Roosevelt STEM Academy has a formal partnership with Austin-area industrial firms. A dev testing sponsorship would be highlighted in our school's annual STEM showcase, reaching 600+ families.",
    submitted_at: daysAgo(7),
    sent_at: daysAgo(6),
  },
  {
    sponsor_id: sponsor.id,
    team_id: vanguard.id,
    status: 'dispatched',
    season: '2025-2026',
    requested_amount_cents: 850_000,
    reserved_amount_cents: 850_000,
    custom_pitch_alignment:
      "Volt Vanguard and dev testing share geography and goals: we are both Bay Area-based and focused on broadening STEM access for students who would otherwise never see a robotics lab. Our quarterly workshops at Title I middle schools are already funded in part by two local tech companies — dev testing would join a cohort of forward-thinking sponsors with measurable community impact.",
    specific_needs_statement:
      "The $8,500 request funds: NorCal Championship travel and hotel for 15 students and 3 mentors ($4,800), raw aluminum and hardware for the 2026 robot build ($1,500), competition registration ($1,500), and workshop consumables for our after-school outreach program ($700).",
    local_connection_notes:
      "Westlake Academy is steps from your San Francisco office. We'd be glad to arrange a shop tour for your team and could co-brand our next community workshop as a dev testing event.",
    submitted_at: daysAgo(3),
    sent_at: daysAgo(3),
  },
]

const { data: createdSubs, error: subErr } = await admin
  .from('submissions')
  .insert(SUBMISSIONS)
  .select('id, status, requested_amount_cents, team_id')

if (subErr) {
  console.error('\n❌  Failed to create submissions:', subErr.message)
  process.exit(1)
}

for (const s of createdSubs) {
  const team = createdTeams.find((t) => t.id === s.team_id)
  log(`Submission for "${team?.team_name}" — $${s.requested_amount_cents / 100}  [${s.id}]`)
}

// Reflect total reserved in sponsor's funding_used_cents.
// Also bump funding_cap_cents to comfortably exceed the total ask so the
// dashboard doesn't show negative available budget.
const totalReserved = SUBMISSIONS.reduce((sum, s) => sum + s.reserved_amount_cents, 0)
const newCap = Math.ceil(totalReserved * 1.5 / 100_000) * 100_000  // round up to nearest $1k
const { error: capErr } = await admin
  .from('sponsors')
  .update({ funding_used_cents: totalReserved, funding_cap_cents: newCap })
  .eq('id', sponsor.id)
if (capErr) warn(`Could not update sponsor financials: ${capErr.message}`)
else log(`Sponsor cap=$${newCap / 100}, used=$${totalReserved / 100}`)

// ── Done ──────────────────────────────────────────────────────────────────────

console.log(`
╔══════════════════════════════════════════════════════════════╗
║              Fake pitches seeded successfully!                ║
╠══════════════════════════════════════════════════════════════╣
║  3 "dispatched" submissions now in the "dev testing" account  ║
║                                                               ║
║  Log in at Vercel as:                                         ║
║    Email:    sponsor+clerk_test@example.com                  ║
║    Password: SponsorTest123!                                  ║
╚══════════════════════════════════════════════════════════════╝
`)
