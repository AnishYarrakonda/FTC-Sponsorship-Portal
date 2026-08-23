#!/usr/bin/env node
/**
 * verify-capacity-invariant.mjs — the real proof behind prompt 11(b).
 *
 * The capacity invariant (0047 header, 0065 verification block, 0084's detector):
 *
 *   sponsors.funding_used_cents
 *     = SUM(submissions.reserved_amount_cents WHERE status IN ('dispatched','delivered','opened'))
 *     + SUM(transactions_ledger.amount_cents)
 *
 * Nothing in the repo asserted it before this script. Each scenario below seeds a sponsor
 * with a known cap, drives one real state change through the SAME RPCs production uses,
 * and then asserts BOTH that `detect_capacity_drift()` returns zero rows for that sponsor
 * AND that funding_used_cents equals the expected figure. An expectation that only checked
 * the detector would pass against a detector that agrees with the bug.
 *
 * Every scenario runs inside BEGIN … ROLLBACK, so a run leaves the database exactly as it
 * found it and a failure cannot poison the next scenario.
 *
 * SAFETY: refuses to run unless SUPABASE_LOCAL is set — mirrors tests/global-setup.ts.
 * Point DATABASE_URL at a LOCAL or SCRATCH database, never production.
 *
 *   SUPABASE_LOCAL=1 DATABASE_URL=postgresql://… npm run verify:capacity
 *
 * Driven through `psql` on purpose: it is already the documented way this project applies
 * migrations, so this adds no dependency. It also means the RPCs are called as the
 * database owner, which is what satisfies the service_role-only EXECUTE grants on
 * detect_capacity_drift() and friends.
 */

import { execFileSync } from 'node:child_process'

if (!process.env.SUPABASE_LOCAL) {
  console.error(
    'Refusing to run: set SUPABASE_LOCAL=1 to confirm DATABASE_URL points at a local or\n' +
      'scratch database. These scenarios insert profiles, sponsors, teams and submissions.'
  )
  process.exit(1)
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required.')
  process.exit(1)
}

// ── Shared SQL ────────────────────────────────────────────────────────────────────────

// pgcrypto's digest() lives in `extensions` (0059); the RPCs set their own search_path,
// but the scenario bodies below call digest() directly.
const PREAMBLE = `\\set ON_ERROR_STOP on
SET search_path TO public, extensions;
BEGIN;`

const EPILOGUE = `ROLLBACK;`

/**
 * Declarations + seed shared by every scenario. Produces:
 *   v_admin, v_coach, v_sponsor_user, v_sponsor, v_team, v_sub
 * with cap = $10,000.00 and ask = $2,500.00, and a sponsor starting at funding_used = 0.
 *
 * teams.status is 'incubator' so the existing_team_requires_number CHECK (0001) does not
 * force an FTC number, and slug is randomised because it is UNIQUE NOT NULL (0046).
 */
