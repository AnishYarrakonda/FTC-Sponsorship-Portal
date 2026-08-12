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
    { id: 'sp1', company_name: 'Acme Robotics', industry: 'Manufacturing', contact_name: 'Dana Cole', contact_email: 'dana@acmerobotics.com', status: 'active', funding_cap_cents: 5_000_000, funding_used_cents: 1_250_000, created_at: iso(90) },
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

  sponsor_applications: [
    { id: 'app1', company_name: 'Northwind Logistics', contact_name: 'Grace Park', contact_email: 'grace@northwind.co', status: 'pending', proposed_cap_cents: 2_500_000, message: 'We’d love to fund teams in the DFW area and offer facility tours.', created_at: iso(2) },
    { id: 'app2', company_name: 'Helios Energy', contact_name: 'Ravi Menon', contact_email: 'ravi@helios.energy', status: 'pending', proposed_cap_cents: 4_000_000, message: 'Interested in sponsoring 3–5 teams this season.', created_at: iso(5) },
    { id: 'app3', company_name: 'Cobalt Labs', contact_name: 'Mia Brandt', contact_email: 'mia@cobaltlabs.dev', status: 'approved', proposed_cap_cents: 1_000_000, message: 'Long-time FIRST supporter.', created_at: iso(20) },
  ],

  transactions_ledger: [
    { id: 'tx1', amount_cents: 300_000 },
    { id: 'tx2', amount_cents: 250_000 },
    { id: 'tx3', amount_cents: 180_000 },
    { id: 'tx4', amount_cents: 120_000 },
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
