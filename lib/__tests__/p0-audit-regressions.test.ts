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

describe('B-03-01: the automatic tax receipt must use the system actor', () => {
  const fulfillmentSrc = read('app/actions/fulfillment.ts')

  it('confirmPaymentReceived passes a NULL actor, never the coach profile id', () => {
    const call = fulfillmentSrc.match(/generateAndStoreReceipt\([^)]*\)/)
    expect(call).not.toBeNull()
    // issue_funding_receipt rejects any non-NULL actor whose profiles.role !== 'admin'.
    // The coach is never an admin, so `user.id` here made the call fail 100% of the time
    // and no receipt was ever issued by this path.
    expect(call![0]).toContain('null')
    expect(call![0]).not.toContain('user.id')
  })

  it('the confirm dialog surfaces a receipt-issuance warning instead of a success toast', () => {
    const dialog = read('components/coach/confirm-receipt-dialog.tsx')
    // The action returns { success: true, warning } when the receipt fails. The dialog
    // branched only on res.error, so that warning was silently discarded — which is the
    // reason this bug survived in production.
    expect(dialog).toContain('res.warning')
    const warningIdx = dialog.indexOf('res.warning')
    const successIdx = dialog.indexOf("toast.success('Payment confirmed')")
    expect(warningIdx).toBeGreaterThan(-1)
    expect(successIdx).toBeGreaterThan(-1)
    // The warning branch must come FIRST, or the success toast swallows it again.
    expect(warningIdx).toBeLessThan(successIdx)
  })

  it('the admin-initiated receipt paths still pass a real admin actor', () => {
    const receiptSrc = read('app/actions/receipt.ts')
    expect(receiptSrc).toContain('requireAdmin')
    expect(receiptSrc).toContain('user.id')
  })
})

describe('B-02-01: signing a sponsorship agreement takes approver rank', () => {
  it('signAgreement gates sponsors on approver, and leaves coaches alone', () => {
    const src = read('app/actions/agreements-sign.ts')
    expect(src).toContain("requireSponsorRole('approver')")
    // The gate must be scoped to sponsors — a coach signs as the team owner and has no
    // sponsor-org rank at all, so applying it unconditionally would break countersigning.
    expect(src).toMatch(/signerRole === 'sponsor'[\s\S]{0,400}requireSponsorRole\('approver'\)/)
  })

  it('the RPC failure code is mapped to a message that names the required rank', () => {
    const src = read('app/actions/agreements-sign.ts')
    expect(src).toContain('insufficient_org_role')
  })

  it('the sponsor sign page and the Sign now affordance are both rank-gated', () => {
    const page = read('app/(sponsor)/sponsor/submissions/[id]/sign/page.tsx')
    expect(page).toContain("requireSponsorRole('approver')")

    const row = read('components/agreements/agreement-status-row.tsx')
    expect(row).toContain("hasSponsorRole(sponsorMemberRole ?? null, 'approver')")
  })

  it('migration 0099 enforces the same rank in SQL, independent of the caller', () => {
    const sql = read('supabase/migrations/0099_sign_agreement_member_rank.sql')
    expect(sql).toContain('sponsor_member_role_rank')
    expect(sql).toContain('insufficient_org_role')
    // The UI and the action are conveniences; this is the gate that actually holds.
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.sign_agreement_atomic')
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

describe('A-06-01: receipts never carry a full EIN', () => {
  it('the receipt context has no full-EIN field and receipts.ts never resolves one', () => {
    const doc = read('lib/receipt-document.tsx')
    expect(doc).not.toContain('payeeEinFull')

    const receipts = read('lib/receipts.ts')
    expect(receipts).not.toContain('payeeEinFull')
    // The decrypting RPC must not be CALLED from the receipt render path at all: whatever
    // it returns would be persisted to funding_receipts.document_html and emailed.
    // (Matches an invocation, not the word — the comment explaining why still names it.)
    expect(receipts).not.toMatch(/rpc\(\s*['"`]get_payout_ein/)
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
