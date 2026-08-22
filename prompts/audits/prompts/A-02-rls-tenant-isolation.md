# A-02 — RLS & tenant isolation

**Lane A (static — parallel-safe).** Audit id `A-02`.
**Outputs:** `prompts/audits/findings/A-02-findings.md` · `prompts/audits/handoff/A-02-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full first.
> This is the highest-stakes audit in the pack. A hole here is a P0 by definition.

---

## You own

Every row-level security policy in `supabase/migrations/*.sql`, and the question that matters:
**can any actor read or write a row that belongs to someone else?**

The 33 tables: `profiles teams submissions sponsors notifications audit_log
transactions_ledger submission_access_tokens sponsor_members sponsor_applications
sponsor_decision_proposals funding_fulfillments funding_fulfillment_events funding_receipts
funding_receipt_counters funding_capacity_releases team_payout_profiles team_verification_records
team_achievements agreement_templates agreement_signatures appeals submission_messages
recognition_tiers recognition_benefit_deliveries sponsor_recognition_awards
impact_report_snapshots email_domain_rules ftc_teams_cache pitches pitch_sponsor_targets
public_platform_stats request_throttle`.

## Investigate

1. **Build the matrix.** For every table: is RLS enabled, is it forced, and what is the
   complete set of policies by command (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) and role. Then
   fill a grid of **table × actor** for the actors: anonymous, authenticated non-coach,
   unverified coach, verified coach (owner), verified coach (**a different team's**), sponsor
   member (viewer/approver/admin, own org), sponsor member (**a different org**), platform
   admin, super admin, `service_role`. Mark each cell allowed/denied and cite the policy.
   **A table with RLS enabled and zero policies is a silent deny — confirm that is intended.**
2. **Hunt the classic holes.**
   - `auth.uid()` anywhere — it is always NULL under Clerk. `grep -rn "auth.uid()" supabase/`.
   - A policy testing `auth.jwt()->>'sub' IS NULL` by hand instead of calling
     `is_trusted_server_context()` — the anon key also has no `sub`, so that test **fails open**.
     This exact pattern is called out in `prompts/revamp/_CONTEXT.md`; find every instance.
   - `USING (true)`, `WITH CHECK (true)`, or a `USING` clause with no matching `WITH CHECK` on
     an `UPDATE` policy — the latter lets a row be updated *out of* the caller's scope.
   - Policies that reference a column an attacker controls.
   - `SECURITY DEFINER` functions without `SET search_path`.
3. **Multi-org isolation is the core of this audit.** Read `current_sponsor_ids()`,
   `sponsor_ids_for_profile()`, `is_sponsor_org_member()`, `has_sponsor_permission()`,
   `current_sponsor_member_role()`, `sponsor_member_role_rank()`, `sponsor_owns_submission()`,
   `sponsor_can_view_team()`, `can_read_fulfillment()`, `can_read_recognition_award()`.
   Note that migration `0082` moved sponsor identity from `profiles.sponsor_id` to a
   multi-org model. **Find every policy, function, or query still keying off the old single
   `profiles.sponsor_id` column** — that drift is exactly how a tenant-isolation bug appears.
   Then prove, per table, that Sponsor A cannot reach Sponsor B's submissions, decisions,
   fulfillments, receipts, agreements, awards, members, or impact snapshots.
4. **Coach isolation.** Prove a verified coach cannot read another team's submission-specific
   data, payout profile, EIN, appeals, or messages. Check `get_payout_ein()`/`set_payout_ein()`
   and the encryption boundary around the EIN specifically.
5. **COPPA.** Enumerate every column that could carry a minor's identity and prove no
   non-admin-reachable policy, view, API route, CSV export, or receipt/impact document exposes
   it. Include `/api/admin/export` and the impact-report snapshots.
6. **The unauthenticated surface.** `submission_access_tokens`, `/sponsor-view/*`,
   `/agreement-records/*`, `/receipts/*`, `public_platform_stats`, `ftc_teams_cache`. For each:
   what exactly does an anonymous holder of a URL get, how is the token scoped and expired, is
   it guessable, and does it leak anything about *other* rows. Read `remint_submission_access_token()`.
7. **Regression sweep on rewritten functions.** For every function above, diff its **latest**
   migration definition against all earlier definitions of the same name. Report any predicate
   that existed before and is gone now. This class of defect has hit this repo three times
   (`0093`, `0094`, `0096` — the last a tenant takeover).
8. **Replay safety.** Confirm each policy-bearing migration is idempotent and that a
   from-scratch replay produces the same policy set as production.

## If a local database is available

Do not start one and do not touch production. If a local Supabase is already running, verify
your paper findings with read-only `SELECT`s against `pg_policies` and `pg_proc`, and record
the actual output as evidence upgrading a finding from INFERRED to CONFIRMED.

## Done when

The full table × actor matrix is in the report, every hole is proven with the policy text that
allows it, and the sponsor-A-vs-sponsor-B question is answered table by table.
