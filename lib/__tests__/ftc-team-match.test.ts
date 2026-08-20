import { describe, it, expect } from 'vitest'
import { normalizeTeamName, similarity, scoreTeamMatch } from '../ftc-team-match'

describe('normalizeTeamName', () => {
  it('strips a leading team-number prefix', () => {
    expect(normalizeTeamName('#12345 Gearheads')).toBe('gearheads')
  })

  it('strips diacritics', () => {
    expect(normalizeTeamName('Équipe Ångström')).toBe('equipe angstrom')
  })

  it('drops noise tokens (team, robotics, ftc, first, the, and, inc, llc, high, school, academy, club, program)', () => {
    expect(normalizeTeamName('The FTC Robotics Team And Program Inc')).toBe('')
    expect(normalizeTeamName('Gearheads Robotics Team')).toBe('gearheads')
    expect(normalizeTeamName('Lincoln High School Robotics Club')).toBe('lincoln')
  })
})

describe('similarity', () => {
  it('returns 1 for identical strings', () => {
    expect(similarity('gearheads', 'gearheads')).toBe(1)
  })

  it('returns 0 when either side is empty', () => {
    expect(similarity('', 'gearheads')).toBe(0)
    expect(similarity('gearheads', '')).toBe(0)
    expect(similarity('', '')).toBe(0)
  })
})

describe('scoreTeamMatch', () => {
  it('exact match after normalization -> nameScore === 1, auto_pass', () => {
    const result = scoreTeamMatch({
      claimedTeamName: '#12345 Gearheads',
      officialTeamName: 'Gearheads',
    })
    expect(result.nameScore).toBe(1)
    expect(result.outcome).toBe('auto_pass')
  })

  it('"The Gearheads" vs "Gearheads Robotics Team" -> auto_pass', () => {
    const result = scoreTeamMatch({
      claimedTeamName: 'The Gearheads',
      officialTeamName: 'Gearheads Robotics Team',
    })
    expect(result.outcome).toBe('auto_pass')
  })

  it('"Gearheads" vs "Iron Panthers" -> rejected', () => {
    const result = scoreTeamMatch({
      claimedTeamName: 'Gearheads',
      officialTeamName: 'Iron Panthers',
    })
    expect(result.outcome).toBe('rejected')
  })

  it('a near miss ("Gear Heads" vs "The Gearheads") with mismatched orgs lands in needs_review', () => {
    const result = scoreTeamMatch({
      claimedTeamName: 'Gear Heads',
      claimedOrganization: 'Lincoln High School',
      officialTeamName: 'The Gearheads',
      officialOrganization: 'Roosevelt Academy',
    })
    expect(result.outcome).toBe('needs_review')
  })

  it('officialTeamName: null -> confidence === 0, caller maps that to unavailable not rejected', () => {
    const result = scoreTeamMatch({
      claimedTeamName: 'Gearheads',
      officialTeamName: null,
    })
    expect(result.confidence).toBe(0)
    // scoreTeamMatch itself has no 'unavailable' outcome — verifyFTCTeamIdentity in
    // lib/ftc-roster.ts is responsible for mapping a null official record to
    // 'unavailable' before ever calling scoreTeamMatch with confidence 0 as 'rejected'.
    expect(result.outcome).toBe('rejected')
  })

  it('nameScore >= 0.95 short-circuits past a 0-scoring organization', () => {
    const result = scoreTeamMatch({
      claimedTeamName: 'Gearheads',
      claimedOrganization: 'Lincoln High School',
      officialTeamName: 'Gearheads',
      officialOrganization: 'Completely Unrelated Sponsor Co',
    })
    expect(result.nameScore).toBe(1)
    expect(result.organizationScore).toBeLessThan(0.5)
    expect(result.outcome).toBe('auto_pass')
  })
})
