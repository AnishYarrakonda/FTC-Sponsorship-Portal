'use client'

import { useState, useTransition } from 'react'
import { isAwaitingSponsor, isTerminal } from '@/lib/submission-status'
import { statusLabel } from '@/components/ui/status-badge'
import { useRouter } from 'next/navigation'
import { 
  Building2, 
  MapPin, 
  Target, 
  Award, 
  ChevronLeft,
  CheckCircle2,
  XCircle,
  MessageSquare,
  ExternalLink,
  History
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn, htmlToPlainText } from '@/lib/utils'
import { sponsorUpdateSubmissionStatus } from '@/app/actions/sponsor-decision'
import { toast } from 'sonner'

type SponsorSubmission = {
  id: string
  status: string
  custom_pitch_alignment?: string | null
  specific_needs_statement?: string | null
  sponsors?: { company_name?: string | null } | null
  requested_amount_cents: number
}

type TeamAchievement = {
  id: string
  season?: string | null
  event_name: string
  award?: string | null
  description?: string | null
}

type SponsorTeam = {
  ftc_team_number?: number | null
  team_name: string
  city?: string | null
  state?: string | null
  organization?: string | null
  mission_statement?: string | null
  team_achievements?: TeamAchievement[] | null
  financial_ask_cents: number
  website?: string | null
  founded_year?: number | null
  team_size?: number | null
  seasons_competed?: number | null
  coach_experience?: string | null
  past_sponsors?: string[] | null
  press_links?: { label: string; url: string }[] | null
  community_endorsements?: string | null
  outreach_summary?: string | null
  students_reached?: number | null
  events_hosted?: number | null
  volunteer_hours?: number | null
  technical_summary?: string | null
  github_link?: string | null
}

function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

