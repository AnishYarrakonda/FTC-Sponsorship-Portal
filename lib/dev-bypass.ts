/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
//
// DEV-ONLY auth bypass + mock Supabase data.
//
// Lets you open the admin portal on localhost with NO sign-in, rendering on
// fully static mock data so the real (production) Supabase is never touched.
//
// HARD SAFETY GUARD: this is forced OFF whenever NODE_ENV === 'production', so
// even if NEXT_PUBLIC_DEV_AUTH_BYPASS=true leaks into a deployed build it does
// nothing. Turn it on for local work by setting the env var in .env.local.
//
// Flip the switch:  NEXT_PUBLIC_DEV_AUTH_BYPASS=true   (in .env.local)
//
import type { Database } from './supabase/types'
import { PREVIEW_PLACEHOLDER_IMAGE } from './dev-placeholder-image'
import type { SupabaseClient } from '@supabase/supabase-js'

type Profile = Database['public']['Tables']['profiles']['Row']

/** True only in local dev with the env flag set. Never true in production. */
export function isDevAuthBypass(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true'
  )
}

// ── Stable ids / timestamps ──────────────────────────────────────────────────
const ADMIN_ID = '00000000-0000-4000-8000-000000000001'
const iso = (daysAgo = 0) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString()

/** The fake admin profile the auth guards hand back under bypass. */
export const MOCK_ADMIN_PROFILE = {
  id: ADMIN_ID,
  clerk_user_id: 'user_dev_admin',
  role: 'admin',
  // Without this the preview breaks the moment any page calls requireSuperAdmin() (0084).
  admin_level: 'super_admin',
  full_name: 'Dev Admin',
  email: 'admin+clerk_test@example.com',
  coach_verified: false,
  sponsor_id: null,
  coach_credentials_url: null,
  date_of_birth: null,
  phone_number: null,
  address_line1: null,
  city: null,
  state: null,
  zip_code: null,
  referral_source: null,
  coppa_acknowledged: true,
  tos_accepted: true,
  pending_team_data: null,
  created_at: iso(120),
  updated_at: iso(0),
} as unknown as Profile

// ── Canned datasets (keyed by table / view name) ─────────────────────────────
const budgetItems = [
  { qty: 1, label: 'CNC mill time', total_cents: 90_000 },
  { qty: 4, label: 'NEO motors', total_cents: 60_000 },
  { qty: 1, label: 'Competition travel', total_cents: 100_000 },
]

