'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { MoreHorizontal, UserPlus, Users } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/empty-state'
import {
  inviteSponsorMember,
  updateSponsorMemberRole,
  removeSponsorMember,
} from '@/app/actions/sponsor-members'
import { inviteSponsorMemberSchema, type InviteSponsorMemberInput } from '@/lib/schemas/sponsor-members'
import { SPONSOR_ROLES, SPONSOR_ROLE_LABELS, type SponsorRole } from '@/lib/sponsor-roles'

type Member = {
  id: string
  role: SponsorRole
  joinedAt: string | null
  invitedAt: string | null
  pending: boolean
  profileId: string | null
  fullName: string | null
  email: string | null
}

export function MembersPanel({
  members,
  membership,
}: {
  members: Member[]
  membership: { id: string; role: SponsorRole } | null
}) {
  const isOrgAdmin = membership?.role === 'org_admin'
  const adminCount = members.filter((m) => m.role === 'org_admin' && !m.pending).length
  const eligibleApproverCount = members.filter((m) => (m.role === 'approver' || m.role === 'org_admin') && !m.pending).length

  return (
    <div className="space-y-4">
      {!isOrgAdmin && (
        <Alert>
          <AlertDescription>
            You can view your organization&apos;s roster, but only an admin can invite, change roles, or remove
            teammates.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        {isOrgAdmin && <InviteDialog />}
      </div>

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="You are the only member of your organization."
          description="Invite a teammate to share this inbox."
        />
      ) : (
        <div className="rounded-xl border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                {isOrgAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>{member.fullName ?? '—'}</TableCell>
                  <TableCell>{member.email ?? '—'}</TableCell>
                  <TableCell>
                    <Badge
                      variant={member.role === 'org_admin' ? 'default' : member.role === 'approver' ? 'secondary' : 'outline'}
                      title={SPONSOR_ROLE_LABELS[member.role]?.hint}
                    >
                      {SPONSOR_ROLE_LABELS[member.role]?.label ?? member.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {member.pending ? (
                      <Badge variant="outline">Invited</Badge>
                    ) : member.joinedAt ? (
                      new Date(member.joinedAt).toLocaleDateString()
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  {isOrgAdmin && (
                    <TableCell className="text-right">
                      {!member.pending && member.profileId && (
                        <MemberRowActions
                          memberId={member.id}
                          role={member.role}
                          isLastAdmin={member.role === 'org_admin' && adminCount <= 1}
                          isLastEligibleApprover={
                            (member.role === 'approver' || member.role === 'org_admin') && eligibleApproverCount <= 2
                          }
                        />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function InviteDialog() {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const form = useForm<InviteSponsorMemberInput>({
    resolver: zodResolver(inviteSponsorMemberSchema),
    defaultValues: { email: '', role: 'viewer' },
  })

  function onSubmit(values: InviteSponsorMemberInput) {
    setError(null)
    startTransition(async () => {
      const res = await inviteSponsorMember(values)
      if (res.error) {
        setError(res.error)
      } else {
        toast.success('Invitation sent')
        setOpen(false)
        form.reset()
        router.refresh()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite teammate
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They&apos;ll receive an email from Clerk to join your organization and see the same pitches, funding
            page, and inbox as you.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="teammate@company.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <FormControl>
                    <RadioGroup value={field.value} onValueChange={field.onChange} className="grid grid-cols-2 gap-3">
                      {SPONSOR_ROLES.map((role) => (
                        <div key={role} className="flex items-start space-x-2">
                          <RadioGroupItem value={role} id={`role-${role}`} className="mt-0.5" />
                          <div>
                            <Label htmlFor={`role-${role}`}>{SPONSOR_ROLE_LABELS[role].label}</Label>
                            <p className="text-xs text-muted-foreground">{SPONSOR_ROLE_LABELS[role].hint}</p>
                          </div>
                        </div>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Sending…' : 'Send invitation'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function MemberRowActions({
  memberId,
  role,
  isLastAdmin,
  isLastEligibleApprover,
}: {
  memberId: string
  role: SponsorRole
  isLastAdmin: boolean
  isLastEligibleApprover: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const blockedByApprovalFloor = isLastEligibleApprover && role !== 'org_admin'
  const approvalFloorTitle = 'Approvals are on for this organization — keep at least two Approvers, or turn approvals off first.'

  function handleRoleChange(newRole: SponsorRole) {
    startTransition(async () => {
      const res = await updateSponsorMemberRole({ memberId, role: newRole })
      if (res.error) toast.error(res.error)
      else {
        toast.success('Role updated')
        router.refresh()
      }
    })
  }

  function handleRemove() {
    startTransition(async () => {
      const res = await removeSponsorMember({ memberId })
      if (res.error) toast.error(res.error)
      else {
        toast.success('Member removed')
        router.refresh()
      }
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={isPending}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SPONSOR_ROLES.map((candidateRole) => {
          const demotingLastAdmin = role === 'org_admin' && candidateRole !== 'org_admin' && isLastAdmin
          const demotingLastApprover =
            (role === 'approver' || role === 'org_admin') &&
            candidateRole !== 'approver' &&
            candidateRole !== 'org_admin' &&
            blockedByApprovalFloor
          const disabled = candidateRole === role || demotingLastAdmin || demotingLastApprover || isPending
          return (
            <DropdownMenuItem
              key={candidateRole}
              disabled={disabled}
              title={demotingLastAdmin ? 'An organization must keep at least one admin.' : demotingLastApprover ? approvalFloorTitle : undefined}
              onClick={() => handleRoleChange(candidateRole)}
            >
              Make {SPONSOR_ROLE_LABELS[candidateRole].label.toLowerCase()}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuItem
          disabled={isLastAdmin || blockedByApprovalFloor || isPending}
          title={isLastAdmin ? 'An organization must keep at least one admin.' : blockedByApprovalFloor ? approvalFloorTitle : undefined}
          onClick={handleRemove}
          className="text-destructive focus:text-destructive"
        >
          Remove from organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
