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
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './supabase/types'

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
  clerk_org_id: 'org_preview',
  company_name: 'Helix Robotics Foundation',
  contact_email: 'partnerships@helix.example',
  contact_name: 'Jordan Avery',
  contact_title: 'Director of Community Impact',
  created_at: '2026-01-12T15:00:00.000Z',
  updated_at: '2026-06-01T15:00:00.000Z',
  funding_cap_cents: 5_000_000, // $50,000 seasonal cap
  funding_used_cents: 1_850_000, // $18,500 committed
  approval_required_above_cents: 500_000, // $5,000 — so both above/below-threshold pitches exercise the flow
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

const fulfillments = [
  { id: 'f-1', sponsor_id: SPONSOR_ID, submission_id: 'preview-sub-4', team_id: TEAM_ID_A, amount_cents: 500_000, status: 'receipted', receipt_number: 'PF-2026-000001', pledged_at: '2026-04-15T11:00:00.000Z', payment_sent_at: '2026-04-17T11:00:00.000Z', payment_received_at: '2026-04-20T11:00:00.000Z', teams: { team_name: 'Quantum Foxes' } },
]

const receipts = [
  {
    id: 'rec-1',
    receipt_number: 'PF-2026-000001',
    fulfillment_id: 'f-1',
    transaction_id: 'txn-1',
    sponsor_id: SPONSOR_ID,
    team_id: TEAM_ID_A,
    amount_cents: 500_000,
    contribution_date: '2026-04-20',
    variant: 'charitable_501c3',
    payee_legal_name: 'Quantum Foxes Robotics Booster Club Inc.',
    payee_ein_last4: '1234',
    payee_tax_classification: '501c3_org',
    sponsor_legal_name: 'Helix Robotics Foundation',
    sponsor_contact_email: 'partnerships@helix.example',
    document_html: '<div style="padding: 24px;"><h1>Contribution acknowledgment</h1><p>Quantum Foxes Robotics Booster Club Inc. (EIN 12-3456789) acknowledges receipt of $5,000.00 from Helix Robotics Foundation on 2026-04-20.</p><p><strong>No goods or services were provided by Quantum Foxes Robotics Booster Club Inc. in exchange for this contribution.</strong></p></div>',
    document_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    copy_version: '2026-08-v1',
    copy_reviewed_at: null,
    status: 'issued',
    issued_at: '2026-04-20T12:00:00.000Z',
    emailed_at: '2026-04-20T12:01:00.000Z',
    teams: { team_name: 'Quantum Foxes' }
  },
  {
    id: 'rec-voided',
    receipt_number: 'PF-2026-000000',
    fulfillment_id: 'f-1',
    transaction_id: 'txn-1',
    sponsor_id: SPONSOR_ID,
    team_id: TEAM_ID_A,
    amount_cents: 500_000,
    contribution_date: '2026-04-20',
    variant: 'charitable_501c3',
    payee_legal_name: 'Quantum Foxes Robotics Team',
    payee_ein_last4: '1234',
    sponsor_legal_name: 'Helix Robotics Foundation',
    document_html: '<div style="padding: 24px;"><h1>Contribution acknowledgment</h1><p>Draft receipt superseded by PF-2026-000001.</p></div>',
    document_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    copy_version: '2026-08-v1',
    copy_reviewed_at: null,
    status: 'voided',
    issued_at: '2026-04-19T12:00:00.000Z',
    voided_at: '2026-04-20T11:59:00.000Z',
    voided_reason: 'Payee legal name updated from team name to booster club legal entity name.',
    superseded_by_receipt_id: 'rec-1',
    teams: { team_name: 'Quantum Foxes' }
  }
]

const MEMBER_PROFILE_ID = 'preview-member-profile'

