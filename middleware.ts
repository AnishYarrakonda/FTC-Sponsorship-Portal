import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Routes reachable without an authenticated session.
const isPublicRoute = createRouteMatcher([
  '/',
  '/login(.*)',
  '/signup(.*)',
  '/verify-email(.*)',
  '/legal(.*)',
  '/sponsors/apply(.*)',
  '/sponsor-view(.*)',
  '/teams(.*)',
  '/api/webhooks(.*)',
  '/api/cron(.*)',
  '/api/health',
])

// Auth pages: authenticated users should never see these.
const isAuthPage = createRouteMatcher(['/login(.*)', '/signup(.*)', '/verify-email(.*)'])

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
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ico|webp|woff2?|ttf|otf|map)).*)',
    '/(api|trpc)(.*)',
  ],
}
