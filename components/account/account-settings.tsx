'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { ReadOnlyField } from '@/components/ui/read-only-field'
import { cn } from '@/lib/utils'
import { updateProfile, updatePassword, changeEmail, deleteAccount, requestDataExport } from '@/app/actions/account'
import { CheckCircle2, AlertCircle, Download, Trash2 } from 'lucide-react'

function SectionCard({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function StatusMessage({ type, text }: { type: 'success' | 'error'; text: string }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-md px-3 py-2.5 text-sm',
      type === 'success' ? 'bg-emerald-500/10 text-status-success dark:text-emerald-400' : 'bg-destructive/10 text-destructive-text'
    )}>
      {type === 'success'
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
        : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />}
      <span>{text}</span>
    </div>
  )
}

export function AccountSettings({
  currentName,
  email,
  role,
  pendingEmail = null,
}: {
  currentName: string
  email: string
  role: string
  /** Email registered in Clerk but not yet verified (pending change), if any. */
  pendingEmail?: string | null
}) {
  // Profile
  const [fullName, setFullName] = useState(currentName)
  const [nameMsg, setNameMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Password
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Email change
  const [newEmail, setNewEmail] = useState('')
  const [emailPw, setEmailPw] = useState('')
  const [emailMsg, setEmailMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [pendingEmailState, setPendingEmailState] = useState<string | null>(pendingEmail)

  // Data export
  const [exportMsg, setExportMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Delete account
  const [confirmEmail, setConfirmEmail] = useState('')
  const [deletePw, setDeletePw] = useState('')
  const [deleteMsg, setDeleteMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // B-03-16
  const [commitmentWarning, setCommitmentWarning] = useState<string | null>(null)
  const [commitmentsAcknowledged, setCommitmentsAcknowledged] = useState(false)

  // Per-section transitions so one submitting section doesn't put every other
  // button into a loading state.
  const [nameSaving, startNameTransition] = useTransition()
  const [pwSaving, startPwTransition] = useTransition()
  const [emailSaving, startEmailTransition] = useTransition()
  const [exporting, startExportTransition] = useTransition()
  const [deleting, startDeleteTransition] = useTransition()

  function handleProfileSave() {
    setNameMsg(null)
    startNameTransition(async () => {
      const res = await updateProfile({ fullName })
      if (res?.error) setNameMsg({ type: 'error', text: res.error })
      else setNameMsg({ type: 'success', text: 'Display name updated.' })
    })
  }

  function handlePasswordSave() {
    setPwMsg(null)
    startPwTransition(async () => {
      const res = await updatePassword({ newPassword: newPw, currentPassword: currentPw })
      if (res?.error) setPwMsg({ type: 'error', text: res.error })
      else {
        setPwMsg({ type: 'success', text: 'Password updated successfully.' })
        setCurrentPw('')
        setNewPw('')
      }
    })
  }

  function handleEmailChange() {
    setEmailMsg(null)
    startEmailTransition(async () => {
      const res = await changeEmail({ newEmail, currentPassword: emailPw })
      if (res?.error) setEmailMsg({ type: 'error', text: res.error })
      else {
        setEmailMsg(null)
        setPendingEmailState(newEmail)
        setNewEmail('')
        setEmailPw('')
      }
    })
  }

  function handleExport() {
    setExportMsg(null)
    startExportTransition(async () => {
      const res = await requestDataExport()
      if (res?.error) setExportMsg({ type: 'error', text: res.error })
      else setExportMsg({ type: 'success', text: res.message ?? 'Export queued.' })
    })
  }

  /**
   * B-03-16. The first call discovers live sponsorship commitments and comes back with
   * `requiresCommitmentAcknowledgement`. Nothing is deleted on that pass — the coach is
   * shown what their departure orphans and must tick the acknowledgement before a second
   * call proceeds, which then notifies the sponsors involved.
   */
  function handleDelete() {
    setDeleteMsg(null)
    startDeleteTransition(async () => {
      const res = await deleteAccount({
        confirmEmail,
        currentPassword: deletePw,
        acknowledgeCommitments: commitmentsAcknowledged,
      })
      if (res && 'requiresCommitmentAcknowledgement' in res && res.requiresCommitmentAcknowledgement) {
        setCommitmentWarning(res.error ?? 'Your team has sponsorship commitments still in progress.')
        setDeleteMsg(null)
        return
      }
      if (res?.error) setDeleteMsg({ type: 'error', text: res.error })
    })
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">

      {/* Profile */}
      <SectionCard title="Profile" sub="Your public display name shown to sponsors and teammates.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              value={fullName}
              maxLength={100}
              onChange={e => setFullName(e.target.value)}
            />
          </div>
          {/* B-04-07. Were unlabelled `<input disabled>` elements — no id, no htmlFor, no
              aria-label — while fullName beside them was labelled correctly. */}
          <ReadOnlyField
            label="Email address"
            value={email}
            hint="Change your email in the section below."
          />
          <ReadOnlyField label="Role" value={role} valueClassName="capitalize" />
          {nameMsg && <StatusMessage type={nameMsg.type} text={nameMsg.text} />}
          <Button onClick={handleProfileSave} disabled={nameSaving} loading={nameSaving} className="self-start">
            Save profile
          </Button>
        </div>
      </SectionCard>

      {/* Change email */}
      <SectionCard title="Change Email" sub="You'll receive a confirmation link at your new address before the change takes effect.">
        <div className="flex flex-col gap-4">
          {pendingEmailState && (
            <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
              <span>
                Verification sent to <span className="font-medium">{pendingEmailState}</span> — it becomes your
                active email once confirmed. Until then, keep signing in with{' '}
                <span className="font-medium">{email}</span>.
              </span>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newEmail">New email address</Label>
            <Input
              id="newEmail"
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="new@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emailPw">Current password</Label>
            <Input
              id="emailPw"
              type="password"
              value={emailPw}
              onChange={e => setEmailPw(e.target.value)}
              placeholder="Confirm with your current password"
            />
          </div>
          {emailMsg && <StatusMessage type={emailMsg.type} text={emailMsg.text} />}
          <Button
            onClick={handleEmailChange}
            disabled={emailSaving || !newEmail || !emailPw}
            loading={emailSaving}
            className="self-start"
          >
            {emailSaving ? 'Sending…' : 'Send confirmation'}
          </Button>
        </div>
      </SectionCard>

      {/* Change password */}
      <SectionCard
        title="Change Password"
        sub="Minimum 12 characters with uppercase, lowercase, and a number."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currentPw">Current password</Label>
            <Input
              id="currentPw"
              type="password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              placeholder="Enter current password"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newPw">New password</Label>
            <Input
              id="newPw"
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              placeholder="Enter new password"
            />
          </div>
          {pwMsg && <StatusMessage type={pwMsg.type} text={pwMsg.text} />}
          <Button
            onClick={handlePasswordSave}
            disabled={pwSaving || !currentPw || newPw.length < 12}
            loading={pwSaving}
            className="self-start"
          >
            {pwSaving ? 'Updating…' : 'Update password'}
          </Button>
        </div>
      </SectionCard>

      {/* Data export */}
      <SectionCard
        title="Export Your Data"
        sub="Download a copy of your profile, teams, submissions, and notifications."
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Your export will be prepared and emailed to{' '}
            <span className="font-medium text-foreground">{email}</span> within 24 hours.
          </p>
          {exportMsg && <StatusMessage type={exportMsg.type} text={exportMsg.text} />}
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exporting}
            loading={exporting}
            className="self-start gap-2"
          >
            <Download className="h-4 w-4" strokeWidth={1.5} />
            Request data export
          </Button>
        </div>
      </SectionCard>

      {/* Delete account */}
      <SectionCard
        title="Delete Account"
        sub="Permanently removes your account and all associated data. This cannot be undone."
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            To confirm, type your email address:{' '}
            <span className="font-medium text-foreground">{email}</span>
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmEmail">Confirm email</Label>
            <Input
              id="confirmEmail"
              value={confirmEmail}
              onChange={e => setConfirmEmail(e.target.value)}
              placeholder={email}
              className={cn(confirmEmail && confirmEmail !== email && 'border-destructive focus-visible:ring-destructive/40')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deletePw">Current password</Label>
            <Input
              id="deletePw"
              type="password"
              value={deletePw}
              onChange={e => setDeletePw(e.target.value)}
              placeholder="Enter your current password"
            />
          </div>
          {/* B-03-16. Live sponsorship commitments this deletion will orphan. */}
          {commitmentWarning && (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
            >
              <p className="text-foreground">{commitmentWarning}</p>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="acknowledge-commitments"
                  checked={commitmentsAcknowledged}
                  onCheckedChange={(v) => setCommitmentsAcknowledged(v === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="acknowledge-commitments" className="text-sm font-normal leading-snug">
                  I understand, and I still want to delete my account.
                </Label>
              </div>
            </div>
          )}
          {deleteMsg && <StatusMessage type={deleteMsg.type} text={deleteMsg.text} />}
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={
              deleting ||
              confirmEmail !== email ||
              !deletePw ||
              (!!commitmentWarning && !commitmentsAcknowledged)
            }
            loading={deleting}
            className="self-start gap-2"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
            Permanently delete account
          </Button>
        </div>
      </SectionCard>

    </div>
  )
}
