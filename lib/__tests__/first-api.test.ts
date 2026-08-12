import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  env: { FIRST_API_USERNAME: 'first-user', FIRST_API_TOKEN: 'first-token' } as {
    FIRST_API_USERNAME?: string
    FIRST_API_TOKEN?: string
  },
}))

vi.mock('@/lib/env', () => ({ env: mocks.env }))

import { fetchTeamFromFirstApi, currentFtcSeason } from '../first-api'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('currentFtcSeason', () => {
  it('the last day of the 2025-26 season (April) is still season 2025', () => {
    expect(currentFtcSeason(new Date('2026-04-30T12:00:00Z'))).toBe(2025)
  })

  it('the first day of May rolls over to the next season', () => {
    expect(currentFtcSeason(new Date('2026-05-01T12:00:00Z'))).toBe(2026)
  })
})

describe('fetchTeamFromFirstApi', () => {
  beforeEach(() => {
    mocks.env.FIRST_API_USERNAME = 'first-user'
    mocks.env.FIRST_API_TOKEN = 'first-token'
    vi.unstubAllGlobals()
  })

  it('missing credentials -> unavailable, fetch is never called', async () => {
    mocks.env.FIRST_API_USERNAME = undefined
    mocks.env.FIRST_API_TOKEN = undefined
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTeamFromFirstApi(12345)

    expect(result.status).toBe('unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Authorization header is exactly "Basic " + base64("user:token")', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ teams: [{ teamNumber: 12345, nameShort: 'Gearheads' }] })
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchTeamFromFirstApi(12345)

    const expected = 'Basic ' + Buffer.from('first-user:first-token').toString('base64')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe(expected)
  })

  it.each([401, 429, 500])('HTTP %i -> unavailable, never a throw', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, status))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTeamFromFirstApi(12345)
    expect(result.status).toBe('unavailable')
  })

  it('{ teams: [] } -> not_found, and retries currentFtcSeason() - 1 exactly once', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ teams: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTeamFromFirstApi(12345)

    expect(result.status).toBe('not_found')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const season = currentFtcSeason()
    expect(fetchMock.mock.calls[0][0]).toContain(`/${season}/teams`)
    expect(fetchMock.mock.calls[1][0]).toContain(`/${season - 1}/teams`)
  })

  it('a team found only in the prior season is returned as found, not not_found', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ teams: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ teams: [{ teamNumber: 12345, nameShort: 'Gearheads' }] })
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchTeamFromFirstApi(12345)
    expect(result.status).toBe('found')
    if (result.status === 'found') {
      expect(result.team.teamNumber).toBe(12345)
    }
  })

  it('timeout (fetch rejects with AbortError) -> unavailable, never a throw', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValue(abortError)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTeamFromFirstApi(12345)).resolves.toEqual(
      expect.objectContaining({ status: 'unavailable' })
    )
  })
})
