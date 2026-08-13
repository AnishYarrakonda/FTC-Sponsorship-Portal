'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { sponsorSchema, type SponsorInput } from '@/lib/schemas/sponsor'
import { adminUpdateSponsor, adminCreateSponsor } from '@/app/actions/sponsor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Sponsor } from '@/lib/supabase/types'
import { describeActionError } from '@/lib/client-errors'

type Props = {
  /**
   * False for a reviewer (0084). The funding cap is a super-admin write; disabling the
   * input only saves a pointless round trip — adminUpdateSponsor / adminCreateSponsor are
   * the real gate and reject a reviewer outright.
   */
  canEditFundingCap?: boolean
  initialSponsor?: Pick<
    Sponsor,
    'id' | 'company_name' | 'industry' | 'website' | 'contact_name' | 'contact_email' | 'contact_title' | 'funding_cap_cents' | 'status' | 'notes'
  >
}

export function SponsorForm({ initialSponsor, canEditFundingCap = true }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  const form = useForm<SponsorInput>({
    resolver: zodResolver(sponsorSchema),
    defaultValues: {
      companyName: initialSponsor?.company_name ?? '',
      industry: initialSponsor?.industry ?? '',
      website: initialSponsor?.website ?? '',
      contactName: initialSponsor?.contact_name ?? '',
      contactEmail: initialSponsor?.contact_email ?? '',
      contactTitle: initialSponsor?.contact_title ?? '',
      fundingCapCents: initialSponsor?.funding_cap_cents ?? 0,
      status: initialSponsor?.status ?? 'pending_review',
      notes: initialSponsor?.notes ?? '',
      website2: '',
    },
  })

  async function onSubmit(values: SponsorInput) {
    setIsPending(true)
    setError(null)
    try {
      const result = initialSponsor
        ? await adminUpdateSponsor(initialSponsor.id, values)
        : await adminCreateSponsor(values)
      if (result?.error) {
        setError(result.error)
        setIsPending(false)
        return
      }
      router.push('/sponsors')
    } catch (e) {
      setError(describeActionError(e, 'adminSaveSponsor'))
      setIsPending(false)
    }
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>{initialSponsor ? 'Edit Sponsor' : 'Add Sponsor'}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Honeypot — visually hidden, never shown to real users. Bots that
                autofill every field trip it and the server silently no-ops. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
              <label htmlFor="website2">Website (leave this field empty)</label>
              <input
                id="website2"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                {...form.register('website2')}
              />
            </div>

            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., TechCorp Inc." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="industry"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Industry</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Technology, Manufacturing" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="website"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Website</FormLabel>
                  <FormControl>
                    <Input placeholder="https://example.com" type="text" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contactTitle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Title</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., VP of Community" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="contactEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact Email *</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="john@techcorp.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="fundingCapCents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Annual Funding Cap (USD)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="100"
                      placeholder="50000"
                      disabled={!canEditFundingCap}
                      aria-describedby={canEditFundingCap ? undefined : 'funding-cap-help'}
                      value={field.value / 100}
                      onChange={(e) => field.onChange(Math.round(parseFloat(e.target.value) * 100))}
                    />
                  </FormControl>
                  {!canEditFundingCap && (
                    <p id="funding-cap-help" className="text-sm text-muted-foreground">
                      Only a super admin can change a funding cap.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status *</FormLabel>
                  <FormControl>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className="w-full justify-between font-normal">
                            {field.value === 'pending_review' ? 'Pending Review' : 
                             field.value === 'active' ? 'Active' : 
                             field.value === 'inactive' ? 'Inactive' : 'Select status'}
                            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-full min-w-[200px]">
                        <DropdownMenuItem onClick={() => field.onChange('pending_review')}>
                          Pending Review
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => field.onChange('active')}>
                          Active
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => field.onChange('inactive')}>
                          Inactive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Admin Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Internal notes about this sponsor..."
                      className="min-h-[80px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-3 pt-4 border-t">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving...' : 'Save Sponsor'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push('/sponsors')}>
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
