'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  Search, Plus, ArrowUpRight, Sparkles, Building2, AlertCircle,
  ChevronDown, ChevronUp, Bell, CheckCircle2, FileText, MessageSquare, Scale,
} from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { FadeUp } from '@/components/motion/fade-up'
import { isAwaitingSponsor } from '@/lib/submission-status'
import { describeActionError } from '@/lib/client-errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatCard } from '@/components/ui/stat-card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { EmptyState } from '@/components/ui/empty-state'
import { PortfolioTab } from './portfolio-tab'
import { InboxTab } from './inbox-tab'
import { FundingTab } from './funding-tab'
import { RecognitionTab, type CoachRecognitionAward } from './recognition-tab'
import { AccountSettings } from '@/components/account/account-settings'
import { updateTeam, requestTeamVerificationReview } from '@/app/actions/team'
import { toast } from 'sonner'
import type { Team, Notification, Submission, Sponsor, TeamAchievement, SubmissionSummary } from '@/lib/supabase/types'

/**
 * The dashboard projection (app/(coach)/dashboard/page.tsx) carries one field the
 * v_submission_summary view does not: how many sponsor questions are on this pitch's
 * thread, so a coach can see there is something to answer without opening every row.
 */
type CoachSubmissionSummary = SubmissionSummary & {
  question_count?: number
  /** Set by the dashboard projection when this decline is still inside its 30-day window. */
  appealable?: boolean
  appeal_status?: string | null
}

const TABS = [
  { id: 'overview', label: 'Dashboard' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'pitches', label: 'Pitches' },
  { id: 'sponsors', label: 'Sponsors' },
  { id: 'recognition', label: 'Recognition' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'funding', label: 'Funding' },
  { id: 'settings', label: 'Settings' },
]

const TAB_ALIASES: Record<string, string> = {
  'find-sponsors': 'sponsors',
  'finances': 'funding',
  'money': 'funding',
  'submissions': 'pitches',
  'drafts': 'pitches',
  'ledger': 'portfolio',
  'insights': 'overview',
}

