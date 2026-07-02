import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Sentry before importing the module under test so mapDbError's
// captureException call hits the mock, never the real SDK.
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { mapDbError } from '../errors'

const DEFAULT_MESSAGE =
  'Something went wrong on our end. Please try again — if it keeps happening, contact support.'

describe('mapDbError — code mapping', () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear()
  })

  it('maps 23505 (unique_violation) to a duplicate message', () => {
    expect(mapDbError({ code: '23505', message: 'duplicate key value' }, 'test')).toBe(
      'This already exists — please refresh and try again.'
    )
  })

  it('maps 23503 (foreign_key_violation) to a missing-relation message', () => {
    expect(mapDbError({ code: '23503', message: 'fk violation' }, 'test')).toBe(
      'A related record could not be found. Please refresh and try again.'
    )
  })

  it('maps 23514 (check_violation) to an out-of-range message', () => {
    expect(mapDbError({ code: '23514', message: 'check violation' }, 'test')).toBe(
      'One of the values is out of the allowed range.'
    )
  })

  it('maps 22001 (string_data_right_truncation) to a too-long message', () => {
    expect(mapDbError({ code: '22001', message: 'value too long' }, 'test')).toBe(
      'One of the fields is too long.'
    )
  })

  it('maps 42501 (insufficient_privilege / RLS) to a permission message', () => {
    expect(mapDbError({ code: '42501', message: 'permission denied' }, 'test')).toBe(
      'You do not have permission to do that.'
    )
  })

  it('maps PGRST116 (no rows) to a not-found message', () => {
    expect(mapDbError({ code: 'PGRST116', message: 'no rows returned' }, 'test')).toBe(
      'That record was not found. It may have been removed.'
    )
  })

  it('maps an unknown code to the generic default message', () => {
    expect(mapDbError({ code: '99999', message: 'weird' }, 'test')).toBe(DEFAULT_MESSAGE)
  })

  it('maps an error without a code to the generic default message', () => {
    expect(mapDbError({ message: 'boom' }, 'test')).toBe(DEFAULT_MESSAGE)
  })

  it('handles null and undefined errors with the default message', () => {
    expect(mapDbError(null, 'test')).toBe(DEFAULT_MESSAGE)
    expect(mapDbError(undefined, 'test')).toBe(DEFAULT_MESSAGE)
  })
})

describe('mapDbError — leak prevention', () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear()
  })

  it('never returns the raw database message', () => {
    const raw = 'duplicate key value violates unique constraint "submissions_team_sponsor_key"'
    const result = mapDbError({ code: '23505', message: raw }, 'submission.create')
    expect(result).not.toContain('submissions_team_sponsor_key')
    expect(result).not.toContain('constraint')
  })
})

describe('mapDbError — Sentry reporting', () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear()
  })

  it('reports the full error (code, context, extras) to Sentry', () => {
    mapDbError(
      { code: '23505', message: 'duplicate key', details: 'Key (id) exists', hint: 'try again' },
      'submission.create'
    )

    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    const [err, opts] = vi.mocked(Sentry.captureException).mock.calls[0]
    expect((err as Error).message).toContain('[db:submission.create]')
    expect((err as Error).message).toContain('23505')
    expect(opts).toMatchObject({
      extra: {
        code: '23505',
        details: 'Key (id) exists',
        hint: 'try again',
        context: 'submission.create',
      },
    })
  })

  it('does not report to Sentry when the error is null/undefined', () => {
    mapDbError(null, 'noop')
    mapDbError(undefined, 'noop')
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})
