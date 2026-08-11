import { FulfillmentStatus, TERMINAL_FULFILLMENT_STATUSES } from './fulfillment-status'

export interface FulfillmentTimestamps {
  pledged_at: string | null
  agreement_signed_at: string | null
  payment_sent_at: string | null
  payment_received_at: string | null
  receipted_at: string | null
  cancelled_at: string | null
  status: FulfillmentStatus
}

// 14 days to send payment. Corporate AP runs on a check cycle; two weeks is one full
// cycle plus slack. Nudging sooner reads as nagging and gets the sender filtered.
// 10 days to confirm receipt. A mailed check plus a deposit clears inside 5–10 calendar
// days. Past 10, silence is informative rather than normal.
// 21 days → second notice to the sponsor. At three weeks the likeliest explanation is a
// lost or misaddressed check, and only the sponsor can reissue it.
export const NUDGE_THRESHOLDS = {
  /** pledged / agreement_signed with no payment sent. */
  awaitingPaymentDays: 14,
  /** payment_sent with no confirmation from the coach. */
  awaitingReceiptDays: 10,
  /** payment_sent this long with no confirmation — tell the SPONSOR too; the check may be lost. */
  sponsorSecondNoticeDays: 21,
} as const

/** Never nudge the same fulfillment more often than this, whatever else is true. */
export const NUDGE_REPEAT_DAYS = 14

/** Past this, stop pestering the counterparties and hand it to a human. */
export const ESCALATE_AFTER_DAYS = 90

export const AGING_BUCKETS = {
  on_track: { maxDays: 13 },   // 0–13
  aging:    { maxDays: 29 },   // 14–29
  stale:    { maxDays: 59 },   // 30–59
  escalate: { maxDays: null }, // 60+
} as const

/** Age is measured from the moment the row ENTERED its current status, not from pledge. */
export function statusEnteredAt(f: FulfillmentTimestamps): string {
  let date: string | null = null
  switch (f.status) {
    case 'pledged': date = f.pledged_at; break
    case 'agreement_signed': date = f.agreement_signed_at; break
    case 'payment_sent': date = f.payment_sent_at; break
    case 'payment_received': date = f.payment_received_at; break
    case 'receipted': date = f.receipted_at; break
    case 'cancelled': date = f.cancelled_at; break
  }
  return date || f.pledged_at || new Date(0).toISOString()
}

export function ageInDays(f: FulfillmentTimestamps, now: Date = new Date()): number {
  const entered = new Date(statusEnteredAt(f))
  return Math.max(0, Math.floor((now.getTime() - entered.getTime()) / (1000 * 60 * 60 * 24)))
}

export type AgingBucket = 'on_track' | 'aging' | 'stale' | 'escalate'

export function agingBucket(days: number): AgingBucket {
  if (days <= AGING_BUCKETS.on_track.maxDays) return 'on_track'
  if (days <= AGING_BUCKETS.aging.maxDays) return 'aging'
  if (days <= AGING_BUCKETS.stale.maxDays) return 'stale'
  return 'escalate'
}

export type NudgeTarget = 'sponsor' | 'coach' | 'admin' | null

export type NudgeReason = 'awaiting_payment' | 'awaiting_receipt' | 'sponsor_second_notice' | 'escalation'

export function nudgePlan(
  f: FulfillmentTimestamps & { status: FulfillmentStatus; last_nudged_at: string | null },
  now: Date = new Date(),
): { target: NudgeTarget; reason: NudgeReason | null; ageDays: number } {
  const ageDays = ageInDays(f, now)
  
  if (ageDays >= ESCALATE_AFTER_DAYS) {
    return { target: 'admin', reason: 'escalation', ageDays }
  }

  if ((TERMINAL_FULFILLMENT_STATUSES as readonly string[]).includes(f.status)) {
    return { target: null, reason: null, ageDays }
  }

  if (f.last_nudged_at) {
    const nudgedAge = Math.floor((now.getTime() - new Date(f.last_nudged_at).getTime()) / (1000 * 60 * 60 * 24))
    if (nudgedAge < NUDGE_REPEAT_DAYS) {
      return { target: null, reason: null, ageDays }
    }
  }

  if (f.status === 'pledged' || f.status === 'agreement_signed') {
    if (ageDays >= NUDGE_THRESHOLDS.awaitingPaymentDays) {
      return { target: 'sponsor', reason: 'awaiting_payment', ageDays }
    }
  }

  if (f.status === 'payment_sent') {
    if (ageDays >= NUDGE_THRESHOLDS.sponsorSecondNoticeDays) {
      return { target: 'sponsor', reason: 'sponsor_second_notice', ageDays }
    }
    if (ageDays >= NUDGE_THRESHOLDS.awaitingReceiptDays) {
      return { target: 'coach', reason: 'awaiting_receipt', ageDays }
    }
  }

  return { target: null, reason: null, ageDays }
}
