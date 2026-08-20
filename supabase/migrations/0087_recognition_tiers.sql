-- 0087_recognition_tiers.sql
--
-- Sponsor recognition tiers and benefit fulfillment.
--
-- A corporation funding a team receives, today, nothing concrete: neither the pitch email
-- nor the token viewer names a single deliverable. This migration adds the recognition
-- ladder (admin-editable, thresholds in cents), pins what was promised at the moment a
-- sponsorship settles, and materialises one delivery row per promised benefit so that
-- editing a tier can never rewrite a promise already made.
--
-- Design notes worth reading before changing anything here:
--
--  * PINNING IS BY SNAPSHOT, NOT TIER VERSIONING. sponsor_recognition_awards carries
--    tier_name_snapshot / tier_rank_snapshot / tier_min_amount_cents_snapshot /
--    benefits_snapshot, and one recognition_benefit_deliveries row per benefit. tier_id is
--    a breadcrumb for admin reporting only — NOTHING reads through it to decide what was
--    promised.
--
--  * THRESHOLD MATH LIVES IN EXACTLY ONE FUNCTION: recognition_tier_for_amount(bigint).
--    Not in a second SQL function, not in TypeScript, not in a component.
--
--  * AWARD CREATION IS A TRIGGER on funding_fulfillments, not a rewrite of the two settle
--    RPCs. The fulfillment INSERT *is* the settle event and runs in the settle transaction;
--    reproducing ~235 lines of capacity-critical RPC a third time is risk with no upside.
--    trg_release_reservation_on_delete (0067) is the same idiom.
--
--  * SPONSOR SCOPING GOES THROUGH current_sponsor_ids() (0082), NOT profiles.sponsor_id.
--    A sponsor user can belong to several sponsor orgs through sponsor_members; the
--    single-column comparison silently returns nothing for them. This mirrors
--    fulfillments_select_sponsor exactly.
--
--  * $$-quoted blocks: apply with `psql -f`, never the Supabase CLI splitter.
--
-- Idempotent: safe to run twice.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────
-- All values declared at type creation so a from-scratch replay works.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recognition_benefit_type') THEN
    CREATE TYPE recognition_benefit_type AS ENUM (
      'logo_on_robot',
      'logo_on_team_shirt',
      'logo_on_website',
      'social_media_mention',
      'event_signage',
      'mention_in_outreach_materials'
    );
  END IF;
  -- 'waived' means the SPONSOR said "don't bother". 'not_applicable' means an ADMIN
  -- determined the benefit cannot exist for this team (an incubator team with no robot).
  -- Neither is a failure.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recognition_delivery_status') THEN
    CREATE TYPE recognition_delivery_status AS ENUM (
      'promised', 'in_progress', 'delivered', 'waived', 'not_applicable'
    );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. recognition_tiers — the project's first admin-editable configuration table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recognition_tiers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  -- Display order, low = entry tier. Unique among LIVE tiers only, so an archived tier
  -- does not permanently burn a rank number.
  rank              int  NOT NULL CHECK (rank >= 0),
  -- Thresholds in CENTS, matching every other money column in the schema.
  min_amount_cents  bigint NOT NULL CHECK (min_amount_cents >= 0),
  -- NULL = open-ended top tier. Exclusive upper bound.
  max_amount_cents  bigint CHECK (max_amount_cents IS NULL OR max_amount_cents > min_amount_cents),
  benefits          recognition_benefit_type[] NOT NULL DEFAULT '{}'::recognition_benefit_type[],
  description       text CHECK (description IS NULL OR char_length(description) <= 500),
  -- Soft delete. Archiving stops a tier being awarded; it NEVER touches awards already
  -- pinned against it — that is the whole point of the snapshot.
  archived_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_recognition_tier_rank_live
  ON recognition_tiers(rank) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recognition_tier_min_live
  ON recognition_tiers(min_amount_cents) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recognition_tiers_live
  ON recognition_tiers(min_amount_cents DESC) WHERE archived_at IS NULL;

