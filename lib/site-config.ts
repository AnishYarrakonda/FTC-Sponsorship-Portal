/**
 * Centralised site configuration.
 * Edit this file to update stats, sponsors, mock data, and copy
 * across the entire landing page without touching component code.
 */

// ─── Theme ───────────────────────────────────────────────────────────────────
// Warm Pine
export const ACCENT_TEXT = "#1F6F5C"  // Pine
export const ACCENT_GLOBE = "#1F6F5C" // Pine

// ─── Season ──────────────────────────────────────────────────────────────────
export const CURRENT_SEASON = '2026'
export const DISPATCH_SEASON_LABEL = `Season ${CURRENT_SEASON} dispatch window open`

// ─── Showcase team (fictional team used across product mocks) ─────────────────
export const SHOWCASE_TEAM = { number: '12345', name: 'Ironclad Robotics' } as const

// ─── Contact ─────────────────────────────────────────────────────────────────
/**
 * The address humans reach the team on. Shown in the footer, the FAQ, the sponsor
 * portal, and used as the fallback `replyTo` on outbound mail.
 *
 * NOT the address mail is sent FROM — that is `RESEND_FROM_EMAIL`, which must stay on a
 * domain verified in Resend (Resend cannot send as a gmail.com address). The two are
 * deliberately different: we send from a verified domain and receive on a real inbox.
 *
 * A Gmail address is used on purpose. The previous value, support@exodiusftc.com, had no
 * MX record behind it — mail sent there bounced, which meant a sponsor replying to a
 * pitch reached nobody.
 */
export const SUPPORT_EMAIL = 'exodiusftc@gmail.com'

// ─── Portfolio mock (product showcase) ───────────────────────────────────────
export const PORTFOLIO_MOCK = {
  teamNumber: SHOWCASE_TEAM.number,
  teamName: SHOWCASE_TEAM.name,
  budgetItems: [
    { label: `Outreach, Q1 ${CURRENT_SEASON}`, funded: '$2,400', goal: '$5,000' },
    { label: 'Robot build', funded: '$1,100', goal: '$2,800' },
    { label: 'Travel to Regionals', funded: '$0', goal: '$3,200' },
  ],
}

// ─── Dispatch review timeline (product showcase) ──────────────────────────────
// Illustrates the human-review gate using the fictional showcase team's pitch
// lifecycle — no real teams or sponsor companies.
export const DISPATCH_REVIEW = {
  team: SHOWCASE_TEAM,
  submissionRef: '318',
  subject: 'Sponsor outreach draft',
  steps: [
    { label: 'Drafted by coach', meta: '2h ago', state: 'done' },
    { label: 'Submitted for review', meta: '1h ago', state: 'done' },
    { label: 'In admin review', meta: 'Now', state: 'active' },
    { label: 'Approval gate', meta: 'Pending', state: 'todo' },
    { label: 'Dispatched · signed URL', meta: '—', state: 'todo' },
  ],
} as const

// ─── Footer social links ─────────────────────────────────────────────────────
export const FOOTER_SOCIALS = [
  { label: 'Website', href: 'https://firstinspires.org', icon: 'Globe' },
  { label: 'Contact', href: `mailto:${SUPPORT_EMAIL}`, icon: 'Mail' },
  { label: 'FTC Forum', href: 'https://ftcforum.firstinspires.org', icon: 'AtSign' },
] as const

// ─── Footer columns ───────────────────────────────────────────────────────────
export const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'For coaches', href: '/signup' },
      { label: 'For sponsors', href: '/sponsors/apply' },
      { label: 'Sign in', href: '/login' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'How it works', href: '#how' },
      { label: 'FAQ', href: '#faq' },
      { label: 'FIRST Inspires', href: 'https://firstinspires.org' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms', href: '/legal/terms' },
      { label: 'Privacy', href: '/legal/privacy' },
    ],
  },
] as const

// ─── Credits (footer) ────────────────────────────────────────────────────────
// Framing is deliberate — keep it. All three built it in the sense of being
// involved; the technical work (architecture, DB, security, UI, all code) was
// Anish alone. Rishi and Shreyas originated the idea. Don't flatten these into
// one equal list of names.
export const BUILT_BY = 'Anish Yarrakonda'
export const IDEA_BY = [
  { name: 'Rishi Jhaveri', role: 'outreach lead' },
  { name: 'Shreyas Vempati', role: 'team captain' },
] as const
export const TEAM_NAME = 'Exodius'
export const TEAM_NUMBER = '31579'

// ─── Hero copy ───────────────────────────────────────────────────────────────
export const HERO_MORPHING_WORDS = ['sponsorship', 'partnership', 'opportunity', 'investment', 'connection', 'breakthrough', 'endorsement', 'contribution'] as const
export const HERO_DESCRIPTION = 'The professional sponsorship pipeline for FIRST Tech Challenge coaches. Build a verified portfolio, send moderated pitches, and connect with the industry leaders powering the next generation.'

// ─── Live platform stats (landing page) ──────────────────────────────────────
/**
 * Fallback for the landing page's live impact block. Used when public_platform_stats is
 * unreachable or has never been refreshed. All zeros on purpose: pre-launch the honest
 * number is zero, and the block hides itself entirely when every figure is zero rather
 * than advertising "$0 funded".
 *
 * This does NOT replace the "100%" / "< 24h" figures further down the page — those are
 * process claims that a live number cannot express, and they stay.
 */
export const PLATFORM_STATS_FALLBACK = {
  teamsSupported: 0,
  dollarsReceivedCents: 0,
  studentsReached: 0,
  volunteerHours: 0,
} as const
