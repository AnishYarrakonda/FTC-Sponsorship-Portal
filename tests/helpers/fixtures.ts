/**
 * Shared E2E fixture builders for money-shaped rows.
 *
 * Two rules make the difference between a suite that passes alone and one that passes in a
 * parallel run:
 *
 * 1. **Capacity must stay consistent.** `detect_capacity_drift()` is global: it compares
 *    every sponsor's `funding_used_cents` against its open reservations plus settled ledger.
 *    A fixture that inserts a `transactions_ledger` row without moving `funding_used_cents`
 *    creates real drift for as long as it lives — and two suites (appeals, recognition-tiers)
 *    assert that drift is zero across the whole database. Their failure looked like a
 *    capacity bug in the product; it was the test fixtures. `pledge`/`unpledge` below move
 *    both together, the way the application's own RPC does.
 *
 * 2. **Fixtures must own their rows.** The seeded coach already has a team, and the DB
 *    enforces one team per owner, so a suite that inserts "its" team against the shared coach
 *    fails outright. `createOwnedTeam` provisions a throwaway coach profile to own it.
 *    Uniqueness is likewise enforced on (team_id, sponsor_id) for an active submission, so
 *    two suites sharing the seeded team collide on the second one to start.
 *
 * Everything created here is tagged with an `e2e-fixture-` prefix in whatever free-text
 * column the table offers, so leftovers from a crashed run are identifiable.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Admin = SupabaseClient<any, any, any>

export const FIXTURE_PREFIX = 'e2e-fixture'

/** A throwaway coach profile plus the one team it owns. */
export async function createOwnedTeam(
  admin: Admin,
  opts: { label: string; ftcTeamNumber: number }
): Promise<{ coachProfileId: string; teamId: string; teamName: string }> {
  const tag = `${FIXTURE_PREFIX}-${opts.label}-${Date.now()}`
  const teamName = `Fixture Team ${opts.label}`

  const { data: coach, error: coachErr } = await admin
    .from('profiles')
    .insert({
      // No Clerk user backs this profile — it exists only to satisfy teams.owner_id and the
      // one-team-per-owner trigger. Nothing signs in as it.
      clerk_user_id: `user_${tag}`,
      email: `${tag}@example.com`,
      full_name: `Fixture Coach ${opts.label}`,
      role: 'coach',
      coach_verified: true,
    })
    .select('id')
    .single()
  if (coachErr) throw new Error(`fixture coach insert failed: ${coachErr.message}`)

  const { data: team, error: teamErr } = await admin
    .from('teams')
    .insert({
      owner_id: coach!.id,
      status: 'existing',
      ftc_team_number: opts.ftcTeamNumber,
      team_name: teamName,
      slug: tag,
      tax_status: 'None',
    })
    .select('id')
    .single()
  if (teamErr) throw new Error(`fixture team insert failed: ${teamErr.message}`)

  return { coachProfileId: coach!.id, teamId: team!.id, teamName }
}

export async function deleteOwnedTeam(
  admin: Admin,
  ids: { coachProfileId?: string; teamId?: string }
) {
  if (ids.teamId) await admin.from('teams').delete().eq('id', ids.teamId)
  if (ids.coachProfileId) await admin.from('profiles').delete().eq('id', ids.coachProfileId)
}

async function bumpFundingUsed(admin: Admin, sponsorId: string, deltaCents: number) {
  const { data } = await admin
    .from('sponsors')
    .select('funding_used_cents')
    .eq('id', sponsorId)
    .single()
  const next = Math.max(0, (data?.funding_used_cents ?? 0) + deltaCents)
  await admin.from('sponsors').update({ funding_used_cents: next }).eq('id', sponsorId)
}

/**
 * A settled pledge: ledger row + fulfillment, with `sponsors.funding_used_cents` moved to
 * match so global drift stays zero while the fixture exists.
 */