-- No EXCLUDE constraint on the ranges: it needs btree_gist, and overlap is already
-- rejected by admin_upsert_recognition_tier, the only writer. recognition_tier_for_amount
-- is total-order safe even if a gap or overlap somehow exists.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. sponsor_recognition_awards — the pinned promise
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsor_recognition_awards (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One award per settled commitment. UNIQUE is what makes the trigger and the backfill
  -- idempotent. CASCADE: an award without its fulfillment is meaningless.
  fulfillment_id        uuid NOT NULL UNIQUE REFERENCES funding_fulfillments(id) ON DELETE CASCADE,
  -- Denormalised from the fulfillment so every policy on this table is a single sublink.
  -- Mirrors the fulfillment's nullability: sponsor RESTRICT, team SET NULL so a Clerk
  -- account deletion (which runs no app code) is never blocked by this table.
  sponsor_id            uuid NOT NULL REFERENCES sponsors(id) ON DELETE RESTRICT,
  team_id               uuid          REFERENCES teams(id)    ON DELETE SET NULL,
  -- The amount the tier was derived from. Copied at settle, never recomputed.
  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),

  -- ── THE SNAPSHOT ──────────────────────────────────────────────────────────
  -- tier_id is a breadcrumb for admin reporting ONLY. Nothing reads through it to decide
  -- what was promised; every displayed or enforced value comes from the *_snapshot
  -- columns and from recognition_benefit_deliveries.
  tier_id               uuid REFERENCES recognition_tiers(id) ON DELETE SET NULL,
  tier_name_snapshot    text   NOT NULL,
  tier_rank_snapshot    int    NOT NULL,
  tier_min_amount_cents_snapshot bigint NOT NULL,
  -- Redundant with the delivery rows BY DESIGN: a delivery row can be marked
  -- not_applicable, so only this array still answers "what did we originally promise".
  benefits_snapshot     recognition_benefit_type[] NOT NULL,
  -- ──────────────────────────────────────────────────────────────────────────

  awarded_at            timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recognition_awards_sponsor ON sponsor_recognition_awards(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_recognition_awards_team    ON sponsor_recognition_awards(team_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. recognition_benefit_deliveries — the checklist
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recognition_benefit_deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id          uuid NOT NULL REFERENCES sponsor_recognition_awards(id) ON DELETE CASCADE,
  benefit_type      recognition_benefit_type NOT NULL,
  status            recognition_delivery_status NOT NULL DEFAULT 'promised',
  -- Public pitch-media URL. COPPA: this is a photo of a ROBOT, a SHIRT, SIGNAGE or a
  -- WEBSITE. Never a photo of a student, never a face.
  proof_url         text CHECK (proof_url IS NULL OR char_length(proof_url) <= 1000),
  proof_uploaded_at timestamptz,
  -- Stamped when the coach ticks the no-minors affirmation.
  no_minors_confirmed_at timestamptz,
  delivered_at      timestamptz,
  coach_note        text CHECK (coach_note IS NULL OR char_length(coach_note) <= 1000),
  -- The COPPA takedown lever.
  admin_voided_at   timestamptz,
  admin_void_reason text CHECK (admin_void_reason IS NULL OR char_length(admin_void_reason) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uniq_delivery_per_benefit UNIQUE (award_id, benefit_type),
  -- Fails CLOSED at the storage layer of the database, not merely in the action that
  -- happens to write it today: a proof cannot exist without the affirmation.
  CONSTRAINT proof_requires_no_minors_affirmation
    CHECK (proof_url IS NULL OR no_minors_confirmed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_benefit_deliveries_award ON recognition_benefit_deliveries(award_id);
-- The coach's "what do I still owe" and the sponsor's "what am I still owed" read exactly
-- this predicate.
CREATE INDEX IF NOT EXISTS idx_benefit_deliveries_open
  ON recognition_benefit_deliveries(award_id, status)
  WHERE status IN ('promised', 'in_progress');

-- There is no shared set_updated_at/handle_updated_at helper in this schema (verified),
-- so updated_at is stamped inside each RPC rather than by an invented trigger — the same
-- instruction funding_fulfillments follows.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Threshold math — THE ONLY PLACE A THRESHOLD IS COMPARED TO AN AMOUNT
-- ─────────────────────────────────────────────────────────────────────────────
-- The tier is derived from funding_fulfillments.amount_cents, which is copied 1:1 from
-- transactions_ledger.amount_cents inside the settle transaction and never rewritten by
-- record_fulfillment_transition — the two candidate values are the same integer. Reading
-- the fulfillment means the trigger already has the row in NEW: no join, no chance of
-- picking up a second ledger row, no dependency on transactions_ledger's RLS.
--
-- Tier is pinned at SETTLE, not at payment_received: the coach must know what to deliver
-- the day the sponsorship is agreed, and a partial commitment already produces its own
-- smaller ledger row, its own fulfillment, and therefore its own (lower) tier.
--
-- ORDER BY min_amount_cents DESC LIMIT 1 is what makes this total: with a mis-entered
-- overlap the highest qualifying tier wins deterministically rather than erroring or
-- returning two rows. An amount below the lowest tier returns NULL, which means NO AWARD
-- ROW IS CREATED AT ALL — a $100 pledge earns no recognition and the product says nothing
-- rather than inventing a tier.
CREATE OR REPLACE FUNCTION recognition_tier_for_amount(p_amount_cents bigint)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id
    FROM recognition_tiers t
   WHERE t.archived_at IS NULL
     AND p_amount_cents >= t.min_amount_cents
     AND (t.max_amount_cents IS NULL OR p_amount_cents < t.max_amount_cents)
   ORDER BY t.min_amount_cents DESC
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION recognition_tier_for_amount(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION recognition_tier_for_amount(bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION recognition_tier_for_amount(bigint) FROM authenticated;
GRANT  EXECUTE ON FUNCTION recognition_tier_for_amount(bigint) TO service_role;

-- The pitch-time preview. Exposed as one function so no component ever builds the ladder
-- from a raw table read — that is how threshold logic escapes into the UI.
CREATE OR REPLACE FUNCTION recognition_tier_ladder()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY rnk), '[]'::jsonb)
    FROM (
      SELECT t.rank AS rnk,
             jsonb_build_object(
               'id', t.id, 'name', t.name, 'rank', t.rank,
               'min_amount_cents', t.min_amount_cents,
               'max_amount_cents', t.max_amount_cents,
               'benefits', to_jsonb(t.benefits),
               'description', t.description
             ) AS x
        FROM recognition_tiers t
       WHERE t.archived_at IS NULL
    ) s;
$$;

REVOKE EXECUTE ON FUNCTION recognition_tier_ladder() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION recognition_tier_ladder() FROM anon;
REVOKE EXECUTE ON FUNCTION recognition_tier_ladder() FROM authenticated;
GRANT  EXECUTE ON FUNCTION recognition_tier_ladder() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Policy helper
-- ─────────────────────────────────────────────────────────────────────────────
-- An inline sublink from the deliveries policy back into sponsor_recognition_awards makes
-- the planner evaluate THAT table's policies, which themselves sublink into profiles and
-- teams — the exact nesting that produced 42P17 in 0066. Wrap it, as can_read_fulfillment
-- does.
--
-- DO NOT REVOKE EXECUTE ON THIS ONE. Like is_admin(), current_profile_id() and
-- can_read_fulfillment(), it is evaluated inside an RLS policy AS THE CALLING ROLE;
-- revoking from authenticated makes every read raise 42501 (0062's comment).
CREATE OR REPLACE FUNCTION can_read_recognition_award(p_award_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM sponsor_recognition_awards a
     WHERE a.id = p_award_id
       AND (
         is_admin()
         OR a.sponsor_id = ANY (current_sponsor_ids())
         OR (a.team_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM teams t WHERE t.id = a.team_id AND t.owner_id = current_profile_id()))
       )
  );
$$;

-- current_sponsor_ids() (0082) was never granted to `anon`. That was invisible while only
-- authenticated-only tables used it, but recognition_awards_select_sponsor is evaluated
-- for every role that touches the table, and a policy calling a function the caller cannot
-- execute RAISES 42501 instead of filtering — so an anonymous read of
-- sponsor_recognition_awards errored rather than returning []. This is 0062's lesson
-- again: a helper evaluated inside an RLS policy runs as the CALLING role and must be
-- executable by every role the policy is evaluated for. Granting is safe: the function is
-- SECURITY DEFINER and resolves through current_profile_id(), which is NULL for anon, so
-- anon gets '{}' and matches nothing. This also fixes the same latent trap on
-- fulfillments_select_sponsor and ledger_select_sponsor.
GRANT EXECUTE ON FUNCTION current_sponsor_ids() TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Award creation — factored so the trigger and the backfill can never drift
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_recognition_award_for_fulfillment(p_fulfillment_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_f       funding_fulfillments%ROWTYPE;
  v_tier    recognition_tiers%ROWTYPE;
  v_award_id uuid;
  v_benefit recognition_benefit_type;
BEGIN
  SELECT * INTO v_f FROM funding_fulfillments WHERE id = p_fulfillment_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_tier FROM recognition_tiers
   WHERE id = recognition_tier_for_amount(v_f.amount_cents);

  -- Below the entry tier, or no live tiers configured: no recognition, no row, no noise.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO sponsor_recognition_awards (
    fulfillment_id, sponsor_id, team_id, amount_cents,
    tier_id, tier_name_snapshot, tier_rank_snapshot,
    tier_min_amount_cents_snapshot, benefits_snapshot
  ) VALUES (
    v_f.id, v_f.sponsor_id, v_f.team_id, v_f.amount_cents,
    v_tier.id, v_tier.name, v_tier.rank, v_tier.min_amount_cents, v_tier.benefits
  )
  ON CONFLICT (fulfillment_id) DO NOTHING
  RETURNING id INTO v_award_id;

  IF v_award_id IS NULL THEN          -- already awarded; nothing to materialise
    RETURN NULL;
  END IF;

  -- Materialise the promise. THIS is the pinning: once these rows exist, editing the
  -- tier cannot reach them.
  FOREACH v_benefit IN ARRAY v_tier.benefits LOOP
    INSERT INTO recognition_benefit_deliveries (award_id, benefit_type)
    VALUES (v_award_id, v_benefit)
    ON CONFLICT (award_id, benefit_type) DO NOTHING;
  END LOOP;

  RETURN v_award_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_recognition_award_for_fulfillment(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_recognition_award_for_fulfillment(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION create_recognition_award_for_fulfillment(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION create_recognition_award_for_fulfillment(uuid) TO service_role;

-- Notifying the coach is deliberately NOT done here: a trigger must not perform side
-- effects the settle transaction can roll back. syncRecognitionForFulfillment (a server
-- action) sends that message.
CREATE OR REPLACE FUNCTION trg_create_recognition_award()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM create_recognition_award_for_fulfillment(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION trg_create_recognition_award() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_create_recognition_award() FROM anon;
REVOKE EXECUTE ON FUNCTION trg_create_recognition_award() FROM authenticated;
GRANT  EXECUTE ON FUNCTION trg_create_recognition_award() TO service_role;

DROP TRIGGER IF EXISTS create_recognition_award ON funding_fulfillments;
CREATE TRIGGER create_recognition_award
  AFTER INSERT ON funding_fulfillments
  FOR EACH ROW EXECUTE FUNCTION trg_create_recognition_award();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. record_benefit_delivery
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_benefit_delivery(
  p_delivery_id         uuid,
  p_actor_profile_id    uuid,
  p_status              recognition_delivery_status,
  p_proof_url           text    DEFAULT NULL,
  p_no_minors_confirmed boolean DEFAULT false,
  p_note                text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor       uuid;
  v_actor_role  text;
  v_d           recognition_benefit_deliveries%ROWTYPE;
  v_award       sponsor_recognition_awards%ROWTYPE;
  v_from        recognition_delivery_status;
  v_delivered_at timestamptz;
BEGIN
  -- Actor resolution, three-branch form. 0065's bare ELSE is the pre-0072 shape and
  -- admits the anon key; do not copy it.
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor := current_profile_id();
    IF v_actor IS NULL OR v_actor <> p_actor_profile_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor := p_actor_profile_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_d FROM recognition_benefit_deliveries
   WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'delivery_not_found');
  END IF;

  SELECT * INTO v_award FROM sponsor_recognition_awards WHERE id = v_d.award_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'delivery_not_found');
  END IF;

  -- Role derivation is done against p_actor_profile_id rather than the JWT helpers,
  -- because this function also runs in the trusted server context where there is no JWT
  -- at all. Sponsor membership covers BOTH sponsor_members (0082) and the legacy
  -- profiles.sponsor_id column, matching current_sponsor_ids().
  IF EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_actor AND p.role = 'admin') THEN
    v_actor_role := 'admin';
  ELSIF EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = v_actor AND p.role = 'sponsor'
       AND (p.sponsor_id = v_award.sponsor_id
            OR EXISTS (SELECT 1 FROM sponsor_members m
                        WHERE m.profile_id = p.id AND m.sponsor_id = v_award.sponsor_id))
  ) THEN
    v_actor_role := 'sponsor';
  ELSIF v_award.team_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM teams t WHERE t.id = v_award.team_id AND t.owner_id = v_actor
  ) THEN
    v_actor_role := 'coach';
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- Who may set what:
  --                  coach   sponsor   admin
  --   in_progress      Y        N        Y
  --   delivered        Y        N        Y
  --   promised         Y        N        Y
  --   waived           N        Y        Y
  --   not_applicable   N        N        Y
  -- A sponsor cannot mark their own benefit delivered — that is the team's claim to make.
  -- A coach cannot waive a benefit they owe.
  IF p_status IN ('promised', 'in_progress', 'delivered') AND v_actor_role = 'sponsor' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'role_not_permitted');
  END IF;
  IF p_status = 'waived' AND v_actor_role = 'coach' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'role_not_permitted');
  END IF;
  IF p_status = 'not_applicable' AND v_actor_role <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'role_not_permitted');
  END IF;

  v_from := v_d.status;

  -- Terminal-ish guard: a waived row is the sponsor's decision and only an admin may
  -- move it again.
  IF v_from = 'waived' AND v_actor_role <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_waived');
  END IF;

  -- A soft error the action treats as success, same convention as
  -- record_fulfillment_transition. Note this fires only when no proof is being attached,
  -- so re-uploading a photo for an already-delivered benefit still works.
  IF v_from = p_status AND p_proof_url IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_in_status');
  END IF;

  IF p_proof_url IS NOT NULL THEN
    IF NOT p_no_minors_confirmed THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_minors_affirmation_required');
    END IF;
    -- The real gate is the storage RLS policy; this stops a wrong-bucket or off-host
    -- string being stored.
    IF p_proof_url !~ '^https://[a-z0-9.-]+\.supabase\.co/storage/v1/object/public/pitch-media/' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_proof_url');
    END IF;
  END IF;

  v_delivered_at := CASE
    WHEN p_status = 'delivered' THEN COALESCE(v_d.delivered_at, now())
    WHEN p_status IN ('promised', 'in_progress') THEN NULL
    ELSE v_d.delivered_at
  END;

  UPDATE recognition_benefit_deliveries SET
    status            = p_status,
    delivered_at      = v_delivered_at,
    proof_url         = COALESCE(p_proof_url, proof_url),
    proof_uploaded_at = CASE WHEN p_proof_url IS NOT NULL THEN now() ELSE proof_uploaded_at END,
    no_minors_confirmed_at = CASE WHEN p_proof_url IS NOT NULL THEN now() ELSE no_minors_confirmed_at END,
    admin_voided_at   = CASE WHEN p_proof_url IS NOT NULL THEN NULL ELSE admin_voided_at END,
    admin_void_reason = CASE WHEN p_proof_url IS NOT NULL THEN NULL ELSE admin_void_reason END,
    coach_note        = COALESCE(p_note, coach_note),
    updated_at        = now()
  WHERE id = p_delivery_id;

  -- has_proof is a BOOLEAN on purpose: the proof URL is a public, permanent link to a
  -- photograph and audit_log has no expiry.
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor, 'benefit_delivery_recorded', 'recognition_benefit_deliveries', p_delivery_id,
    jsonb_build_object(
      'award_id', v_d.award_id,
      'benefit_type', v_d.benefit_type,
      'from_status', v_from,
      'to_status', p_status,
      'actor_role', v_actor_role,
      'has_proof', (p_proof_url IS NOT NULL)
    )
  );

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'from_status', v_from);
END;
$$;

