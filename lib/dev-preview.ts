/**
 * DEV-ONLY sponsor portal preview.
 *
 * Lets you browse the entire sponsor portal on localhost with no Clerk sign-in
 * and no live Supabase — every read resolves to the static fixtures below.
 * Purely for UI/UX editing.
 *
 * Activated ONLY when running `next dev` (NODE_ENV !== 'production') AND
 * `NEXT_PUBLIC_SPONSOR_PREVIEW=1`. It can never switch on in a production build,
 * so it is safe to leave the wiring in place.
 *
 * Launch with:  npm run dev:sponsor-preview
 */

export const SPONSOR_PREVIEW =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_SPONSOR_PREVIEW === '1'

const PROFILE_ID = 'preview-profile'
const SPONSOR_ID = 'preview-sponsor'
const TEAM_ID_A = 'preview-team-a'
const TEAM_ID_B = 'preview-team-b'
const TEAM_ID_C = 'preview-team-c'

// ---- static fixtures -------------------------------------------------------

const sponsor = {
  id: SPONSOR_ID,
  company_name: 'Helix Robotics Foundation',
  contact_email: 'partnerships@helix.example',
  contact_name: 'Jordan Avery',
  contact_title: 'Director of Community Impact',
  created_at: '2026-01-12T15:00:00.000Z',
  updated_at: '2026-06-01T15:00:00.000Z',
  funding_cap_cents: 5_000_000, // $50,000 seasonal cap
  funding_used_cents: 1_850_000, // $18,500 committed
  geo_states: ['CA', 'TX', 'NY'],
  industry: 'Industrial Automation',
  logo_url: null,
  notes: null,
  search_vector: null,
  source: 'admin_added',
  status: 'active',
  website: 'https://helix.example',
}

const profile = {
  id: PROFILE_ID,
  clerk_user_id: 'preview-clerk-user',
  email: 'sponsor@preview.local',
  full_name: 'Jordan Avery',
  role: 'sponsor',
  sponsor_id: SPONSOR_ID,
  coach_verified: false,
  coppa_acknowledged: false,
  tos_accepted: true,
  age_confirmed_at: null,
  date_of_birth: null,
  city: 'San Jose',
  state: 'CA',
  zip_code: '95113',
  phone_number: null,
  coach_credentials_url: null,
  pending_team_data: null,
  referral_source: null,
  created_at: '2026-01-12T15:00:00.000Z',
  updated_at: '2026-06-01T15:00:00.000Z',
  // nested join used by `.select('*, sponsors(*)')`
  sponsors: sponsor,
}

function makeTeam(id: string, over: Record<string, unknown>) {
  return {
    id,
    owner_id: 'preview-coach',
    team_name: 'Team',
    ftc_team_number: 11111,
    slug: 'team',
    organization: 'Lincoln High School',
    city: 'San Jose',
    state: 'CA',
    tagline: 'Engineering the future, one match at a time.',
    mission_statement:
      'We are a student-led FTC team building competitive robots while running STEM outreach for our community.',
    technical_summary:
      'Custom swerve drive, dual-motor linear lift, and a vision-assisted auto routine.',
    outreach_summary: 'Ran 6 community workshops reaching 200+ students this season.',
    community_interest_text: 'Mentoring two new rookie teams in our district.',
    subteam_breakdown: 'Build, Programming, Outreach, Business.',
    founded_year: 2019,
    team_size: 14,
    seasons_competed: 6,
    coach_experience: '6th season mentoring FTC; mechanical engineer with a decade in industry.',
    past_sponsors: ['Bay Area Machine Works', 'Rotary Club of San Jose'],
    press_links: [
      { label: 'Mercury News: Students build robots and futures', url: 'https://news.example/quantum-foxes' },
    ],
    community_endorsements:
      '“This team transformed our after-school STEM program.” — Principal, Lincoln High School',
    students_reached: 200,
    events_hosted: 6,
    volunteer_hours: 180,
    sustainability_plan: 'Alumni mentorship pipeline plus recurring local business sponsorships keep us funded year over year.',
    financial_ask_cents: 750_000,
    seed_funding_goals_cents: 500_000,
    tax_status: '501c3',
    status: 'existing',
    public: true,
    github_link: 'https://github.com/example/team',
    youtube_url: null,
    logo_url: null,
    coach_photo_url: null,
    budget_items: [],
    media_urls: [],
    visual_pitch_items: [],
    team_members: [],
    deleted_at: null,
    created_at: '2026-02-01T15:00:00.000Z',
    updated_at: '2026-06-01T15:00:00.000Z',
    team_achievements: [],
    ...over,
  }
}

