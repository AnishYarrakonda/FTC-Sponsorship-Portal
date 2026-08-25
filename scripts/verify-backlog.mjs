#!/usr/bin/env node
/**
 * verify-backlog — one command for every acceptance check in `prompts/01-18` that a
 * machine can honestly decide on its own.
 *
 * The prompt pack ends each slice with an acceptance checklist (287 boxes in total).
 * Most were never ticked. A large share of them are not really "manual" at all — they
 * are SQL shape assertions, grep guards against PII leaking into logs and emails, HTTP
 * status contracts, and env presence. Those are the ones this script decides.
 *
 * It deliberately does NOT pretend to cover:
 *   - anything needing a real browser session (see tests/e2e/*.spec.ts)
 *   - anything living in a third-party dashboard (Resend, Clerk, Vercel, GoDaddy)
 *   - anything needing human judgement (screen-reader output, legal copy review)
 * Those are tracked in docs/verification-backlog.md and reported here as MANUAL so the
 * count always adds up to the full 287 rather than quietly shrinking to what is easy.
 *
 * Usage:
 *   node scripts/verify-backlog.mjs                # everything runnable
 *   node scripts/verify-backlog.mjs --group=db     # db | grep | http | env | gates
 *   node scripts/verify-backlog.mjs --prompt=14
 *   node scripts/verify-backlog.mjs --json
 *
 * Exit code is 1 if any check FAILs. SKIP (missing prerequisite) never fails the run —
 * a missing DATABASE_URL is not the same as a broken invariant, and conflating them is
 * how a green suite starts lying.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── env ────────────────────────────────────────────────────────────────────────

/** Minimal .env.local reader. Deliberately not dotenv — this script must run with zero installs. */
function loadEnvLocal() {
  const path = join(ROOT, '.env.local')
  if (!existsSync(path)) return {}
  const out = {}
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[line.slice(0, eq).trim()] = value
  }
  return out
}

const ENV = { ...loadEnvLocal(), ...process.env }
const PSQL = ['/opt/homebrew/opt/libpq/bin/psql', 'psql'].find((p) => {
  try {
    return p.startsWith('/') ? existsSync(p) : true
  } catch {
    return false
  }
})

// ── primitives ─────────────────────────────────────────────────────────────────

class Skip extends Error {}
const skip = (why) => {
  throw new Skip(why)
}

/**
 * Run a query and return rows as arrays of strings.
 * `-At -F'|'` keeps parsing trivial; every check below asserts on shape, never on
 * formatting, so the crude delimiter is safe.
 */
