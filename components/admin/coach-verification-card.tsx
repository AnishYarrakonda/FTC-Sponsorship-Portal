'use client'

import { useState, useTransition } from 'react'
import { OpenSensitiveDocumentButton } from '@/components/admin/open-sensitive-document-button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ActionWarning } from '@/components/ui/action-warning'
import { verifyCoach, denyCoach, overrideTeamVerification } from '@/app/actions/admin'
import { CheckCircle, ExternalLink, XCircle, AlertTriangle, Building, MapPin, Phone, Calendar, Target, ShieldCheck, BadgeCheck } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type TeamVerificationData = {
  id: string
  ftc_team_number: number
  claimed_team_name: string
  claimed_organization: string | null
  official_team_name: string | null
  official_organization: string | null
  source: string
  confidence: number
  outcome: string
}

export type CoachData = {
  id: string
  full_name: string | null
  email: string | null
  created_at: string
  coach_verified: boolean
  coach_credentials_url: string | null
  coach_credentials_purged_at: string | null
  date_of_birth: string | null
  phone_number: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  referral_source: string | null
  coppa_acknowledged: boolean
  tos_accepted: boolean
  denial_reason: string | null
  denied_at: string | null
  pending_team_data: any | null
  signedUrl: string | null
  team: { team_name: string; ftc_team_number: number | null; city: string | null; state: string | null } | null
  verification?: TeamVerificationData | null
}