const teamA = makeTeam(TEAM_ID_A, {
  team_name: 'Quantum Foxes',
  ftc_team_number: 31579,
  slug: 'quantum-foxes',
  team_achievements: [
    { id: 'ach-1', team_id: TEAM_ID_A, event_name: 'NorCal Regional', award: 'Inspire Award – 2nd', season: '2025-2026', description: 'Top-tier judged award for overall excellence.', created_at: '2026-03-01T15:00:00.000Z' },
    { id: 'ach-2', team_id: TEAM_ID_A, event_name: 'Silicon Valley Qualifier', award: 'Winning Alliance Captain', season: '2025-2026', description: null, created_at: '2026-02-15T15:00:00.000Z' },
  ],
})

const teamB = makeTeam(TEAM_ID_B, {
  team_name: 'Iron Aviators',
  ftc_team_number: 18420,
  slug: 'iron-aviators',
  organization: 'Roosevelt STEM Academy',
  city: 'Austin',
  state: 'TX',
  tagline: 'Lifting limits — on robots and on students.',
  mission_statement:
    'Iron Aviators exists to show underrepresented students that engineering is for them. Every season we field a competitive robot AND mentor two rookie teams in our district.',
  technical_summary:
    'Four-bar linkage endgame climber, dead-wheel odometry, and a custom vision pipeline for sample detection.',
  outreach_summary: 'Co-hosted a Saturday robotics camp with Roosevelt STEM Academy that reached 120 Title I students.',
  community_interest_text: 'Running a district rookie intake program that has on-boarded 3 new teams since 2024.',
  founded_year: 2021,
  team_size: 11,
  seasons_competed: 4,
  coach_experience: '4 seasons coaching FTC; controls engineer and Roosevelt STEM Academy alum.',
  past_sponsors: ['Austin Tooling Co.'],
  press_links: [
    { label: 'Austin Chronicle: STEM Academy camp feature', url: 'https://news.example/iron-aviators' },
  ],
  community_endorsements:
    '“Iron Aviators onboarded three rookie teams in our district — real leadership.” — District STEM Coordinator',
  students_reached: 120,
  events_hosted: 4,
  volunteer_hours: 140,
  sustainability_plan: 'School-district partnership covers meeting space; recurring camp revenue funds registration.',
  financial_ask_cents: 600_000,
  seed_funding_goals_cents: 400_000,
  team_achievements: [
    { id: 'ach-b1', team_id: TEAM_ID_B, event_name: 'Central TX Qualifier', award: 'Think Award', season: '2025-2026', description: 'Recognized for innovative engineering process documentation.', created_at: '2026-01-18T15:00:00.000Z' },
  ],
})

const teamC = makeTeam(TEAM_ID_C, {
  team_name: 'Volt Vanguard',
  ftc_team_number: 22317,
  slug: 'volt-vanguard',
  organization: 'Westlake Academy',
  city: 'San Francisco',
  state: 'CA',
  tagline: 'High voltage. High ambition.',
  mission_statement:
    'Volt Vanguard is a student-run team that blends rigorous engineering with community education, holding free quarterly workshops for Bay Area middle-schoolers.',
  technical_summary:
    'Differential swerve prototype, PIDF-tuned slides, and a Limelight 3 vision system for AprilTag targeting.',
  outreach_summary: 'Quarterly STEM workshops at Title I middle schools across San Francisco, reaching 350+ students this season.',
  community_interest_text: 'Partner with two local libraries to run after-school robotics clubs.',
  founded_year: 2017,
  team_size: 18,
  seasons_competed: 8,
  coach_experience: '8 seasons coaching; software lead at a SF robotics startup and FIRST alum.',
  past_sponsors: ['Bayline Software', 'Golden Gate Credit Union', 'Mission Hardware'],
  press_links: [
    { label: 'SF Standard: Free robotics workshops for middle-schoolers', url: 'https://news.example/volt-vanguard' },
    { label: 'FIRST spotlight: Volt Vanguard outreach', url: 'https://news.example/volt-vanguard-first' },
  ],
  community_endorsements:
    '“Volt Vanguard’s library clubs are the most requested program we run.” — SF Public Library, Branch Manager',
  students_reached: 350,
  events_hosted: 8,
  volunteer_hours: 320,
  sustainability_plan: 'Two multi-year tech sponsors plus workshop grants cover our base budget each season.',
  financial_ask_cents: 850_000,
  seed_funding_goals_cents: 600_000,
  budget_items: [
    { qty: 1, label: 'Limelight 3 vision module', total_cents: 40_000 },
    { qty: 2, label: 'REV Expansion Hub', total_cents: 30_000 },
    { qty: 1, label: 'Championship travel (flights + hotel)', total_cents: 480_000 },
    { qty: 1, label: 'Raw materials (aluminum, hardware)', total_cents: 150_000 },
    { qty: 1, label: 'Registration fees', total_cents: 150_000 },
  ],
  team_achievements: [
    { id: 'ach-c1', team_id: TEAM_ID_C, event_name: 'Bay Area Qualifier', award: 'Inspire Award – 1st', season: '2025-2026', description: 'Top judged award for overall excellence.', created_at: '2026-02-08T15:00:00.000Z' },
    { id: 'ach-c2', team_id: TEAM_ID_C, event_name: 'NorCal Championship', award: 'Finalist Alliance', season: '2025-2026', description: null, created_at: '2026-03-22T15:00:00.000Z' },
  ],
})

