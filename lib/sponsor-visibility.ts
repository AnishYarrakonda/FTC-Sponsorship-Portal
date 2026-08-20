/**
 * What a SPONSOR is allowed to read off a `submissions` row.
 *
 * Sponsor pages render their submission through Client Components, so every column the
 * server selects is serialized into the RSC payload and lands in the browser. A bare
 * `select('*')` therefore hands the sponsor four columns that belong to moderation, not to
 * them:
 *
 *   - `admin_feedback`   the admin's private decline/changes-requested note. It is written
 *                        about the COACH, survives re-approval (approve_submission_atomic
 *                        never clears it), and is shown to the coach as "Admin feedback".
 *                        A sponsor reading it sees an internal judgement of the team.
 *   - `reviewed_by`      the moderating admin's profile id — deanonymises the reviewer.
 *   - `reviewed_at`      the moderation timestamp, which pairs with the above.
 *   - `resend_message_id` the provider-side id of the outreach email; an internal handle.
 *
 * RLS cannot fix this: `submissions` is row-scoped, and Postgres row policies have no
 * column granularity, so the sponsor's own row legitimately passes the policy WITH the
 * admin's note attached. The boundary has to be drawn in the select, which makes it a
 * property of this constant rather than of any one page remembering to be careful.
 *
 * Adding a column to `submissions` does NOT expose it here — the list is an allowlist, so
 * a new column is invisible to sponsors until someone deliberately adds it.
 */
/**
 * The PostgREST select fragment for the columns above. Never `*`.
 *
 * Written as one `as const` string rather than joined from an array on purpose:
 * supabase-js parses the select at the TYPE level, so it must see a string literal.
 * `Array.join()` widens to `string`, and the parser then fails with `ParserError<...>` and
 * every column on the result becomes untyped. The array below is derived from this, not
 * the other way round.
 */
export const SPONSOR_SUBMISSION_SELECT =
  'id, team_id, sponsor_id, custom_pitch_alignment, specific_needs_statement, local_connection_notes, status, created_at, updated_at, expires_at, variant_label, submitted_at, sent_at, season, requested_amount_cents, reserved_amount_cents, is_locked' as const

export const SPONSOR_VISIBLE_SUBMISSION_COLUMNS = SPONSOR_SUBMISSION_SELECT.split(', ')

/** Columns that must never appear in a sponsor-facing select. Asserted by tests. */
export const SPONSOR_FORBIDDEN_SUBMISSION_COLUMNS = [
  'admin_feedback',
  'reviewed_by',
  'reviewed_at',
  'resend_message_id',
] as const
