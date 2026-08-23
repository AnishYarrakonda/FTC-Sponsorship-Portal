/**
 * Regression cover for P2 Group E (enterprise) and the whole P3 polish sweep.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { createZip, safeZipSegment } from '../zip'
import { jitMemberRole, reconcileMemberRole } from '../sponsor-roles'
import { LIMITS } from '../schemas/limits'

const root = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const readCode = (p: string) =>
  read(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// ── A-12-05 ────────────────────────────────────────────────────────────────────────────

describe('A-12-05 — sponsor self-serve audit log', () => {
  const migration = read('supabase/migrations/0109_sponsor_self_serve_audit_log.sql')

  it('audit_log RLS is NOT loosened — the projection is a function instead', () => {
    // The finding's direction was an RLS policy on audit_log, which would also expose the
    // free-form `metadata` jsonb of every matching row to a sponsor.
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]{0,120}ON\s+(public\.)?audit_log/i)
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.sponsor_audit_log')
  })

  it('the visible actions are an allowlist, not a denylist', () => {
    expect(migration).toContain('sponsor_auditable_actions()')
    expect(migration).toContain('a.action = ANY (sponsor_auditable_actions())')
    // Coach-side and admin-moderation actions are not this org's business even when the
    // row mentions its id.
    expect(migration).not.toMatch(/'submit_submission'/)
    expect(migration).not.toMatch(/'verify_coach'/)
    expect(migration).not.toMatch(/'deny_coach'/)
  })

  it('org scoping goes through current_sponsor_ids(), never a caller-supplied id', () => {
    expect(migration).toContain('v_orgs := current_sponsor_ids();')
    expect(migration).toContain("(a.metadata ->> 'sponsor_id')::uuid = ANY (v_orgs)")
    // A caller-supplied profile/org id is the exact shape A-02-02 exploited.
    expect(migration).not.toMatch(/p_sponsor_id|p_profile_id/)
  })

  it('only ONE metadata value is returned, read by name — never the blob', () => {
    const body = migration.slice(migration.indexOf('RETURN QUERY'))
    const metadataReads = body.match(/a\.metadata/g) ?? []
    // One in the projection (amount_cents), one in the WHERE (sponsor_id).
    expect(metadataReads.length).toBe(2)
    expect(body).toContain("a.metadata ->> 'amount_cents'")
    expect(body).not.toMatch(/SELECT[\s\S]{0,80}a\.metadata\s*(,|$)/)
  })

  it('it is org_admin only, enforced in SQL and not only in the action', () => {
    expect(migration).toContain("sponsor_member_role_rank('org_admin')")
    expect(migration).toContain("RAISE EXCEPTION 'forbidden'")
    expect(read('app/actions/sponsor-audit.ts')).toContain("requireSponsorRole('org_admin')")
  })

  it('anon cannot execute it', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.sponsor_audit_log(integer, integer) FROM anon')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.sponsor_audit_log(integer, integer) TO authenticated')
  })

  it('the action runs as the CALLER, not through the admin client', () => {
    // The function is SECURITY DEFINER and derives its whole scope from the caller's JWT.
    const src = read('app/actions/sponsor-audit.ts')
    expect(src).not.toContain('createAdminClient')
    expect(src).toContain("supabase.rpc('sponsor_audit_log'")
  })

  it('the page is read-only and reachable from the sponsor nav', () => {
    const page = read('app/(sponsor)/sponsor/activity/page.tsx')
    expect(page).toContain('listSponsorAuditLog')
    // No mutation imported that could quietly become one.
    expect(page).not.toMatch(/import .*\{[^}]*(update|delete|create|insert)[^}]*\} from '@\/app\/actions/i)
    expect(read('components/sponsor/sponsor-sidebar.tsx')).toContain("href: '/sponsor/activity'")
  })
})

// ── A-12-06 ────────────────────────────────────────────────────────────────────────────

describe('A-12-06 — marketing asset export', () => {
  it('produces a real ZIP: signature, entry count and end-of-central-directory', () => {
    const zip = createZip(
      [
        { name: 'a/one.txt', data: new TextEncoder().encode('hello') },
        { name: 'manifest.csv', data: new TextEncoder().encode('file\n') },
      ],
      new Date('2026-08-23T12:00:00Z')
    )
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(dv.getUint32(0, true)).toBe(0x04034b50) // first local file header

    // End of central directory is the last 22 bytes when there is no archive comment.
    const eocd = zip.length - 22
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50)
    expect(dv.getUint16(eocd + 8, true)).toBe(2) // entries on this disk
    expect(dv.getUint16(eocd + 10, true)).toBe(2) // entries total
  })

  it('round-trips through the system unzip, so it is not merely well-formed to us', () => {
    const zip = createZip([
      { name: 'folder/hello.txt', data: new TextEncoder().encode('the quick brown fox') },
      { name: 'manifest.csv', data: new TextEncoder().encode('file,team\nfolder/hello.txt,Test\n') },
    ])
    const tmp = execSync('mktemp -d', { encoding: 'utf8' }).trim()
    const zipPath = join(tmp, 'assets.zip')
    writeFileSync(zipPath, zip)
    // -t tests the archive; a bad CRC or a wrong offset fails here.
    const out = execSync(`unzip -t ${JSON.stringify(zipPath)} 2>&1 || true`, { encoding: 'utf8' })
    expect(out, out).toContain('No errors detected')
    const listing = execSync(`unzip -Z1 ${JSON.stringify(zipPath)}`, { encoding: 'utf8' })
    expect(listing).toContain('folder/hello.txt')
    expect(listing).toContain('manifest.csv')
    const content = execSync(`unzip -p ${JSON.stringify(zipPath)} folder/hello.txt`, { encoding: 'utf8' })
    expect(content).toBe('the quick brown fox')
  })

  it('an empty archive is still a valid archive', () => {
    const zip = createZip([])
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(zip.length).toBe(22)
    expect(dv.getUint32(0, true)).toBe(0x06054b50)
  })

  it('archive paths cannot carry separators, traversal, or Windows-illegal characters', () => {
    expect(safeZipSegment('../../etc/passwd')).not.toContain('..')
    expect(safeZipSegment('../../etc/passwd')).not.toContain('/')
    expect(safeZipSegment('Team: "Robo" <1>|x')).not.toMatch(/[\\/:*?"<>|]/)
    expect(safeZipSegment('')).toBe('team')
    expect(safeZipSegment('x'.repeat(200)).length).toBeLessThanOrEqual(80)
  })

  it('the route re-validates every asset URL before fetching it', () => {
    // SSRF: the snapshot is an immutable payload that may predate A-06-04's write-side
    // validation, and this fetch happens server-side from a signed-in session.
    const src = read('app/api/sponsor/impact-report/route.ts')
    expect(src).toContain('safeMediaUrl(rawUrl)')
    expect(src).toContain("redirect: 'error'")
    expect(src).toContain('MAX_ASSET_BYTES')
    expect(src).toContain('MAX_BUNDLE_BYTES')
  })

  it('one unreachable asset does not fail the whole export', () => {
    const src = read('app/api/sponsor/impact-report/route.ts')
    expect(src).toContain('skipped.push')
    expect(src).toContain("rowToCsv(['SKIPPED'")
  })

  it('the bundle restates the COPPA affirmation the images were cleared under', () => {
    expect(read('app/api/sponsor/impact-report/route.ts')).toContain('no identifiable minors')
  })

  it('no zip dependency was added', () => {
    const pkg = JSON.parse(read('package.json'))
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    for (const forbidden of ['jszip', 'archiver', 'adm-zip', 'yazl', 'zip-stream']) {
      expect(deps, forbidden).not.toHaveProperty(forbidden)
    }
  })
})

// ── P3 sweep ───────────────────────────────────────────────────────────────────────────

describe('P3 — app/actions', () => {
  it('feedback max lengths come from LIMITS, not a hardcoded 2000', () => {
    for (const f of ['app/actions/moderation.ts', 'app/actions/sponsor-decision.ts']) {
      expect(read(f), f).toContain('z.string().max(LIMITS.feedback)')
      expect(readCode(f), f).not.toContain('z.string().max(2000)')
    }
    expect(LIMITS.feedback).toBe(2000)
  })

  it('the sponsor is not emailed twice about the same approved submission', () => {
    // dispatchApprovedSubmission already sends them the real pitch.
    const src = read('app/actions/moderation.ts')
    const block = src.slice(src.indexOf('New submission is ready for your decision') - 400)
    expect(block.slice(0, 500)).toContain('skipEmail: true')
  })

  it("the coach's approval notification says what the admin preview promises", () => {
    expect(read('app/actions/moderation.ts')).toContain(
      'has been approved and dispatched. You will be notified when the sponsor responds.'
    )
  })
})

describe('P3 — components', () => {
  it('the sponsor confirm dialog uses a verb, not the raw decision enum', () => {
    const src = read('components/sponsor/review-shell.tsx')
    expect(src).toContain('CONFIRM_PROMPTS')
    expect(src).toContain('Are you sure you want to approve this submission')
    // "Are you sure you want to APPROVED this submission?" — read as money is committed.
    expect(readCode(src ? 'components/sponsor/review-shell.tsx' : '')).not.toContain(
      "{showConfirm.replace('_', ' ')}"
    )
  })

  it('the appeal panel does not render "Confirm overturned"', () => {
    const src = readCode('components/admin/appeal-review-panel.tsx')
    expect(src).not.toContain("Confirm {outcome ?? 'decision'}")
    expect(src).toContain("'Confirm overturn'")
  })

  it('the coach thread does not print the same sentence twice', () => {
    const src = readCode('components/messages/thread-panels.tsx')
    const sentence = 'No questions yet. If ${sponsorName} has one, it will appear here.'
    expect(src.split(sentence).length - 1, 'the empty-state sentence appears more than once').toBe(1)
  })

  it('team_payout_profiles is read with maybeSingle, not single', () => {
    // .single() throws a console 406 on every /team/edit load for a team with no profile.
    const src = readCode('components/coach/portfolio-tab.tsx')
    const block = src.slice(src.indexOf("from('team_payout_profiles')"), 400 + src.indexOf("from('team_payout_profiles')"))
    expect(block).toContain('.maybeSingle()')
    expect(block).not.toMatch(/(?<!maybeS)\.single\(\)/)
  })

  it('a failed portfolio save offers a way to the first invalid field', () => {
    const src = read('components/coach/portfolio-tab.tsx')
    expect(src).toContain('function focusFirstError()')
    expect(src).toContain('scrollIntoView')
    expect(src).toContain('onClick={focusFirstError}')
  })

  it("a team with no charitable status does not render 'None'", () => {
    // 'None' is a real enum value, not a null.
    expect(read('components/impact/impact-report-view.tsx')).toContain('function taxStatusLabel')
    expect(read('app/api/sponsor/impact-report/route.ts')).toContain(
      "section.team.tax_status === 'None' ? '' : section.team.tax_status"
    )
  })

  it('fulfillment dates are en-US, matching the rest of the app', () => {
    for (const f of ['components/sponsor/sponsor-fulfillment-row.tsx', 'components/coach/funding-tab.tsx']) {
      expect(read(f), f).not.toContain('en-GB')
    }
  })
})

describe('P3 — accessibility polish', () => {
  it('dialog modality uses base-ui’s own option and NOT a hand-added aria-modal', () => {
    // aria-modal without real inertness tells assistive tech the background is unreachable
    // when it is not — worse than saying nothing.
    const src = read('components/ui/dialog.tsx')
    expect(src).toContain('modal = true')
    expect(src).toContain('modal={modal}')
    expect(readCode('components/ui/dialog.tsx')).not.toContain('aria-modal')
  })

  it('every <th> from the shared Table carries a scope', () => {
    expect(read('components/ui/table.tsx')).toContain('scope="col"')
  })

  it("the audit log's fifth column has a name", () => {
    const src = read('components/admin/audit-log-table.tsx')
    expect(src).toContain('sr-only')
    expect(src).toContain("label: 'Details'")
    expect(readCode('components/admin/audit-log-table.tsx')).not.toContain("'Time', ''")
  })

  it('the proof-removal reason has a persistent, announced rule', () => {
    const src = read('components/admin/proof-review-queue.tsx')
    expect(src).toContain('aria-describedby={`proof-reason-hint-')
    expect(src).toContain('At least 10 characters')
    expect(src).toContain('aria-label=')
  })

  it('the textarea uses the shared form-control border token', () => {
    // Measured: --border-color is 1.18:1 against the field background and FAILED 1.4.11;
    // --input is 3.15:1 and is what Input was already fixed to. The pack said the FOCUS
    // treatment passes (4.49 / 5.29, both reproduced) and asked only for consistency — the
    // rest-state failure was found while checking that claim.
    const src = read('components/ui/textarea.tsx')
    expect(src).toContain('border-input')
    expect(src).toContain('focus-visible:ring-2')
    expect(src).not.toContain('var(--border-color)')
  })
})

describe('P3 — docs', () => {
  it('the architecture rule lists every cron route and which two are scheduled', () => {
    // The pack called this "already done"; workflows.md was updated, architecture.md was
    // not, and still listed expire-submissions as the only cron route.
    const doc = read('.claude/rules/architecture.md')
    expect(doc).toContain('cron/daily-maintenance')
    expect(doc).toContain('cron/refresh-ftc-roster')
    expect(doc).toContain('cron/nudge-fulfillments')
    expect(doc).toContain('cron/impact-rollup')
  })

  it('vercel.json still schedules exactly two, which is the Hobby ceiling', () => {
    const vercel = JSON.parse(read('vercel.json'))
    expect(vercel.crons).toHaveLength(2)
    expect(vercel.crons.map((c: { path: string }) => c.path)).toEqual([
      '/api/cron/expire-submissions',
      '/api/cron/daily-maintenance',
    ])
  })
})

describe('P3 — IdP group mapping: CLOSED AS A DECISION, not a defect', () => {
  /**
   * The finding asks for SAML group claims to provision "Approver" vs "Viewer", and
   * attributes the gap to `updateSponsorAsOrgAdmin`. That function writes columns on the
   * `sponsors` row (the approval threshold) and has nothing to do with member roles, so
   * the location is wrong.
   *
   * The behaviour itself is deliberate and documented in jitMemberRole: anything that is
   * not an explicit Clerk `org:admin` becomes `viewer`, because "an IdP-authenticated
   * stranger must not be able to move money on day one". `approver` is the rank that
   * countersigns funding. Letting an IdP assertion grant it would hand the authority to
   * commit a sponsor's budget to whoever controls their directory groups, with no act by
   * anyone at the sponsor.
   *
   * That is a real trade, and it is the customer's to make — not one to make silently on
   * their behalf by shipping the mapping. Closed as a product decision. These tests pin
   * the invariant so it cannot be reversed by accident.
   */
  it('an SSO first login lands on viewer, never on a money-moving rank', () => {
    expect(jitMemberRole('org:member')).toBe('viewer')
    expect(jitMemberRole(null)).toBe('viewer')
    expect(jitMemberRole(undefined)).toBe('viewer')
    expect(jitMemberRole('approver')).toBe('viewer')
    expect(jitMemberRole('org:approver')).toBe('viewer')
    expect(jitMemberRole('anything-an-idp-might-assert')).toBe('viewer')
  })

  it('org:admin is honoured only because Clerk alone can grant it', () => {
    expect(jitMemberRole('org:admin')).toBe('org_admin')
  })

  it('a returning member is never demoted by an SSO re-login', () => {
    expect(reconcileMemberRole('org:member', 'approver')).toBe('approver')
    expect(reconcileMemberRole('org:member', 'submitter')).toBe('submitter')
    expect(reconcileMemberRole('org:member', 'viewer')).toBe('viewer')
  })

  it('a genuine Clerk-dashboard demotion still lands', () => {
    expect(reconcileMemberRole('org:member', 'org_admin')).toBe('submitter')
  })
})
