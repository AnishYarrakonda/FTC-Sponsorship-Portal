import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  statusEnteredAt,
  ageInDays,
  agingBucket,
  nudgePlan,
  NUDGE_THRESHOLDS,
  NUDGE_REPEAT_DAYS,
  ESCALATE_AFTER_DAYS,
  AGING_BUCKETS,
  FulfillmentTimestamps,
} from '../fulfillment-aging'
import { FulfillmentStatus } from '../fulfillment-status'

const MOCK_NOW = new Date('2026-08-10T12:00:00.000Z')

describe('fulfillment-aging', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(MOCK_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createTimestamps(
    status: FulfillmentStatus,
    dates: Partial<Omit<FulfillmentTimestamps & { last_nudged_at: string | null }, 'status'>> = {}
  ): FulfillmentTimestamps & { status: FulfillmentStatus; last_nudged_at: string | null } {
    return {
      pledged_at: null,
      agreement_signed_at: null,
      payment_sent_at: null,
      payment_received_at: null,
      receipted_at: null,
      cancelled_at: null,
      status,
      last_nudged_at: null,
      ...dates,
    }
  }

  describe('statusEnteredAt', () => {
    it('returns the timestamp for the current status', () => {
      const f = createTimestamps('payment_sent', {
        pledged_at: '2026-07-01T00:00:00.000Z',
        payment_sent_at: '2026-07-15T00:00:00.000Z',
      })
      expect(statusEnteredAt(f)).toBe('2026-07-15T00:00:00.000Z')
    })

    it('falls back to pledged_at if current status timestamp is missing', () => {
      const f = createTimestamps('agreement_signed', {
        pledged_at: '2026-07-01T00:00:00.000Z',
      })
      expect(statusEnteredAt(f)).toBe('2026-07-01T00:00:00.000Z')
    })
  })

  describe('ageInDays', () => {
    it('calculates the age accurately', () => {
      const f = createTimestamps('payment_sent', {
        payment_sent_at: '2026-08-01T12:00:00.000Z', // 9 days ago
      })
      expect(ageInDays(f, MOCK_NOW)).toBe(9)
    })
  })

  describe('agingBucket', () => {
    it('categorizes on_track', () => {
      expect(agingBucket(0)).toBe('on_track')
      expect(agingBucket(AGING_BUCKETS.on_track.maxDays)).toBe('on_track')
    })
    it('categorizes aging', () => {
      expect(agingBucket(AGING_BUCKETS.on_track.maxDays + 1)).toBe('aging')
      expect(agingBucket(AGING_BUCKETS.aging.maxDays)).toBe('aging')
    })
    it('categorizes stale', () => {
      expect(agingBucket(AGING_BUCKETS.aging.maxDays + 1)).toBe('stale')
      expect(agingBucket(AGING_BUCKETS.stale.maxDays)).toBe('stale')
    })
    it('categorizes escalate', () => {
      expect(agingBucket(AGING_BUCKETS.stale.maxDays + 1)).toBe('escalate')
      expect(agingBucket(ESCALATE_AFTER_DAYS + 10)).toBe('escalate')
    })
  })

  describe('nudgePlan', () => {
    it('escalates to admin if >= ESCALATE_AFTER_DAYS', () => {
      const past = new Date(MOCK_NOW.getTime() - ESCALATE_AFTER_DAYS * 86400 * 1000).toISOString()
      const f = createTimestamps('payment_sent', {
        payment_sent_at: past,
      })
      const plan = nudgePlan(f, MOCK_NOW)
      expect(plan.target).toBe('admin')
      expect(plan.reason).toBe('escalation')
    })

    it('does not nudge terminal states', () => {
      const f = createTimestamps('receipted', {
        receipted_at: '2026-08-01T00:00:00.000Z',
      })
      expect(nudgePlan(f, MOCK_NOW).target).toBeNull()
    })

    it('does not nudge if recently nudged', () => {
      const nudgedRecently = new Date(MOCK_NOW.getTime() - (NUDGE_REPEAT_DAYS - 1) * 86400 * 1000).toISOString()
      const f = createTimestamps('pledged', {
        pledged_at: '2026-07-01T00:00:00.000Z',
        last_nudged_at: nudgedRecently,
      })
      expect(nudgePlan(f, MOCK_NOW).target).toBeNull()
    })

    it('nudges sponsor for awaiting payment (>= NUDGE_THRESHOLDS.awaitingPaymentDays)', () => {
      const sent = new Date(MOCK_NOW.getTime() - NUDGE_THRESHOLDS.awaitingPaymentDays * 86400 * 1000).toISOString()
      const f = createTimestamps('pledged', {
        pledged_at: sent,
      })
      const plan = nudgePlan(f, MOCK_NOW)
      expect(plan.target).toBe('sponsor')
      expect(plan.reason).toBe('awaiting_payment')
    })

    it('nudges coach for awaiting receipt (>= NUDGE_THRESHOLDS.awaitingReceiptDays)', () => {
      const sent = new Date(MOCK_NOW.getTime() - NUDGE_THRESHOLDS.awaitingReceiptDays * 86400 * 1000).toISOString()
      const f = createTimestamps('payment_sent', {
        payment_sent_at: sent,
      })
      const plan = nudgePlan(f, MOCK_NOW)
      expect(plan.target).toBe('coach')
      expect(plan.reason).toBe('awaiting_receipt')
    })

    it('nudges sponsor for second notice (>= NUDGE_THRESHOLDS.sponsorSecondNoticeDays)', () => {
      const sent = new Date(MOCK_NOW.getTime() - NUDGE_THRESHOLDS.sponsorSecondNoticeDays * 86400 * 1000).toISOString()
      const f = createTimestamps('payment_sent', {
        payment_sent_at: sent,
      })
      const plan = nudgePlan(f, MOCK_NOW)
      expect(plan.target).toBe('sponsor')
      expect(plan.reason).toBe('sponsor_second_notice')
    })
  })
})