function makeSubmission(id: string, team: typeof teamA, over: Record<string, unknown>) {
  return {
    id,
    sponsor_id: SPONSOR_ID,
    team_id: team.id,
    status: 'pending',
    requested_amount_cents: 750_000,
    custom_pitch_alignment:
      'Your foundation funds underrepresented STEM programs — half our roster is first-generation college-bound.',
    specific_needs_statement:
      'Funding covers a second Control Hub, competition registration, and travel to the regional championship.',
    local_connection_notes: 'Two of our mentors are Helix Robotics alumni.',
    admin_feedback: null,
    season: '2025-2026',
    variant_label: null,
    is_locked: false,
    requested_amount: 7500,
    reviewed_at: null,
    reviewed_by: null,
    submitted_at: '2026-05-20T15:00:00.000Z',
    sent_at: '2026-05-21T15:00:00.000Z',
    delivered_at: null,
    expires_at: null,
    deleted_at: null,
    resend_message_id: null,
    created_at: '2026-05-20T15:00:00.000Z',
    updated_at: '2026-05-21T15:00:00.000Z',
    // nested joins
    teams: team,
    sponsors: { company_name: sponsor.company_name },
    ...over,
  }
}

const submissions = [
  // Pitch 1 — Quantum Foxes (pending, in the review queue)
  makeSubmission('preview-sub-1', teamA, {
    status: 'pending',
    requested_amount_cents: 750_000,
    requested_amount: 7500,
    custom_pitch_alignment:
      "Helix Robotics Foundation's mission to expand underrepresented STEM access mirrors our own — over half our roster is first-generation college-bound and we recruit entirely from Title I feeder schools.",
    specific_needs_statement:
      'This grant covers a second REV Control Hub ($250), competition registration ($850), travel to the NorCal Regional Championship ($5,400), and a replacement intake roller kit ($1,000). Without this funding we cannot send the full team to regionals.',
    local_connection_notes:
      "Two of our mentors are Helix Robotics Foundation alumni (class of 2019). We already partner with your foundation's annual Tech-for-All day as a demo team.",
    submitted_at: '2026-05-20T15:00:00.000Z',
    sent_at: '2026-05-21T09:14:00.000Z',
  }),

  // Pitch 2 — Iron Aviators (pending, different ask and angle)
  makeSubmission('preview-sub-2', teamB, {
    status: 'pending',
    requested_amount_cents: 600_000,
    requested_amount: 6000,
    custom_pitch_alignment:
      "Your foundation prioritizes industrial automation pathways — Iron Aviators' four-bar linkage climber and dead-wheel odometry system were designed end-to-end by students who want careers in mechanical and controls engineering. We are a direct pipeline for the talent you want to see in the field.",
    specific_needs_statement:
      'We are requesting $6,000 to cover: travel to the Austin Regional ($3,200), a Limelight 3 vision module upgrade ($400), replacement goBILDA structural parts ($800), and a team laptop for on-field programming and debugging ($1,600).',
    local_connection_notes:
      "Roosevelt STEM Academy has a formal partnership with Austin-area industrial firms. A Helix sponsorship would be highlighted in our school's annual STEM showcase, reaching 600+ families.",
    submitted_at: '2026-06-01T10:30:00.000Z',
    sent_at: '2026-06-02T08:00:00.000Z',
  }),

  // Pitch 3 — Volt Vanguard (pending, highest ask, strongest resume)
  makeSubmission('preview-sub-3', teamC, {
    status: 'pending',
    requested_amount_cents: 850_000,
    requested_amount: 8500,
    custom_pitch_alignment:
      'Volt Vanguard and Helix share geography and goals: we are both Bay Area-based and focused on broadening STEM access for students who would otherwise never see a robotics lab. Our quarterly workshops at Title I middle schools are already funded in part by two local tech companies — Helix would join a cohort of forward-thinking sponsors with measurable community impact.',
    specific_needs_statement:
      'The $8,500 request funds: NorCal Championship travel and hotel for 15 students and 3 mentors ($4,800), raw aluminum and hardware for the 2026 robot build ($1,500), competition registration ($1,500), and workshop consumables (3D filament, wire, connectors) for our after-school outreach program ($700).',
    local_connection_notes:
      "Westlake Academy is three miles from Helix's San Francisco office. We'd be glad to arrange a shop tour for your team and could co-brand our next community workshop as a Helix Robotics Foundation event.",
    submitted_at: '2026-06-10T14:00:00.000Z',
    sent_at: '2026-06-10T14:05:00.000Z',
  }),

  // Pitch 4 — Quantum Foxes second pitch, already approved (for contrast)
  makeSubmission('preview-sub-4', teamA, {
    status: 'approved',
    requested_amount_cents: 500_000,
    requested_amount: 5000,
    custom_pitch_alignment:
      "Follow-up request for our outreach kit after the regional championship — fully aligned with Helix's education mandate.",
    specific_needs_statement: 'STEM kit materials for our summer workshop series (6 sessions, ~40 students each).',
    local_connection_notes: 'Continuing from our existing Helix partnership.',
    reviewed_at: '2026-04-15T11:00:00.000Z',
    submitted_at: '2026-04-10T10:00:00.000Z',
    sent_at: '2026-04-10T10:30:00.000Z',
  }),
]