const DATA: Record<string, any[]> = {
  profiles: [
    MOCK_ADMIN_PROFILE,
    {
      id: 'c1', clerk_user_id: 'user_c1', role: 'coach', full_name: 'Anish Yarrakonda',
      email: 'coach+clerk_test@example.com', coach_verified: true, coach_credentials_url: null,
      sponsor_id: null, date_of_birth: '1990-04-12', phone_number: '(214) 555-0131',
      address_line1: '120 Robotics Way', city: 'Plano', state: 'TX', zip_code: '75024',
      referral_source: 'FIRST regional', coppa_acknowledged: true, tos_accepted: true,
      pending_team_data: null, created_at: iso(60), updated_at: iso(5),
      teams: [{ team_name: 'Exodius', ftc_team_number: 31579, city: 'Plano', state: 'TX' }],
    },
    {
      id: 'c2', clerk_user_id: 'user_c2', role: 'coach', full_name: 'Jordan Lee',
      email: 'jordan.lee@example.com', coach_verified: false,
      coach_credentials_url: 'c2/photo-id.jpg', sponsor_id: null,
      date_of_birth: '1988-09-02', phone_number: '(469) 555-0188',
      address_line1: '88 Maker St', city: 'Frisco', state: 'TX', zip_code: '75034',
      referral_source: 'School mentor', coppa_acknowledged: true, tos_accepted: true,
      pending_team_data: { team_name: 'Robo Knights', ftc_team_number: 21044 },
      created_at: iso(3), updated_at: iso(3), teams: [],
    },
    {
      id: 'c3', clerk_user_id: 'user_c3', role: 'coach', full_name: 'Priya Patel',
      email: 'priya.patel@example.com', coach_verified: false,
      coach_credentials_url: 'c3/photo-id.jpg', sponsor_id: null,
      date_of_birth: '1992-01-23', phone_number: '(972) 555-0142',
      address_line1: '7 Circuit Ln', city: 'Allen', state: 'TX', zip_code: '75013',
      referral_source: 'Returning coach', coppa_acknowledged: true, tos_accepted: true,
      pending_team_data: { team_name: 'Volt Vipers', ftc_team_number: 18820 },
      created_at: iso(1), updated_at: iso(1), teams: [],
    },
    {
      id: 'c4', clerk_user_id: 'user_c4', role: 'coach', full_name: 'Sam Rivera',
      email: 'sam.rivera@example.com', coach_verified: false, coach_credentials_url: null,
      sponsor_id: null, date_of_birth: null, phone_number: null, address_line1: null,
      city: null, state: null, zip_code: null, referral_source: 'Web search',
      coppa_acknowledged: true, tos_accepted: true, pending_team_data: null,
      created_at: iso(2), updated_at: iso(2), teams: [],
    },
    {
      id: 'c5', clerk_user_id: 'user_c5', role: 'coach', full_name: 'Maria Gomez',
      email: 'maria.gomez@example.com', coach_verified: true, coach_credentials_url: null,
      sponsor_id: null, date_of_birth: '1985-07-30', phone_number: '(214) 555-0166',
      address_line1: '405 Gear Ave', city: 'Dallas', state: 'TX', zip_code: '75201',
      referral_source: 'Alumni network', coppa_acknowledged: true, tos_accepted: true,
      pending_team_data: null, created_at: iso(80), updated_at: iso(12),
      teams: [{ team_name: 'Steel Comets', ftc_team_number: 14502, city: 'Dallas', state: 'TX' }],
    },
  ],

  teams: [
    { id: 't1', team_name: 'Exodius', ftc_team_number: 31579, city: 'Plano', state: 'TX' },
    { id: 't2', team_name: 'Robo Knights', ftc_team_number: 21044, city: 'Frisco', state: 'TX' },
    { id: 't3', team_name: 'Steel Comets', ftc_team_number: 14502, city: 'Dallas', state: 'TX' },
    { id: 't4', team_name: 'Volt Vipers', ftc_team_number: 18820, city: 'Allen', state: 'TX' },
    { id: 't5', team_name: 'Circuit Breakers', ftc_team_number: 9921, city: 'McKinney', state: 'TX' },
    { id: 't6', team_name: 'Gear Hawks', ftc_team_number: 27310, city: 'Irving', state: 'TX' },
  ],

  sponsors: [
    { id: 'sp1', company_name: 'Acme Robotics', industry: 'Manufacturing', contact_name: 'Dana Cole', contact_email: 'dana@acmerobotics.com', status: 'active', funding_cap_cents: 5_000_000, funding_used_cents: 1_250_000, created_at: iso(90), clerk_org_id: 'org_dev_sp1' },
    { id: 'sp2', company_name: 'TechNova', industry: 'Software', contact_name: 'Wei Chen', contact_email: 'wei@technova.io', status: 'active', funding_cap_cents: 3_000_000, funding_used_cents: 2_700_000, created_at: iso(70) },
    { id: 'sp3', company_name: 'Quantum Dynamics', industry: 'Aerospace', contact_name: 'Lena Vogt', contact_email: 'lena@quantumdyn.com', status: 'pending', funding_cap_cents: 2_000_000, funding_used_cents: 0, created_at: iso(10) },
    { id: 'sp4', company_name: 'BrightForge Tools', industry: 'Hardware', contact_name: 'Omar Said', contact_email: 'omar@brightforge.com', status: 'active', funding_cap_cents: 1_500_000, funding_used_cents: 450_000, created_at: iso(45) },
  ],

  submissions: [
    {
      id: 's1', status: 'pending', team_id: 't1', sponsor_id: 'sp1',
      requested_amount_cents: 250_000, created_at: iso(0), updated_at: iso(0),
      custom_pitch_alignment: 'Acme’s precision-machining focus maps directly onto our build season.',
      specific_needs_statement: 'CNC time and four NEO motors to finish the swerve modules before regionals.',
      teams: { team_name: 'Exodius', ftc_team_number: 31579, state: 'TX', status: 'active', mission_statement: 'Grow access to competitive robotics across North Texas.', technical_summary: 'Custom swerve drive, vision-assisted scoring, modular intake.', outreach_summary: 'Run 6 STEM workshops a year reaching 400+ students.', founded_year: 2020, team_size: 12, seasons_competed: 5, coach_experience: '5th season mentoring FTC.', past_sponsors: ['Plano Precision Machining'], press_links: [{ label: 'Plano Star feature', url: 'https://news.example/exodius' }], community_endorsements: '“Best student workshops in our district.” — Plano ISD STEM Coordinator', students_reached: 400, events_hosted: 6, volunteer_hours: 220, financial_ask_cents: 250_000, budget_items: budgetItems },
      sponsors: { company_name: 'Acme Robotics' },
    },
    {
      id: 's2', status: 'pending', team_id: 't2', sponsor_id: 'sp2',
      requested_amount_cents: 180_000, created_at: iso(1), updated_at: iso(1),
      custom_pitch_alignment: 'TechNova’s software mission aligns with our vision-based scoring pipeline.',
      specific_needs_statement: 'Funding for a depth camera and an onboard compute module.',
      teams: { team_name: 'Robo Knights', ftc_team_number: 21044, state: 'TX', status: 'active', mission_statement: 'Mentor rookie teams in our district.', technical_summary: 'Computer-vision auton, linear-slide lift.', outreach_summary: 'Host an annual scrimmage for 8 local teams.', financial_ask_cents: 180_000, budget_items: budgetItems },
      sponsors: { company_name: 'TechNova' },
    },
    {
      id: 's3', status: 'approved', team_id: 't3', sponsor_id: 'sp1',
      requested_amount_cents: 300_000, created_at: iso(9), updated_at: iso(4),
      custom_pitch_alignment: 'Shared focus on skilled-trades apprenticeships.',
      specific_needs_statement: 'Materials and travel for the championship.',
      teams: { team_name: 'Steel Comets', ftc_team_number: 14502, state: 'TX', status: 'active', mission_statement: 'Build a pipeline to the trades.', technical_summary: 'Welded chassis, dual-stage shooter.', outreach_summary: 'Partner with two high schools.', financial_ask_cents: 300_000, budget_items: budgetItems },
      sponsors: { company_name: 'Acme Robotics' },
    },
    {
      id: 's4', status: 'declined', team_id: 't5', sponsor_id: 'sp4',
      requested_amount_cents: 120_000, created_at: iso(14), updated_at: iso(8),
      custom_pitch_alignment: 'Tooling overlap.',
      specific_needs_statement: 'Spare parts budget.',
      teams: { team_name: 'Circuit Breakers', ftc_team_number: 9921, state: 'TX', status: 'active', mission_statement: 'Keep robotics free for our members.', technical_summary: 'Belt drive, claw intake.', outreach_summary: 'Monthly community build nights.', financial_ask_cents: 120_000, budget_items: budgetItems },
      sponsors: { company_name: 'BrightForge Tools' },
    },
    {
      id: 's5', status: 'changes_requested', team_id: 't6', sponsor_id: 'sp2',
      requested_amount_cents: 200_000, created_at: iso(6), updated_at: iso(2),
      custom_pitch_alignment: 'Software-driven analytics for match strategy.',
      specific_needs_statement: 'Laptop and telemetry hardware.',
      teams: { team_name: 'Gear Hawks', ftc_team_number: 27310, state: 'TX', status: 'active', mission_statement: 'Data-first robotics.', technical_summary: 'Telemetry logging, PID-tuned drive.', outreach_summary: 'Publish open-source match data.', financial_ask_cents: 200_000, budget_items: budgetItems },
      sponsors: { company_name: 'TechNova' },
    },
  ],

  // app2 deliberately carries a domain_match of 'mismatch' so the advisory badge on
  // /applications is visible in `npm run dev:admin-preview` (0090).
  sponsor_applications: [
    { id: 'app1', company_name: 'Northwind Logistics', contact_name: 'Grace Park', contact_email: 'grace@northwind.co', status: 'pending', proposed_cap_cents: 2_500_000, message: 'We’d love to fund teams in the DFW area and offer facility tours.', created_at: iso(2), website: 'https://northwind.co', email_domain: 'northwind.co', website_domain: 'northwind.co', domain_match: 'match' },
    { id: 'app2', company_name: 'Helios Energy', contact_name: 'Ravi Menon', contact_email: 'ravi@helios.energy', status: 'pending', proposed_cap_cents: 4_000_000, message: 'Interested in sponsoring 3–5 teams this season.', created_at: iso(5), website: 'https://helios-energy.com', email_domain: 'helios.energy', website_domain: 'helios-energy.com', domain_match: 'mismatch' },
    { id: 'app3', company_name: 'Cobalt Labs', contact_name: 'Mia Brandt', contact_email: 'mia@cobaltlabs.dev', status: 'approved', proposed_cap_cents: 1_000_000, message: 'Long-time FIRST supporter.', created_at: iso(20), website: 'cobaltlabs.dev', email_domain: 'cobaltlabs.dev', website_domain: 'cobaltlabs.dev', domain_match: 'match' },
  ],

  email_domain_rules: [
    { domain: 'gmail.com', rule: 'block', category: 'consumer', reason: 'Consumer mail', created_by: null, created_at: iso(30), updated_at: iso(30) },
    { domain: 'outlook.com', rule: 'block', category: 'consumer', reason: 'Consumer mail', created_by: null, created_at: iso(30), updated_at: iso(30) },
    { domain: 'mailinator.com', rule: 'block', category: 'disposable', reason: 'Disposable mail', created_by: null, created_at: iso(30), updated_at: iso(30) },
    { domain: 'brandtfamilyfoundation.org', rule: 'allow', category: 'manual', reason: 'Family foundation with no company domain', created_by: ADMIN_ID, created_at: iso(4), updated_at: iso(4) },
  ],

  sponsor_members: [
    {
      id: 'sm1', sponsor_id: 'sp1', profile_id: 'c5', clerk_org_id: 'org_dev_sp1',
      clerk_membership_id: 'orgmem_dev_1', role: 'org_admin', invited_by: null,
      invited_at: iso(90), joined_at: iso(90), created_at: iso(90), updated_at: iso(90),
      profiles: { id: 'c5', full_name: 'Dana Cole', email: 'dana@acmerobotics.com' },
    },
  ],

  transactions_ledger: [
    { id: 'tx1', amount_cents: 300_000 },
    { id: 'tx2', amount_cents: 250_000 },
    { id: 'tx3', amount_cents: 180_000 },
    { id: 'tx4', amount_cents: 120_000 },
  ],

  team_verification_records: [
    {
      id: 'tvr-1', team_id: 't1', profile_id: 'c1', ftc_team_number: 31579,
      claimed_team_name: 'Exodius', claimed_organization: 'Plano Robotics Collective',
      official_team_name: 'Exodius', official_organization: 'Plano Robotics Collective',
      source: 'first_api', name_score: 1, organization_score: 1, confidence: 1,
      outcome: 'auto_pass', override_reason: null, overridden_by: null, overridden_at: null,
      checked_at: iso(5),
    },
    {
      id: 'tvr-2', team_id: null, profile_id: 'c2', ftc_team_number: 21044,
      claimed_team_name: 'Robo Knights', claimed_organization: null,
      official_team_name: 'RoboKnights FTC', official_organization: 'Frisco ISD',
      source: 'ftcscout', name_score: 0.72, organization_score: null, confidence: 0.72,
      outcome: 'needs_review', override_reason: null, overridden_by: null, overridden_at: null,
      checked_at: iso(3),
    },
  ],

  audit_log: [
    { id: 'a1', action: 'verify_coach', entity_type: 'profiles', entity_id: 'c1', created_at: iso(5), metadata: {}, actor_id: ADMIN_ID, actor: { full_name: 'Dev Admin', role: 'admin' } },
    { id: 'a2', action: 'approve_submission', entity_type: 'submissions', entity_id: 's3', created_at: iso(4), metadata: { amount_cents: 300_000 }, actor_id: ADMIN_ID, actor: { full_name: 'Dev Admin', role: 'admin' } },
    { id: 'a3', action: 'decline_submission', entity_type: 'submissions', entity_id: 's4', created_at: iso(8), metadata: { reason: 'Out of scope' }, actor_id: ADMIN_ID, actor: { full_name: 'Dev Admin', role: 'admin' } },
    { id: 'a4', action: 'create_sponsor', entity_type: 'sponsors', entity_id: 'sp4', created_at: iso(45), metadata: {}, actor_id: ADMIN_ID, actor: { full_name: 'Dev Admin', role: 'admin' } },
    { id: 'a5', action: 'dispatch_submission', entity_type: 'submissions', entity_id: 's3', created_at: iso(4), metadata: { sponsor: 'Acme Robotics' }, actor_id: ADMIN_ID, actor: { full_name: 'Dev Admin', role: 'admin' } },
    { id: 'a6', action: 'request_changes', entity_type: 'submissions', entity_id: 's5', created_at: iso(2), metadata: {}, actor_id: ADMIN_ID, actor: { full_name: 'Dev Admin', role: 'admin' } },
  ],

  v_submission_summary: [
    { id: 's1', status: 'pending', team_name: 'Exodius', company_name: 'Acme Robotics', requested_amount_cents: 250_000, updated_at: iso(0) },
    { id: 's2', status: 'pending', team_name: 'Robo Knights', company_name: 'TechNova', requested_amount_cents: 180_000, updated_at: iso(1) },
    { id: 's3', status: 'approved', team_name: 'Steel Comets', company_name: 'Acme Robotics', requested_amount_cents: 300_000, updated_at: iso(4) },
    { id: 's4', status: 'declined', team_name: 'Circuit Breakers', company_name: 'BrightForge Tools', requested_amount_cents: 120_000, updated_at: iso(8) },
    { id: 's5', status: 'changes_requested', team_name: 'Gear Hawks', company_name: 'TechNova', requested_amount_cents: 200_000, updated_at: iso(2) },
    { id: 's6', status: 'dispatched', team_name: 'Volt Vipers', company_name: 'BrightForge Tools', requested_amount_cents: 95_000, updated_at: iso(3) },
    { id: 's7', status: 'approved', team_name: 'Exodius', company_name: 'TechNova', requested_amount_cents: 150_000, updated_at: iso(11) },
    { id: 's8', status: 'draft', team_name: 'Steel Comets', company_name: 'Acme Robotics', requested_amount_cents: 80_000, updated_at: iso(13) },
  ],

  v_sponsor_capacity: [
    { id: 'sp2', company_name: 'TechNova', utilization_pct: 90, funding_cap_cents: 3_000_000, funding_used_cents: 2_700_000, status: 'active' },
    { id: 'sp1', company_name: 'Acme Robotics', utilization_pct: 25, funding_cap_cents: 5_000_000, funding_used_cents: 1_250_000, status: 'active' },
    { id: 'sp4', company_name: 'BrightForge Tools', utilization_pct: 80, funding_cap_cents: 1_500_000, funding_used_cents: 450_000, status: 'active' },
  ],

  funding_fulfillments: [
    { id: 'f-1', sponsor_id: 'sp1', team_id: 't1', amount_cents: 250_000, status: 'payment_sent', pledged_at: iso(10), payment_sent_at: iso(2), sponsors: { company_name: 'Acme Robotics' }, teams: { team_name: 'Exodius' } },
    { id: 'f-2', sponsor_id: 'sp2', team_id: 't2', amount_cents: 150_000, status: 'pledged', pledged_at: iso(40), sponsors: { company_name: 'TechNova' }, teams: { team_name: 'Robo Knights' } },
    { id: 'f-3', sponsor_id: 'sp4', team_id: 't3', amount_cents: 50_000, status: 'payment_sent', pledged_at: iso(100), payment_sent_at: iso(80), sponsors: { company_name: 'BrightForge Tools' }, teams: { team_name: 'Steel Comets' } },
    { id: 'f-4', sponsor_id: 'sp4', team_id: 't4', amount_cents: 50_000, status: 'receipted', receipt_number: 'PF-2026-000003', pledged_at: iso(100), payment_sent_at: iso(80), payment_received_at: iso(70), sponsors: { company_name: 'BrightForge Tools' }, teams: { team_name: 'Circuit Breakers' } }
  ],

  agreement_templates: [
    {
      id: 'agr-1',
      key: 'sponsorship_agreement',
      version: 1,
      title: 'FTC Team Sponsorship Agreement',
      body: '<h2>1. Parties</h2><p>{{ sponsor_company_name }} and {{ team_legal_payee_name }} for FTC Team {{ team_number }} ({{ team_name }}) of {{ team_organization }}, {{ team_city }}, {{ team_state }}, effective {{ agreement_date }}.</p><h2>2. Commitment</h2><p>{{ amount_formatted }} for the {{ season }} season, facilitated by {{ platform_name }}.</p>',
      consent_text: 'By typing your name and clicking "Sign," you consent to transact electronically under ESIGN/UETA.',
      merge_fields: ['sponsor_company_name', 'team_legal_payee_name', 'team_number', 'team_name', 'team_organization', 'team_city', 'team_state', 'agreement_date', 'amount_formatted', 'season', 'platform_name'],
      status: 'effective',
      needs_legal_review: true,
      effective_from: iso(20),
      retired_at: null,
      created_by: null,
      created_at: iso(20),
      updated_at: iso(20),
    },
    {
      id: 'agr-2',
      key: 'sponsorship_agreement',
      version: 2,
      title: 'FTC Team Sponsorship Agreement (draft)',
      body: '<h2>1. Parties</h2><p>{{ sponsor_company_name }} and {{ team_legal_payee_name }} for FTC Team {{ team_number }} ({{ team_name }}) of {{ team_organization }}, {{ team_city }}, {{ team_state }}, effective {{ agreement_date }}.</p><h2>2. Commitment</h2><p>{{ amount_formatted }} for the {{ season }} season, facilitated by {{ platform_name }}. Draft revision adding a recognition clause.</p>',
      consent_text: 'By typing your name and clicking "Sign," you consent to transact electronically under ESIGN/UETA.',
      merge_fields: ['sponsor_company_name', 'team_legal_payee_name', 'team_number', 'team_name', 'team_organization', 'team_city', 'team_state', 'agreement_date', 'amount_formatted', 'season', 'platform_name'],
      status: 'draft',
      needs_legal_review: true,
      effective_from: null,
      retired_at: null,
      created_by: ADMIN_ID,
      created_at: iso(1),
      updated_at: iso(1),
    },
  ],

  agreement_signatures: [
    {
      id: '00000000-0000-4000-8000-000000000301',
      template_id: 'agr-1',
      template_key: 'sponsorship_agreement',
      template_version: 1,
      signer_profile_id: 'c5',
      signer_role: 'sponsor',
      signer_legal_name: 'Dana Cole',
      signer_email: 'dana@acmerobotics.com',
      submission_id: 's3',
      sponsor_id: 'sp1',
      team_id: 't3',
      entity_snapshot: { team_number: 14502, team_name: 'Steel Comets', team_organization: null, sponsor_company_name: 'Acme Robotics', amount_cents: 300_000 },
      typed_name: 'Dana Cole',
      signed_at: iso(4),
      ip_address: '203.0.113.10',
      user_agent: 'Mozilla/5.0 (dev preview)',
      document_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      document_storage_path: 'preview/sig-admin-1.html',
      consent_text_version: 1,
      consent_text_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      created_at: iso(4),
    },
    {
      id: '00000000-0000-4000-8000-000000000302',
      template_id: 'agr-1',
      template_key: 'sponsorship_agreement',
      template_version: 1,
      signer_profile_id: 'c1',
      signer_role: 'coach',
      signer_legal_name: 'Anish Yarrakonda',
      signer_email: 'coach+clerk_test@example.com',
      submission_id: 's3',
      sponsor_id: 'sp1',
      team_id: 't3',
      entity_snapshot: { team_number: 14502, team_name: 'Steel Comets', team_organization: null, sponsor_company_name: 'Acme Robotics', amount_cents: 300_000 },
      typed_name: 'Anish Yarrakonda',
      signed_at: iso(3),
      ip_address: '203.0.113.42',
      user_agent: 'Mozilla/5.0 (dev preview)',
      document_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      document_storage_path: 'preview/sig-admin-2.html',
      consent_text_version: 1,
      consent_text_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      created_at: iso(3),
    },
  ],

  funding_receipts: [
    {
      id: 'rec-3',
      receipt_number: 'PF-2026-000003',
      fulfillment_id: 'f-4',
      transaction_id: 'txn-4',
      sponsor_id: 'sp4',
      team_id: 't4',
      amount_cents: 50_000,
      contribution_date: iso(70).split('T')[0],
      variant: 'charitable_501c3',
      payee_legal_name: 'Circuit Breakers Booster Club',
      payee_ein_last4: '4321',
      payee_tax_classification: '501c3_org',
      sponsor_legal_name: 'BrightForge Tools',
      sponsor_contact_email: 'grants@brightforge.example',
      document_html: '<div style="padding: 24px;"><h1>Contribution acknowledgment</h1><p>Circuit Breakers Booster Club (EIN 11-2233445) acknowledges receipt of $500.00 from BrightForge Tools on 2026-06-01.</p><p><strong>No goods or services were provided by Circuit Breakers Booster Club in exchange for this contribution.</strong></p></div>',
      document_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      copy_version: '2026-08-v1',
      copy_reviewed_at: null,
      status: 'issued',
      issued_at: iso(70),
      emailed_at: iso(70),
      teams: { team_name: 'Circuit Breakers' }
    }
  ],

  // Appeals (0086). The admin queue reads this; without an `open` row the /appeals preview
  // renders an empty state and the review UI cannot be exercised. `original_decider_id` is
  // the mock admin on purpose, so the self-review override banner is reachable in preview.
  appeals: [
    {
      id: 'apl-1', subject_type: 'submission', subject_id: 's4',
      appellant_profile_id: 'c1', appellant_name: 'Anish Yarrakonda',
      statement: 'The travel budget line was flagged as unclear, but the itemised quote was attached to the pitch. Please take another look — we cannot compete without the regional travel covered.',
      status: 'open', decision_at: iso(6), original_decider_id: ADMIN_ID,
      assigned_reviewer_id: null, assigned_at: null, override_reason: null,
      resolution_notes: null, resolved_by: null, resolved_at: null,
      created_at: iso(4), updated_at: iso(4),
    },
    {
      id: 'apl-2', subject_type: 'coach_verification', subject_id: 'c2',
      appellant_profile_id: 'c2', appellant_name: 'Jordan Lee',
      statement: 'My licence photo was rejected as illegible. I have a clearer scan and my school can confirm my role directly if that helps.',
      status: 'under_review', decision_at: iso(9), original_decider_id: null,
      assigned_reviewer_id: ADMIN_ID, assigned_at: iso(2), override_reason: null,
      resolution_notes: null, resolved_by: null, resolved_at: null,
      created_at: iso(8), updated_at: iso(2),
    },
    {
      id: 'apl-3', subject_type: 'submission', subject_id: 's5',
      appellant_profile_id: 'c5', appellant_name: 'Maria Gomez',
      statement: 'We were declined for an incomplete portfolio, but the missing achievements were added the same day.',
      status: 'overturned', decision_at: iso(25), original_decider_id: ADMIN_ID,
      assigned_reviewer_id: ADMIN_ID, assigned_at: iso(20),
      override_reason: 'Sole administrator on this deployment; self-review recorded.',
      resolution_notes: 'Portfolio was complete at the time of review. Returned for resubmission.',
      resolved_by: ADMIN_ID, resolved_at: iso(19),
      created_at: iso(22), updated_at: iso(19),
    },
  ],

  // Q&A threads (0085). The admin release queue reads this; without a `pending` coach reply
  // the /moderation preview renders an empty section and the review UI cannot be exercised.
  // Embedded relations are inlined because MockQuery ignores the select() column list.
  submission_messages: [
    {
      id: 'msg-1', submission_id: 's3', author_role: 'sponsor', author_profile_id: 'sp-user-1',
      author_token_id: null, author_label: 'Dana Cole', status: 'released',
      body: 'Is the 501(c)(3) the school district itself, or a separate booster club? Our grants team needs the EIN on the receipt to match the payee.',
      released_at: iso(3), released_by: null, rejected_reason: null,
      flagged_at: null, flagged_by: null, created_at: iso(3),
      submissions: { teams: { team_name: 'Steel Comets' }, sponsors: { company_name: 'Acme Robotics' } },
    },
    {
      id: 'msg-2', submission_id: 's3', author_role: 'coach', author_profile_id: 'c5',
      author_token_id: null, author_label: 'Maria Gomez', status: 'pending',
      body: 'It is a separate booster club — Steel Comets Booster Club, EIN ending 4321. The district is not the payee. Happy to send the determination letter to whichever address your grants team prefers.',
      released_at: null, released_by: null, rejected_reason: null,
      flagged_at: null, flagged_by: null, created_at: iso(2),
      submissions: { teams: { team_name: 'Steel Comets' }, sponsors: { company_name: 'Acme Robotics' } },
    },
    {
      id: 'msg-3', submission_id: 's1', author_role: 'sponsor', author_profile_id: 'sp-user-1',
      author_token_id: null, author_label: 'Dana Cole', status: 'released',
      body: 'Which students are on the swerve subteam, and can you send their names for our press release?',
      released_at: iso(1), released_by: null, rejected_reason: null,
      flagged_at: iso(1), flagged_by: 'c1', created_at: iso(1),
      submissions: { teams: { team_name: 'Exodius' }, sponsors: { company_name: 'Acme Robotics' } },
    },
  ],
  // The four seeded tiers, plus one archived row so the admin ladder shows both states.
  recognition_tiers: [
    {
      id: 'tier-supporter', name: 'Supporter', rank: 0, min_amount_cents: 25000,
      max_amount_cents: 100000, benefits: ['logo_on_website'],
      description: 'Entry-level recognition on the team website.',
      archived_at: null, created_at: iso(90), updated_at: iso(90),
    },
    {
      id: 'tier-bronze', name: 'Bronze', rank: 1, min_amount_cents: 100000,
      max_amount_cents: 250000, benefits: ['logo_on_website', 'social_media_mention'],
      description: 'Website placement plus a social media thank-you post.',
      archived_at: null, created_at: iso(90), updated_at: iso(90),
    },
    {
      id: 'tier-silver', name: 'Silver', rank: 2, min_amount_cents: 250000,
      max_amount_cents: 750000,
      benefits: ['logo_on_website', 'social_media_mention', 'logo_on_team_shirt', 'mention_in_outreach_materials'],
      description: 'Team apparel placement and inclusion in outreach materials.',
      archived_at: null, created_at: iso(90), updated_at: iso(90),
    },
    {
      id: 'tier-gold', name: 'Gold', rank: 3, min_amount_cents: 750000,
      max_amount_cents: null,
      benefits: ['logo_on_website', 'social_media_mention', 'logo_on_team_shirt', 'mention_in_outreach_materials', 'logo_on_robot', 'event_signage'],
      description: 'Full recognition including placement on the competition robot and event signage.',
      archived_at: null, created_at: iso(90), updated_at: iso(90),
    },
    {
      id: 'tier-legacy', name: 'Founding Partner', rank: 9, min_amount_cents: 2000000,
      max_amount_cents: null, benefits: ['logo_on_robot'],
      description: 'Retired 2025 tier, kept so awards pinned against it still resolve.',
      archived_at: iso(30), created_at: iso(400), updated_at: iso(30),
    },
  ],
  sponsor_recognition_awards: [
    {
      id: 'award-1', fulfillment_id: 'ff-1', sponsor_id: 'sp1', team_id: 't1',
      amount_cents: 300000, tier_id: 'tier-silver', tier_name_snapshot: 'Silver',
      tier_rank_snapshot: 2, tier_min_amount_cents_snapshot: 250000,
      benefits_snapshot: ['logo_on_website', 'social_media_mention', 'logo_on_team_shirt', 'mention_in_outreach_materials'],
      awarded_at: iso(20), created_at: iso(20), updated_at: iso(5),
      sponsors: { company_name: 'Acme Robotics' }, teams: { team_name: 'Exodius' },
    },
  ],
  recognition_benefit_deliveries: [
    {
      id: 'del-1', award_id: 'award-1', benefit_type: 'logo_on_website', status: 'delivered',
      proof_url: PREVIEW_PLACEHOLDER_IMAGE,
      proof_uploaded_at: iso(5), no_minors_confirmed_at: iso(5), delivered_at: iso(5),
      coach_note: null, admin_voided_at: null, admin_void_reason: null,
      created_at: iso(20), updated_at: iso(5),
      sponsor_recognition_awards: { sponsors: { company_name: 'Acme Robotics' }, teams: { team_name: 'Exodius' } },
    },
    {
      id: 'del-2', award_id: 'award-1', benefit_type: 'logo_on_team_shirt', status: 'in_progress',
      proof_url: null, proof_uploaded_at: null, no_minors_confirmed_at: null, delivered_at: null,
      coach_note: null, admin_voided_at: iso(2),
      admin_void_reason: 'A student was visible in the background of the previous photo.',
      created_at: iso(20), updated_at: iso(2),
      sponsor_recognition_awards: { sponsors: { company_name: 'Acme Robotics' }, teams: { team_name: 'Exodius' } },
    },
    {
      id: 'del-3', award_id: 'award-1', benefit_type: 'social_media_mention', status: 'promised',
      proof_url: null, proof_uploaded_at: null, no_minors_confirmed_at: null, delivered_at: null,
      coach_note: null, admin_voided_at: null, admin_void_reason: null,
      created_at: iso(20), updated_at: iso(20),
      sponsor_recognition_awards: { sponsors: { company_name: 'Acme Robotics' }, teams: { team_name: 'Exodius' } },
    },
  ],
  impact_report_snapshots: [
    {
      id: 'snap-platform-2026', scope: 'platform', sponsor_id: null, report_year: 2026,
      status: 'open', payload_schema_version: 1, generated_at: iso(1), closed_at: null,
      payload: {
        schema_version: 1, year: 2026, generated_at: iso(1), sponsors_active: 5,
        totals: {
          pledged_cents: 4200000, received_cents: 2600000, outstanding_cents: 1600000,
          teams_supported: 12, students_reached: 9400, events_hosted: 61,
          volunteer_hours: 3100, benefits_promised: 28, benefits_delivered: 19,
        },
        footnotes: ['The platform never handles funds.'],
      },
    },
    {
      id: 'snap-sponsor-2026', scope: 'sponsor', sponsor_id: 'sp1', report_year: 2026,
      status: 'open', payload_schema_version: 1, generated_at: iso(1), closed_at: null,
      payload: {
        schema_version: 1, year: 2026, generated_at: iso(1),
        sponsor: { company_name: 'Acme Robotics', logo_url: null },
        totals: {
          pledged_cents: 300000, received_cents: 100000, outstanding_cents: 200000,
          teams_supported: 1, students_reached: 1200, events_hosted: 8,
          volunteer_hours: 340, benefits_promised: 4, benefits_delivered: 1,
        },
        teams: [], footnotes: [],
      },
    },
  ],
  public_platform_stats: [
    {
      id: true, teams_supported: 12, sponsors_active: 5, dollars_pledged_cents: 4200000,
      dollars_received_cents: 2600000, students_reached: 9400, events_hosted: 61,
      volunteer_hours: 3100, refreshed_at: iso(0),
    },
  ],
}