export function DashboardShell({
  team,
  profile,
  sponsors,
  notifications,
  unreadCount,
  submissions,
  achievements,
  fulfillments = [],
  payoutProfiles = [],
  recognitionAwards = [],
}: {
  team: Team
  profile: any
  sponsors: Sponsor[]
  notifications: Notification[]
  unreadCount: number
  submissions: CoachSubmissionSummary[]
  achievements: TeamAchievement[]
  fulfillments?: any[]
  payoutProfiles?: any[]
  recognitionAwards?: CoachRecognitionAward[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const reduce = useReducedMotion()

  const rawTab = searchParams.get('tab') ?? 'overview'
  const canonical = TAB_ALIASES[rawTab] ?? rawTab
  const tab = TABS.some(t => t.id === canonical) ? canonical : 'overview'

  const setTab = (newTab: string) => {
    const sp = new URLSearchParams(searchParams)
    if (newTab === 'overview') sp.delete('tab')
    else sp.set('tab', newTab)
    router.replace(`${pathname}${sp.size ? `?${sp}` : ''}`, { scroll: false })
  }

  // `delivered` and `opened` were missing, so the headline "active pitches" KPI
  // under-counted precisely the pitches that are live with a sponsor right now.
  const activePitches = submissions.filter(
    s => s.status === 'pending' || isAwaitingSponsor(s.status) || s.status === 'approved'
  ).length
  const totalFunded = submissions.filter(s => s.status === 'approved').length

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
            {team.status === 'existing' ? `FTC · ${team.ftc_team_number}` : 'Incubator'}
            {(team.city || team.state) && (
              <> · {team.city}{team.city && team.state && ', '}{team.state}</>
            )}
          </div>
          <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">{team.team_name}</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">{team.organization ?? 'Independent'}</p>
        </div>
      </div>

      {/* Tab content — no visible tab bar; navigation is sidebar-only */}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={tab}
          initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.99, filter: 'blur(4px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.01, filter: 'blur(4px)' }}
          transition={{ duration: 0.08, ease: 'easeOut' }}
          className="w-full"
        >
          {tab === 'overview' && (
            <OverviewTab
              team={team}
              switchTab={setTab}
              activePitches={activePitches}
              submissionsCount={submissions.length}
              totalFunded={totalFunded}
              portfolioAsk={team.financial_ask_cents || 0}
              submissions={submissions}
              unreadCount={unreadCount}
            />
          )}
          {tab === 'portfolio' && <PortfolioTab team={team} achievements={achievements} />}
          {tab === 'pitches' && <SubmissionsTab submissions={submissions} onNewPitch={() => setTab('sponsors')} />}
          {tab === 'sponsors' && <FindSponsorsTab sponsors={sponsors} submissions={submissions} />}
          {tab === 'recognition' && <RecognitionTab awards={recognitionAwards} />}
          {tab === 'inbox' && <InboxTab notifications={notifications} switchTab={setTab} />}
          {tab === 'funding' && <FundingTab teams={[team]} fulfillments={fulfillments} payoutProfiles={payoutProfiles} />}
          {tab === 'settings' && (
            <div className="max-w-[600px] mx-auto">
              <AccountSettings currentName={profile?.full_name} email={profile?.email} role={profile?.role} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/* ── Overview tab ───────────────────────────────────────────────────────────── */

function OverviewTab({
  team, switchTab, activePitches, submissionsCount, totalFunded, portfolioAsk, submissions, unreadCount,
}: {
  team: Team
  switchTab: (t: string) => void
  activePitches: number
  submissionsCount: number
  totalFunded: number
  portfolioAsk: number
  submissions: CoachSubmissionSummary[]
  unreadCount: number
}) {
  const needsAttention = submissions.filter(s => s.status === 'declined' || s.status === 'changes_requested')
  const recentPitches = [...submissions]
    .sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime())
    .slice(0, 5)
  const fundedAmount = submissions
    .filter(s => s.status === 'approved')
    .reduce((sum, s) => sum + (s.requested_amount_cents || 0), 0)
  const fundingPct = portfolioAsk > 0 ? Math.min(100, Math.round((fundedAmount / portfolioAsk) * 100)) : 0

  const [showGraduation, setShowGraduation] = useState(false)
  const [gradNumber, setGradNumber] = useState('')
  const [gradName, setGradName] = useState(team.team_name)
  const [isGraduating, startGraduation] = useTransition()
  const [rejection, setRejection] = useState<{ claimedTeamName: string; officialTeamName: string | null } | null>(null)
  const [isRequestingReview, startReviewRequest] = useTransition()
  const [reviewRequested, setReviewRequested] = useState(false)

  const handleGraduate = () => {
    const num = parseInt(gradNumber)
    if (isNaN(num) || num <= 0) {
      toast.error('Please enter a valid FTC Team Number')
      return
    }
    startGraduation(async () => {
      try {
        // The `as any` that used to be here was unnecessary — updateTeam already takes
        // Partial<TeamOnboardingInput> — and it was the only reason nobody noticed that
        // updateTeam had no branch for `status` or `ftcTeamNumber` at all. Graduation
        // wrote the team name, left status='incubator' and ftc_team_number NULL, and
        // still showed the success toast below. Both fields are now written; the cast is
        // gone so a future dropped field is a type error.
        const res = await updateTeam(team.id, {
          status: 'existing',
          ftcTeamNumber: num,
          teamName: gradName.trim() || team.team_name,
        })
        if (res?.error) {
          // A verification rejection carries structured fields so this can be shown
          // inline (official vs. entered name) rather than only as a toast — the coach
          // needs to actually compare the two, not just be told "something's wrong."
          if ('verificationRejected' in res && res.verificationRejected) {
            setRejection({ claimedTeamName: res.claimedTeamName, officialTeamName: res.officialTeamName })
            setShowGraduation(false)
          } else {
            toast.error(res.error)
          }
        } else {
          setRejection(null)
          toast.success('Congratulations! You are now an official Existing Team.')
          window.location.reload()
        }
      } catch (e) {
        toast.error(describeActionError(e, 'updateTeam.graduate'))
      }
    })
  }

  const handleRequestReview = () => {
    startReviewRequest(async () => {
      const res = await requestTeamVerificationReview(team.id)
      if (res?.error) toast.error(res.error)
      else {
        setReviewRequested(true)
        toast.success('An admin has been notified to review your team number.')
      }
    })
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Incubator graduation banner */}
      {team.status === 'incubator' && (
        <FadeUp>
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-[15px] font-semibold text-foreground">Ready to graduate?</h4>
                <p className="mt-1 text-sm text-muted-foreground max-w-md leading-relaxed">
                  If you have secured your seed funding and registered with FIRST, you can upgrade your account to unlock technical robot specs and award history.
                </p>
              </div>
            </div>

            <Dialog open={showGraduation} onOpenChange={setShowGraduation}>
              <DialogTrigger
                className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              >
                I have a team now
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px] bg-card border-border">
                <DialogHeader>
                  <DialogTitle className="text-xl font-medium tracking-tight flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Level Up Your Team
                  </DialogTitle>
                  <DialogDescription className="text-muted-foreground text-sm">
                    Enter your official registration details to graduate from an Incubator to an Existing Team.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    {/* htmlFor/id pair: without it the label is decorative markup — a screen
                        reader announces an unlabelled number box, and getByLabel finds nothing. */}
                    <Label htmlFor="grad-team-number" className="text-foreground">New FTC Team Number</Label>
                    <Input
                      id="grad-team-number"
                      type="number"
                      placeholder="e.g. 12345"
                      className="bg-background border-input text-foreground placeholder:text-muted-foreground focus:ring-primary"
                      value={gradNumber}
                      onChange={(e) => setGradNumber(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="grad-team-name" className="text-foreground">Official Team Name</Label>
                    <Input
                      id="grad-team-name"
                      placeholder="Enter official team name"
                      className="bg-background border-input text-foreground placeholder:text-muted-foreground focus:ring-primary"
                      value={gradName}
                      onChange={(e) => setGradName(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setShowGraduation(false)}
                    className="border-border text-foreground hover:bg-accent hover:text-foreground"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleGraduate}
                    disabled={isGraduating || !gradNumber}
                    className="bg-primary text-primary-foreground hover:bg-primary-hover"
                  >
                    {isGraduating ? 'Upgrading...' : 'Graduate Team'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </FadeUp>
      )}

      {/* Graduation verification rejection — not silently swallowed into a toast */}
      {rejection && (
        <FadeUp>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-status-danger" />
              <div className="flex-1 space-y-2">
                <h4 className="text-[15px] font-semibold text-status-danger">Team number could not be verified</h4>
                <p className="text-sm text-muted-foreground">
                  The name you entered doesn&apos;t match the official FIRST roster record for that team number.
                </p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground uppercase tracking-wide">You entered</dt>
                    <dd className="mt-0.5 font-medium text-foreground">{rejection.claimedTeamName}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground uppercase tracking-wide">Official record</dt>
                    <dd className="mt-0.5 font-medium text-foreground">{rejection.officialTeamName ?? 'Unknown'}</dd>
                  </div>
                </dl>
                <div className="flex items-center gap-3 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isRequestingReview || reviewRequested}
                    onClick={handleRequestReview}
                    className="border-rose-500/30 text-status-danger hover:bg-rose-500/10"
                  >
                    {reviewRequested ? 'Review requested' : isRequestingReview ? 'Requesting…' : 'Request admin review'}
                  </Button>
                  <button
                    onClick={() => setRejection(null)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        </FadeUp>
      )}

      {/* Needs-attention alerts */}
      {needsAttention.length > 0 && (
        <FadeUp>
          <div className="space-y-3">
            {needsAttention.map(s => (
              <div key={s.id} className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-status-danger" />
                    <h4 className="text-sm font-medium text-status-danger">
                      {s.status === 'declined' ? 'Submission Declined' : 'Changes Requested'}
                    </h4>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{s.company_name}</span>: {s.admin_feedback || 'Needs your attention.'}
                  </p>
                </div>
                <Link
                  href={`/submissions/${s.id}/edit`}
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-[6px] bg-rose-600 text-white px-4 h-9 shrink-0 text-sm font-medium transition-all hover:bg-rose-700 active:scale-95 shadow-sm"
                >
                  Review Submission
                </Link>
              </div>
            ))}
          </div>
        </FadeUp>
      )}

      {/* KPI row */}
      <FadeUp className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={AlertCircle} label="Active pitches" value={activePitches} description="In review or approved" />
        <StatCard icon={Search} label="Submissions" value={submissionsCount} description="All-time sponsor outreach" />
        <StatCard icon={Building2} label="Funded" value={totalFunded} description="Approved by sponsors" />
        <StatCard icon={Sparkles} label="Portfolio ask" value={`$${(portfolioAsk / 100).toLocaleString('en-US')}`} description="Season target" />
      </FadeUp>

      {/* Two-column: Recent Pitches + Portfolio Snapshot */}
      <FadeUp className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Pitches</CardTitle>
              <button
                onClick={() => switchTab('pitches')}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View all <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {recentPitches.length > 0 ? (
              <div className="flex flex-col divide-y divide-border">
                {recentPitches.map(s => (
                  <div key={s.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-accent/30 text-muted-foreground">
                        <Building2 className="h-4 w-4" strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{s.company_name}</p>
                        <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                          {new Date(s.updated_at ?? 0).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={s.status ?? 'draft'} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground mb-3">No pitches yet.</p>
                <button
                  onClick={() => switchTab('sponsors')}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" /> Start your first pitch
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Portfolio Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {team.mission_statement ? (
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                {team.mission_statement}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">Add a mission statement to strengthen your pitches.</p>
            )}

            {portfolioAsk > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <span>Funded</span>
                  <span className="font-mono text-foreground">
                    ${(fundedAmount / 100).toLocaleString()} of ${(portfolioAsk / 100).toLocaleString()}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${fundingPct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{fundingPct}% of season target</p>
              </div>
            )}

            {team.budget_items && (team.budget_items as any[]).length > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.5} />
                <span>{(team.budget_items as any[]).length} budget line items</span>
              </div>
            )}

            <button
              onClick={() => switchTab('portfolio')}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              Edit Portfolio
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </CardContent>
        </Card>
      </FadeUp>

      {/* Quick actions */}
      <div className="grid gap-4 sm:grid-cols-3">
        <CoachQuickAction
          icon={<Plus className="h-4 w-4" strokeWidth={1.5} />}
          label="New Pitch"
          sub="Target a specific sponsor"
          onClick={() => switchTab('sponsors')}
        />
        <CoachQuickAction
          icon={<Search className="h-4 w-4" strokeWidth={1.5} />}
          label="Browse Sponsors"
          sub="Find your next partner"
          onClick={() => switchTab('sponsors')}
        />
        <CoachQuickAction
          icon={<Bell className="h-4 w-4" strokeWidth={1.5} />}
          label="View Inbox"
          sub={unreadCount > 0 ? `${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}` : 'All caught up'}
          onClick={() => switchTab('inbox')}
          badge={unreadCount > 0 ? unreadCount : undefined}
        />
      </div>
    </div>
  )
}

/* ── Coach quick action card ────────────────────────────────────────────────── */

function CoachQuickAction({ icon, label, sub, onClick, badge }: {
  icon: React.ReactNode
  label: string
  sub: string
  onClick: () => void
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border border-border p-4 transition-colors hover:bg-accent/50"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-foreground">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        {badge != null && (
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </button>
  )
}

/* ── Find Sponsors tab ──────────────────────────────────────────────────────── */

const FUNDING_RANGES = [
  { label: 'Any', min: 0, max: Infinity },
  { label: 'Under $1k', min: 0, max: 100_000 },
  { label: '$1k – $5k', min: 100_000, max: 500_000 },
  { label: '$5k+', min: 500_000, max: Infinity },
]

function SponsorInitials({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt={name} className="h-full w-full object-cover rounded-lg" />
    )
  }
  return (
    <span className="text-sm font-semibold">{initials}</span>
  )
}

function FindSponsorsTab({ sponsors, submissions }: { sponsors: Sponsor[], submissions: CoachSubmissionSummary[] }) {
  const [query, setQuery] = useState('')
  const [industry, setIndustry] = useState('all')
  const [fundingRange, setFundingRange] = useState(0) // index into FUNDING_RANGES

  const industries = ['all', ...Array.from(new Set(sponsors.map(s => s.industry).filter(Boolean) as string[]))]

  const { min, max } = FUNDING_RANGES[fundingRange]

  const results = sponsors.filter(s => {
    const q = query.trim().toLowerCase()
    const remaining = s.funding_cap_cents - s.funding_used_cents
    return (
      s.status === 'active' &&
      remaining > 0 &&
      (!q || s.company_name.toLowerCase().includes(q)) &&
      (industry === 'all' || s.industry === industry) &&
      remaining >= min && remaining < max
    )
  })

  return (
    <FadeUp>
      <div className="space-y-6 pb-20">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="h-4 w-4" strokeWidth={1.5} />
          <h2 className="text-[15px] font-medium tracking-tight text-foreground">Find sponsors for your next pitch</h2>
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.5} />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search sponsor companies"
              placeholder="Search companies…"
              className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-shadow shadow-sm"
            />
          </div>

          {/* Industry pills */}
          <div className="flex flex-wrap gap-1.5 items-center">
            {industries.map(t => (
              <button
                key={t}
                onClick={() => setIndustry(t)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors capitalize shadow-sm',
                  industry === t
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-accent'
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Funding range pills */}
          <div className="flex gap-1.5 items-center">
            {FUNDING_RANGES.map((r, i) => (
              <button
                key={r.label}
                onClick={() => setFundingRange(i)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors shadow-sm',
                  fundingRange === i
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-status-success'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-accent'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sponsor cards — larger, more visual */}
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {results.map(s => {
              const remaining = s.funding_cap_cents - s.funding_used_cents
              const pct = s.funding_cap_cents > 0 ? Math.round((s.funding_used_cents / s.funding_cap_cents) * 100) : 0

              // Check if there is an active submission (non-terminal)
              const activeSub = submissions.find(sub =>
                sub.sponsor_id === s.id &&
                !['declined', 'expired', 'bounced'].includes(sub.status ?? '')
              )

              return (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.18 }}
                  className="group flex flex-col gap-0 rounded-xl border border-border bg-card overflow-hidden transition-all hover:shadow-md hover:border-border/80"
                >
                  {/* Card header */}
                  <div className="flex items-start gap-4 p-5 pb-4">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-primary/10 bg-primary/5 text-primary overflow-hidden shadow-sm">
                      <SponsorInitials name={s.company_name} logoUrl={s.logo_url} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-medium text-foreground tracking-tight truncate">{s.company_name}</div>
                      {s.industry && (
                        <span className="mt-1 inline-block rounded-md bg-secondary border border-border/50 px-2 py-0.5 text-xs uppercase font-medium tracking-wider text-muted-foreground">
                          {s.industry}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Funding bar */}
                  <div className="px-5 pb-5 space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground font-medium uppercase tracking-wider">
                      <span>Remaining</span>
                      <span className="font-mono text-foreground">${(remaining / 100).toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${100 - pct}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">{100 - pct}% capacity available</div>
                  </div>

                  {/* Actions */}
                  <div className="mt-auto border-t border-border grid grid-cols-2 divide-x divide-border">
                    {s.website ? (
                      <a
                        href={s.website}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center gap-1.5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        Visit site <ArrowUpRight className="h-3 w-3" />
                      </a>
                    ) : (
                      <div />
                    )}
                    {activeSub ? (
                      <Link
                        href={`/submissions/${activeSub.id}/edit`}
                        className={cn(
                          'flex items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors bg-emerald-500/10 text-status-success hover:bg-emerald-500/20',
                          !s.website && 'col-span-2',
                        )}
                      >
                        View active pitch
                      </Link>
                    ) : (
                      <Link
                        href={`/submissions/new?sponsor=${s.id}`}
                        className={cn(
                          'flex items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors',
                          s.website
                            ? 'text-primary hover:bg-primary/5'
                            : 'col-span-2 text-primary hover:bg-primary/5',
                        )}
                      >
                        <Plus className="h-3.5 w-3.5" /> Pitch this sponsor
                      </Link>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
          {results.length === 0 && (
            <EmptyState
              className="col-span-full"
              icon={Building2}
              title="No sponsors match your filters"
              description="Try a different search term, industry, or funding range — new sponsors are added as they're approved."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setQuery(''); setIndustry('all'); setFundingRange(0) }}
                >
                  Clear filters
                </Button>
              }
            />
          )}
        </div>
      </div>
    </FadeUp>
  )
}

/* ── Submissions tab ────────────────────────────────────────────────────────── */

type SubmissionFilter = 'all' | 'approved' | 'declined' | 'pending' | 'draft' | 'closed'

// `expired` and `bounced` previously matched NO tab, so a lapsed or undeliverable pitch
// was reachable only under "All" — the two states a coach most needs to notice, because
// both mean the sponsor will never respond. "Pending" also missed delivered/opened.
const SUBMISSION_FILTERS: { id: SubmissionFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'approved', label: 'Accepted' },
  { id: 'pending', label: 'In progress' },
  { id: 'declined', label: 'Rejected' },
  { id: 'closed', label: 'Expired / undelivered' },
  { id: 'draft', label: 'Drafts' },
]

function SubmissionsTab({ submissions, onNewPitch }: { submissions: CoachSubmissionSummary[], onNewPitch: () => void }) {
  const [filter, setFilter] = useState<SubmissionFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = submissions.filter(s => {
    if (filter === 'all') return true
    if (filter === 'declined') return s.status === 'declined' || s.status === 'changes_requested'
    if (filter === 'pending') return s.status === 'pending' || isAwaitingSponsor(s.status)
    if (filter === 'closed') return s.status === 'expired' || s.status === 'bounced'
    return s.status === filter
  })

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Filter tabs and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex gap-1.5 flex-wrap">
        {SUBMISSION_FILTERS.map(f => {
          const count = f.id === 'all'
            ? submissions.length
            : f.id === 'declined'
              ? submissions.filter(s => s.status === 'declined' || s.status === 'changes_requested').length
              : submissions.filter(s => s.status === f.id).length
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors shadow-sm',
                filter === f.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-accent'
              )}
            >
              {f.label} <span className="ml-1 opacity-50">{count}</span>
            </button>
          )
        })}
        </div>
        <Button onClick={onNewPitch} className="gap-2 shrink-0 bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm">
          <Plus className="h-4 w-4" /> New Pitch
        </Button>
      </div>

      {/* List */}
      <div className="rounded-xl border border-border bg-card shadow-sm divide-y divide-border">
        {filtered.map(s => {
          const isEditable = ['draft', 'declined', 'changes_requested'].includes(s.status ?? '')
          const expanded = expandedId === s.id
          return (
            <div key={s.id} className="transition-colors hover:bg-accent/40">
              <div
                className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-5 py-4 cursor-pointer"
                onClick={() => setExpandedId(expanded ? null : s.id)}
              >
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-primary/10 bg-primary/5 shadow-sm text-primary">
                    <Building2 className="h-5 w-5" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{s.company_name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={s.status ?? 'draft'} />
                      <span className="text-xs text-muted-foreground font-mono" suppressHydrationWarning>
                        {new Date(s.updated_at ?? 0).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {isEditable ? (
                    <Link
                      href={`/submissions/${s.id}/edit`}
                      onClick={e => e.stopPropagation()}
                      className="text-xs uppercase tracking-wider px-3 py-1.5 bg-background border border-border rounded-md hover:bg-accent text-foreground font-semibold transition-colors shadow-sm"
                    >
                      Edit
                    </Link>
                  ) : (
                    // A locked pitch has nothing to edit — send them to the detail page,
                    // which is where the sponsor Q&A thread lives.
                    <Link
                      href={`/submissions/${s.id}`}
                      onClick={e => e.stopPropagation()}
                      className="text-xs uppercase tracking-wider px-3 py-1.5 bg-background border border-border rounded-md hover:bg-accent text-foreground font-semibold transition-colors shadow-sm"
                    >
                      View
                    </Link>
                  )}
                  {s.appeal_status ? (
                    <Link
                      href="/appeals"
                      onClick={e => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider px-3 py-1.5 rounded-md border border-border bg-background text-muted-foreground font-semibold transition-colors hover:bg-accent"
                    >
                      <Scale className="h-3.5 w-3.5" />
                      Appeal {s.appeal_status.replace('_', ' ')}
                    </Link>
                  ) : s.appealable ? (
                    <Link
                      href="/appeals"
                      onClick={e => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider px-3 py-1.5 rounded-md border border-border bg-background text-foreground font-semibold transition-colors hover:bg-accent shadow-sm"
                    >
                      <Scale className="h-3.5 w-3.5" />
                      Appeal
                    </Link>
                  ) : null}
                  {(s.question_count ?? 0) > 0 && (
                    <Link
                      href={`/submissions/${s.id}`}
                      onClick={e => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider px-3 py-1.5 rounded-md border border-amber-300 bg-amber-50 text-amber-900 font-semibold transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      {s.question_count} question{s.question_count === 1 ? '' : 's'}
                    </Link>
                  )}
                  <span className="text-muted-foreground/50">
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </span>
                </div>
              </div>

              {/* Expanded detail */}
              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 space-y-3 border-t border-border pt-4 bg-accent/20">
                      {s.admin_feedback && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-700">
                          <span className="font-semibold text-amber-700">Admin feedback: </span>{s.admin_feedback}
                        </div>
                      )}
                      {s.requested_amount_cents != null && (
                        <div className="text-xs text-muted-foreground">
                          Ask: <span className="text-foreground font-mono font-medium">${(s.requested_amount_cents / 100).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <EmptyState
            className="rounded-none border-0 bg-transparent"
            icon={FileText}
            title={filter === 'all' ? 'No pitches yet' : 'No pitches in this category'}
            description={
              filter === 'all'
                ? 'Browse active sponsors and send your first tailored pitch.'
                : 'Try another filter, or start a new pitch to an active sponsor.'
            }
            action={
              <Button onClick={onNewPitch} size="sm" className="gap-2">
                <Plus className="h-4 w-4" aria-hidden="true" /> New Pitch
              </Button>
            }
          />
        )}
      </div>
    </div>
  )
}
