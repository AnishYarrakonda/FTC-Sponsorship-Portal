import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  RECOGNITION_BENEFIT_TYPES,
  RECOGNITION_DELIVERY_STATUSES,
  OPEN_DELIVERY_STATUSES,
  CLOSED_DELIVERY_STATUSES,
  recognitionBenefitLabel,
  recognitionBenefitHint,
  deliveryStatusLabel,
  isOpenDelivery,
  formatTierRange,
  ladderForEmail,
  type TierLadderEntry,
} from '@/lib/recognition'
import { upsertTierSchema, adminVoidProofSchema } from '@/lib/schemas/recognition'
import { LIMITS } from '@/lib/schemas/limits'

const repoRoot = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(repoRoot, p), 'utf8')

const MIGRATION = read('supabase/migrations/0087_recognition_tiers.sql')

describe('recognition enums mirror the SQL exactly', () => {
  it('RECOGNITION_BENEFIT_TYPES matches the recognition_benefit_type enum, in order', () => {
    // Parsed out of the migration rather than hand-copied: a seventh value added in SQL
    // and forgotten in TypeScript is exactly the drift this asserts against.
    const block = MIGRATION.match(/CREATE TYPE recognition_benefit_type AS ENUM \(([\s\S]*?)\);/)
    expect(block).not.toBeNull()
    const values = Array.from(block![1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1])
    expect(values).toEqual([...RECOGNITION_BENEFIT_TYPES])
    expect(values).toHaveLength(6)
  })

  it('RECOGNITION_DELIVERY_STATUSES matches the recognition_delivery_status enum', () => {
    const block = MIGRATION.match(/CREATE TYPE recognition_delivery_status AS ENUM \(([\s\S]*?)\);/)
    expect(block).not.toBeNull()
    const values = Array.from(block![1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1])
    expect(values).toEqual([...RECOGNITION_DELIVERY_STATUSES])
  })
})

describe('open / closed delivery status partition', () => {
  it('is a partition: the union is complete and the two sets are disjoint', () => {
    const union = new Set<string>([...OPEN_DELIVERY_STATUSES, ...CLOSED_DELIVERY_STATUSES])
    expect([...union].sort()).toEqual([...RECOGNITION_DELIVERY_STATUSES].sort())
    for (const s of OPEN_DELIVERY_STATUSES) {
      expect(CLOSED_DELIVERY_STATUSES as readonly string[]).not.toContain(s)
    }
  })

  it('isOpenDelivery is true for exactly the open statuses', () => {
    for (const s of OPEN_DELIVERY_STATUSES) expect(isOpenDelivery(s)).toBe(true)
    for (const s of CLOSED_DELIVERY_STATUSES) expect(isOpenDelivery(s)).toBe(false)
    expect(isOpenDelivery(null)).toBe(false)
    expect(isOpenDelivery('nonsense')).toBe(false)
  })
})

describe('labels are total', () => {
  it('every benefit type has a non-empty label and hint', () => {
    for (const b of RECOGNITION_BENEFIT_TYPES) {
      expect(recognitionBenefitLabel(b).length).toBeGreaterThan(0)
      expect(recognitionBenefitHint(b).length).toBeGreaterThan(0)
      // A missing case must not fall through to the raw enum value — that is the bug
      // submission-status.ts documents for `delivered`/`opened`.
      expect(recognitionBenefitLabel(b)).not.toBe(b)
    }
  })

  it('every delivery status has a label', () => {
    for (const s of RECOGNITION_DELIVERY_STATUSES) {
      expect(deliveryStatusLabel(s).length).toBeGreaterThan(0)
      expect(deliveryStatusLabel(s)).not.toBe(s)
    }
  })
})

describe('formatTierRange', () => {
  it('renders a closed range with an inclusive-looking ceiling', () => {
    // The DB bound is EXCLUSIVE, so $7,500 belongs to the next tier up. Displaying
    // "$2,500 – $7,500" would make two disjoint tiers look like they overlap.
    expect(formatTierRange(250000, 750000)).toBe('$2,500 – $7,499')
  })

  it('renders the open-ended top tier', () => {
    expect(formatTierRange(750000, null)).toBe('$7,500+')
  })
})

describe('ladderForEmail', () => {
  it('maps enum values to labels and drops anything unrecognised', () => {
    const tiers: TierLadderEntry[] = [
      {
        id: 't1',
        name: 'Silver',
        rank: 2,
        min_amount_cents: 250000,
        max_amount_cents: 750000,
        benefits: ['logo_on_website', 'not_a_real_benefit' as never],
        description: null,
      },
    ]
    expect(ladderForEmail(tiers)).toEqual([
      { name: 'Silver', range: '$2,500 – $7,499', benefits: ['Logo on team website'] },
    ])
  })
})

