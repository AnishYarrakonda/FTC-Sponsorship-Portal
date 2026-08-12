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

type Member = {
  id: string
  role: 'member' | 'org_admin'
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
  membership: { id: string; role: 'member' | 'org_admin' } | null
}) {
  const isOrgAdmin = membership?.role === 'org_admin'
  const adminCount = members.filter((m) => m.role === 'org_admin' && !m.pending).length

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
                    <Badge variant={member.role === 'org_admin' ? 'default' : 'secondary'}>
                      {member.role === 'org_admin' ? 'Admin' : 'Member'}
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
    defaultValues: { email: '', role: 'member' },
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
                    <RadioGroup value={field.value} onValueChange={field.onChange} className="flex gap-4">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="member" id="role-member" />
                        <Label htmlFor="role-member">Member</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="org_admin" id="role-admin" />
                        <Label htmlFor="role-admin">Admin</Label>
                      </div>
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
}: {
  memberId: string
  role: 'member' | 'org_admin'
  isLastAdmin: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleRoleChange(newRole: 'member' | 'org_admin') {
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
        <DropdownMenuItem
          disabled={role === 'org_admin' || isPending}
          onClick={() => handleRoleChange('org_admin')}
        >
          Make admin
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={role === 'member' || isLastAdmin || isPending}
          title={isLastAdmin ? 'An organization must keep at least one admin.' : undefined}
          onClick={() => handleRoleChange('member')}
        >
          Make member
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isLastAdmin || isPending}
          title={isLastAdmin ? 'An organization must keep at least one admin.' : undefined}
          onClick={handleRemove}
          className="text-destructive focus:text-destructive"
        >
          Remove from organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
