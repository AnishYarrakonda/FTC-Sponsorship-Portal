import * as Sentry from '@sentry/nextjs'
import { scrubBreadcrumb, scrubEvent } from '@/lib/sentry-scrub'

// Server + edge runtime initialization. Enabled once SENTRY_DSN is set.
export async function register() {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return

  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      // 100% tracing was wasteful/expensive in production; sample down in prod, full in dev.
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      // A-10-03. /sponsor-view/<token> carries a live bearer credential in the path.
      // Without these, the first DSN ever configured starts copying working sponsor
      // tokens into a third-party log — silently, and for every token in flight.
      beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
      beforeSend: (event) => scrubEvent(event),
      beforeSendTransaction: (event) => scrubEvent(event),
    })
  }
}

// Captures errors thrown in Server Components, Route Handlers, and middleware (Next 15+).
// Previously these were invisible — only manually-caught server errors were reported.
export const onRequestError = Sentry.captureRequestError