const sponsorMembers = [
  {
    id: 'preview-sm-1',
    sponsor_id: SPONSOR_ID,
    profile_id: PROFILE_ID,
    clerk_org_id: 'org_preview',
    clerk_membership_id: 'orgmem_preview_1',
    role: 'org_admin',
    invited_by: null,
    invited_at: '2026-01-12T15:00:00.000Z',
    joined_at: '2026-01-12T15:00:00.000Z',
    created_at: '2026-01-12T15:00:00.000Z',
    updated_at: '2026-01-12T15:00:00.000Z',
    profiles: { id: PROFILE_ID, full_name: profile.full_name, email: profile.email },
  },
  {
    id: 'preview-sm-2',
    sponsor_id: SPONSOR_ID,
    profile_id: MEMBER_PROFILE_ID,
    clerk_org_id: 'org_preview',
    clerk_membership_id: 'orgmem_preview_2',
    role: 'submitter',
    invited_by: PROFILE_ID,
    invited_at: '2026-02-01T15:00:00.000Z',
    joined_at: '2026-02-02T15:00:00.000Z',
    created_at: '2026-02-01T15:00:00.000Z',
    updated_at: '2026-02-02T15:00:00.000Z',
    profiles: { id: MEMBER_PROFILE_ID, full_name: 'Sam Rivera', email: 'sam@preview.local' },
  },
  {
    id: 'preview-sm-3',
    sponsor_id: SPONSOR_ID,
    profile_id: 'preview-viewer-profile',
    clerk_org_id: 'org_preview',
    clerk_membership_id: 'orgmem_preview_3',
    role: 'viewer',
    invited_by: PROFILE_ID,
    invited_at: '2026-03-01T15:00:00.000Z',
    joined_at: '2026-03-02T15:00:00.000Z',
    created_at: '2026-03-01T15:00:00.000Z',
    updated_at: '2026-03-02T15:00:00.000Z',
    profiles: { id: 'preview-viewer-profile', full_name: 'Casey Lin', email: 'casey@preview.local' },
  },
]

// A pending proposal on Iron Aviators (below the sponsor's $5,000 threshold pitches
// settle immediately; this one is above it) plus one closed proposal, so
// /sponsor/approvals has both an actionable row and a "recently closed" row in preview.
const sponsorDecisionProposals = [
  {
    id: 'preview-proposal-1',
    submission_id: 'preview-sub-2',
    sponsor_id: SPONSOR_ID,
    decision: 'approved',
    amount_cents: 600_000,
    feedback: 'Approving the full amount — great alignment with our automation focus.',
    status: 'pending',
    origin: 'portal',
    proposed_by: MEMBER_PROFILE_ID,
    proposed_at: '2026-06-05T10:00:00.000Z',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    closed_reason: null,
    settled_amount_cents: null,
    expires_at: '2026-06-12T10:00:00.000Z',
    created_at: '2026-06-05T10:00:00.000Z',
    updated_at: '2026-06-05T10:00:00.000Z',
    submissions: { id: 'preview-sub-2', teams: { team_name: 'Iron Aviators', ftc_team_number: 18420 } },
    proposer: { full_name: 'Sam Rivera', email: 'sam@preview.local' },
    approver: null,
  },
  {
    id: 'preview-proposal-2',
    submission_id: 'preview-sub-4',
    sponsor_id: SPONSOR_ID,
    decision: 'approved',
    amount_cents: 500_000,
    feedback: null,
    status: 'confirmed',
    origin: 'portal',
    proposed_by: MEMBER_PROFILE_ID,
    proposed_at: '2026-04-14T09:00:00.000Z',
    decided_by: PROFILE_ID,
    decided_at: '2026-04-15T11:00:00.000Z',
    decision_note: 'Confirmed — matches the outreach kit budget.',
    closed_reason: null,
    settled_amount_cents: 500_000,
    expires_at: '2026-04-21T09:00:00.000Z',
    created_at: '2026-04-14T09:00:00.000Z',
    updated_at: '2026-04-15T11:00:00.000Z',
    submissions: { id: 'preview-sub-4', teams: { team_name: 'Quantum Foxes', ftc_team_number: 31579 } },
    proposer: { full_name: 'Sam Rivera', email: 'sam@preview.local' },
    approver: { full_name: profile.full_name, email: profile.email },
  },
]