const SEED = `
DECLARE
  v_admin        uuid;
  v_coach        uuid;
  v_sponsor_user uuid;
  v_sponsor      uuid;
  v_team         uuid;
  v_sub          uuid;
  v_cap          bigint := 1000000;
  v_ask          bigint := 250000;
  v_used         bigint;
  v_drift        bigint;
  v_status       text;
  v_reserved     bigint;
  v_ledger       int;
  v_result       jsonb;
  v_jresult      json;
  v_token        text;
  v_token_hash   text;
  v_used_at      timestamptz;
  v_audit        int;
  v_suffix       text := replace(gen_random_uuid()::text, '-', '');
BEGIN
  INSERT INTO profiles (clerk_user_id, role, full_name, email)
  VALUES ('user_vci_admin_' || v_suffix, 'admin', 'Capacity Verify Admin', 'vci-admin-' || v_suffix || '@example.test')
  RETURNING id INTO v_admin;

  INSERT INTO sponsors (company_name, contact_name, contact_email, funding_cap_cents, funding_used_cents, status, source)
  VALUES ('Capacity Verify Corp', 'Contact', 'vci-sponsor-' || v_suffix || '@example.test', v_cap, 0, 'active', 'admin_added')
  RETURNING id INTO v_sponsor;

  INSERT INTO profiles (clerk_user_id, role, full_name, email, sponsor_id)
  VALUES ('user_vci_sponsor_' || v_suffix, 'sponsor', 'Capacity Verify Sponsor', 'vci-su-' || v_suffix || '@example.test', v_sponsor)
  RETURNING id INTO v_sponsor_user;

  INSERT INTO profiles (clerk_user_id, role, full_name, email, coach_verified)
  VALUES ('user_vci_coach_' || v_suffix, 'coach', 'Capacity Verify Coach', 'vci-coach-' || v_suffix || '@example.test', true)
  RETURNING id INTO v_coach;

  INSERT INTO teams (owner_id, status, team_name, slug, city, state, financial_ask_cents)
  VALUES (v_coach, 'incubator', 'Capacity Verify Team', 'vci-team-' || v_suffix, 'Plano', 'TX', v_ask)
  RETURNING id INTO v_team;

  INSERT INTO submissions (team_id, sponsor_id, status)
  VALUES (v_team, v_sponsor, 'pending')
  RETURNING id INTO v_sub;
`

/** RESERVE via the real approval RPC, capturing the minted access token. */
const APPROVE = `
  v_result := approve_submission_atomic(v_sub, v_admin, v_ask);
  IF (v_result ->> 'ok') <> 'true' THEN
    RAISE EXCEPTION 'setup failed: approve_submission_atomic returned %', v_result;
  END IF;
  v_token := v_result ->> 'token';
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

  SELECT funding_used_cents INTO v_used FROM sponsors WHERE id = v_sponsor;
  IF v_used <> v_ask THEN
    RAISE EXCEPTION 'setup failed: expected funding_used_cents = % after reserve, got %', v_ask, v_used;
  END IF;
`

/**
 * The two-part assertion every scenario ends with: the detector is silent AND the number
 * is right. `expected` is a SQL expression evaluated in the block.
 */
function assertUsed(expected, label) {
  return `
  SELECT funding_used_cents INTO v_used FROM sponsors WHERE id = v_sponsor;
  IF v_used <> (${expected}) THEN
    RAISE EXCEPTION '${label}: expected funding_used_cents = %, observed %', (${expected}), v_used;
  END IF;

  SELECT d.drift_cents INTO v_drift FROM detect_capacity_drift() d WHERE d.sponsor_id = v_sponsor;
  IF FOUND THEN
    RAISE EXCEPTION '${label}: detect_capacity_drift() reported drift of % cents (funding_used_cents = %)', v_drift, v_used;
  END IF;
`
}

// ── Scenarios ─────────────────────────────────────────────────────────────────────────

