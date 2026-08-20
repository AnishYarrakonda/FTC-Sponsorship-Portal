import { initBotId } from 'botid/client/core'
import * as Sentry from '@sentry/nextjs'

/**
 * Vercel BotID (Basic mode) — arms the invisible challenge before anything else runs.
 *
 * Server Actions are protected by the PAGE PATH they are invoked from, not by an API
 * route: a Server Action POSTs back to its own page URL. So the paths listed here are the
 * pages that host a protected action, not the action names.
 *
 * A path listed here that does not exist is harmless. A path OMITTED here that hosts a
 * protected action is not: checkBotId() then sees no challenge response and rejects every
 * human that reaches it.
 *
 * Basic mode is free on all plans (this project is on Hobby). Deep Analysis needs Pro and
 * is billed per call — if it is ever enabled, `advancedOptions.checkLevel` must be set on
 * BOTH this entry and the matching server-side checkBotId() call, or verification fails.
 */
initBotId({
  protect: [
    { path: '/sponsors/apply', method: 'POST' },   // createSponsorApplication
    { path: '/signup', method: 'POST' },           // createCoachProfile
    { path: '/complete-profile', method: 'POST' }, // completeCoachProfile + stranded-sponsor recovery
  ],
})

// Client-side error + performance capture. Uses a PUBLIC DSN (NEXT_PUBLIC_SENTRY_DSN) since
// this runs in the browser. Without this, client-side runtime errors were never reported.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  })
}

// Instruments client-side navigations so router transitions are traced.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
