/**
 * Regression cover for Groups 3–5: notifications (A-05), observability (A-11) and
 * performance (A-09).
 *
 * Every finding here failed silently by construction — an empty recipient list, an
 * unreported crash, a health check that always says yes — so the assertions target the
 * property, not the implementation.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { execSync } from 'node:child_process'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('A-05-01 / A-05-02 — invited teammates are notified', () => {
  it('no surviving caller hand-rolls the sponsor-recipient read', () => {
    // The nudge cron this originally named was removed with the fulfillment layer (0111),
    // but the bug it encoded is general: profiles.sponsor_id is stamped only on the
    // ORIGINAL account holder, so a hand-rolled profiles-only read resolves an all-invited
    // org to zero recipients — and an empty recipient list is indistinguishable from a
    // successful send. Asserted across the tree rather than against one file, so deleting
    // the next caller cannot quietly delete the coverage too.
    const hits = execSync(
      "grep -rl \"eq('role', 'sponsor')\" app lib --include=*.ts --include=*.tsx || true",
      { cwd: root, encoding: 'utf8' }
    )
      .split('\n')
      .filter((f) => f && !f.includes('sponsor-recipients.ts') && !f.includes('__tests__'))

    for (const f of hits) {
      const src = read(f)
      const handRolled =
        /from\('profiles'\)[\s\S]{0,160}eq\('role', 'sponsor'\)[\s\S]{0,80}eq\('sponsor_id'/.test(src)
      if (!handRolled) continue

      // The bug is a profiles-only read, NOT the profiles read itself: app/actions/messages.ts
      // legitimately reads profiles and unions sponsor_members inline, which is what the
      // shared helper does. So the assertion is that every such reader also picks up members
      // one way or the other -- otherwise invited teammates are silently dropped.
      expect(
        /sponsor_members|sponsorRecipient/.test(src),
        `${f} reads sponsor profiles without unioning sponsor_members`
      ).toBe(true)
    }
  })

  it('admin approval fans out through the same helper', () => {
    const src = read('app/actions/moderation.ts')
    expect(src).toContain('sponsorRecipientIds')
    expect(src).not.toMatch(/from\('profiles'\)[\s\S]{0,160}eq\('role', 'sponsor'\)[\s\S]{0,80}eq\('sponsor_id'/)
  })

  it('the union helper covers legacy owners AND members', () => {
    const src = read('lib/sponsor-recipients.ts')
    expect(src).toContain("from('sponsor_members')")
    expect(src).toContain("eq('role', 'sponsor')")
    expect(src).toContain('sponsorRecipientProfiles')
  })
})

describe('A-05-03 — the legacy owner is in the approver set', () => {
  const src = read('lib/decision-followup.ts')

  it('unions legacy owners into the eligible set, not just as a zero-rows fallback', () => {
    // The old code reached the owner ONLY when the org had no member rows at all. One
    // invited approver and the original account holder stopped hearing about proposals
    // entirely, while remaining the person with full authority over the org.
    expect(src).toContain('legacyOwnerIdsWithoutMembership')
    expect(src).toMatch(/const eligible = new Set<string>\(\[/)
  })

  it('a member row still wins over legacy status', () => {
    // requireSponsorRole resolves `membership?.role ?? LEGACY_MEMBER_ROLE`; a deliberate
    // demotion must not be undone by the notification path.
    const helper = read('lib/sponsor-recipients.ts')
    expect(helper).toContain('withMembership.has(id)')
  })
})

describe('A-11-01 — does NOT reproduce', () => {
  it('instrumentation-client.ts is the supported convention and is really loaded', () => {
    // The finding claims Next does not auto-import this file and that it must be renamed
    // to sentry.client.config.ts. That is the LEGACY convention. Next's own docs describe
    // instrumentation-client.{js,ts} as the file that "runs before your application's
    // frontend code starts executing", and initBotId from this exact file is present in
    // the built client bundle. Renaming it would break BotID for no gain.
    const src = read('instrumentation-client.ts')
    expect(src).toContain('initBotId')
    expect(src).toContain('Sentry.init')
    expect(src).toContain('onRouterTransitionStart')
  })
})

describe('A-11-02 — the error boundary reports', () => {
  const src = read('app/error.tsx')

  it('captures to Sentry, not just console', () => {
    expect(src).toContain('Sentry.captureException(error')
  })

  it('carries the digest, which is what links it to the server-side log', () => {
    expect(src).toContain('digest: error.digest')
  })
})

describe('A-11-03 — the health check tells the truth', () => {
  const src = read('app/api/health/route.ts')

  it('the PUBLIC branch verifies the database', () => {
    // The deep probe already existed but was gated behind CRON_SECRET, which no
    // third-party uptime monitor has — so in practice nothing checked, and a paused
    // Supabase project still reported 100% uptime.
    expect(src).toContain('checkDatabase')
    expect(src).toMatch(/if \(!deep\) \{[\s\S]{0,200}await checkDatabase\(\)/)
  })

  it('signals failure with a status code, not just a body field', () => {
    expect(src).toMatch(/status: dbOk \? 200 : 503/)
  })

  it('caches so the endpoint cannot be turned into a database amplifier', () => {
    expect(src).toContain('DB_CHECK_TTL_MS')
    // Failures are cached too — otherwise an outage makes every probe a fresh query
    // against a database that is already struggling.
    expect(src).toMatch(/cachedDbCheck = \{ ok, at: now \}/)
  })
})

describe('A-11-04 — a bounce reaches the coach', () => {
  const src = read('app/api/webhooks/resend/route.ts')

  it('notifies the team owner', () => {
    expect(src).toContain('notifyCoachOfBounce')
    expect(src).toMatch(/could not be delivered/i)
  })

  it('fans out AFTER the audit row, so a Svix retry is deduped', () => {
    const audit = src.indexOf("action: `resend_webhook_${type}`")
    const notify = src.indexOf('await notifyCoachOfBounce(')
    expect(audit).toBeGreaterThan(-1)
    expect(notify).toBeGreaterThan(audit)
  })
})

describe('A-11-05 — the unverified webhook body never reaches Sentry', () => {
  const src = read('app/api/webhooks/clerk/route.ts')

  it('captures a message, not the raw Svix error', () => {
    // A failed signature check means the payload is untrusted AND unattributed, and a
    // Clerk user payload is full of PII.
    expect(src).not.toMatch(/signature verification failed[\s\S]{0,120}captureException\(err\)/)
    expect(src).toContain('signature verification failed: ${reason}')
  })

  it('keeps the svix ids, which are what actually diagnose a secret mismatch', () => {
    expect(src).toContain("svix_id: req.headers.get('svix-id')")
  })
})

describe('A-09-01 — the dashboard range filter is indexed', () => {
  const sql = read('supabase/migrations/0105_submissions_updated_at_index.sql')

  it('adds a plain index for the ORDER BY and a composite for the cited counts', () => {
    expect(sql).toContain('idx_submissions_updated_at')
    expect(sql).toContain('idx_submissions_status_updated_at')
  })

  it('is not CONCURRENTLY — the runner applies files in a transaction', () => {
    // Match an actual CREATE INDEX, not the comment explaining why CONCURRENTLY is absent.
    expect(sql).not.toMatch(/CREATE INDEX\s+CONCURRENTLY/i)
  })
})

describe('A-09-03 — impact rollup is parallel but bounded', () => {
  const src = read('app/api/cron/impact-rollup/route.ts')

  it('no longer awaits sponsors one at a time', () => {
    expect(src).not.toMatch(/for \(const sponsorId of sponsorIds\) \{\s*\n\s*const payload = await/)
  })

  it('bounds concurrency rather than fanning out unbounded', () => {
    // Each payload build issues several queries; an unbounded Promise.all over hundreds
    // of sponsors trades a slow job for one that exhausts the connection pool.
    expect(src).toContain('CONCURRENCY')
    expect(src).toMatch(/Math\.min\(CONCURRENCY, sponsorIds\.length\)/)
  })

  it('one sponsor failing does not abort the rest', () => {
    expect(src).toMatch(/catch \(e\) \{[\s\S]{0,140}failures\.push/)
  })
})

describe('A-09-04 — the CSV export streams', () => {
  const src = read('app/api/admin/export/route.ts')

  it('returns a ReadableStream rather than a joined string', () => {
    expect(src).toContain('new ReadableStream')
    // Match a real statement, not the comment that explains what used to be here.
    expect(src).not.toMatch(/^\s*const csv = lines\.join/m)
    expect(src).not.toMatch(/submissions\.push\(\.\.\.page\)/)
  })

  it('audits BEFORE the first byte, so a disconnect cannot erase the record', () => {
    const audit = src.indexOf("action: 'export_submissions_csv'")
    const stream = src.indexOf('new ReadableStream')
    expect(audit).toBeGreaterThan(-1)
    expect(audit).toBeLessThan(stream)
  })

  it('aborts on failure instead of closing cleanly', () => {
    // Headers are already sent, so there is no 500 to return. Closing cleanly would hand
    // the admin a silently truncated financial export — worse than a failed download.
    expect(src).toContain('controller.error(e)')
    expect(src).toContain('export_submissions_csv_failed')
  })

  it('still records the row count on success', () => {
    expect(src).toContain('export_submissions_csv_completed')
    expect(src).toContain('row_count: rowCount')
  })
})
