import * as Sentry from '@sentry/nextjs'

interface DbErrorLike {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

/**
 * Maps a raw Postgres/Supabase error to a user-safe message and reports the full
 * error to Sentry. Server actions must never return `error.message` from the
 * database directly — it leaks schema details (table/column/constraint names).
 */
export function mapDbError(error: DbErrorLike | null | undefined, context: string): string {
  if (error) {
    const summary = `[db:${context}] ${error.code ?? ''} ${error.message ?? 'unknown'}`

    // console.error as well as Sentry, deliberately. Sentry has no DSN in ANY Vercel
    // environment today, and instrumentation.ts early-returns when it is unset, so
    // captureException is a no-op — which made all ~20 mapDbError call sites across
    // every action file produce no log line anywhere. Vercel runtime logs are the only
    // channel that actually works right now, and this one line is what makes every
    // other failure in this list investigable.
    console.error(summary, { code: error.code, details: error.details, hint: error.hint })

    Sentry.captureException(new Error(summary), {
      extra: { code: error.code, details: error.details, hint: error.hint, context },
    })
  }

  switch (error?.code) {
    case '23505': // unique_violation
      return 'This already exists — please refresh and try again.'
    case '23503': // foreign_key_violation
      return 'A related record could not be found. Please refresh and try again.'
    case '23514': // check_violation
      return 'One of the values is out of the allowed range.'
    case '22001': // string_data_right_truncation
      return 'One of the fields is too long.'
    case '42501': // insufficient_privilege (RLS)
      return 'You do not have permission to do that.'
    case 'PGRST116': // no rows returned when one expected
      return 'That record was not found. It may have been removed.'
    default:
      return 'Something went wrong on our end. Please try again — if it keeps happening, contact support.'
  }
}