export function CoachVerificationCard({ coach }: { coach: CoachData }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [isDenyModalOpen, setIsDenyModalOpen] = useState(false)
  const [denyReason, setDenyReason] = useState('')
  const [isOverrideOpen, setIsOverrideOpen] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const [overridden, setOverridden] = useState(false)

  if (dismissed) return null

  const MIN_OVERRIDE_REASON = 20

  function handleOverride() {
    if (!coach.verification) return
    if (overrideReason.trim().length < MIN_OVERRIDE_REASON) {
      setOverrideError(`Give a reason of at least ${MIN_OVERRIDE_REASON} characters`)
      return
    }
    setOverrideError(null)
    startTransition(async () => {
      const result = await overrideTeamVerification({ recordId: coach.verification!.id, reason: overrideReason.trim() })
      if (result?.error) {
        setOverrideError(result.error)
      } else {
        setIsOverrideOpen(false)
        setOverridden(true)
      }
    })
  }

  function handleVerify(verified: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await verifyCoach(coach.id, verified)
      if (result?.error) {
        setError(result.error)
      } else {
        // P0-11: verifyCoach returns a warning when the coach WAS verified but their
        // team could not be provisioned. Dropping it left the admin thinking the coach
        // was fully set up while the coach sat on "Setting up your workspace…".
        const w = 'warning' in result ? result.warning : undefined
        setWarning(w ?? null)
        if (verified && !w) setDismissed(true)
      }
    })
  }

  function handleDeny() {
    if (!denyReason.trim()) {
      setError('Please provide a reason for denial.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await denyCoach(coach.id, denyReason)
      if (result?.error) {
        setError(result.error)
      } else {
        setIsDenyModalOpen(false)
        setDismissed(true)
      }
    })
  }

  const pd = coach.pending_team_data || {}
  const hasPendingData = !!coach.pending_team_data
  const wasDenied = !coach.coach_verified && !!coach.denied_at

  return (
    <div className="rounded-xl border bg-card p-5 flex flex-col md:flex-row md:items-start gap-5 transition-colors hover:border-accent shadow-sm">
      {/* Avatar */}
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-muted border text-sm font-semibold text-muted-foreground">
        {(coach.full_name ?? 'U').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
      </div>

      {/* Info summary */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="font-semibold text-foreground text-sm flex items-center gap-2">
          {coach.full_name ?? '(no name)'}
          {coach.coppa_acknowledged && coach.tos_accepted && (
            <span title="Policies Accepted"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /></span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{coach.email}</div>
        {coach.team ? (
          <div className="text-xs text-muted-foreground">
            {coach.team.team_name}
            {coach.team.ftc_team_number ? ` · #${coach.team.ftc_team_number}` : ''}
            {coach.team.city ? ` · ${coach.team.city}, ${coach.team.state}` : ''}
          </div>
        ) : hasPendingData ? (
          <div className="text-xs text-blue-600">
            Pending Team: {pd.teamName || 'Unknown'} {pd.ftcTeamNumber ? `(#${pd.ftcTeamNumber})` : '(Incubator)'}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">No team data</div>
        )}
        <div className="text-[10px] font-mono text-muted-foreground" suppressHydrationWarning>
          Joined {new Date(coach.created_at).toLocaleDateString()}
        </div>
        
        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {coach.coach_verified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-status-success text-[10px] font-medium px-2 py-0.5">
              <CheckCircle className="h-3 w-3" /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-amber-500/10 border border-amber-500/20 text-status-warning text-[10px] font-medium px-2 py-0.5">
              {coach.coach_credentials_url
                ? 'Credentials uploaded'
                // A purged ID is NOT the same as one that was never sent. Without this
                // branch a coach whose document we deliberately destroyed reads as
                // "No credentials", i.e. as if they had ignored the signup step.
                : coach.coach_credentials_purged_at
                  ? 'ID deleted — awaiting re-upload'
                  : 'No credentials'}
            </span>
          )}
          {coach.coach_verified && coach.coach_credentials_purged_at && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-muted border border-border text-muted-foreground text-[10px] font-medium px-2 py-0.5"
              title={`Photo ID reviewed and permanently deleted on ${new Date(coach.coach_credentials_purged_at).toLocaleDateString()}. We do not retain identity documents after verification.`}
            >
              <ShieldCheck className="h-3 w-3" /> ID deleted after review
            </span>
          )}
          {!coach.coach_verified && hasPendingData && (
             <span className="inline-flex items-center rounded-full bg-[var(--badge-pending-bg)] border border-[var(--badge-pending-text)]/25 text-[var(--badge-pending-text)] text-[10px] font-medium px-2 py-0.5">
               Data Pending Review
             </span>
          )}
          {wasDenied && (
             <span className="inline-flex items-center gap-1 rounded-full bg-[var(--badge-rejected-bg)] border border-[var(--badge-rejected-text)]/25 text-[var(--badge-rejected-text)] text-[10px] font-medium px-2 py-0.5">
               <XCircle className="h-3 w-3" /> Previously denied {new Date(coach.denied_at!).toLocaleDateString()}
             </span>
          )}
        </div>
        {wasDenied && coach.denial_reason && (
          <p className="text-xs text-red-600/90 mt-1 line-clamp-2" title={coach.denial_reason}>
            Prior denial reason: {coach.denial_reason}
          </p>
        )}
        {coach.verification && (
          <div className="mt-2 rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <BadgeCheck className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">FTC verification</span>
              <span
                className={`inline-flex items-center rounded-full text-[10px] font-medium px-2 py-0.5 border ${
                  overridden || coach.verification.outcome === 'overridden'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-status-success'
                    : coach.verification.outcome === 'auto_pass'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-status-success'
                      : coach.verification.outcome === 'needs_review'
                        ? 'bg-amber-500/10 border-amber-500/20 text-status-warning'
                        : coach.verification.outcome === 'unavailable'
                          ? 'bg-muted border-border text-muted-foreground'
                          : 'bg-red-500/10 border-red-500/20 text-red-600'
                }`}
              >
                {overridden ? 'overridden' : coach.verification.outcome.replace('_', ' ')}
              </span>
              <span className="inline-flex items-center rounded-full bg-muted border border-border text-muted-foreground text-[10px] font-medium px-2 py-0.5">
                {coach.verification.source} · {Math.round(coach.verification.confidence * 100)}%
              </span>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div>
                <dt className="text-muted-foreground">Claimed</dt>
                <dd className="text-foreground font-medium">{coach.verification.claimed_team_name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Official</dt>
                <dd className="text-foreground font-medium">{coach.verification.official_team_name ?? 'Unknown'}</dd>
              </div>
            </dl>
            {!overridden && coach.verification.outcome !== 'auto_pass' && coach.verification.outcome !== 'overridden' && (
              <Dialog open={isOverrideOpen} onOpenChange={(open) => { setIsOverrideOpen(open); if (!open) setOverrideError(null) }}>
                <DialogTrigger render={<Button size="sm" variant="outline" className="h-7 text-xs" />}>
                  Override
                </DialogTrigger>
                <DialogContent className="sm:max-w-md border-border bg-background">
                  <DialogHeader>
                    <DialogTitle>Manually verify FTC Team #{coach.verification.ftc_team_number}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm rounded-md border border-border/50 bg-muted/30 p-3">
                      <div>
                        <dt className="text-xs text-muted-foreground">Claimed</dt>
                        <dd className="text-foreground">{coach.verification.claimed_team_name}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Official</dt>
                        <dd className="text-foreground">{coach.verification.official_team_name ?? 'Unknown'}</dd>
                      </div>
                    </dl>
                    <div className="space-y-2">
                      <Label htmlFor="overrideReason" className="text-foreground">
                        Reason for override <span className="text-red-500" aria-hidden>*</span>
                      </Label>
                      <Textarea
                        id="overrideReason"
                        placeholder="e.g., Confirmed with the coach by phone — the team recently renamed with FIRST."
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        required
                        aria-required
                        className="h-24 bg-background border-input resize-none"
                      />
                      <p className={`text-xs ${overrideReason.trim().length < MIN_OVERRIDE_REASON ? 'text-muted-foreground' : 'text-status-success'}`}>
                        {overrideReason.trim().length}/{MIN_OVERRIDE_REASON} characters minimum
                      </p>
                      {overrideError && <p className="text-xs text-red-400">{overrideError}</p>}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsOverrideOpen(false)}>Cancel</Button>
                    <Button
                      onClick={handleOverride}
                      disabled={isPending || overrideReason.trim().length < MIN_OVERRIDE_REASON}
                    >
                      {isPending ? 'Saving…' : 'Confirm override'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        )}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        {warning && (
          <div className="mt-2">
            <ActionWarning>{warning}</ActionWarning>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {!coach.coach_verified && coach.coach_credentials_url ? (
          <Dialog>
            <DialogTrigger render={<Button size="sm" className="bg-primary text-primary-foreground" />}>
              Review Application
            </DialogTrigger>
            <DialogContent className="max-w-6xl w-[90vw] h-[85vh] flex flex-col p-0 overflow-hidden bg-background border-border">
              <DialogHeader className="p-6 pb-2 border-b bg-muted/50">
                <DialogTitle className="flex justify-between items-center text-xl">
                  <span>Application Review: {coach.full_name}</span>
                  <span className="text-sm font-normal text-muted-foreground bg-muted px-3 py-1 rounded-full border">
                    Joined {new Date(coach.created_at).toLocaleDateString()}
                  </span>
                </DialogTitle>
              </DialogHeader>

              <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2">
                {/* Left Side: Data Tabs */}
                <div className="overflow-y-auto border-r p-6">
                  {wasDenied && (
                    <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/5 p-4 space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-red-600 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Re-review — previously denied{' '}
                        {new Date(coach.denied_at!).toLocaleDateString()}
                      </p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">
                        {coach.denial_reason ?? 'No reason recorded.'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        The coach has since re-uploaded credentials. Check that the prior issue is resolved.
                      </p>
                    </div>
                  )}
                  <Tabs defaultValue="identity" className="w-full">
                    <TabsList className="w-full grid grid-cols-2 mb-6">
                      <TabsTrigger value="identity">Coach Identity</TabsTrigger>
                      <TabsTrigger value="team">Pending Team Data</TabsTrigger>
                    </TabsList>

                    <TabsContent value="identity" className="space-y-6 mt-0">
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Personal Details</h3>
                          <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                            <div className="sm:col-span-1">
                              <dt className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Date of Birth</dt>
                              <dd className="mt-1 text-sm text-foreground">{coach.date_of_birth || 'Not provided'}</dd>
                            </div>
                            <div className="sm:col-span-1">
                              <dt className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" /> Phone Number</dt>
                              <dd className="mt-1 text-sm text-foreground">{coach.phone_number || 'Not provided'}</dd>
                            </div>
                            <div className="sm:col-span-2">
                              <dt className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3 w-3" /> Home Address</dt>
                              <dd className="mt-1 text-sm text-foreground">
                                {coach.address_line1}<br/>
                                {coach.city}, {coach.state} {coach.zip_code}
                              </dd>
                            </div>
                          </dl>
                        </div>

                        <div className="border-t pt-4">
                          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Compliance & Referral</h3>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between p-3 rounded-md bg-muted/50 border border-border/50">
                              <span className="text-sm text-foreground">COPPA Responsibility Acknowledged</span>
                              {coach.coppa_acknowledged ? <CheckCircle className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                            </div>
                            <div className="flex items-center justify-between p-3 rounded-md bg-muted/50 border border-border/50">
                              <span className="text-sm text-foreground">Terms of Service Accepted</span>
                              {coach.tos_accepted ? <CheckCircle className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                            </div>
                            {coach.referral_source && (
                              <div className="p-3 rounded-md bg-muted/50 border border-border/50">
                                <span className="text-xs text-muted-foreground block mb-1">Referral Source</span>
                                <span className="text-sm text-foreground italic">"{coach.referral_source}"</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="team" className="space-y-6 mt-0">
                      {hasPendingData ? (
                        <div className="space-y-6">
                          <div>
                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Team Basics</h3>
                            <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 bg-muted/30 p-4 rounded-lg border border-border/50">
                              <div className="sm:col-span-1">
                                <dt className="text-xs font-medium text-muted-foreground">Status</dt>
                                <dd className="mt-1 text-sm text-foreground capitalize">{pd.status}</dd>
                              </div>
                              <div className="sm:col-span-1">
                                <dt className="text-xs font-medium text-muted-foreground">FTC Number</dt>
                                <dd className="mt-1 text-sm font-mono text-foreground">{pd.ftcTeamNumber || 'N/A'}</dd>
                              </div>
                              <div className="sm:col-span-2">
                                <dt className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Building className="h-3 w-3" /> Team Name</dt>
                                <dd className="mt-1 text-sm text-foreground font-semibold">{pd.teamName}</dd>
                              </div>
                              <div className="sm:col-span-2">
                                <dt className="text-xs font-medium text-muted-foreground">Organization</dt>
                                <dd className="mt-1 text-sm text-foreground">{pd.organization || 'None'}</dd>
                              </div>
                              <div className="sm:col-span-2">
                                <dt className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3 w-3" /> Location</dt>
                                <dd className="mt-1 text-sm text-foreground">{pd.city}, {pd.state}</dd>
                              </div>
                              <div className="sm:col-span-2">
                                <dt className="text-xs font-medium text-muted-foreground">Tax Status</dt>
                                <dd className="mt-1 text-sm text-foreground">{pd.taxStatus}</dd>
                              </div>
                            </dl>
                          </div>
                          
                          <div>
                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Financial Request</h3>
                            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-4 flex items-center justify-between">
                              <span className="text-sm font-medium text-primary flex items-center gap-2"><Target className="h-4 w-4" /> Total Ask</span>
                              <span className="text-lg font-bold text-primary">${((pd.financialAskCents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                            {pd.budgetItems && pd.budgetItems.length > 0 && (
                              <div className="space-y-2">
                                <dt className="text-xs font-medium text-muted-foreground mb-2">Budget Line Items</dt>
                                <ul className="text-sm divide-y divide-border/50 border border-border/50 rounded-md">
                                  {pd.budgetItems.map((item: any, i: number) => (
                                    <li key={i} className="flex justify-between py-2 px-3 bg-muted/20">
                                      <span className="text-foreground">{item.qty}x {item.label}</span>
                                      <span className="text-muted-foreground font-mono">${((item.totalCents || 0) / 100).toFixed(2)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          <div>
                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Narrative</h3>
                            <div className="space-y-4">
                              <div>
                                <dt className="text-xs font-medium text-muted-foreground mb-1">Mission Statement</dt>
                                <dd className="text-sm text-foreground bg-muted/40 p-3 rounded border border-border/50 italic">"{pd.missionStatement}"</dd>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground border border-dashed border-border rounded-lg">
                          <AlertTriangle className="h-8 w-8 mb-2 opacity-50" />
                          <p>No team data was submitted with this application.</p>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>

                {/* Right Side: PDF/Image Viewer */}
                <div className="bg-background flex flex-col relative group">
                  <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-background/80 to-transparent p-4 z-10 flex justify-between items-start pointer-events-none">
                    <span className="text-xs font-semibold text-foreground uppercase tracking-widest drop-shadow-md">Photo ID Document</span>
                    {/* A-06-03. Re-mints a 60s URL on click rather than reusing the
                        render-time one, so the short TTL costs nothing in usability. */}
                    <OpenSensitiveDocumentButton kind="coach_credential" subjectId={coach.id} />
                  </div>
                  {coach.signedUrl ? (
                    <iframe
                      src={coach.signedUrl}
                      className="w-full h-full bg-background"
                      title={`Credentials for ${coach.full_name}`}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      Failed to load signed URL.
                    </div>
                  )}
                </div>
              </div>

              {/* Action Bar */}
              <DialogFooter className="p-4 border-t bg-muted/80 flex items-center justify-between sm:justify-between">
                <div className="text-sm text-muted-foreground hidden sm:block">
                  Review the ID against the provided details to ensure COPPA compliance.
                  <span className="block text-xs mt-0.5">
                    Either decision permanently deletes this document — check it now, you cannot reopen it.
                  </span>
                </div>
                <div className="flex gap-3">
                  <Dialog open={isDenyModalOpen} onOpenChange={setIsDenyModalOpen}>
                    <DialogTrigger render={<Button variant="destructive" className="bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 hover:text-red-600" />}>
                      Deny Application
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md border-border bg-background">
                      <DialogHeader>
                        <DialogTitle className="text-red-500">Deny Application</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <p className="text-sm text-muted-foreground">
                          This will clear their pending team data and uploaded credentials. An email will be sent to the coach with your reason, allowing them to correct the issue and re-apply.
                        </p>
                        {wasDenied && coach.denial_reason && (
                          <div className="rounded-md border border-border bg-muted/40 p-3">
                            <p className="text-xs font-medium text-muted-foreground mb-1">
                              Previous denial ({new Date(coach.denied_at!).toLocaleDateString()})
                            </p>
                            <p className="text-sm text-foreground whitespace-pre-wrap">{coach.denial_reason}</p>
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label htmlFor="denyReason" className="text-foreground">
                            Reason for Denial <span className="text-red-500" aria-hidden>*</span>
                          </Label>
                          <Textarea
                            id="denyReason"
                            placeholder="e.g., The provided ID is expired. Please upload a valid ID."
                            value={denyReason}
                            onChange={(e) => setDenyReason(e.target.value)}
                            required
                            aria-required
                            className="h-24 bg-background border-input resize-none"
                          />
                          <p className="text-xs text-muted-foreground">
                            Required — this is emailed to the coach and shown on their status page.
                          </p>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDenyModalOpen(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={handleDeny} disabled={isPending || !denyReason.trim()}>
                          {isPending ? 'Processing...' : 'Confirm Denial & Notify Coach'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Button 
                    onClick={() => handleVerify(true)} 
                    disabled={isPending}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white min-w-[140px]"
                  >
                    {isPending ? 'Saving...' : 'Approve & Provision Team'}
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : coach.coach_verified ? (
           <Button
            size="sm"
            variant="outline"
            onClick={() => handleVerify(false)}
            disabled={isPending}
            title="Removes verified status and notifies the coach. Their photo ID was deleted after the original review, so they will have to upload a new one to be re-verified."
            className="text-muted-foreground hover:text-foreground"
          >
            {isPending ? 'Saving…' : 'Revoke Verification'}
          </Button>
        ) : (
           <Button size="sm" disabled className="bg-muted text-muted-foreground">Awaiting Upload</Button>
        )}
      </div>
    </div>
  )
}