// ── Minimal in-memory query builder mimicking the supabase-js fluent API ──────
class MockQuery implements PromiseLike<any> {
  private filters: ((r: any) => boolean)[] = []
  private orderBy?: { col: string; asc: boolean }
  private limitN?: number
  private rangeFromTo?: [number, number]
  private wantCount = false
  private head = false
  private singleRow = false
  private inserted?: any[]

  constructor(private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.wantCount = true
    if (opts?.head) this.head = true
    return this
  }
  insert(payload: any) { this.inserted = Array.isArray(payload) ? payload : [payload]; return this }
  update(_p: any) { return this }
  delete() { return this }
  upsert(payload: any) { this.inserted = Array.isArray(payload) ? payload : [payload]; return this }

  eq(col: string, val: any) { this.filters.push((r) => r[col] === val); return this }
  neq(col: string, val: any) { this.filters.push((r) => r[col] !== val); return this }
  in(col: string, vals: any[]) { this.filters.push((r) => vals.includes(r[col])); return this }
  gte(col: string, val: any) { this.filters.push((r) => r[col] >= val); return this }
  lte(col: string, val: any) { this.filters.push((r) => r[col] <= val); return this }
  gt(col: string, val: any) { this.filters.push((r) => r[col] > val); return this }
  lt(col: string, val: any) { this.filters.push((r) => r[col] < val); return this }
  is(col: string, val: any) { this.filters.push((r) => (r[col] ?? null) === val); return this }
  not(col: string, op: string, val: any) {
    if (op === 'is' && val === null) this.filters.push((r) => r[col] != null)
    return this
  }
  ilike() { return this }
  or() { return this }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy = { col, asc: opts?.ascending ?? true }; return this }
  limit(n: number) { this.limitN = n; return this }
  range(from: number, to: number) { this.rangeFromTo = [from, to]; return this }

  single() { this.singleRow = true; return this.resolve() }
  maybeSingle() { this.singleRow = true; return this.resolve() }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected)
  }

  private async resolve() {
    if (this.inserted) {
      const rows = this.inserted.map((r, i) => ({ id: r.id ?? `mock-${i}`, ...r }))
      return { data: this.singleRow ? rows[0] ?? null : rows, error: null, count: rows.length }
    }
    let rows = (DATA[this.table] ?? []).slice()
    for (const f of this.filters) rows = rows.filter(f)
    const count = rows.length
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
    }
    if (this.rangeFromTo) rows = rows.slice(this.rangeFromTo[0], this.rangeFromTo[1] + 1)
    else if (this.limitN != null) rows = rows.slice(0, this.limitN)
    if (this.head) return { data: null, error: null, count }
    if (this.singleRow) return { data: rows[0] ?? null, error: null, count }
    return { data: rows, error: null, count: this.wantCount ? count : null }
  }
}

/**
 * A stand-in Supabase client that reads/writes only the canned datasets above.
 * Covers the fluent query API, a no-op storage signer, and a no-op rpc — enough
 * for every admin page and server action to render/run without a real backend.
 */
export function createMockSupabaseClient(): SupabaseClient<Database> {
  return {
    from: (table: string) => new MockQuery(table),
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: '#dev-mock' }, error: null }),
        upload: async () => ({ data: { path: 'dev-mock' }, error: null }),
        remove: async () => ({ data: [], error: null }),
        // Empty listing, not a missing member: the retention purge lists a prefix
        // before deleting it, and an absent `list` would crash the preview.
        list: async () => ({ data: [], error: null }),
      }),
    },
  } as unknown as SupabaseClient<Database>
}