export function SponsorReviewShell({ submission, team }: { submission: any; team: any }) {
  const submissionData = submission as SponsorSubmission
  const teamData = team as SponsorTeam
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState('')
  const [showConfirm, setShowConfirm] = useState<'approved' | 'declined' | 'changes_requested' | null>(null)
  const sponsorCompany = submissionData?.sponsors?.company_name || 'your company'

  const achievements = teamData?.team_achievements ?? []
  const pastSponsors = teamData?.past_sponsors ?? []
  const pressLinks = (teamData?.press_links ?? [])
    .map((p) => ({ label: p.label, url: safeHttpUrl(p.url) }))
    .filter((p): p is { label: string; url: string } => !!p.url)
  const impactStats = [
    teamData?.students_reached ? { label: 'Students reached', value: teamData.students_reached } : null,
    teamData?.events_hosted ? { label: 'Events hosted', value: teamData.events_hosted } : null,
    teamData?.volunteer_hours ? { label: 'Volunteer hours', value: teamData.volunteer_hours } : null,
  ].filter(Boolean) as { label: string; value: number }[]
  const storyFacts = [
    teamData?.founded_year ? `Founded ${teamData.founded_year}` : null,
    teamData?.team_size ? `${teamData.team_size} students` : null,
    teamData?.seasons_competed ? `${teamData.seasons_competed} season${teamData.seasons_competed === 1 ? '' : 's'} competed` : null,
  ].filter(Boolean) as string[]
  const githubUrl = safeHttpUrl(teamData?.github_link)

  const handleDecision = (status: 'approved' | 'declined' | 'changes_requested') => {
    startTransition(async () => {
      const result = await sponsorUpdateSubmissionStatus(
        submissionData.id,
        status,
        feedback
      )

      if ('success' in result && result.success) {
        // P0-11: the decision COMMITTED but a confirmation email failed. Navigating away
        // on a green toast is what made this class of failure invisible; hold the sponsor
        // here long enough to actually read it.
        const warning = 'warning' in result ? result.warning : undefined
        if (warning) {
          toast.warning(warning, { duration: 12000 })
          setTimeout(() => router.push('/sponsor/dashboard'), 1200)
        } else {
          toast.success(`Submission ${status} successfully.`)
          router.push('/sponsor/dashboard')
        }
      } else {
        toast.error(result.error || 'Failed to update submission.')
      }
    })
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      {/* Back Link */}
      <button 
        onClick={() => router.back()}
        className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Dashboard
      </button>

      <div className="grid lg:grid-cols-[1fr,400px] gap-12 lg:gap-8">
        {/* Left Column: Team Portfolio */}
        <div className="space-y-8">
          <section className="space-y-4">
            <div className="flex items-center gap-5">
              <div className="h-20 w-20 shrink-0 rounded-2xl bg-primary flex items-center justify-center text-3xl font-medium tracking-tight text-primary-foreground shadow-sm">
                {teamData?.ftc_team_number || '??'}
              </div>
              <div>
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">{teamData?.team_name || 'Unknown Team'}</h1>
                <div className="flex flex-wrap items-center gap-3 mt-2 text-[15px] text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" strokeWidth={1.5} />
                    {teamData?.city || 'Unknown'}, {teamData?.state || 'Unknown'}
                  </div>
                  <span>•</span>
                  <div className="flex items-center gap-1.5">
                    <Building2 className="h-4 w-4" strokeWidth={1.5} />
                    {teamData?.organization || 'Independent'}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Custom Pitch Section */}
          <Card className="border-primary/20 bg-primary/5 shadow-none overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
              <MessageSquare className="h-16 w-16" />
            </div>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2 text-primary">
                <Target className="h-5 w-5" />
                The Pitch to {sponsorCompany}
              </CardTitle>
              <CardDescription className="text-[13px]">Specifically tailored alignment and needs for your company.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Why us?</Label>
                <p className="whitespace-pre-wrap text-[15px] text-foreground leading-relaxed italic border-l-2 border-primary/30 pl-4">
                  &ldquo;{htmlToPlainText(submissionData.custom_pitch_alignment) || 'No specific alignment provided.'}&rdquo;
                </p>
              </div>
              <div className="space-y-3">
                <Label className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Specific Needs</Label>
                <p className="whitespace-pre-wrap text-[15px] text-foreground leading-relaxed">
                  {htmlToPlainText(submissionData.specific_needs_statement) || 'General sponsorship request.'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Team Portfolio — achievements, credibility, and impact first */}
          <div className="space-y-8 pt-4">
            <h2 className="text-xl font-medium tracking-tight border-b border-border pb-3">Team Portfolio</h2>

            {/* 1. Achievements & Awards */}
            <div className="space-y-4">
              <Label className="text-[13px] text-muted-foreground">Achievements &amp; Awards</Label>
              <div className="grid gap-3">
                {achievements.length > 0 ? achievements.map((ach) => (
                  <div key={ach.id} className="p-4 rounded-xl border border-border bg-card flex items-start gap-4 shadow-sm">
                    <Award className="h-5 w-5 text-amber-500 shrink-0" strokeWidth={1.5} />
                    <div className="min-w-0">
                      <div className="text-[15px] font-medium text-foreground">{ach.award || ach.event_name}</div>
                      <div className="text-[13px] text-muted-foreground mt-0.5">
                        {[ach.season, ach.award ? ach.event_name : null, ach.description].filter(Boolean).join(' • ')}
                      </div>
                    </div>
                  </div>
                )) : <div className="text-[15px] text-muted-foreground italic">No achievements listed.</div>}
              </div>
            </div>

            {/* 2. Team Story & People */}
            <div className="space-y-3">
              <Label className="text-[13px] text-muted-foreground">Team Story &amp; People</Label>
              {storyFacts.length > 0 && (
                <p className="text-[13px] font-medium text-foreground">{storyFacts.join(' • ')}</p>
              )}
              <p className="text-[15px] leading-relaxed text-foreground">{teamData?.mission_statement || 'No mission statement provided.'}</p>
              {teamData?.coach_experience && (
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">Coaching: </span>
                  {teamData.coach_experience}
                </p>
              )}
            </div>

            {/* 3. Credibility */}
            {(pastSponsors.length > 0 || pressLinks.length > 0 || teamData?.community_endorsements) && (
              <div className="space-y-3">
                <Label className="text-[13px] text-muted-foreground">Credibility</Label>
                {pastSponsors.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {pastSponsors.map((cap) => (
                      <span key={cap} className="px-2.5 py-1 bg-secondary text-secondary-foreground rounded-md text-[11px] font-medium uppercase tracking-wider">
                        {cap}
                      </span>
                    ))}
                  </div>
                )}
                {pressLinks.length > 0 && (
                  <ul className="space-y-1">
                    {pressLinks.map((p) => (
                      <li key={p.url}>
                        <a href={p.url} target="_blank" rel="noreferrer" className="text-[13px] text-primary hover:underline">
                          {p.label} ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {teamData?.community_endorsements && (
                  <p className="text-[13px] leading-relaxed text-muted-foreground italic border-l-2 border-border pl-3">
                    {htmlToPlainText(teamData.community_endorsements)}
                  </p>
                )}
              </div>
            )}

            {/* 4. Community & Ethics Impact */}
            {(impactStats.length > 0 || teamData?.outreach_summary) && (
              <div className="space-y-3">
                <Label className="text-[13px] text-muted-foreground">Community Impact</Label>
                {impactStats.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {impactStats.map((s) => (
                      <div key={s.label} className="rounded-xl border border-border bg-card p-3 text-center shadow-sm">
                        <p className="text-xl font-semibold tabular-nums text-foreground">{s.value.toLocaleString()}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{s.label}</p>
                      </div>
                    ))}
                  </div>
                )}
                {teamData?.outreach_summary && (
                  <p className="text-[15px] leading-relaxed text-foreground">{htmlToPlainText(teamData.outreach_summary)}</p>
                )}
              </div>
            )}

            {/* 7. Robot & Engineering (slim, optional) */}
            {(teamData?.technical_summary || githubUrl) && (
              <div className="space-y-2 rounded-xl border border-border/70 bg-card/60 p-4">
                <Label className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Robot &amp; Engineering</Label>
                {teamData?.technical_summary && (
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{htmlToPlainText(teamData.technical_summary)}</p>
                )}
                {githubUrl && (
                  <a href={githubUrl} target="_blank" rel="noreferrer" className="text-[13px] text-primary hover:underline">
                    View code on GitHub →
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Actions */}
        <div className="space-y-6">
          <div className="sticky top-8 space-y-6">
            {/*
              This gated only on ['approved','declined','changes_requested'], so an
              `expired` or `bounced` submission fell into the ELSE branch and rendered a
              LIVE Decision Console. Every RPC rejects those states with 'invalid_status',
              so the sponsor's funding decision silently evaporated on submit. Inverted to
              an allowlist: the console renders only for states a decision can actually be
              recorded against.
            */}
            {!isAwaitingSponsor(submissionData.status) ? (
              <Card className="border-border bg-card shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">
                    {isTerminal(submissionData.status) && submissionData.status !== 'approved' && submissionData.status !== 'declined'
                      ? 'No Longer Actionable'
                      : 'Decision Recorded'}
                  </CardTitle>
                  <CardDescription className="text-[13px]">
                    {submissionData.status === 'expired' ? (
                      <>This request expired before a decision was made, and its reserved funding has been released. Ask the team to resubmit if you would still like to fund it.</>
                    ) : submissionData.status === 'bounced' ? (
                      <>The email carrying this request could not be delivered, so it is no longer actionable. Contact the team or the portal administrators to have it resent.</>
                    ) : (
                      <>This submission has already been marked as <strong className="text-foreground font-medium">{statusLabel(submissionData.status)}</strong>.</>
                    )}
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <Card className="border-border bg-card shadow-md">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg font-medium tracking-tight">Decision Console</CardTitle>
                  <CardDescription className="text-[13px]">Review and respond to this request.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="feedback" className="text-[13px] text-muted-foreground">Internal/External Feedback</Label>
                      <Textarea 
                        id="feedback"
                        placeholder="Add a message for the team or internal notes..."
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        className="min-h-[120px] bg-background border-border text-[14px]"
                      />
                    </div>

                  </div>

                  <div className="grid grid-cols-1 gap-3 pt-6 border-t border-border">
                    <Button 
                      variant="default" 
                      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                      disabled={isPending}
                      onClick={() => setShowConfirm('approved')}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Approve Sponsorship
                    </Button>
                    <div className="grid grid-cols-2 gap-3">
                      <Button 
                        variant="outline" 
                        className="border-border hover:bg-accent text-foreground"
                        disabled={isPending}
                        onClick={() => setShowConfirm('changes_requested')}
                      >
                        <History className="mr-2 h-4 w-4" />
                        More Info
                      </Button>
                      <Button 
                        variant="outline" 
                        className="border-rose-500/20 text-rose-600 hover:bg-rose-500/10"
                        disabled={isPending}
                        onClick={() => setShowConfirm('declined')}
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Decline
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Confirmation Dialog (Simple Inline Overlay) */}
            <AnimatePresence>
              {showConfirm && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="p-5 rounded-xl border border-border bg-card space-y-5 shadow-lg"
                >
                  <p className="text-[14px] leading-relaxed text-center text-foreground">
                    Are you sure you want to <span className="font-semibold uppercase tracking-wider">{showConfirm.replace('_', ' ')}</span> this submission?
                  </p>
                  <div className="flex gap-3">
                    <Button variant="ghost" className="flex-1 text-[13px]" onClick={() => setShowConfirm(null)}>Cancel</Button>
                    <Button 
                      variant="default" 
                      className={cn(
                        "flex-1 text-[13px] shadow-sm",
                        showConfirm === 'approved' ? 'bg-primary hover:bg-primary/90' : showConfirm === 'declined' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'
                      )}
                      onClick={() => handleDecision(showConfirm)}
                      disabled={isPending}
                    >
                      {isPending ? 'Processing...' : 'Confirm'}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="text-center">
              <a
                href={teamData?.website || '#'}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View Team Website
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