const SCENARIOS = [
  {
    /**
     * A-11-06 — the NEGATIVE CONTROL, and it runs first on purpose.
     *
     * Every other scenario ends in `assertUsed`, half of which is "detect_capacity_drift()
     * stayed silent". Silence only means something if the detector can speak. A detector
     * that returned zero rows unconditionally — because a predicate inverted, because a
     * join dropped, because someone revoked its EXECUTE grant and the error was swallowed
     * — would let all seven scenarios pass while reporting a clean database that was not.
     *
     * The finding filed this as "the script asserts what it computed", which is not quite
     * right: `assertUsed` does compare funding_used_cents against an independently stated
     * figure. But the detector half genuinely was unfalsifiable, and that half is what the
     * admin capacity page and the post-deploy check both rely on.
     *
     * So: reserve a known amount, corrupt the cached counter by a known delta, and require
     * the detector to report THAT sponsor with THAT drift. Then put it back and require
     * silence again — proving the detector tracks the data rather than always firing.
     */
    name: '0. Negative control — a deliberately corrupted counter IS caught by the detector',
    body: `${APPROVE}
  -- Corrupt the cache: funding_used_cents no longer matches the open reservation.
  UPDATE sponsors SET funding_used_cents = funding_used_cents + 33300 WHERE id = v_sponsor;

  SELECT d.drift_cents INTO v_drift FROM detect_capacity_drift() d WHERE d.sponsor_id = v_sponsor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'negative control: detect_capacity_drift() did NOT report a sponsor whose funding_used_cents was inflated by 33300 -- the detector is broken, and every "zero drift" result in this script is meaningless';
  END IF;
  IF v_drift <> 33300 THEN
    RAISE EXCEPTION 'negative control: expected drift of 33300 cents, detector reported %', v_drift;
  END IF;

  -- Put it back; the detector must fall silent again. A detector that always fires is as
  -- useless as one that never does.
  UPDATE sponsors SET funding_used_cents = funding_used_cents - 33300 WHERE id = v_sponsor;
${assertUsed('v_ask', 'negative control (restored)')}`,
  },
  {
    name: '1. Decline — sponsor declines in the portal, reservation returns to the cap',
    body: `${APPROVE}
  v_result := sponsor_decide_submission_atomic(v_sub, v_sponsor_user, 'declined', 'not this season', 0);
  IF (v_result ->> 'ok') <> 'true' THEN
    RAISE EXCEPTION 'sponsor_decide_submission_atomic(declined) returned %', v_result;
  END IF;

  SELECT status, reserved_amount_cents INTO v_status, v_reserved FROM submissions WHERE id = v_sub;
  IF v_status <> 'declined' OR v_reserved <> 0 THEN
    RAISE EXCEPTION 'decline: expected status declined / reserved 0, got % / %', v_status, v_reserved;
  END IF;
${assertUsed('0', 'decline')}`,
  },
  {
    name: '2. Partial fund — settles at P < A, releases the difference, writes one ledger row',
    body: `${APPROVE}
  v_result := sponsor_decide_submission_atomic(v_sub, v_sponsor_user, 'approved', NULL, 100000);
  IF (v_result ->> 'ok') <> 'true' THEN
    RAISE EXCEPTION 'sponsor_decide_submission_atomic(partial) returned %', v_result;
  END IF;

  SELECT count(*) INTO v_ledger FROM transactions_ledger
   WHERE submission_id = v_sub AND decision_type = 'partial' AND amount_cents = 100000;
  IF v_ledger <> 1 THEN
    RAISE EXCEPTION 'partial: expected exactly 1 partial ledger row of 100000, found %', v_ledger;
  END IF;
${assertUsed('100000', 'partial fund')}`,
  },
  {
    name: '3. Expiry — the nightly batch releases an overdue reservation',
    body: `${APPROVE}
  -- Backdate past the 14-day window the approval RPC stamped.
  UPDATE submissions SET expires_at = now() - interval '1 day' WHERE id = v_sub;

  v_result := expire_overdue_submissions();
  IF (v_result ->> 'ok') <> 'true' THEN
    RAISE EXCEPTION 'expire_overdue_submissions returned %', v_result;
  END IF;

  SELECT status, reserved_amount_cents INTO v_status, v_reserved FROM submissions WHERE id = v_sub;
  IF v_status <> 'expired' OR v_reserved <> 0 THEN
    RAISE EXCEPTION 'expiry: expected status expired / reserved 0, got % / %', v_status, v_reserved;
  END IF;
${assertUsed('0', 'expiry')}`,
  },
  {
    name: '4. Bounce — a Resend hard bounce releases the reservation',
    body: `${APPROVE}
  v_result := release_submission_reservation(v_sub, 'bounced', 'resend_bounce');
  IF (v_result ->> 'ok') <> 'true' THEN
    RAISE EXCEPTION 'release_submission_reservation(bounced) returned %', v_result;
  END IF;
${assertUsed('0', 'bounce')}`,
  },
  {
    name: '5. Coach-account-deletion cascade — trg_release_reservation_on_delete catches it',
    body: `${APPROVE}
  -- The Clerk webhook deletes the profile; submissions vanish by CASCADE with NO app code
  -- running. Only the BEFORE DELETE trigger (0067) can give the money back.
  DELETE FROM profiles WHERE id = v_coach;

  IF EXISTS (SELECT 1 FROM submissions WHERE id = v_sub) THEN
    RAISE EXCEPTION 'cascade: the submission survived the coach deletion';
  END IF;

  SELECT count(*) INTO v_audit FROM audit_log
   WHERE action = 'release_reservation_on_delete' AND entity_id = v_sub;
  IF v_audit <> 1 THEN
    RAISE EXCEPTION 'cascade: expected 1 release_reservation_on_delete audit row, found %', v_audit;
  END IF;
${assertUsed('0', 'account-deletion cascade')}`,
  },
  {
    name: '6. Double settle — token path after a portal settle is refused (0071 status guard / 0084 ledger guard)',
    body: `${APPROVE}
  v_result := sponsor_decide_submission_atomic(v_sub, v_sponsor_user, 'approved', NULL, 0);
  IF (v_result ->> 'ok') <> 'true' THEN
    RAISE EXCEPTION 'portal settle returned %', v_result;
  END IF;

  -- The emailed link is still live at the DATABASE level: the portal RPC never touches
  -- submission_access_tokens. (The application layer now revokes them in
  -- runDecisionFollowUp for B-03-11, but this scenario calls the RPCs directly, which is
  -- the point — it tests the database's own defences with the token still valid.)
  --
  -- CORRECTED EXPECTATION. This asserted already_decided, copied from the worked example
  -- in 0084's header comment (line ~446). That expectation was never reachable: migration
  -- 0071 -- 0071_token_decision_check_status_first.sql, which says so in its filename --
  -- had already moved the status guard ahead of everything else. A portal settle leaves
  -- the submission at approved, so the status guard refuses first and invalid_status
  -- is the correct, by-design answer; 0084's ledger guard is the second line of defence
  -- behind it, for a race where two calls interleave while the status is still dispatched.
  --
  -- What this scenario actually exists to protect is unchanged and is asserted below: a
  -- second settlement cannot happen, no second ledger row appears, the token is not burned
  -- by the rejected call, and the money is right. Pinning WHICH guard fires made the test
  -- fail on correct behaviour, so it now accepts either refusal and checks the outcomes.
  v_jresult := record_sponsor_decision_atomic(v_token_hash, 'full', 0);
  IF (v_jresult ->> 'ok') <> 'false'
     OR (v_jresult ->> 'error') NOT IN ('invalid_status', 'already_decided') THEN
    RAISE EXCEPTION 'token path after a portal settle: expected a refusal (invalid_status or already_decided), got %', v_jresult;
  END IF;

  SELECT count(*) INTO v_ledger FROM transactions_ledger WHERE submission_id = v_sub;
  IF v_ledger <> 1 THEN
    RAISE EXCEPTION 'double settle: expected exactly 1 ledger row, found %', v_ledger;
  END IF;

  -- The guard sits BEFORE the claim, so the sponsor keeps a usable link (0071's whole point).
  SELECT used_at INTO v_used_at FROM submission_access_tokens WHERE token_hash = v_token_hash;
  IF v_used_at IS NOT NULL THEN
    RAISE EXCEPTION 'double settle: the access token was consumed by the rejected call (used_at = %)', v_used_at;
  END IF;
${assertUsed('v_ask', 'double settle')}`,
  },
  {
    /**
     * B-03-12. The coach-initiated withdraw added in 0107 travels the same release path as
     * expiry and bounce, so it belongs in the same invariant suite: capacity is a Core
     * Mandate and this is a new way for money to move.
     */
    name: '7. Withdraw — a coach retracts a dispatched pitch and the reservation returns',
    body: `${APPROVE}
  v_result := release_submission_reservation(v_sub, 'withdrawn', 'withdrawn_by_coach');
  IF (v_result ->> 'ok') <> 'true' THEN
    RAISE EXCEPTION 'withdraw returned %', v_result;
  END IF;
  IF (v_result ->> 'released_cents')::bigint <> v_ask THEN
    RAISE EXCEPTION 'withdraw: expected % released, got %', v_ask, v_result ->> 'released_cents';
  END IF;

  SELECT status, reserved_amount_cents INTO v_status, v_reserved FROM submissions WHERE id = v_sub;
  IF v_status <> 'withdrawn' OR v_reserved <> 0 THEN
    RAISE EXCEPTION 'withdraw: expected status withdrawn / reserved 0, got % / %', v_status, v_reserved;
  END IF;

  -- No ledger row: a withdrawal is not a settlement, so nothing was ever funded.
  SELECT count(*) INTO v_ledger FROM transactions_ledger WHERE submission_id = v_sub;
  IF v_ledger <> 0 THEN
    RAISE EXCEPTION 'withdraw: expected 0 ledger rows, found %', v_ledger;
  END IF;
${assertUsed('0', 'withdraw')}`,
  },
  {
    name: '8. No double refund — releasing twice moves the money once',
    body: `${APPROVE}
  v_result := release_submission_reservation(v_sub, 'declined', 'first_release');
  IF (v_result ->> 'ok') <> 'true' THEN
    RAISE EXCEPTION 'first release returned %', v_result;
  END IF;

  v_result := release_submission_reservation(v_sub, 'declined', 'second_release');
  IF (v_result ->> 'ok') <> 'false' OR (v_result ->> 'error') <> 'not_releasable' THEN
    RAISE EXCEPTION 'second release: expected not_releasable, got %', v_result;
  END IF;
${assertUsed('0', 'double refund')}`,
  },
]