describe('limits agree with the SQL CHECK constraints', () => {
  it('tier name, description and void reason lengths match 0087', () => {
    expect(MIGRATION).toContain(`char_length(name) BETWEEN 2 AND ${LIMITS.recognitionTierName}`)
    expect(MIGRATION).toContain(
      `char_length(description) <= ${LIMITS.recognitionTierDescription}`
    )
    expect(MIGRATION).toContain(
      `char_length(admin_void_reason) <= ${LIMITS.recognitionVoidReason}`
    )
    expect(MIGRATION).toContain(`char_length(coach_note) <= ${LIMITS.recognitionDeliveryNote}`)
  })
})

describe('schemas', () => {
  it('rejects an upper bound at or below the lower bound', () => {
    const base = { name: 'Silver', rank: 2, minAmountCents: 250000, benefits: [] }
    expect(upsertTierSchema.safeParse({ ...base, maxAmountCents: 250000 }).success).toBe(false)
    expect(upsertTierSchema.safeParse({ ...base, maxAmountCents: 750000 }).success).toBe(true)
  })

  it('treats a null upper bound as the open-ended top tier, not an error', () => {
    const r = upsertTierSchema.safeParse({
      name: 'Gold',
      rank: 3,
      minAmountCents: 750000,
      maxAmountCents: null,
      benefits: ['logo_on_robot'],
    })
    expect(r.success).toBe(true)
  })

  it('requires a real reason to void a proof', () => {
    expect(adminVoidProofSchema.safeParse({ deliveryId: crypto.randomUUID(), reason: 'bad' }).success).toBe(false)
    expect(
      adminVoidProofSchema.safeParse({
        deliveryId: crypto.randomUUID(),
        reason: 'A student is visible in the background of this photo.',
      }).success
    ).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Invariants — file-reading assertions, in the style of remediation-invariants.test.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('INVARIANT: threshold math exists in exactly one place', () => {
  const sources = [
    'lib/recognition.ts',
    'app/actions/recognition.ts',
    'components/coach/recognition-tab.tsx',
    'components/admin/recognition-tier-form.tsx',
    'app/(sponsor)/sponsor/recognition/page.tsx',
  ]

  it('no TypeScript source compares an amount to a tier threshold', () => {
    // The tier a sponsorship earns is decided by recognition_tier_for_amount(bigint) and
    // pinned into the award snapshot. A second implementation in the UI would drift the
    // moment an admin edits a threshold, and would silently disagree with what was
    // actually promised.
    const comparison = /(min_amount_cents|max_amount_cents|minAmountCents|maxAmountCents)\s*(<=|>=|<|>)|(<=|>=|<|>)\s*(min_amount_cents|max_amount_cents|minAmountCents|maxAmountCents)/
    for (const file of sources) {
      const body = read(file)
      // Strip comments: the prohibition is discussed in prose in several of these files.
      const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '')
      expect(comparison.test(code), `${file} compares a tier threshold`).toBe(false)
    }
  })

  it('the SQL comparison lives only in recognition_tier_for_amount', () => {
    const fnBody = MIGRATION.match(
      /CREATE OR REPLACE FUNCTION recognition_tier_for_amount[\s\S]*?\$\$;/
    )
    expect(fnBody).not.toBeNull()
    const rest = MIGRATION.replace(fnBody![0], '')
    // Remaining uses are column definitions, indexes, seeds and the overlap check inside
    // admin_upsert_recognition_tier — none of which map an amount to a tier.
    expect(rest).not.toContain('p_amount_cents >=')
  })
})

describe('INVARIANT: no proof URL escapes into an audit or notification payload', () => {
  const actions = read('app/actions/recognition.ts')

  it('audit_log inserts carry has_proof/benefit_type, never the URL', () => {
    // A-03-05 moved every audit write behind writeAudit(client, { … }). The invariant is
    // unchanged — a proof URL must never reach audit_log — only the call shape moved, so
    // the matcher follows it rather than the invariant being dropped.
    const inserts = Array.from(actions.matchAll(/writeAudit\([^,]+,\s*\{([\s\S]*?)\n  \}\)/g))
    expect(inserts.length).toBeGreaterThan(0)
    for (const m of inserts) {
      expect(m[1]).not.toMatch(/proof_url|proofUrl|publicUrl/)
    }
  })

  it('createInAppNotification calls carry no URL', () => {
    const calls = Array.from(actions.matchAll(/createInAppNotification\(\{([\s\S]*?)\}\)/g))
    expect(calls.length).toBeGreaterThan(0)
    for (const m of calls) {
      expect(m[1]).not.toMatch(/proof_url|proofUrl|publicUrl/)
    }
  })
})

describe('INVARIANT: no new sponsor outreach path', () => {
  it('the recognition actions import no mail client', () => {
    const actions = read('app/actions/recognition.ts')
    expect(actions).not.toMatch(/from 'resend'|require\('resend'\)|new Resend\(/)
    expect(actions).not.toMatch(/emails\.send/)
  })

  it('dispatchApprovedSubmission is still the only send site', () => {
    // Adding the ladder to the pitch must not add a way to reach a sponsor.
    const dispatch = read('lib/dispatch.ts')
    const sends = dispatch.match(/resend\.emails\.send/g) ?? []
    expect(sends).toHaveLength(1)
  })
})

describe('INVARIANT: the snapshot is authoritative', () => {
  it('nothing resolves a promised benefit by following tier_id back to the tier table', () => {
    // benefits_snapshot and the delivery rows ARE the promise. Reading
    // recognition_tiers.benefits through award.tier_id would make an admin's edit
    // retroactively rewrite what a sponsor was told they were buying.
    for (const file of [
      'app/actions/recognition.ts',
      'app/(coach)/dashboard/page.tsx',
      'app/(sponsor)/sponsor/recognition/page.tsx',
    ]) {
      const body = read(file)
      expect(body).not.toMatch(/tier_id\s*\([^)]*benefits/)
      expect(body).not.toMatch(/recognition_tiers\s*\(\s*benefits/)
    }
  })
})

describe('INVARIANT: 0087 grants follow the house rule', () => {
  it('every SECURITY DEFINER RPC is revoked from PUBLIC/anon/authenticated', () => {
    for (const fn of [
      'recognition_tier_for_amount',
      'recognition_tier_ladder',
      'trg_create_recognition_award',
      'create_recognition_award_for_fulfillment',
      'record_benefit_delivery',
      'void_benefit_proof',
      'admin_upsert_recognition_tier',
      'admin_archive_recognition_tier',
    ]) {
      expect(MIGRATION, `${fn} missing REVOKE`).toMatch(
        new RegExp(`REVOKE EXECUTE ON FUNCTION ${fn}\\([^)]*\\) FROM PUBLIC`)
      )
      expect(MIGRATION, `${fn} missing GRANT`).toMatch(
        new RegExp(`GRANT  EXECUTE ON FUNCTION ${fn}\\([^)]*\\) TO service_role`)
      )
    }
  })

  it('can_read_recognition_award is NOT revoked', () => {
    // It is evaluated inside an RLS policy as the CALLING role. Revoking it from
    // `authenticated` turns every read into 42501 instead of an empty result — 0062's
    // lesson, repeated by can_read_fulfillment.
    expect(MIGRATION).not.toMatch(/REVOKE EXECUTE ON FUNCTION can_read_recognition_award/)
  })

  it('the three tables have SELECT policies and no write policies', () => {
    for (const table of [
      'recognition_tiers',
      'sponsor_recognition_awards',
      'recognition_benefit_deliveries',
    ]) {
      expect(MIGRATION).toMatch(
        new RegExp(`ALTER TABLE ${table}\\s+ENABLE ROW LEVEL SECURITY`)
      )
    }
    // Any INSERT/UPDATE/DELETE policy would open a path around the RPCs, which are where
    // the role matrix and the no-minors rule actually live.
    expect(MIGRATION).not.toMatch(/CREATE POLICY[\s\S]{0,200}FOR (INSERT|UPDATE|DELETE)/)
  })

  it('sponsor scoping goes through current_sponsor_ids(), not profiles.sponsor_id', () => {
    // A sponsor user can belong to several sponsor orgs since 0082. The single-column
    // comparison the prompt inherited from the pre-0082 schema returns nothing for them.
    expect(MIGRATION).toContain('sponsor_id = ANY (current_sponsor_ids())')
    expect(MIGRATION).not.toMatch(/p\.sponsor_id = sponsor_recognition_awards\.sponsor_id/)
  })

  it('never uses auth.uid()', () => {
    expect(MIGRATION).not.toContain('auth.uid()')
  })
})
