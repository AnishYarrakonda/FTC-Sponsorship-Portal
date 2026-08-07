import { describe, it, expect } from 'vitest'
import { deriveTeamSlug, uniquifyTeamSlug } from '@/lib/team-slug'

/**
 * P0-14. `teams.slug` is NOT NULL UNIQUE with no DB default (0046:5,20), and three of the
 * four insert sites omitted it while casting the payload `as any` / `as never` — so
 * `npm run typecheck` passed and every affected coach was stranded on the
 * "Setting up your workspace…" spinner by a runtime 23502.
 *
 * The four call sites now share `deriveTeamSlug`. These tests pin the invariant the
 * database actually enforces: the function must ALWAYS return a usable non-empty slug,
 * whatever the coach typed as a team name.
 */
describe('deriveTeamSlug', () => {
  it('slugifies a normal team name with its FTC number', () => {
    expect(deriveTeamSlug('Exodius Robotics', 12345)).toBe('exodius-robotics-12345')
  })

  it('omits the number for an incubator team that has none', () => {
    expect(deriveTeamSlug('Exodius Robotics', null)).toBe('exodius-robotics')
    expect(deriveTeamSlug('Exodius Robotics')).toBe('exodius-robotics')
  })

  it('collapses punctuation and whitespace, and trims leading/trailing hyphens', () => {
    expect(deriveTeamSlug('  The Quantum   Foxes!! ', 99)).toBe('the-quantum-foxes-99')
    expect(deriveTeamSlug('---Iron Aviators---')).toBe('iron-aviators')
    expect(deriveTeamSlug('A.B.C. Robotics & Co.')).toBe('a-b-c-robotics-co')
  })

  it('NEVER returns an empty slug — the case that produced the 23502', () => {
    // A NOT NULL column will reject '' just as surely as null. Names that slugify to
    // nothing are entirely plausible: emoji-only, CJK, punctuation-only, blank.
    for (const name of ['', '   ', '!!!', '---', '🤖🤖', '机器人', null, undefined]) {
      const slug = deriveTeamSlug(name as string | null | undefined)
      expect(slug.length).toBeGreaterThan(0)
      expect(slug).toBe('team')
    }
  })

  it('still yields a usable slug when only the number is meaningful', () => {
    expect(deriveTeamSlug('🤖', 6832)).toBe('team-6832')
  })

  it('only ever emits characters that are safe in a URL path segment', () => {
    const slug = deriveTeamSlug('Ünïcôdé Tëam ✨ #42', 7)
    expect(slug).toMatch(/^[a-z0-9-]+$/)
    expect(encodeURIComponent(slug)).toBe(slug)
  })
})

describe('uniquifyTeamSlug', () => {
  it('extends the base slug so the 23505 retry can succeed', () => {
    const base = 'exodius-robotics'
    const uniq = uniquifyTeamSlug(base)
    expect(uniq.startsWith(`${base}-`)).toBe(true)
    expect(uniq.length).toBeGreaterThan(base.length + 1)
    expect(uniq).toMatch(/^[a-z0-9-]+$/)
  })

  it('produces a different value each time (two teams can share a name)', () => {
    const seen = new Set(Array.from({ length: 50 }, () => uniquifyTeamSlug('team')))
    expect(seen.size).toBeGreaterThan(45)
  })
})