REVOKE EXECUTE ON FUNCTION record_benefit_delivery(uuid, uuid, recognition_delivery_status, text, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_benefit_delivery(uuid, uuid, recognition_delivery_status, text, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION record_benefit_delivery(uuid, uuid, recognition_delivery_status, text, boolean, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION record_benefit_delivery(uuid, uuid, recognition_delivery_status, text, boolean, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. void_benefit_proof — the COPPA takedown lever
-- ─────────────────────────────────────────────────────────────────────────────
-- It deliberately does NOT delete the storage object: pitch-media has no DELETE policy,
-- and the service role deleting from a bucket with no delete policy is a separate change.
-- Removing it from the product is what matters here; the void reason tells an admin to
-- purge it out of band if it is genuinely a COPPA violation rather than a bad crop.
CREATE OR REPLACE FUNCTION void_benefit_proof(
  p_delivery_id      uuid,
  p_actor_profile_id uuid,
  p_reason           text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_d     recognition_benefit_deliveries%ROWTYPE;
BEGIN
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor := current_profile_id();
    IF v_actor IS NULL OR v_actor <> p_actor_profile_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor := p_actor_profile_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_actor AND p.role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
  END IF;

  SELECT * INTO v_d FROM recognition_benefit_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'delivery_not_found');
  END IF;

  UPDATE recognition_benefit_deliveries SET
    proof_url              = NULL,
    proof_uploaded_at      = NULL,
    no_minors_confirmed_at = NULL,
    status                 = 'in_progress',
    delivered_at           = NULL,
    admin_voided_at        = now(),
    admin_void_reason      = btrim(p_reason),
    updated_at             = now()
  WHERE id = p_delivery_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor, 'void_benefit_proof', 'recognition_benefit_deliveries', p_delivery_id,
    jsonb_build_object(
      'award_id', v_d.award_id,
      'benefit_type', v_d.benefit_type,
      'from_status', v_d.status,
      'reason', btrim(p_reason)
    )
  );

  RETURN jsonb_build_object('ok', true, 'award_id', v_d.award_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION void_benefit_proof(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION void_benefit_proof(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION void_benefit_proof(uuid, uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION void_benefit_proof(uuid, uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Tier administration
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_upsert_recognition_tier(
  p_actor_profile_id uuid,
  p_tier_id          uuid,      -- NULL = create
  p_name             text,
  p_rank             int,
  p_min_amount_cents bigint,
  p_max_amount_cents bigint,
  p_benefits         recognition_benefit_type[],
  p_description      text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor    uuid;
  v_before   jsonb := 'null'::jsonb;
  v_conflict text;
  v_id       uuid;
BEGIN
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor := current_profile_id();
    IF v_actor IS NULL OR v_actor <> p_actor_profile_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor := p_actor_profile_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_actor AND p.role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- Two concurrent admin saves must not both pass the overlap check.
  LOCK TABLE recognition_tiers IN SHARE ROW EXCLUSIVE MODE;

  IF p_max_amount_cents IS NOT NULL AND p_max_amount_cents <= p_min_amount_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_range');
  END IF;

  -- [min, max) must not overlap any other live tier.
  SELECT t.name INTO v_conflict
    FROM recognition_tiers t
   WHERE t.archived_at IS NULL
     AND (p_tier_id IS NULL OR t.id <> p_tier_id)
     AND p_min_amount_cents < COALESCE(t.max_amount_cents, 9223372036854775807)
     AND COALESCE(p_max_amount_cents, 9223372036854775807) > t.min_amount_cents
   LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'overlapping_tier', 'conflict', v_conflict);
  END IF;

  IF p_max_amount_cents IS NULL AND EXISTS (
    SELECT 1 FROM recognition_tiers t
     WHERE t.archived_at IS NULL AND t.max_amount_cents IS NULL
       AND (p_tier_id IS NULL OR t.id <> p_tier_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'multiple_open_tiers');
  END IF;

  IF p_tier_id IS NOT NULL THEN
    SELECT to_jsonb(t) INTO v_before FROM recognition_tiers t WHERE t.id = p_tier_id;
    IF v_before IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tier_not_found');
    END IF;

    UPDATE recognition_tiers SET
      name = p_name, rank = p_rank,
      min_amount_cents = p_min_amount_cents, max_amount_cents = p_max_amount_cents,
      benefits = p_benefits, description = p_description,
      updated_at = now()
    WHERE id = p_tier_id;
    v_id := p_tier_id;
  ELSE
    INSERT INTO recognition_tiers (name, rank, min_amount_cents, max_amount_cents, benefits, description)
    VALUES (p_name, p_rank, p_min_amount_cents, p_max_amount_cents, p_benefits, p_description)
    RETURNING id INTO v_id;
  END IF;

  -- Configuration, not personal data: a full before/after snapshot is the right thing to
  -- keep.
  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor, 'recognition_tier_upserted', 'recognition_tiers', v_id,
    jsonb_build_object(
      'before', v_before,
      'after', (SELECT to_jsonb(t) FROM recognition_tiers t WHERE t.id = v_id)
    )
  );

  -- awards_affected is structurally 0: there is no UPDATE statement against
  -- sponsor_recognition_awards or recognition_benefit_deliveries anywhere in this
  -- function. Editing a tier is incapable of touching a promise already made.
  RETURN jsonb_build_object('ok', true, 'tier_id', v_id, 'awards_affected', 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_upsert_recognition_tier(uuid, uuid, text, int, bigint, bigint, recognition_benefit_type[], text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_upsert_recognition_tier(uuid, uuid, text, int, bigint, bigint, recognition_benefit_type[], text) FROM anon;
REVOKE EXECUTE ON FUNCTION admin_upsert_recognition_tier(uuid, uuid, text, int, bigint, bigint, recognition_benefit_type[], text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION admin_upsert_recognition_tier(uuid, uuid, text, int, bigint, bigint, recognition_benefit_type[], text) TO service_role;

CREATE OR REPLACE FUNCTION admin_archive_recognition_tier(
  p_actor_profile_id uuid,
  p_tier_id          uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_live  int;
BEGIN
  IF (auth.jwt() ->> 'sub') IS NOT NULL THEN
    v_actor := current_profile_id();
    IF v_actor IS NULL OR v_actor <> p_actor_profile_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
    END IF;
  ELSIF is_trusted_server_context() THEN
    v_actor := p_actor_profile_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_actor AND p.role = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  LOCK TABLE recognition_tiers IN SHARE ROW EXCLUSIVE MODE;

  IF NOT EXISTS (SELECT 1 FROM recognition_tiers WHERE id = p_tier_id AND archived_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tier_not_found');
  END IF;

  SELECT count(*) INTO v_live FROM recognition_tiers WHERE archived_at IS NULL;
  IF v_live <= 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'last_live_tier');
  END IF;

  UPDATE recognition_tiers SET archived_at = now(), updated_at = now() WHERE id = p_tier_id;

  INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor, 'recognition_tier_archived', 'recognition_tiers', p_tier_id,
    jsonb_build_object('tier', (SELECT to_jsonb(t) FROM recognition_tiers t WHERE t.id = p_tier_id))
  );

  RETURN jsonb_build_object('ok', true, 'tier_id', p_tier_id, 'awards_affected', 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_archive_recognition_tier(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_archive_recognition_tier(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION admin_archive_recognition_tier(uuid, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION admin_archive_recognition_tier(uuid, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. RLS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE recognition_tiers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_recognition_awards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE recognition_benefit_deliveries  ENABLE ROW LEVEL SECURITY;

-- recognition_tiers is public-facing product copy, not private data: the ladder appears on
-- a token-gated page rendered for a signed-out sponsor, and the thresholds are advertised
-- in the pitch email anyway. Archived tiers stay hidden.
DROP POLICY IF EXISTS recognition_tiers_select_all   ON recognition_tiers;
CREATE POLICY recognition_tiers_select_all ON recognition_tiers
  FOR SELECT TO anon, authenticated USING (archived_at IS NULL);

DROP POLICY IF EXISTS recognition_tiers_select_admin ON recognition_tiers;
CREATE POLICY recognition_tiers_select_admin ON recognition_tiers
  FOR SELECT USING (is_admin());

-- No INSERT / UPDATE / DELETE policies anywhere in this migration. Writes go through the
-- SECURITY DEFINER RPCs on the service role — the same stance funding_fulfillments,
-- transactions_ledger and audit_log already take.

DROP POLICY IF EXISTS recognition_awards_select_admin   ON sponsor_recognition_awards;
CREATE POLICY recognition_awards_select_admin ON sponsor_recognition_awards
  FOR SELECT USING (is_admin());

-- current_sponsor_ids() (0082), NOT profiles.sponsor_id: a sponsor user can belong to
-- several sponsor orgs. Byte-for-byte the shape of fulfillments_select_sponsor.
DROP POLICY IF EXISTS recognition_awards_select_sponsor ON sponsor_recognition_awards;
CREATE POLICY recognition_awards_select_sponsor ON sponsor_recognition_awards
  FOR SELECT USING (sponsor_id = ANY (current_sponsor_ids()));

DROP POLICY IF EXISTS recognition_awards_select_coach   ON sponsor_recognition_awards;
CREATE POLICY recognition_awards_select_coach ON sponsor_recognition_awards
  FOR SELECT USING (
    team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM teams t
       WHERE t.id = sponsor_recognition_awards.team_id AND t.owner_id = current_profile_id()
    )
  );

DROP POLICY IF EXISTS benefit_deliveries_select ON recognition_benefit_deliveries;
CREATE POLICY benefit_deliveries_select ON recognition_benefit_deliveries
  FOR SELECT USING (can_read_recognition_award(award_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Seed — defaults an admin is expected to EDIT, not a specification
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO recognition_tiers (name, rank, min_amount_cents, max_amount_cents, benefits, description)
SELECT 'Supporter', 0, 25000, 100000,
       ARRAY['logo_on_website']::recognition_benefit_type[],
       'Entry-level recognition on the team website.'
 WHERE NOT EXISTS (SELECT 1 FROM recognition_tiers WHERE name = 'Supporter');

INSERT INTO recognition_tiers (name, rank, min_amount_cents, max_amount_cents, benefits, description)
SELECT 'Bronze', 1, 100000, 250000,
       ARRAY['logo_on_website', 'social_media_mention']::recognition_benefit_type[],
       'Website placement plus a social media thank-you post.'
 WHERE NOT EXISTS (SELECT 1 FROM recognition_tiers WHERE name = 'Bronze');

INSERT INTO recognition_tiers (name, rank, min_amount_cents, max_amount_cents, benefits, description)
SELECT 'Silver', 2, 250000, 750000,
       ARRAY['logo_on_website', 'social_media_mention', 'logo_on_team_shirt',
             'mention_in_outreach_materials']::recognition_benefit_type[],
       'Team apparel placement and inclusion in outreach materials.'
 WHERE NOT EXISTS (SELECT 1 FROM recognition_tiers WHERE name = 'Silver');

INSERT INTO recognition_tiers (name, rank, min_amount_cents, max_amount_cents, benefits, description)
SELECT 'Gold', 3, 750000, NULL,
       ARRAY['logo_on_website', 'social_media_mention', 'logo_on_team_shirt',
             'mention_in_outreach_materials', 'logo_on_robot',
             'event_signage']::recognition_benefit_type[],
       'Full recognition including placement on the competition robot and event signage.'
 WHERE NOT EXISTS (SELECT 1 FROM recognition_tiers WHERE name = 'Gold');

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Backfill
-- ─────────────────────────────────────────────────────────────────────────────
-- Fulfillments that settled before this migration get the tier they would earn under the
-- ladder AS IT EXISTS RIGHT NOW. That is the only defensible choice: the tiers did not
-- exist at settle time, so there is nothing historical to honour. Idempotent via
-- ON CONFLICT (fulfillment_id) DO NOTHING inside the shared helper.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT f.id FROM funding_fulfillments f
     WHERE NOT EXISTS (SELECT 1 FROM sponsor_recognition_awards a WHERE a.fulfillment_id = f.id)
       AND f.status <> 'cancelled'
  LOOP
    PERFORM create_recognition_award_for_fulfillment(r.id);
  END LOOP;
END $$;
