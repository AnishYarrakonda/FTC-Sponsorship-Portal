/**
 * `teams.slug` is `NOT NULL UNIQUE` with **no database default**
 * (`0046_team_slugs.sql:5,20`). Every insert into `teams` must supply it or the row
 * fails with `23502 not-null violation`.
 *
 * P0-14: three of the four insert sites omitted it, and `npm run typecheck` passed
 * anyway because each payload was cast with `as any` / `as never`. The failure mode was
 * a verified coach permanently parked on the "Setting up your workspace…" spinner. The
 * fix that shipped in `4ebe492` derived the slug inline at one site only, so this module
 * exists to make the rule impossible to forget at the next one.
 *
 * Derivation matches the 0046 backfill rule: lowercase, non-alphanumerics to hyphens,
 * trimmed, with the FTC team number appended when there is one.
 */

/** Base slug for a team. Never returns an empty string. */
export function deriveTeamSlug(teamName: string | null | undefined, ftcTeamNumber?: number | null): string {
  const base =
    (teamName ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'team'
  return ftcTeamNumber ? `${base}-${ftcTeamNumber}` : base
}

/**
 * Collision suffix for the retry after a `23505 unique_violation` on `teams.slug`.
 * Two teams can legitimately share a name (and incubator teams have no team number to
 * disambiguate them), so a collision is expected rather than exceptional.
 */
export function uniquifyTeamSlug(baseSlug: string): string {
  return `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`
}
