import { z } from 'zod'

const envSchema = z.object({
  // Supabase (public)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Supabase (server-only)
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Clerk (public)
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().default('/login'),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().default('/signup'),
  // Clerk (server-only)
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1).optional(), // Optional for dev environments
  // Resend
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().email(),
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(), // Optional for dev environments
  // App
  NEXT_PUBLIC_APP_URL: z.string().url(),
  PAYOUT_ENCRYPTION_KEY: z.string().min(32),
  // Comma-separated list of admin recipient emails for system alerts.

  // If unset, notify falls back to a profiles.role='admin' query.
  ADMIN_NOTIFICATION_EMAILS: z.string().optional(),
  // Sentry. `.optional()` permits the variable to be ABSENT; it does not permit it to be
  // INVALID — and every request path imports this module, so in production `parseEnv()`
  // throws and 500s the ENTIRE SITE on a malformed value. `.env.local` ships the literal
  // placeholder `your_sentry_dsn`, which sits there as an inviting copy-paste for exactly
  // the moment someone sets this in Vercel and pastes a project name instead of a DSN.
  //
  // `.catch(undefined)` makes a malformed OBSERVABILITY value degrade to "no Sentry"
  // instead of taking the product down. The genuinely required secrets above keep failing
  // fast, which is the behaviour that actually protects a deploy.
  SENTRY_DSN: z.string().url().optional().catch(undefined),
  // Cron
  CRON_SECRET: z.string().min(1),
}).superRefine((env, ctx) => {
  if (process.env.NODE_ENV === 'production') {
    if (!env.RESEND_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RESEND_WEBHOOK_SECRET is required in production',
        path: ['RESEND_WEBHOOK_SECRET'],
      })
    }
    if (!env.CLERK_WEBHOOK_SIGNING_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CLERK_WEBHOOK_SIGNING_SECRET is required in production',
        path: ['CLERK_WEBHOOK_SIGNING_SECRET'],
      })
    }
  }
})

// Validation policy:
// - Development: missing vars warn instead of crashing.
// - Production runtime (serverless function handling a request): missing vars throw
//   immediately so a misconfigured deploy fails fast and loudly.
// - Production BUILD phase (`next build`): runtime-only secrets (service role, Resend,
//   cron) are injected at request time on Vercel and are NOT needed to render
//   static pages. Throwing here would crash `collect page data` with a cryptic error on
//   an unrelated route (e.g. /sitemap.xml). So during the build phase we warn and defer
//   the hard check to runtime.
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'

function parseEnv() {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ')
    if (process.env.NODE_ENV === 'production' && !isBuildPhase) {
      throw new Error(`Missing required environment variables: ${missing}`)
    }
    console.warn(`[env] Missing variables (${isBuildPhase ? 'deferred to runtime during build' : 'OK in dev'}): ${missing}`)
    // Return partial object — individual fields will be undefined
    return process.env as unknown as z.infer<typeof envSchema>
  }
  if (
    process.env.NODE_ENV === 'production' &&
    !isBuildPhase &&
    !result.data.RESEND_FROM_EMAIL.toLowerCase().startsWith('noreply@')
  ) {
    throw new Error('RESEND_FROM_EMAIL must use a noreply@ address in production.')
  }
  return result.data
}

export const env = parseEnv()