// ── Runner ────────────────────────────────────────────────────────────────────────────

function runScenario(scenario) {
  const sql = `${PREAMBLE}
DO $vci$
${SEED}
${scenario.body}
  RAISE NOTICE 'ok';
END
$vci$;
${EPILOGUE}
`
  execFileSync('psql', [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], {
    input: sql,
    stdio: ['pipe', 'inherit', 'pipe'],
    encoding: 'utf8',
  })
}

let failed = 0
console.log('Capacity invariant: funding_used_cents = open reservations + settled ledger\n')

for (const scenario of SCENARIOS) {
  try {
    runScenario(scenario)
    console.log(`  PASS  ${scenario.name}`)
  } catch (err) {
    failed += 1
    console.log(`  FAIL  ${scenario.name}`)
    const detail = (err.stderr ?? err.message ?? '').toString().trim()
    console.log(detail.replace(/^/gm, '        '))
  }
}

// A clean database must also be clean globally, not just for the sponsors we seeded.
try {
  const out = execFileSync(
    'psql',
    [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', 'SELECT count(*) FROM detect_capacity_drift();'],
    { encoding: 'utf8' }
  ).trim()
  if (out === '0') {
    console.log('\n  PASS  detect_capacity_drift() returns zero rows across the whole database')
  } else {
    failed += 1
    console.log(`\n  FAIL  detect_capacity_drift() reports ${out} drifting sponsor(s) — run /admin/capacity`)
  }
} catch (err) {
  failed += 1
  console.log(`\n  FAIL  could not run detect_capacity_drift(): ${(err.stderr ?? err.message).toString().trim()}`)
}

console.log(
  `\n${SCENARIOS.length + 1 - failed}/${SCENARIOS.length + 1} checks passed.` +
    (failed ? '\n\nThe invariant is BROKEN. Report the failing scenario with its observed vs\nexpected figures before changing any reserve/release/settle function.' : '')
)
process.exit(failed ? 1 : 0)
