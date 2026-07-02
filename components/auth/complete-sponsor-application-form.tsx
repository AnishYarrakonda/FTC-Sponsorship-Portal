'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { sponsorSignupSchema, type SponsorSignupInput } from '@/lib/schemas/sponsor-signup'
import { createSponsorApplication } from '@/app/actions/auth'
import { useClerk } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ChevronDown, CheckCircle2, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const INDUSTRIES = ['Technology', 'Manufacturing', 'Finance', 'Education', 'Healthcare', 'Energy', 'Retail', 'Other']
const FUNDING_FREQUENCIES = ['One-time', 'Quarterly', 'Annual'] as const
const FOCUS_AREAS = ['Engineering', 'Programming', 'Business/Marketing', 'Diversity & Inclusion', 'Community Outreach', 'General Support']

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="pt-2 border-t border-border/60 first:pt-0 first:border-t-0">
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h2>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

/**
 * The account already exists in Clerk, so the schema's password fields are
 * never used server-side (Clerk owns the credential). Generate a throwaway
 * value that satisfies the shared `sponsorSignupSchema` password rules.
 * Also used by the sponsor wizard when it resumes an already-authed session.
 */
export function schemaPlaceholderPassword(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return `Clerk1${rand}`
}

/**
 * Orphan-recovery form for SPONSORS: the Clerk account exists (email already
 * verified) but the `profiles` row was never provisioned. Re-collects the
 * company + sponsorship data from the sponsor wizard's steps 2–3 and calls
 * `createSponsorApplication` (idempotent: profile upsert on clerk_user_id,
 * no duplicate pending applications).
 */