const agreementSignatures = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    template_id: 'agr-1',
    template_key: 'sponsorship_agreement',
    template_version: 1,
    signer_profile_id: PROFILE_ID,
    signer_role: 'sponsor',
    signer_legal_name: profile.full_name,
    signer_email: profile.email,
    submission_id: 'preview-sub-4',
    sponsor_id: SPONSOR_ID,
    team_id: TEAM_ID_A,
    entity_snapshot: { team_number: teamA.ftc_team_number, team_name: teamA.team_name, team_organization: teamA.organization, sponsor_company_name: sponsor.company_name, amount_cents: 500_000 },
    typed_name: profile.full_name,
    signed_at: '2026-04-15T11:02:00.000Z',
    ip_address: '203.0.113.10',
    user_agent: 'Mozilla/5.0 (dev preview)',
    document_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    document_storage_path: 'preview/sig-sponsor-1.html',
    consent_text_version: 1,
    consent_text_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    created_at: '2026-04-15T11:02:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    template_id: 'agr-1',
    template_key: 'sponsorship_agreement',
    template_version: 1,
    signer_profile_id: 'preview-coach',
    signer_role: 'coach',
    signer_legal_name: 'Preview Coach',
    signer_email: 'coach@preview.local',
    submission_id: 'preview-sub-4',
    sponsor_id: SPONSOR_ID,
    team_id: TEAM_ID_A,
    entity_snapshot: { team_number: teamA.ftc_team_number, team_name: teamA.team_name, team_organization: teamA.organization, sponsor_company_name: sponsor.company_name, amount_cents: 500_000 },
    typed_name: 'Preview Coach',
    signed_at: '2026-04-16T09:30:00.000Z',
    ip_address: '203.0.113.42',
    user_agent: 'Mozilla/5.0 (dev preview)',
    document_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    document_storage_path: 'preview/sig-coach-1.html',
    consent_text_version: 1,
    consent_text_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    created_at: '2026-04-16T09:30:00.000Z',
  },
]

// Q&A thread (0085). Only RELEASED coach messages appear here: a sponsor must never see a
// reply that is still in review, and the preview should not model a state the real policies
// forbid. The sponsor's own question is here too, which is what the composer produces.
const submissionMessages = [
  {
    id: 'msg-1', submission_id: 'preview-sub-2', author_role: 'sponsor',
    author_profile_id: PROFILE_ID, author_token_id: null,
    author_label: 'Dana Cole', status: 'released',
    body: 'Is the 501(c)(3) the school district, or a separate booster club? Our grants team needs the payee EIN to match.',
    released_at: '2026-06-04T10:02:00.000Z', released_by: null, rejected_reason: null,
    flagged_at: null, flagged_by: null, created_at: '2026-06-04T10:02:00.000Z',
  },
  {
    id: 'msg-2', submission_id: 'preview-sub-2', author_role: 'coach',
    author_profile_id: 'preview-coach-1', author_token_id: null,
    author_label: 'Maria Gomez', status: 'released',
    body: 'A separate booster club — Iron Aviators Booster Club. I can send the determination letter to whichever address your grants team prefers.',
    released_at: '2026-06-05T15:40:00.000Z', released_by: null, rejected_reason: null,
    flagged_at: null, flagged_by: null, created_at: '2026-06-05T09:18:00.000Z',
  },
]

