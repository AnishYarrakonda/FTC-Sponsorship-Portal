'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { payoutProfileSchema, type PayoutProfileInput } from '@/lib/schemas/payout'
import { savePayoutProfile } from '@/app/actions/payout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Alert, AlertDescription } from '@/components/ui/alert'

import { Checkbox } from '@/components/ui/checkbox'
import { describeActionError } from '@/lib/client-errors'
import { ShieldAlert } from 'lucide-react'

type Props = {
  teamId: string
  initialData?: any
}

export function PayoutProfileForm({ teamId, initialData }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [replaceEin, setReplaceEin] = useState(!initialData?.ein_ciphertext)
  const [replaceFiscalEin, setReplaceFiscalEin] = useState(!initialData?.fiscal_sponsor_ein_ciphertext)

  const form = useForm<PayoutProfileInput>({
    resolver: zodResolver(payoutProfileSchema),
    defaultValues: {
      legalPayeeName: initialData?.legal_payee_name ?? '',
      taxClassification: initialData?.tax_classification ?? '501c3_org',
      ein: '', // Always empty initially to prevent leaking
      isFiscallySponsored: initialData?.is_fiscally_sponsored ?? false,
      fiscalSponsorName: initialData?.fiscal_sponsor_name ?? '',
      fiscalSponsorEin: '', // Always empty initially
      mailingAddressLine1: initialData?.mailing_address_line1 ?? '',
      mailingAddressLine2: initialData?.mailing_address_line2 ?? '',
      mailingCity: initialData?.mailing_city ?? '',
      mailingState: initialData?.mailing_state ?? '',
      mailingPostalCode: initialData?.mailing_postal_code ?? '',
      remittanceEmail: initialData?.remittance_email ?? '',
    },
  })

  const isFiscallySponsored = form.watch('isFiscallySponsored')

  async function onSubmit(values: PayoutProfileInput) {
    setIsPending(true)
    setError(null)
    
    // Only send EINs if they were replaced/newly entered
    const payload = { ...values }
    if (!replaceEin) delete payload.ein
    if (!replaceFiscalEin) delete payload.fiscalSponsorEin
    
    try {
      const result = await savePayoutProfile(teamId, payload)
      if (result?.error) {
        setError(result.error)
        setIsPending(false)
        return
      }
      router.push('/dashboard?tab=portfolio')
      router.refresh()
    } catch (e) {
      setError(describeActionError(e, 'savePayoutProfile'))
      setIsPending(false)
    }
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Payout & Tax Details</CardTitle>
        <CardDescription>
          Sponsors release funds to a named payee. Add your details to get paid.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {initialData?.w9_verified_at && (
          <Alert className="mb-6 border-amber-500/20 bg-amber-500/10 text-amber-600">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription className="text-xs ml-2">
              Your W-9 is verified. Changing the legal payee name, tax classification, or EIN will require re-verification.
            </AlertDescription>
          </Alert>
        )}
      
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Payee Identity</h3>
              
              <FormField
                control={form.control}
                name="legalPayeeName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Legal Payee Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Anytown High School Robotics Booster Club" {...field} />
                    </FormControl>
                    <p className="text-[10px] text-muted-foreground">This is the exact name that will appear on a check. Must match your W-9. (No student names allowed.)</p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="taxClassification"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tax Classification *</FormLabel>
                      <FormControl>
                        <select
                          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          {...field}
                        >
                          <option value="" disabled>Select a tax classification</option>
                          <option value="501c3_org">501(c)(3) Organization</option>
                          <option value="school_district">School District / Public School</option>
                          <option value="fiscal_sponsor">Using a Fiscal Sponsor</option>
                          <option value="other_nonprofit">Other Non-Profit (e.g. 4H, Scouts)</option>
                          <option value="unincorporated">Unincorporated Team (Limited Payouts)</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!replaceEin && initialData?.ein_last4 ? (
                  <FormItem>
                    <FormLabel>EIN</FormLabel>
                    <div className="flex items-center gap-2">
                      <Input disabled value={`•••••-••${initialData.ein_last4}`} className="font-mono bg-muted" />
                      <Button type="button" variant="outline" size="sm" onClick={() => setReplaceEin(true)}>
                        Replace
                      </Button>
                    </div>
                  </FormItem>
                ) : (
                  <FormField
                    control={form.control}
                    name="ein"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Employer Identification Number (EIN)</FormLabel>
                        <FormControl>
                          <Input placeholder="12-3456789" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </div>

            <div className="space-y-4 border-t pt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Fiscal Sponsorship</h3>
              
              <FormField
                control={form.control}
                name="isFiscallySponsored"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>We use a Fiscal Sponsor</FormLabel>
                      <p className="text-[10px] text-muted-foreground">Check this if funds are received by a separate organization on your team's behalf.</p>
                    </div>
                  </FormItem>
                )}
              />

              {isFiscallySponsored && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/20 p-4 rounded-lg border">
                  <FormField
                    control={form.control}
                    name="fiscalSponsorName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fiscal Sponsor Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., FIRST Robotics Foundation" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {!replaceFiscalEin && initialData?.fiscal_sponsor_ein_last4 ? (
                    <FormItem>
                      <FormLabel>Fiscal Sponsor EIN</FormLabel>
                      <div className="flex items-center gap-2">
                        <Input disabled value={`•••••-••${initialData.fiscal_sponsor_ein_last4}`} className="font-mono bg-muted" />
                        <Button type="button" variant="outline" size="sm" onClick={() => setReplaceFiscalEin(true)}>
                          Replace
                        </Button>
                      </div>
                    </FormItem>
                  ) : (
                    <FormField
                      control={form.control}
                      name="fiscalSponsorEin"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Fiscal Sponsor EIN</FormLabel>
                          <FormControl>
                            <Input placeholder="12-3456789" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4 border-t pt-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Mailing & Remittance</h3>
              
              <FormField
                control={form.control}
                name="mailingAddressLine1"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mailing Address Line 1</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Main St" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="mailingAddressLine2"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mailing Address Line 2</FormLabel>
                    <FormControl>
                      <Input placeholder="Apt 4B (optional)" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-6 gap-4">
                <div className="col-span-6 md:col-span-3">
                  <FormField
                    control={form.control}
                    name="mailingCity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input placeholder="Anytown" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="col-span-3 md:col-span-1">
                  <FormField
                    control={form.control}
                    name="mailingState"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl>
                          <Input placeholder="TX" maxLength={2} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="col-span-3 md:col-span-2">
                  <FormField
                    control={form.control}
                    name="mailingPostalCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ZIP Code</FormLabel>
                        <FormControl>
                          <Input placeholder="12345" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <FormField
                control={form.control}
                name="remittanceEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Remittance Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="ap@example.com (optional)" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving...' : 'Save Payout Profile'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push('/dashboard?tab=portfolio')}>
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