export async function pledge(
  admin: Admin,
  opts: {
    sponsorId: string
    amountCents: number
    teamId?: string
    submissionId?: string
    status?: string
  }
): Promise<{ transactionId: string; fulfillmentId: string }> {
  const { data: txn, error: txnErr } = await admin
    .from('transactions_ledger')
    .insert({
      sponsor_id: opts.sponsorId,
      team_id: opts.teamId ?? null,
      submission_id: opts.submissionId ?? null,
      amount_cents: opts.amountCents,
      decision_type: 'full',
      actor_type: 'sponsor',
    })
    .select('id')
    .single()
  if (txnErr) throw new Error(`fixture ledger insert failed: ${txnErr.message}`)

  const { data: fulfillment, error: fErr } = await admin
    .from('funding_fulfillments')
    .insert({
      transaction_id: txn!.id,
      sponsor_id: opts.sponsorId,
      team_id: opts.teamId ?? null,
      submission_id: opts.submissionId ?? null,
      amount_cents: opts.amountCents,
      status: opts.status ?? 'pledged',
    })
    .select('id')
    .single()
  if (fErr) throw new Error(`fixture fulfillment insert failed: ${fErr.message}`)

  await bumpFundingUsed(admin, opts.sponsorId, opts.amountCents)

  return { transactionId: txn!.id, fulfillmentId: fulfillment!.id }
}

/** Reverse of `pledge`, including the capacity bookkeeping. */
export async function unpledge(
  admin: Admin,
  opts: {
    sponsorId: string
    amountCents: number
    transactionId?: string
    fulfillmentId?: string
  }
) {
  if (opts.fulfillmentId) {
    await admin.from('funding_fulfillment_events').delete().eq('fulfillment_id', opts.fulfillmentId)
    await admin.from('funding_fulfillments').delete().eq('id', opts.fulfillmentId)
  }
  if (opts.transactionId) {
    await admin.from('transactions_ledger').delete().eq('id', opts.transactionId)
  }
  await bumpFundingUsed(admin, opts.sponsorId, -opts.amountCents)
}

/**
 * Both executed signatures for a submission, so `agreement_is_signed()` is true and the
 * fulfillment may legally reach `payment_sent`.
 *
 * Written directly rather than through `sign_agreement_atomic` on purpose. That RPC is the
 * subject of its own suite (agreement-signing.spec.ts), which drives scroll-gating, consent,
 * name matching, document-hash staleness and — since 0106 — the `needs_legal_review` block.
 * A fixture that had to satisfy all of that to set up an unrelated test would couple the two
 * suites together and would fail for reasons that have nothing to do with what is under test.
 * This asserts only the property the transition gate reads: one sponsor row, one coach row.
 *
 * The hashes are real 64-hex digests because the table CHECKs them (`^[0-9a-f]{64}$`) — a
 * placeholder is rejected outright.
 */
export async function executeAgreement(
  admin: Admin,
  opts: {
    submissionId: string
    sponsorId: string
    teamId: string
    sponsorProfileId?: string
    coachProfileId?: string
  }
): Promise<void> {
  const digest = (s: string) =>
    createHash('sha256').update(`${FIXTURE_PREFIX}:${opts.submissionId}:${s}`).digest('hex')

  const base = {
    template_key: 'sponsorship_agreement',
    template_version: 1,
    submission_id: opts.submissionId,
    sponsor_id: opts.sponsorId,
    team_id: opts.teamId,
    entity_snapshot: { fixture: true },
    ip_address: '127.0.0.1',
    user_agent: `${FIXTURE_PREFIX}/1.0`,
    document_hash: digest('document'),
    document_storage_path: `${FIXTURE_PREFIX}/${opts.submissionId}.html`,
    consent_text_version: 1,
    consent_text_hash: digest('consent'),
  }

  const { error } = await admin.from('agreement_signatures').insert([
    {
      ...base,
      signer_role: 'sponsor',
      signer_profile_id: opts.sponsorProfileId ?? null,
      signer_legal_name: 'Fixture Sponsor Signatory',
      signer_email: `${FIXTURE_PREFIX}-sponsor@example.com`,
      typed_name: 'Fixture Sponsor Signatory',
    },
    {
      ...base,
      signer_role: 'coach',
      signer_profile_id: opts.coachProfileId ?? null,
      signer_legal_name: 'Fixture Coach Signatory',
      signer_email: `${FIXTURE_PREFIX}-coach@example.com`,
      typed_name: 'Fixture Coach Signatory',
    },
  ])
  if (error) throw new Error(`fixture agreement signatures insert failed: ${error.message}`)
}