const FIXTURES: Record<string, unknown[]> = {
  profiles: [profile],
  sponsors: [sponsor],
  teams: [teamA, teamB, teamC],
  submissions,
  notifications,
  transactions_ledger: transactions,
  funding_fulfillments: fulfillments,
  funding_receipts: receipts,
  agreement_signatures: agreementSignatures,
  sponsor_members: sponsorMembers,
  sponsor_decision_proposals: sponsorDecisionProposals,
  submission_messages: submissionMessages,
  // Sponsors see no appeals — appeals have no sponsor RLS policy (0086). The key exists so
  // the mock client returns [] rather than undefined.
  appeals: [],
  // One award seen from the sponsor's side: one benefit delivered with proof, one still
  // outstanding so the "Not needed" waive control is browsable.
  sponsor_recognition_awards: [
    {
      id: 'award-preview-s1',
      fulfillment_id: 'ff-preview-s1',
      sponsor_id: sponsor.id,
      team_id: teamA.id,
      amount_cents: 300000,
      tier_id: 'tier-silver',
      tier_name_snapshot: 'Silver',
      tier_rank_snapshot: 2,
      tier_min_amount_cents_snapshot: 250000,
      benefits_snapshot: ['logo_on_website', 'social_media_mention'],
      awarded_at: '2026-06-20T15:00:00.000Z',
      created_at: '2026-06-20T15:00:00.000Z',
      updated_at: '2026-07-05T15:00:00.000Z',
      teams: { team_name: teamA.team_name },
      recognition_benefit_deliveries: [
        {
          id: 'del-preview-s1', award_id: 'award-preview-s1', benefit_type: 'logo_on_website',
          status: 'delivered',
          proof_url: 'https://example.supabase.co/storage/v1/object/public/pitch-media/user_c1/recognition/del-preview-s1.jpg',
          proof_uploaded_at: '2026-07-05T15:00:00.000Z',
          delivered_at: '2026-07-05T15:00:00.000Z',
        },
        {
          id: 'del-preview-s2', award_id: 'award-preview-s1', benefit_type: 'social_media_mention',
          status: 'promised',
          proof_url: null, proof_uploaded_at: null, delivered_at: null,
        },
      ],
    },
  ],
  recognition_benefit_deliveries: [],
  // One open and one closed year, so the index's Open/Final chips and the print view are
  // both browsable without a database.
  impact_report_snapshots: [
    {
      id: 'snap-2026', scope: 'sponsor', sponsor_id: sponsor.id, report_year: 2026,
      status: 'open', payload_schema_version: 1,
      generated_at: '2026-08-01T06:00:00.000Z', closed_at: null,
      payload: {
        schema_version: 1, year: 2026, generated_at: '2026-08-01T06:00:00.000Z',
        sponsor: { company_name: sponsor.company_name, logo_url: null },
        totals: {
          pledged_cents: 300000, received_cents: 100000, outstanding_cents: 200000,
          teams_supported: 1, students_reached: 1200, events_hosted: 8,
          volunteer_hours: 340, benefits_promised: 2, benefits_delivered: 1,
        },
        teams: [
          {
            team: {
              ftc_team_number: 31579, team_name: teamA.team_name, organization: 'Plano East Senior High',
              city: 'Plano', state: 'TX', tax_status: '501c3', founded_year: 2019,
              seasons_competed: 6, team_size: 22, students_reached: 1200, events_hosted: 8,
              volunteer_hours: 340, tagline: 'Engineering the next generation.',
              mission_statement: 'We build robots and community.',
              outreach_summary: 'Summer camps and library demos.', logo_url: null,
              media_urls: [],
            },
            achievements: [{ season: '2025-26', event_name: 'North Texas Regional', award: 'Inspire Award', description: null }],
            fulfillments: [{ amount_cents: 300000, status: 'payment_sent', pledged_at: '2026-03-01T00:00:00.000Z', payment_received_at: null, receipted_at: null }],
            recognition: {
              tier_name: 'Silver',
              benefits: [
                { benefit_type: 'logo_on_website', status: 'delivered', delivered_at: '2026-07-05T00:00:00.000Z', proof_url: null },
                { benefit_type: 'social_media_mention', status: 'promised', delivered_at: null, proof_url: null },
              ],
            },
          },
        ],
        footnotes: ['The platform never handles funds.'],
      },
    },
    {
      id: 'snap-2025', scope: 'sponsor', sponsor_id: sponsor.id, report_year: 2025,
      status: 'closed', payload_schema_version: 1,
      generated_at: '2026-01-02T04:00:00.000Z', closed_at: '2026-01-02T04:00:00.000Z',
      payload: {
        schema_version: 1, year: 2025, generated_at: '2026-01-02T04:00:00.000Z',
        sponsor: { company_name: sponsor.company_name, logo_url: null },
        totals: {
          pledged_cents: 150000, received_cents: 150000, outstanding_cents: 0,
          teams_supported: 1, students_reached: 800, events_hosted: 5,
          volunteer_hours: 210, benefits_promised: 1, benefits_delivered: 1,
        },
        teams: [],
        footnotes: ['The platform never handles funds.'],
      },
    },
  ],
  public_platform_stats: [
    {
      id: true, teams_supported: 12, sponsors_active: 5, dollars_pledged_cents: 4200000,
      dollars_received_cents: 2600000, students_reached: 9400, events_hosted: 61,
      volunteer_hours: 3100, refreshed_at: '2026-08-13T04:00:00.000Z',
    },
  ],
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

/**
 * Typed as a full SupabaseClient (same `as unknown as` pattern as lib/dev-bypass.ts and
 * lib/dev-coach-preview.ts) so `createAdminClient()` can return it in sponsor-preview
 * mode without widening its return type at every call site.
 *
 * `rpc` and `storage` are stubs rather than omissions on purpose: this client is now
 * reachable from server actions, which previously got a LIVE production service-role
 * client under `npm run dev:sponsor-preview`. A missing member would crash the preview;
 * a stub keeps it browsable and, more importantly, keeps the write off production.
 */
export function createMockSupabaseClient(): SupabaseClient<Database> {
  return {
    from(table: string) {
      return makeBuilder(FIXTURES[table] ?? [])
    },
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: '#dev-mock' }, error: null }),
        upload: async () => ({ data: { path: 'dev-mock' }, error: null }),
        remove: async () => ({ data: [], error: null }),
        getPublicUrl: () => ({ data: { publicUrl: '#dev-mock' } }),
        // See dev-bypass: the retention purge lists a prefix before deleting it.
        list: async () => ({ data: [], error: null }),
      }),
    },
  } as unknown as SupabaseClient<Database>
}