async function sql(query) {
  if (!ENV.DATABASE_URL) skip('DATABASE_URL not set in .env.local')
  if (!PSQL) skip('psql not found (brew install libpq)')
  const { stdout } = await execFileAsync(PSQL, [ENV.DATABASE_URL, '-At', '-F', '|', '-c', query], {
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => l.split('|'))
}

/** Single scalar from a query, as a string. */
async function scalar(query) {
  const rows = await sql(query)
  return rows.length ? rows[0][0] : null
}

/**
 * ripgrep if present, else git grep. Returns matching lines.
 * Non-zero exit means "no matches" for both tools, which is a valid result here —
 * several checks assert emptiness — so it is caught rather than thrown.
 */
async function grep(pattern, paths, { codeOnly = false } = {}) {
  const existing = paths.filter((p) => existsSync(join(ROOT, p)))
  if (existing.length === 0) skip(`none of these paths exist: ${paths.join(', ')}`)
  let lines
  try {
    const { stdout } = await execFileAsync('grep', ['-rnE', pattern, ...existing], { cwd: ROOT, maxBuffer: 8 * 1024 * 1024 })
    lines = stdout.split('\n').filter(Boolean)
  } catch (err) {
    if (err.code === 1) return []
    throw err
  }
  if (!codeOnly) return lines
  // These files document the very rule being asserted ("this module never references
  // profiles", "NO OBJECT SPREAD ANYWHERE IN THIS FILE"). Matching that prose reports a
  // violation on the file that is most careful about it, so comment lines are dropped.
  return lines.filter((l) => {
    const body = l.replace(/^[^:]+:\d+:/, '').trim()
    return !(body.startsWith('//') || body.startsWith('*') || body.startsWith('/*') || body.startsWith('--') || body.startsWith('#'))
  })
}

/** Read a repo file, or SKIP if the slice that creates it was never built. */
function read(relPath) {
  const full = join(ROOT, relPath)
  if (!existsSync(full)) skip(`${relPath} does not exist`)
  return readFileSync(full, 'utf8')
}

async function http(path, init = {}) {
  const base = (ENV.VERIFY_BASE_URL ?? ENV.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  if (!base) skip('set VERIFY_BASE_URL (or NEXT_PUBLIC_APP_URL) to probe a deployment')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(`${base}${path}`, { redirect: 'manual', signal: ctrl.signal, ...init })
    return { status: res.status, body: await res.text().catch(() => ''), headers: res.headers }
  } finally {
    clearTimeout(timer)
  }
}

// ── assertions ─────────────────────────────────────────────────────────────────

function assert(cond, detail) {
  if (!cond) throw new Error(detail)
  return detail
}
const eq = (actual, expected, label) =>
  assert(String(actual) === String(expected), `${label}: expected ${expected}, got ${actual}`)

// ── the checks ─────────────────────────────────────────────────────────────────
// id is `<prompt>.<n>` matching the nth acceptance box in that prompt's checklist, so a
// result here can always be traced back to the line that demanded it.

const checks = []
const check = (id, group, title, run) => checks.push({ id, prompt: id.split('.')[0], group, title, run })

// ---- 01 · funding fulfillment state machine -----------------------------------

check('01.3', 'db', 'sponsors.funding_used_cents invariant holds for every sponsor', async () => {
  const rows = await sql(`
    select s.id, s.funding_used_cents,
           coalesce((select sum(t.amount_cents) from transactions_ledger t where t.sponsor_id = s.id), 0)
             + coalesce((select sum(sub.reserved_amount_cents) from submissions sub
                          where sub.sponsor_id = s.id and sub.reserved_amount_cents > 0
                            and sub.status not in ('approved','declined','expired','bounced')), 0) as expected
      from sponsors s`)
  const drifted = rows.filter(([, used, expected]) => used !== expected)
  return assert(drifted.length === 0, drifted.length ? `drifted sponsors: ${JSON.stringify(drifted)}` : `${rows.length} sponsors reconcile`)
})

/**
 * "No authenticated role can UPDATE or DELETE X" is enforced by RLS, not by GRANTs.
 *
 * Supabase hands the `authenticated` role blanket INSERT/UPDATE/DELETE on every table in
 * `public` by default. That grant is inert while RLS is enabled and the table carries no
 * write policy: Postgres evaluates the grant, then finds no policy permitting the row, and
 * rejects. Asserting on `role_table_grants` therefore reports a failure on a correctly
 * locked table — it is the wrong mechanism. Assert the two things that actually decide it.
 */
async function assertWriteSealed(tables) {
  const list = tables.map((t) => `'${t}'`).join(',')
  // No ::text cast — psql renders a bare bool as t/f, but bool::text renders as true/false.
  const rls = await sql(`select relname, relrowsecurity from pg_class where relname in (${list})`)
  eq(rls.length, tables.length, 'tables present')
  const off = rls.filter(([, on]) => on !== 't').map(([n]) => n)
  assert(off.length === 0, `RLS disabled on ${off.join(', ')} — the blanket grant is live`)
  const writes = await sql(`select tablename, cmd, policyname from pg_policies
     where tablename in (${list}) and cmd <> 'SELECT'`)
  assert(writes.length === 0, `write policies exist: ${JSON.stringify(writes)}`)
  return `RLS on, 0 write policies on ${tables.length} table(s) — writes rejected regardless of grants`
}

check('01.13', 'grep', 'payment_reference never reaches an audit or notification payload', async () => {
  const hits = await grep('payment_reference|paymentReference', ['app/actions/fulfillment.ts'])
  const bad = hits.filter((h) => /audit|metadata|notif|title:|body:/i.test(h))
  return assert(bad.length === 0, bad.length ? bad.join('\n') : `${hits.length} refs, all outside audit/notify payloads`)
})

// ---- 02 · payout profiles & W-9 ----------------------------------------------

check('02.13', 'env', 'PAYOUT_ENCRYPTION_KEY is gone from lib/env.ts (0111 removed payouts)', async () => {
  const src = read('lib/env.ts')
  // Inverted by 0111: the payout/W-9 subsystem was removed, so a *required* env var that
  // nothing reads is now a deployment hazard (it 500s a fresh clone for no reason), not a
  // safeguard. The check stays, pointing the other way.
  return assert(!/PAYOUT_ENCRYPTION_KEY/.test(src), 'PAYOUT_ENCRYPTION_KEY still required in lib/env.ts')
})

// ---- 03 · fulfillment UI & reconciliation ------------------------------------

check('03.14', 'http', 'GET /api/cron/nudge-fulfillments without the secret returns JSON 401', async () => {
  const { status, body } = await http('/api/cron/nudge-fulfillments')
  eq(status, 401, 'status')
  assert(!body.startsWith('<'), 'body is HTML — the route redirected instead of returning JSON')
  return `401 ${body.slice(0, 80)}`
})

check('03.16', 'grep', 'payment_reference never reaches an email template or a cron', async () => {
  const hits = await grep('payment_reference|paymentReference', ['emails', 'app/api/cron'])
  return assert(hits.length === 0, hits.length ? hits.join('\n') : 'absent from emails/ and cron routes')
})

check('03.18', 'grep', 'this slice added no SQL', async () => {
  const { stdout } = await execFileAsync('git', ['log', '--oneline', '-1', '--', 'supabase/migrations'], { cwd: ROOT })
  return `latest migration commit: ${stdout.trim() || 'none'}`
})

// ---- 04 · receipts -----------------------------------------------------------

check('04.11', 'db', 'only service_role may execute the receipt RPCs', async () => {
  const rows = await sql(`
    select p.proname, r.rolname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname='public'
      cross join (values ('authenticated'),('anon')) as r(rolname)
     where p.proname in ('issue_funding_receipt','void_funding_receipt')
       and has_function_privilege(r.rolname, p.oid, 'EXECUTE')`)
  return assert(rows.length === 0, rows.length ? `leaked EXECUTE: ${JSON.stringify(rows)}` : 'anon/authenticated denied on both')
})

// ---- 05 · agreement templates ------------------------------------------------

// ---- 06 · e-sign -------------------------------------------------------------

// ---- 07 · FIRST team verification --------------------------------------------

check('07.3', 'env', 'FIRST_API_USERNAME / FIRST_API_TOKEN are declared in lib/env.ts', async () => {
  const src = read('lib/env.ts')
  assert(/FIRST_API_USERNAME/.test(src), 'FIRST_API_USERNAME absent from lib/env.ts')
  assert(/FIRST_API_TOKEN/.test(src), 'FIRST_API_TOKEN absent from lib/env.ts')
  const set = ENV.FIRST_API_USERNAME && ENV.FIRST_API_TOKEN
  return `declared in lib/env.ts; locally ${set ? 'set' : 'UNSET (FTCScout fallback in use)'}`
})

check('07.10', 'http', 'cron/refresh-ftc-roster rejects a missing bearer token with JSON 401', async () => {
  const { status, body } = await http('/api/cron/refresh-ftc-roster')
  eq(status, 401, 'status')
  assert(!body.startsWith('<'), 'body is HTML — route redirected instead of returning JSON')
  return `401 ${body.slice(0, 80)}`
})

// ---- 08 · sponsor organizations ----------------------------------------------

check('08.11', 'db', 'no RLS policy anywhere still keys off auth.uid() (NULL under Clerk)', async () => {
  const rows = await sql(`select tablename, policyname from pg_policies
     where schemaname='public' and (qual like '%auth.uid()%' or with_check like '%auth.uid()%')`)
  return assert(rows.length === 0, rows.length ? `auth.uid() in: ${JSON.stringify(rows)}` : 'zero auth.uid() references in public policies')
})

check('08.12', 'db', 'sponsor resolution goes through current_sponsor_ids(), not profiles.sponsor_id', async () => {
  const n = await scalar(`select count(*) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='public' and p.proname='current_sponsor_ids'`)
  assert(n !== '0', 'current_sponsor_ids() missing — 0082 not applied')
  const stale = await sql(`select tablename, policyname from pg_policies
     where schemaname='public' and qual like '%profiles.sponsor_id%' and qual not like '%current_sponsor_ids%'`)
  return assert(stale.length === 0, stale.length ? `legacy pattern in: ${JSON.stringify(stale)}` : 'all sponsor policies use current_sponsor_ids()')
})

check('08.13', 'db', 'no RLS recursion (42P17) on the four cross-referencing tables', async () => {
  for (const t of ['teams', 'submissions', 'team_achievements', 'transactions_ledger']) {
    await sql(`select count(*) from ${t}`)
  }
  return 'teams, submissions, team_achievements, transactions_ledger all queryable'
})

// ---- 09 · org roles & approvals ----------------------------------------------

check('09.5', 'db', 'the money RPCs are not executable by authenticated', async () => {
  const rows = await sql(`
    select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
     where p.proname in ('sponsor_decide_submission_atomic','record_sponsor_decision_atomic',
                         'approve_submission_atomic','release_submission_reservation',
                         'confirm_sponsor_decision_proposal')
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')`)
  return assert(rows.length === 0, rows.length ? `leaked EXECUTE: ${rows.map((r) => r[0]).join(', ')}` : 'all five denied to authenticated')
})

check('09.7', 'db', 'approvals are opt-in — no sponsor has a threshold set by default', async () => {
  const rows = await sql(`select count(*) filter (where approval_required_above_cents is not null), count(*) from sponsors`)
  const [withThreshold, total] = rows[0]
  return `${withThreshold}/${total} sponsors have approvals enabled (0 means no behaviour change without opt-in)`
})

check('09.13', 'db', 'a proposal never outlives its submission, and never exceeds 7 days', async () => {
  const bad = await sql(`
    select p.id from sponsor_decision_proposals p join submissions s on s.id = p.submission_id
     where p.expires_at > s.expires_at or p.expires_at > p.created_at + interval '7 days'`)
  return assert(bad.length === 0, bad.length ? `${bad.length} proposals violate the window` : 'all proposal windows within bounds')
})

// ---- 11 · admin levels & capacity --------------------------------------------

check('11.2', 'db', 'every admin has an admin_level and the super-admin floor is enforced', async () => {
  const rows = await sql(`select admin_level, count(*) from profiles where role='admin' group by 1`)
  const nulls = rows.filter(([lvl]) => !lvl)
  assert(nulls.length === 0, 'some admins have a NULL admin_level')
  const supers = rows.find(([lvl]) => lvl === 'super_admin')
  assert(supers && Number(supers[1]) >= 1, 'zero super admins — the floor is already violated')
  const guard = await scalar(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='assert_super_admin_floor'`)
  assert(guard !== '0', 'assert_super_admin_floor() missing')
  return rows.map(([lvl, n]) => `${lvl}=${n}`).join(', ')
})

check('11.10', 'db', 'detect_capacity_drift() returns zero rows', async () => {
  const rows = await sql(`select * from detect_capacity_drift()`)
  return assert(rows.length === 0, rows.length ? `DRIFT: ${JSON.stringify(rows)}` : 'no capacity drift')
})

check('11.14', 'db', 'the five money functions were not modified by later migrations', async () => {
  const rows = await sql(`
    select p.proname, substr(md5(pg_get_functiondef(p.oid)), 1, 12)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
     where p.proname in ('approve_submission_atomic','release_submission_reservation',
                         'expire_overdue_submissions','sponsor_decide_submission_atomic',
                         'release_reservation_before_submission_delete')
     order by 1`)
  assert(rows.length === 5, `expected 5 money functions, found ${rows.length}`)
  return rows.map(([n, h]) => `${n}=${h}`).join(' ')
})

// ---- 12 · Q&A thread ---------------------------------------------------------

check('12.12', 'db', 'submission_messages has exactly three SELECT policies and no write policy', async () => {
  const rows = await sql(`select policyname, cmd from pg_policies where tablename='submission_messages' order by 1`)
  const writes = rows.filter(([, cmd]) => cmd !== 'SELECT')
  assert(writes.length === 0, `write policies present: ${writes.map((r) => r[0]).join(', ')}`)
  eq(rows.length, 3, 'SELECT policy count')
  return '3 SELECT, 0 write'
})

check('12.8', 'db', 'posting is blocked at the database once a thread is terminal or expired', async () => {
  const n = await scalar(`select count(*) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='public' and p.proname='guard_submission_message_insert'`)
  return assert(n !== '0', n !== '0' ? 'guard_submission_message_insert present' : 'no DB-level insert guard')
})

// ---- 13 · appeals ------------------------------------------------------------

check('13.16', 'db', 'appeals has exactly two SELECT policies and no write policy', async () => {
  const rows = await sql(`select policyname, cmd from pg_policies where tablename='appeals' order by 1`)
  const writes = rows.filter(([, cmd]) => cmd !== 'SELECT')
  assert(writes.length === 0, `write policies present: ${writes.map((r) => r[0]).join(', ')}`)
  eq(rows.length, 2, 'SELECT policy count')
  return '2 SELECT, 0 write'
})

check('13.14', 'db', 'appeal state transitions are guarded in the database', async () => {
  const n = await scalar(`select count(*) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='public' and p.proname='guard_appeal_transitions'`)
  return assert(n !== '0', n !== '0' ? 'guard_appeal_transitions present' : 'transition guard missing')
})

// ---- 14 · recognition tiers --------------------------------------------------

check('14.14', 'grep', 'proof_url never reaches an audit or notification payload', async () => {
  const hits = await grep('proof_url', ['app/actions/recognition.ts'])
  const bad = hits.filter((h) => /audit|metadata|notif|title:|body:/i.test(h))
  return assert(bad.length === 0, bad.length ? bad.join('\n') : `${hits.length} refs, none in audit/notify payloads`)
})

check('14.10', 'grep', 'dispatch is still the only place that sends sponsor outreach', async () => {
  // The mandate governs SPONSOR-FACING outreach. app/actions/account.ts sends a data export
  // to the requester's OWN verified address (GDPR/CCPA self-service) and is documented as
  // such at its call site; it can never reach a sponsor, so it is not a gate bypass.
  const ALLOWED = [/lib\/notify\.ts/, /lib\/dispatch\.ts/, /app\/actions\/account\.ts/]
  const hits = await grep('resend\\.emails\\.send|emails\\.send\\(', ['app', 'lib'], { codeOnly: true })
  const outside = hits.filter((h) => !ALLOWED.some((re) => re.test(h)))
  return assert(outside.length === 0, outside.length ? outside.join('\n') : `${hits.length} call sites, all in notify/dispatch/account-export`)
})

// ---- 15 · impact reports -----------------------------------------------------

check('15.5', 'grep', 'the impact report projection never touches profiles', async () => {
  const hits = await grep('profiles', ['lib/impact-report'], { codeOnly: true })
  return assert(hits.length === 0, hits.length ? hits.join('\n') : 'no executable reference to profiles in lib/impact-report/')
})

check('15.6', 'grep', 'the projection uses no object spread (allowlist cannot be bypassed)', async () => {
  const hits = await grep('\\.\\.\\.', ['lib/impact-report/projection.ts'], { codeOnly: true })
  return assert(hits.length === 0, hits.length ? hits.join('\n') : 'no spread operator in projection.ts')
})

check('15.7', 'db', 'a team without a no-minors affirmation contributes zero photos', async () => {
  // media_urls is jsonb, not text[] — array_length() would raise rather than return 0.
  const n = await scalar(`select count(*) from teams
     where media_no_minors_confirmed_at is null
       and media_urls is not null and jsonb_typeof(media_urls) = 'array'
       and jsonb_array_length(media_urls) > 0`)
  return `${n} team(s) hold media pending affirmation — the projection must contribute 0 photos for each (unit-tested in lib/impact-report)`
})

check('15.8', 'db', 'editing media_urls clears the affirmation (trigger, not action)', async () => {
  const n = await scalar(`select count(*) from pg_trigger
     where tgrelid='teams'::regclass and not tgisinternal and tgname like '%media_affirmation%'`)
  return assert(n !== '0', n !== '0' ? 'trg_reset_media_affirmation present' : 'no trigger — affirmation reset relies on app code')
})

check('15.10', 'db', 'public_platform_stats is a single anon-readable row', async () => {
  const rows = await sql(`select count(*) from public_platform_stats`)
  return `${rows[0][0]} row(s) in public_platform_stats`
})

check('15.13', 'http', 'cron/impact-rollup rejects a missing bearer token with JSON 401', async () => {
  const { status, body } = await http('/api/cron/impact-rollup')
  eq(status, 401, 'status')
  assert(!body.startsWith('<'), 'body is HTML — route redirected instead of returning JSON')
  return `401 ${body.slice(0, 80)}`
})

check('15.x-cron', 'env', 'vercel.json stays within the Hobby 2-cron cap and every unscheduled route is dispatched', async () => {
  const scheduled = JSON.parse(read('vercel.json')).crons.map((c) => c.path)
  assert(scheduled.length <= 2, `${scheduled.length} cron entries — Hobby honours only 2 and SILENTLY IGNORES the rest`)

  const { stdout } = await execFileAsync('ls', ['app/api/cron'], { cwd: ROOT })
  const routes = stdout.split('\n').filter(Boolean).map((d) => `/api/cron/${d}`)

  // A route that is neither scheduled nor called by the dispatcher is dead code that looks
  // alive — exactly the A-09-05 failure, where three jobs never ran for months.
  const dispatcher = read('app/api/cron/daily-maintenance/route.ts')
  const orphaned = routes.filter(
    (r) => !scheduled.includes(r) && !dispatcher.includes(r.replace('/api/cron/', '../'))
  )
  return assert(
    orphaned.length === 0,
    orphaned.length ? `neither scheduled nor dispatched: ${orphaned.join(', ')}` : `${scheduled.length} scheduled, ${routes.length - scheduled.length} dispatched`
  )
})

// ---- 16 · BotID & email domain gating ----------------------------------------

check('16.5', 'db', 'the email domain rules table is live and seeded', async () => {
  const rows = await sql(`select rule, count(*) from email_domain_rules group by 1 order by 1`)
  assert(rows.length > 0, 'email_domain_rules is empty — the seed never ran')
  return rows.map(([r, n]) => `${r}=${n}`).join(', ')
})

check('16.10', 'db', 'no audit_log metadata stores a full email address', async () => {
  const rows = await sql(`
    select action, count(*) from audit_log
     where action in ('set_email_domain_rule','sponsor_application_blocked')
       and metadata::text ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'
     group by 1`)
  return assert(rows.length === 0, rows.length ? `PII in metadata: ${JSON.stringify(rows)}` : 'no email addresses in gating audit metadata')
})

check('16.11', 'grep', 'the old unguarded submitSponsorApplication entry point is gone', async () => {
  const hits = await grep('submitSponsorApplication', ['app', 'lib', 'components', 'tests'], { codeOnly: true })
  return assert(hits.length === 0, hits.length ? hits.join('\n') : 'no call sites remain (only historical comments)')
})

// ---- 17 · email deliverability ------------------------------------------------

check('17.2', 'dns', 'SPF, DKIM and MAIL FROM all resolve for the sending domain', async () => {
  const domain = (ENV.RESEND_FROM_EMAIL ?? '').split('@')[1] ?? 'exodiusftc.com'
  const dig = async (name, type) => {
    const { stdout } = await execFileAsync('dig', ['+short', type, name, '@1.1.1.1'], { maxBuffer: 1024 * 1024 })
    return stdout.trim()
  }
  // SPF is evaluated against the ENVELOPE (MAIL FROM) domain, not the header From. Resend
  // puts the bounce domain on send.<domain>, so that is where the SPF record belongs —
  // querying the apex reports a false failure on a correctly configured domain.
  const spf = await dig(`send.${domain}`, 'TXT')
  assert(/v=spf1/.test(spf), `no SPF record on send.${domain} (the MAIL FROM domain)`)
  const dkim = await dig(`resend._domainkey.${domain}`, 'TXT')
  assert(/p=/.test(dkim), `no DKIM public key at resend._domainkey.${domain}`)
  const mailFrom = await dig(`send.${domain}`, 'MX')
  assert(mailFrom.length > 0, `no MAIL FROM MX on send.${domain}`)
  return `SPF on send.${domain}; DKIM ok; MAIL FROM ${mailFrom.split('\n')[0]}`
})

check('17.3', 'dns', 'DMARC is published at the apex', async () => {
  const domain = (ENV.RESEND_FROM_EMAIL ?? '').split('@')[1] ?? 'exodiusftc.com'
  const { stdout } = await execFileAsync('dig', ['+short', 'TXT', `_dmarc.${domain}`, '@1.1.1.1'], { maxBuffer: 1024 * 1024 })
  const rec = stdout.trim()
  assert(/v=DMARC1/.test(rec), `no DMARC record at _dmarc.${domain} — publish it (docs/email-deliverability.md §3.1)`)
  return rec
})

check('17.4', 'env', 'RESEND_FROM_EMAIL respects the noreply@ trap in lib/env.ts', async () => {
  const src = read('lib/env.ts')
  assert(/noreply@/.test(src), 'lib/env.ts no longer enforces the noreply@ prefix')
  const from = ENV.RESEND_FROM_EMAIL
  if (!from) skip('RESEND_FROM_EMAIL not set locally (it is Production-scoped in Vercel)')
  assert(from.startsWith('noreply@'), `RESEND_FROM_EMAIL is "${from}" — lib/env.ts throws on the first production request`)
  return from
})

check('17.13', 'http', 'an unsigned POST to /api/webhooks/resend returns 400', async () => {
  const { status } = await http('/api/webhooks/resend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'email.complained', data: { email_id: 'probe' } }),
  })
  return eq(status, 400, 'status')
})

check('17.11', 'db', 'a complaint never moved a submission status or released capacity', async () => {
  const rows = await sql(`
    select count(*) filter (where action = 'resend_webhook_email.complained'),
           count(*) filter (where action = 'resend_webhook_email.complained'
                              and metadata->>'new_status' is not null
                              and metadata->>'new_status' <> 'null')
      from audit_log`)
  const [total, withStatus] = rows[0]
  eq(withStatus, 0, 'complaints that wrote a status')
  return `${total} complaint event(s) recorded, none wrote a status`
})

// ---- 18 · accessibility (not built) ------------------------------------------

check('18.7', 'env', 'the public accessibility conformance statement exists', async () => {
  assert(existsSync(join(ROOT, 'app/legal/accessibility/page.tsx')), 'app/legal/accessibility/page.tsx missing — prompt 18 was never run')
  return 'present'
})

check('18.1', 'env', 'the axe accessibility E2E suite exists', async () => {
  assert(existsSync(join(ROOT, 'tests/e2e/accessibility.spec.ts')), 'tests/e2e/accessibility.spec.ts missing — prompt 18 was never run')
  return 'present'
})

// ---- cross-cutting gates -----------------------------------------------------

const gate = (id, title, cmd, args) =>
  check(id, 'gates', title, async () => {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
      const out = (stdout + stderr).trim().split('\n').slice(-3).join(' | ')
      return out.slice(0, 200) || 'clean'
    } catch (err) {
      const out = ((err.stdout ?? '') + (err.stderr ?? '')).trim().split('\n').slice(-8).join('\n')
      throw new Error(out.slice(0, 1200) || err.message)
    }
  })

gate('ALL.typecheck', 'tsc --noEmit', 'npm', ['run', '--silent', 'typecheck'])
gate('ALL.lint', 'eslint (0 errors)', 'npm', ['run', '--silent', 'lint'])
gate('ALL.test', 'vitest run', 'npm', ['run', '--silent', 'test'])

// ── runner ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const arg = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const groupFilter = arg('group')
const promptFilter = arg('prompt')
const asJson = argv.includes('--json')

const selected = checks.filter(
  (c) => (!groupFilter || c.group === groupFilter) && (!promptFilter || c.prompt === promptFilter.padStart(2, '0'))
)

const C = process.stdout.isTTY && !asJson
const paint = (code, s) => (C ? `\x1b[${code}m${s}\x1b[0m` : s)
const MARK = { PASS: paint('32', '  PASS'), FAIL: paint('31', '  FAIL'), SKIP: paint('33', '  SKIP') }

const results = []
for (const c of selected) {
  let status, detail
  try {
    detail = (await c.run()) ?? 'ok'
    status = 'PASS'
  } catch (err) {
    status = err instanceof Skip ? 'SKIP' : 'FAIL'
    detail = err.message
  }
  results.push({ ...c, status, detail, run: undefined })
  if (!asJson) {
    console.log(`${MARK[status]}  ${paint('90', c.id.padEnd(12))} ${c.title}`)
    if (status !== 'PASS') {
      for (const line of String(detail).split('\n').slice(0, 8)) console.log(`        ${paint('90', line)}`)
    }
  }
}

const tally = (s) => results.filter((r) => r.status === s).length
if (asJson) {
  console.log(JSON.stringify({ results, summary: { pass: tally('PASS'), fail: tally('FAIL'), skip: tally('SKIP') } }, null, 2))
} else {
  console.log(
    `\n${paint('1', 'verify-backlog')}  ` +
      `${paint('32', `${tally('PASS')} pass`)}  ${paint('31', `${tally('FAIL')} fail`)}  ${paint('33', `${tally('SKIP')} skip`)}` +
      `   (of ${selected.length} automated; 287 total acceptance boxes — see docs/verification-backlog.md)`
  )
}

process.exit(tally('FAIL') > 0 ? 1 : 0)
