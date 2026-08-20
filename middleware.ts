import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { BOTID_PROXY_PREFIX } from '@/lib/botid-paths'

// Routes reachable without an authenticated session.
const isPublicRoute = createRouteMatcher([
  '/',
  '/login(.*)',
  '/signup(.*)',
  '/verify-email(.*)',
  '/legal(.*)',
  '/sponsors/apply(.*)',
  '/sponsor-view(.*)',
  // '/teams(.*)' removed with P0-8: there are no public team portfolio pages any more.
  // Sponsor-facing reach is the token-gated /sponsor-view/[token] route above.
  '/api/webhooks(.*)',
  '/api/cron(.*)',
  '/api/health',
  // Vercel BotID's same-origin challenge + proxy paths. `withBotId` rewrites this fixed
  // prefix to api.vercel.com (see BOTID_PROXY_PREFIX in lib/botid-paths.ts). The challenge
  // script itself ends in `.js` and is already excluded by the matcher below, but the
  // SDK's proxy POSTs are not — without this they 307 to /login for the exact users the
  // challenge exists to verify (anonymous visitors on /sponsors/apply and /signup), and
  // checkBotId() then classifies every real human as a bot.
  `${BOTID_PROXY_PREFIX}(.*)`,
])

// Auth pages: authenticated users should never see these.
//
// /sponsors/apply is here for P0-13. It is a PUBLIC page whose action upserts
// role:'sponsor' onto the caller's profile, so a signed-in coach or admin who wandered
// in could silently rewrite their own role and lose their portal with no way back.
// createSponsorApplication now refuses a cross-role overwrite (app/actions/auth.ts), and
// this bounce stops them reaching the form at all. A signed-in user with NO profile row
// still recovers: /dashboard sends them to /complete-profile, which since 3ab1895 offers
// the sponsor-application form as one of its two branches.
const isAuthPage = createRouteMatcher([
  '/login(.*)',
  '/signup(.*)',
  '/verify-email(.*)',
  '/sponsors/apply(.*)',
])

const isApiRoute = createRouteMatcher(['/api(.*)'])

const SPONSOR_PREVIEW =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_SPONSOR_PREVIEW === '1'

const DEV_AUTH_BYPASS =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true'

const COACH_PREVIEW =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_COACH_PREVIEW === '1'

export default clerkMiddleware(async (auth, req) => {
  if (SPONSOR_PREVIEW || DEV_AUTH_BYPASS || COACH_PREVIEW) return

  const { userId } = await auth()

  // Signed-in users hitting an auth page → send them to the dashboard.
  if (userId && isAuthPage(req)) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  if (isPublicRoute(req)) return

  if (userId) return

  // Unauthenticated, non-public request.
  if (isApiRoute(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const loginUrl = new URL('/login', req.url)
  loginUrl.searchParams.set('redirect_url', req.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
})

export const config = {
  matcher: [
    // `txt` and `xml` were missing from this exclusion list, so /robots.txt,
    // /sitemap.xml and /llms.txt entered clerkMiddleware, failed isPublicRoute and
    // 307-redirected to /login. All three build fine as static routes; the site was
    // simply unindexable, and silently so, because they render perfectly for humans.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ico|webp|woff2?|ttf|otf|map|txt|xml|json|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
