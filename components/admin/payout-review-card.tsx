'use client'

import { useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { adminVerifyW9, adminRejectW9 } from '@/app/actions/payout'
import { CheckCircle, ExternalLink, XCircle, AlertTriangle, Building, MapPin, Target, Eye, EyeOff } from 'lucide-react'
import { getPayoutEinAction } from '@/app/actions/admin-payout' // I'll create this to wrap get_payout_ein
import { toast } from 'sonner'

export type PayoutData = {
  id: string
  team_id: string
  legal_payee_name: string
  tax_classification: string
  is_fiscally_sponsored: boolean
  fiscal_sponsor_name: string | null
  ein_last4: string | null
  fiscal_sponsor_ein_last4: string | null
  mailing_address_line1: string | null
  mailing_address_line2: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_postal_code: string | null
  remittance_email: string | null
  w9_document_path: string | null
  w9_uploaded_at: string | null
  w9_expires_at: string | null
  w9_purged_at: string | null
  w9_verified_by: string | null
  w9_verified_at: string | null
  w9_rejected_reason: string | null
  w9_rejected_at: string | null
  signedUrl: string | null
  team: { team_name: string; ftc_team_number: number | null } | null
}

export function PayoutReviewCard({ payout }: { payout: PayoutData }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [isDenyModalOpen, setIsDenyModalOpen] = useState(false)
  const [denyReason, setDenyReason] = useState('')
  
  const [revealedEin, setRevealedEin] = useState<string | null>(null)
  const [revealedFiscalEin, setRevealedFiscalEin] = useState<string | null>(null)

  if (dismissed) return null

  function handleVerify() {
    setError(null)
    startTransition(async () => {
      const result = await adminVerifyW9(payout.team_id)
      if (result?.error) {
        setError(result.error)
      } else {
        setDismissed(true)
        toast.success("W-9 verified successfully.")
      }
    })
  }

  function handleDeny() {
    if (!denyReason.trim() || denyReason.trim().length < 10) {
      setError('Please provide a reason for denial (min 10 chars).')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await adminRejectW9(payout.team_id, denyReason)
      if (result?.error) {
        setError(result.error)
      } else {
        setIsDenyModalOpen(false)
        setDismissed(true)
        toast.success("W-9 rejected.")
      }
    })
  }

  async function handleRevealEin(target: 'payee' | 'fiscal_sponsor') {
    const result = await getPayoutEinAction(payout.team_id, target)
    if (result.error) {
      toast.error(result.error)
    } else if (result.ein) {
      if (target === 'payee') setRevealedEin(result.ein)
      else setRevealedFiscalEin(result.ein)
    }
  }

  const wasDenied = !payout.w9_verified_at && !!payout.w9_rejected_at

  return (
    <div className="rounded-xl border bg-card p-5 flex flex-col md:flex-row md:items-start gap-5 transition-colors hover:border-accent shadow-sm">
      {/* Avatar */}
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-muted border text-sm font-semibold text-muted-foreground">
        {(payout.team?.team_name ?? 'U').substring(0, 2).toUpperCase()}
      </div>

      {/* Info summary */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="font-semibold text-foreground text-sm flex items-center gap-2">
          {payout.team?.team_name ?? '(no team)'}
          {payout.team?.ftc_team_number ? ` (#${payout.team.ftc_team_number})` : ''}
        </div>
        <div className="text-xs text-muted-foreground">
          Payee: {payout.legal_payee_name} ({payout.tax_classification.replace('_', ' ')})
        </div>
        <div className="text-[10px] font-mono text-muted-foreground" suppressHydrationWarning>
          W-9 Uploaded {payout.w9_uploaded_at ? new Date(payout.w9_uploaded_at).toLocaleDateString() : 'Never'}
        </div>
        
        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {payout.w9_verified_at ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-status-success text-[10px] font-medium px-2 py-0.5">
              <CheckCircle className="h-3 w-3" /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-amber-500/10 border border-amber-500/20 text-status-warning text-[10px] font-medium px-2 py-0.5">
              {payout.w9_document_path
                ? 'W-9 uploaded'
                : 'No W-9'}
            </span>
          )}
          {wasDenied && (
             <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-600 text-[10px] font-medium px-2 py-0.5">
               <XCircle className="h-3 w-3" /> Previously rejected {new Date(payout.w9_rejected_at!).toLocaleDateString()}
             </span>
          )}
        </div>
        {wasDenied && payout.w9_rejected_reason && (
          <p className="text-xs text-red-600/90 mt-1 line-clamp-2" title={payout.w9_rejected_reason}>
            Reason: {payout.w9_rejected_reason}
          </p>
        )}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {!payout.w9_verified_at && payout.w9_document_path ? (
          <Dialog>
            <DialogTrigger render={<Button size="sm" className="bg-primary text-primary-foreground" />}>
              Review W-9
            </DialogTrigger>
            <DialogContent className="max-w-6xl w-[90vw] h-[85vh] flex flex-col p-0 overflow-hidden bg-background border-border">
              <DialogHeader className="p-6 pb-2 border-b bg-muted/50">
                <DialogTitle className="flex justify-between items-center text-xl">
                  <span>W-9 Review: {payout.team?.team_name}</span>
                </DialogTitle>
              </DialogHeader>

              <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2">
                {/* Left Side: Data */}
                <div className="overflow-y-auto border-r p-6">
                  {wasDenied && (
                    <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/5 p-4 space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-red-600 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Re-review — previously rejected
                      </p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">
                        {payout.w9_rejected_reason}
                      </p>
                    </div>
                  )}
                  
                  <div className="space-y-6 mt-0">
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Payee Details</h3>
                      <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 bg-muted/30 p-4 rounded-lg border border-border/50">
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-muted-foreground">Legal Payee Name</dt>
                          <dd className="mt-1 text-sm font-semibold text-foreground">{payout.legal_payee_name}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-muted-foreground">Tax Classification</dt>
                          <dd className="mt-1 text-sm text-foreground">{payout.tax_classification.replace('_', ' ')}</dd>
                        </div>
                        <div className="sm:col-span-2 flex items-center justify-between">
                          <div>
                            <dt className="text-xs font-medium text-muted-foreground">EIN</dt>
                            <dd className="mt-1 text-sm font-mono text-foreground">
                              {revealedEin ? revealedEin : `•••••-••${payout.ein_last4 || '????'}`}
                            </dd>
                          </div>
                          {!revealedEin && payout.ein_last4 && (
                            <Button variant="outline" size="sm" onClick={() => handleRevealEin('payee')}>
                              <Eye className="w-4 h-4 mr-2" /> Reveal
                            </Button>
                          )}
                        </div>
                        
                        {payout.is_fiscally_sponsored && (
                          <>
                            <div className="sm:col-span-2 border-t pt-4">
                              <dt className="text-xs font-medium text-muted-foreground">Fiscal Sponsor Name</dt>
                              <dd className="mt-1 text-sm text-foreground">{payout.fiscal_sponsor_name}</dd>
                            </div>
                            <div className="sm:col-span-2 flex items-center justify-between">
                              <div>
                                <dt className="text-xs font-medium text-muted-foreground">Fiscal Sponsor EIN</dt>
                                <dd className="mt-1 text-sm font-mono text-foreground">
                                  {revealedFiscalEin ? revealedFiscalEin : `•••••-••${payout.fiscal_sponsor_ein_last4 || '????'}`}
                                </dd>
                              </div>
                              {!revealedFiscalEin && payout.fiscal_sponsor_ein_last4 && (
                                <Button variant="outline" size="sm" onClick={() => handleRevealEin('fiscal_sponsor')}>
                                  <Eye className="w-4 h-4 mr-2" /> Reveal
                                </Button>
                              )}
                            </div>
                          </>
                        )}
                        
                        <div className="sm:col-span-2 border-t pt-4">
                          <dt className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3 w-3" /> Mailing Address</dt>
                          <dd className="mt-1 text-sm text-foreground">
                            {payout.mailing_address_line1}<br/>
                            {payout.mailing_address_line2 && <>{payout.mailing_address_line2}<br/></>}
                            {payout.mailing_city}, {payout.mailing_state} {payout.mailing_postal_code}
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-medium text-muted-foreground">Remittance Email</dt>
                          <dd className="mt-1 text-sm text-foreground">{payout.remittance_email || 'Not provided'}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>

                {/* Right Side: PDF Viewer */}
                <div className="bg-background flex flex-col relative group">
                  <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-background/80 to-transparent p-4 z-10 flex justify-between items-start pointer-events-none">
                    <span className="text-xs font-semibold text-foreground uppercase tracking-widest drop-shadow-md">W-9 Document</span>
                    <a href={payout.signedUrl!} target="_blank" rel="noreferrer" className="pointer-events-auto bg-background/80 hover:bg-accent text-foreground text-xs px-3 py-1.5 rounded-full backdrop-blur flex items-center gap-1.5 transition-colors border border-border/50">
                      Open Externally <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {payout.signedUrl ? (
                    <iframe
                      src={payout.signedUrl}
                      className="w-full h-full bg-background"
                      title={`W-9 for ${payout.legal_payee_name}`}
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
                  Review the W-9 against the provided details.
                  <span className="block text-xs mt-0.5">
                    Approval allows sponsors to see that a W-9 is on file and payable. Rejection notifies the coach to re-upload.
                  </span>
                </div>
                <div className="flex gap-3">
                  <Dialog open={isDenyModalOpen} onOpenChange={setIsDenyModalOpen}>
                    <DialogTrigger render={<Button variant="destructive" className="bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 hover:text-red-600" />}>
                      Reject W-9
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md border-border bg-background">
                      <DialogHeader>
                        <DialogTitle className="text-red-500">Reject W-9</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <p className="text-sm text-muted-foreground">
                          An in-app notification will be sent to the coach with your reason, allowing them to correct the issue and re-upload.
                        </p>
                        <div className="space-y-2">
                          <Label htmlFor="denyReason" className="text-foreground">
                            Reason for Rejection <span className="text-red-500" aria-hidden>*</span>
                          </Label>
                          <Textarea
                            id="denyReason"
                            placeholder="e.g., The form is unsigned, or the EIN does not match."
                            value={denyReason}
                            onChange={(e) => setDenyReason(e.target.value)}
                            required
                            aria-required
                            className="h-24 bg-background border-input resize-none"
                          />
                          <p className="text-xs text-muted-foreground">
                            Required (min 10 chars) — this is emailed to the coach.
                          </p>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDenyModalOpen(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={handleDeny} disabled={isPending || denyReason.trim().length < 10}>
                          {isPending ? 'Processing...' : 'Confirm Rejection'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Button 
                    onClick={handleVerify} 
                    disabled={isPending}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white min-w-[140px]"
                  >
                    {isPending ? 'Saving...' : 'Approve W-9'}
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : payout.w9_verified_at ? (
           <Button size="sm" disabled className="bg-muted text-muted-foreground">Verified</Button>
        ) : (
           <Button size="sm" disabled className="bg-muted text-muted-foreground">Awaiting Upload</Button>
        )}
      </div>
    </div>
  )
}
