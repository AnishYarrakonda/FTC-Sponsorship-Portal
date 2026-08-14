/**
 * Canonical recognition constants, labels and the ladder fetch.
 *
 * This file exists for the same reason lib/submission-status.ts does: without one home
 * for the groupings, each surface re-derives them and they drift. The coach checklist,
 * the sponsor owed-vs-delivered page and the admin tier editor all read from here.
 *
 * THERE IS DELIBERATELY NO tierForAmount() IN TYPESCRIPT. Threshold math lives in exactly
 * one place — recognition_tier_for_amount(bigint) in 0087. formatTierRange formats numbers
 * it is handed; it never compares an amount to a threshold. An invariant test asserts it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

export const RECOGNITION_BENEFIT_TYPES = [
  'logo_on_robot',
  'logo_on_team_shirt',
  'logo_on_website',
  'social_media_mention',
  'event_signage',
  'mention_in_outreach_materials',
] as const
export type RecognitionBenefitType = (typeof RECOGNITION_BENEFIT_TYPES)[number]

export const RECOGNITION_DELIVERY_STATUSES = [
  'promised',
  'in_progress',
  'delivered',
  'waived',
  'not_applicable',
] as const
export type RecognitionDeliveryStatus = (typeof RECOGNITION_DELIVERY_STATUSES)[number]

/** Still owed. Drives the coach's checklist badge and the sponsor's "outstanding" count. */
export const OPEN_DELIVERY_STATUSES = ['promised', 'in_progress'] as const
/** Settled one way or another — no further action expected from anyone. */
export const CLOSED_DELIVERY_STATUSES = ['delivered', 'waived', 'not_applicable'] as const

/**
 * Exhaustive Records rather than switch statements with a default: adding a seventh enum
 * value then fails the build here, instead of rendering `mention_in_outreach_materials`
 * raw into a sponsor's browser — the exact bug submission-status.ts documents for
 * `delivered`/`opened`.
 */
const BENEFIT_LABELS: Record<RecognitionBenefitType, string> = {
  logo_on_robot: 'Logo on robot',
  logo_on_team_shirt: 'Logo on team shirt',
  logo_on_website: 'Logo on team website',
  social_media_mention: 'Social media mention',
  event_signage: 'Event signage',
  mention_in_outreach_materials: 'Mention in outreach materials',
}

/** What acceptable proof looks like. COPPA: never a person, never a face. */
const BENEFIT_HINTS: Record<RecognitionBenefitType, string> = {
  logo_on_robot: 'A photo of the robot with the decal applied. No students in frame.',
  logo_on_team_shirt: 'A photo of the shirt itself, laid flat or on a hanger. Not worn.',
  logo_on_website: 'A screenshot of the sponsor section of your team site.',
  social_media_mention: 'A screenshot of the published post.',
  event_signage: 'A photo of the banner or pit signage. No students in frame.',
  mention_in_outreach_materials: 'A photo or screenshot of the printed or digital material.',
}

const STATUS_LABELS: Record<RecognitionDeliveryStatus, string> = {
  promised: 'Promised',
  in_progress: 'In progress',
  delivered: 'Delivered',
  waived: 'Waived by sponsor',
  not_applicable: 'Not applicable',
}

export function recognitionBenefitLabel(b: RecognitionBenefitType): string {
  return BENEFIT_LABELS[b]
}

export function recognitionBenefitHint(b: RecognitionBenefitType): string {
  return BENEFIT_HINTS[b]
}

export function deliveryStatusLabel(s: RecognitionDeliveryStatus): string {
  return STATUS_LABELS[s]
}

export function isRecognitionBenefitType(v: unknown): v is RecognitionBenefitType {
  return typeof v === 'string' && (RECOGNITION_BENEFIT_TYPES as readonly string[]).includes(v)
}

export function isOpenDelivery(s?: string | null): boolean {
  return !!s && (OPEN_DELIVERY_STATUSES as readonly string[]).includes(s)
}

export interface TierLadderEntry {
  id: string
  name: string
  rank: number
  min_amount_cents: number
  max_amount_cents: number | null
  benefits: RecognitionBenefitType[]
  description: string | null
}

function dollars(cents: number): string {
  return `$${Math.floor(cents / 100).toLocaleString('en-US')}`
}

/**
 * Formats an already-decided range. The upper bound is EXCLUSIVE in the database, so the
 * displayed ceiling is one cent below it — otherwise two adjacent tiers appear to overlap
 * on screen while being disjoint in fact.
 */
export function formatTierRange(minCents: number, maxCents: number | null): string {
  if (maxCents === null) return `${dollars(minCents)}+`
  return `${dollars(minCents)} – ${dollars(maxCents - 1)}`
}

/**
 * Fetch the live ladder for the pitch preview.
 *
 * Takes the client as an ARGUMENT and constructs nothing at module scope, so this file
 * stays importable from lib/dispatch.ts (which builds a Resend client at import time —
 * the reason lib/dispatch-budget.ts was split out) and from a Server Component alike.
 *
 * recognition_tier_ladder() is granted to service_role only, so this needs the admin
 * client. It reads configuration, never personal data.
 */
export async function fetchRecognitionLadder(
  client: SupabaseClient<Database>
): Promise<TierLadderEntry[]> {
  const { data, error } = await client.rpc('recognition_tier_ladder' as never)
  if (error || !Array.isArray(data)) return []
  return (data as unknown as TierLadderEntry[]).filter(
    (t) => t && typeof t.name === 'string' && typeof t.min_amount_cents === 'number'
  )
}

/** The shape emails/submission-email.tsx takes — plain strings, no enum knowledge. */
export function ladderForEmail(
  tiers: TierLadderEntry[]
): { name: string; range: string; benefits: string[] }[] {
  return tiers.map((t) => ({
    name: t.name,
    range: formatTierRange(t.min_amount_cents, t.max_amount_cents),
    benefits: (t.benefits ?? []).filter(isRecognitionBenefitType).map(recognitionBenefitLabel),
  }))
}