const notifications = [
  { id: 'ntf-1', recipient_id: PROFILE_ID, type: 'general', title: 'New pitch from Quantum Foxes', body: 'A new sponsorship pitch from Quantum Foxes (#31579) is waiting for your review.', submission_id: 'preview-sub-1', read_at: null, created_at: '2026-05-21T09:14:00.000Z' },
  { id: 'ntf-2', recipient_id: PROFILE_ID, type: 'general', title: 'New pitch from Iron Aviators', body: 'Iron Aviators (#18420) submitted a sponsorship pitch for your review.', submission_id: 'preview-sub-2', read_at: null, created_at: '2026-06-02T08:00:00.000Z' },
  { id: 'ntf-3', recipient_id: PROFILE_ID, type: 'general', title: 'New pitch from Volt Vanguard', body: 'Volt Vanguard (#22317) from San Francisco sent you a pitch. They are a Inspire Award winner.', submission_id: 'preview-sub-3', read_at: null, created_at: '2026-06-10T14:05:00.000Z' },
  { id: 'ntf-4', recipient_id: PROFILE_ID, type: 'submission_approved', title: 'Funding confirmed — Quantum Foxes', body: 'You approved $5,000 for Quantum Foxes (outreach kit follow-up).', submission_id: 'preview-sub-4', read_at: '2026-04-15T12:00:00.000Z', created_at: '2026-04-15T11:05:00.000Z' },
]

const transactions = [
  { id: 'txn-1', sponsor_id: SPONSOR_ID, submission_id: 'preview-sub-4', team_id: TEAM_ID_A, amount_cents: 500_000, actor_type: 'sponsor', decision_type: 'approve', created_at: '2026-04-15T11:00:00.000Z', teams: { team_name: 'Quantum Foxes' } },
]

const FIXTURES: Record<string, unknown[]> = {
  profiles: [profile],
  sponsors: [sponsor],
  teams: [teamA, teamB, teamC],
  submissions,
  notifications,
  transactions_ledger: transactions,
  team_achievements: [
    ...teamA.team_achievements,
    ...teamB.team_achievements as any[],
    ...teamC.team_achievements as any[],
  ],
}

export const mockProfile = profile

// ---- chainable mock Supabase client ---------------------------------------
//
// Supports the read patterns the sponsor pages use:
//   .from(t).select(...).eq(...).order(...).limit(...)            -> awaited array
//   .from(t).select(...).eq(...).single() / .maybeSingle()       -> first row
// Filters are intentionally ignored — fixtures are tiny and fixed. Writes are
// no-ops so an accidental button click won't hard-crash the preview.

function makeBuilder(rows: unknown[]) {
  const result = { data: rows, error: null }
  const single = { data: rows[0] ?? null, error: null }
  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    upsert: () => builder,
    delete: () => builder,
    eq: () => builder,
    neq: () => builder,
    is: () => builder,
    in: () => builder,
    gt: () => builder,
    gte: () => builder,
    lt: () => builder,
    lte: () => builder,
    like: () => builder,
    ilike: () => builder,
    or: () => builder,
    not: () => builder,
    contains: () => builder,
    overlaps: () => builder,
    order: () => builder,
    limit: () => builder,
    range: () => builder,
    single: () => Promise.resolve(single),
    maybeSingle: () => Promise.resolve(single),
    then: (resolve: (v: typeof result) => unknown) => resolve(result),
  }
  return builder
}

export function createMockSupabaseClient() {
  return {
    from(table: string) {
      return makeBuilder(FIXTURES[table] ?? [])
    },
  }
}
