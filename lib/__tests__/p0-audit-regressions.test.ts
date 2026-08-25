import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Regression guards for the P0 audit findings whose defining quality was SILENCE — each
 * one shipped, ran in production, and failed without producing a single error anyone saw.
 * They are pinned at the source level because the failures live in the seam between the
 * TypeScript caller and a Postgres function's authorization rules, which no unit test of
 * either side alone would have caught.
 *
 * The database halves are enforced by the migrations themselves (0098, 0099, 0100) and
 * were each reproduced against a live local stack before the fix.
 */
const repoRoot = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(repoRoot, p), 'utf8')

describe('B-02-01: an act that binds the sponsor org takes approver rank', () => {
  /**
   * Originally filed against signing a sponsorship agreement, which 0111 removed along with
   * the rest of the e-signature layer. The finding itself is NOT moot: it was that a
   * low-ranked org member (viewer is the default rank for JIT/SSO joiners) could take an
   * action that commits the company's money. The act that does that today is confirming a
   * funding decision, so the assertions move there rather than being deleted.
   */
  it('confirming a decision proposal is approver-gated in the action', () => {
    const src = read('app/actions/sponsor-approvals.ts')
    expect(src).toContain("requireSponsorRole('approver')")
  })

  it('proposing is submitter-gated, so a viewer cannot even start one', () => {
    const src = read('app/actions/sponsor-decision.ts')
    expect(src).toContain("requireSponsorRole('submitter')")
  })

  it('SQL enforces the same rank independent of the caller', () => {
    // The UI and the action are conveniences; this is the gate that actually holds.
    const sql = read('supabase/migrations/0083_sponsor_roles_and_approvals.sql')
    expect(sql).toContain('sponsor_member_role_rank')
    expect(sql).toContain('confirm_sponsor_decision_proposal')
  })
})

describe('A-02-01: notifications are not anon-writable', () => {
  it('migration 0098 drops the public INSERT policy and revokes the anon grant', () => {
    const sql = read('supabase/migrations/0098_drop_anon_notification_insert.sql')
    expect(sql).toContain('DROP POLICY IF EXISTS service_insert_notifications')
    // RLS does not restrict TRUNCATE at all — only the grant does.
    expect(sql).toMatch(/REVOKE[\s\S]*TRUNCATE[\s\S]*FROM anon/)
  })

  it('the only application insert path is the admin client, which bypasses RLS anyway', () => {
    const notify = read('lib/notify.ts')
    expect(notify).toContain('createAdminClient')
    expect(notify).toContain("from('notifications').insert(")
  })
})

describe('A-04-01: sponsor decisions reconcile capacity in both directions', () => {
  const sql = read('supabase/migrations/0100_sponsor_decide_capacity_delta.sql')

  it('handles delta > 0, which is the legacy path that skipped the cap entirely', () => {
    expect(sql).toContain('v_delta > 0')
    expect(sql).toContain('insufficient_capacity')
    expect(sql).toContain('funding_used_cents + v_delta')
  })

  it('keeps the release path for delta < 0', () => {
    expect(sql).toContain('v_delta < 0')
    expect(sql).toContain('GREATEST(funding_used_cents - (v_prior_reserved - v_amount), 0)')
  })

  it('locks the sponsor row before checking the cap', () => {
    expect(sql).toMatch(/FROM sponsors WHERE id = v_submission\.sponsor_id FOR UPDATE/)
  })

  it('reads the true prior reservation, not the request-amount fallback', () => {
    // v_reserved is overwritten with requested_amount_cents when nothing was reserved;
    // using it as the baseline would compute a delta of 0 and reintroduce the bug.
    expect(sql).toContain('v_prior_reserved := COALESCE(v_submission.reserved_amount_cents, 0)')
  })
})

describe('A-09-02: the moderation queue is bounded', () => {
  it('the pending query carries a limit and reports the true total', () => {
    const page = read('app/(admin)/moderation/page.tsx')
    expect(page).toContain('MODERATION_QUEUE_LIMIT')
    expect(page).toContain('.limit(MODERATION_QUEUE_LIMIT)')
    expect(page).toContain('pendingTotal')
  })
})