export function CompleteSponsorApplicationForm({ email, defaultName }: { email: string; defaultName: string }) {
  const router = useRouter()
  const { signOut } = useClerk()
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [placeholderPassword] = useState(schemaPlaceholderPassword)

  const form = useForm<SponsorSignupInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(sponsorSignupSchema) as any,
    defaultValues: {
      fullName: defaultName,
      email,
      password: placeholderPassword,
      confirmPassword: placeholderPassword,
      companyName: '',
      industry: '',
      website: '',
      phoneNumber: '',
      companyAddress: '',
      proposedCapCents: 100000,
      sponsorshipReason: '',
      fundingFrequency: 'Annual',
      industryFocus: [],
      geographicFocus: 'National',
      mentorshipOffered: false,
      ageConfirmed: false,
      coppaAcknowledged: false,
      tosAccepted: false,
    },
    mode: 'onTouched',
  })

  async function onSubmit(values: SponsorSignupInput) {
    setError(null)
    setIsPending(true)
    const result = await createSponsorApplication(values)
    if (result?.error) {
      setError(result.error)
      setIsPending(false)
      return
    }
    router.push('/awaiting-verification')
  }

  const toggleFocusArea = (area: string) => {
    const current = form.getValues('industryFocus') || []
    form.setValue('industryFocus', current.includes(area) ? current.filter(a => a !== area) : [...current, area], { shouldValidate: true })
  }

  return (
    <Card className="w-full max-w-2xl border-border bg-card/70 backdrop-blur shadow-2xl">
      <CardHeader className="border-b border-border/50 pb-6">
        <CardTitle className="text-2xl text-foreground">Complete your sponsor application</CardTitle>
        <CardDescription className="text-muted-foreground">
          Your sign-in for <span className="font-medium text-foreground">{email}</span> is ready. Tell us about
          your organization and sponsorship goals to submit your application — or sign out if this isn&apos;t you.
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 text-foreground">
            {error && (
              <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <SectionHeader title="Your details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="fullName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Representative Name</FormLabel>
                  <FormControl><Input placeholder="Jane Doe" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormItem>
                <FormLabel>Work Email Address</FormLabel>
                <FormControl><Input type="email" value={email} disabled readOnly /></FormControl>
              </FormItem>
            </div>

            <SectionHeader title="Company" sub="Tell us about your organization." />
            <FormField control={form.control} name="companyName" render={({ field }) => (
              <FormItem><FormLabel>Company Name</FormLabel><FormControl><Input placeholder="e.g. TechCorp Solutions" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="industry" render={({ field }) => (
                <FormItem>
                  <FormLabel>Industry</FormLabel>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <FormControl>
                        <Button variant="outline" className="w-full justify-between font-normal">
                          {field.value || 'Select industry'} <ChevronDown className="h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-full min-w-[200px]">
                      {INDUSTRIES.map(i => <DropdownMenuItem key={i} onClick={() => field.onChange(i)}>{i}</DropdownMenuItem>)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="website" render={({ field }) => (
                <FormItem><FormLabel>Website</FormLabel><FormControl><Input placeholder="https://company.com" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="phoneNumber" render={({ field }) => (
              <FormItem><FormLabel>Work Phone</FormLabel><FormControl><Input type="tel" placeholder="(555) 000-0000" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="companyAddress" render={({ field }) => (
              <FormItem><FormLabel>Company Address</FormLabel><FormControl><Input placeholder="123 Corporate Blvd, Ste 100" {...field} /></FormControl><FormMessage /></FormItem>
            )} />

            <SectionHeader title="Sponsorship" sub="Define your sponsorship goals." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FormField control={form.control} name="proposedCapCents" render={({ field }) => (
                <FormItem>
                  <FormLabel>Proposed Annual Cap ($)</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                      <Input type="number" step="100" className="pl-7" value={field.value / 100} onChange={e => field.onChange(Math.round(parseFloat(e.target.value) * 100))} />
                    </div>
                  </FormControl>
                  <p className="text-xs text-muted-foreground">Estimate — you can adjust this later.</p>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="fundingFrequency" render={({ field }) => (
                <FormItem>
                  <FormLabel>Funding Frequency</FormLabel>
                  <FormControl>
                    <div className="flex flex-col gap-2">
                      {FUNDING_FREQUENCIES.map(f => (
                        <label key={f} className="flex items-center gap-2 cursor-pointer p-2.5 border border-border rounded-md hover:bg-accent">
                          <input type="radio" checked={field.value === f} onChange={() => field.onChange(f)} className="accent-primary" />
                          <span className="text-sm font-medium">{f}</span>
                        </label>
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="sponsorshipReason" render={({ field }) => (
              <FormItem>
                <FormLabel>Why do you want to support FTC Robotics?</FormLabel>
                <FormControl><Textarea placeholder="Share your motivation for supporting student innovation…" className="min-h-[90px]" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="industryFocus" render={({ field }) => (
              <FormItem>
                <FormLabel>Areas of Interest <span className="text-muted-foreground font-normal">(select at least one)</span></FormLabel>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {FOCUS_AREAS.map(area => (
                    <div
                      key={area}
                      className={cn('flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors', field.value?.includes(area) ? 'bg-primary/10 border-primary' : 'border-border hover:bg-accent')}
                      onClick={() => toggleFocusArea(area)}
                    >
                      <div className={cn('w-4 h-4 rounded-sm border flex items-center justify-center shrink-0', field.value?.includes(area) ? 'bg-primary border-primary' : 'border-border')}>
                        {field.value?.includes(area) && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
                      </div>
                      <span className="text-sm">{area}</span>
                    </div>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <FormField control={form.control} name="geographicFocus" render={({ field }) => (
                <FormItem>
                  <FormLabel>Geographic Preference</FormLabel>
                  <FormControl><Input placeholder="e.g. National, Texas, Austin" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="mentorshipOffered" render={({ field }) => (
                <FormItem className="flex items-start space-x-3 space-y-0 rounded-md border p-4 bg-accent/20 self-end">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Offer Mentorship</FormLabel>
                    <p className="text-xs text-muted-foreground">We can provide technical or business mentorship.</p>
                  </div>
                </FormItem>
              )} />
            </div>

            <SectionHeader title="Agreements" />
            <div className="space-y-3">
              <FormField control={form.control} name="ageConfirmed" render={({ field }) => (
                <FormItem className="flex items-start space-x-3 space-y-0 rounded-md border border-border p-4 bg-accent/30">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-sm leading-snug">I confirm I am 18 or older and authorized to represent this company.</FormLabel>
                    <FormMessage />
                  </div>
                </FormItem>
              )} />
              <FormField control={form.control} name="coppaAcknowledged" render={({ field }) => (
                <FormItem className="flex items-start space-x-3 space-y-0 rounded-md border border-border p-4 bg-accent/30">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-sm">COPPA & PII Policy</FormLabel>
                    <p className="text-xs text-muted-foreground mt-1">I will not collect student PII through this platform.</p>
                    <FormMessage />
                  </div>
                </FormItem>
              )} />
              <FormField control={form.control} name="tosAccepted" render={({ field }) => (
                <FormItem className="flex items-start space-x-3 space-y-0 rounded-md border border-border p-4 bg-accent/30">
                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-sm leading-snug">
                      I agree to the{' '}
                      <Link href="/legal/terms" className="text-primary hover:underline" target="_blank">Terms of Service</Link>
                    </FormLabel>
                    <FormMessage />
                  </div>
                </FormItem>
              )} />
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-border/60">
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => signOut({ redirectUrl: '/login' })}
              >
                Sign out instead
              </Button>
              <Button type="submit" disabled={isPending} className="px-8 font-semibold">
                {isPending ? 'Submitting…' : 'Submit Application'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="border-t border-border/50 py-4">
        <p className="text-xs text-muted-foreground">
          Questions about sponsoring? Contact{' '}
          <a href="mailto:support@ftcportal.dev" className="underline hover:text-foreground">support</a>.
        </p>
      </CardFooter>
    </Card>
  )
}
