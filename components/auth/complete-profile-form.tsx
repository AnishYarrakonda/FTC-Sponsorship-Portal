'use client'

import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { coachProfileDataSchema, type CoachProfileDataInput } from '@/lib/schemas/auth'
import { completeCoachProfile } from '@/app/actions/auth'
import { useClerk } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { StateSelector } from '@/components/ui/state-selector'
import { UploadCloud, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { describeActionError } from '@/lib/client-errors'

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="pt-2 border-t border-border/60 first:pt-0 first:border-t-0">
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h2>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

/**
 * Orphan-recovery form: the Clerk account exists (email already verified) but
 * the profiles row was never provisioned. Re-collects the minimal required
 * data and calls `completeCoachProfile` (idempotent upsert on clerk_user_id).
 */
export function CompleteProfileForm({ email, defaultName }: { email: string; defaultName: string }) {
  const router = useRouter()
  const { signOut } = useClerk()
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const form = useForm<CoachProfileDataInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(coachProfileDataSchema) as any,
    defaultValues: {
      fullName: defaultName,
      email,
      dateOfBirth: '',
      phoneNumber: '',
      addressLine1: '',
      city: '',
      state: '',
      zipCode: '',
      referralSource: '',
      teamData: {
        status: 'existing',
        teamName: '',
        organization: '',
        city: '',
        state: '',
        missionStatement: '',
        taxStatus: 'None',
        communityInterestText: '',
        sustainabilityPlan: '',
        seedFundingGoalsCents: 0,
      },
    },
    mode: 'onTouched',
  })

  const teamStatus = form.watch('teamData.status')
  const file = form.watch('photoIdFile')

  async function onSubmit(values: CoachProfileDataInput) {
    setError(null)

    const { photoIdFile, ...jsonValues } = values
    if (!photoIdFile) {
      form.setError('photoIdFile', { message: 'Photo ID is required' })
      return
    }

    setIsPending(true)
    const formData = new FormData()
    formData.append('data', JSON.stringify(jsonValues))
    formData.append('photoIdFile', photoIdFile)

    try {
      const result = await completeCoachProfile(formData)
      if (result?.error) {
        setError(result.error)
        setIsPending(false)
        return
      }

      router.push('/awaiting-verification')
    } catch (e) {
      setError(describeActionError(e, 'completeCoachProfile'))
      setIsPending(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      form.setValue('photoIdFile', e.target.files[0], { shouldValidate: true })
      form.clearErrors('photoIdFile')
    }
  }

  return (
    <section className="w-full text-foreground">
      <div className="w-full grid place-items-center">
        <Card className="w-full max-w-2xl border-border bg-card/70 backdrop-blur shadow-2xl">
          <CardHeader className="border-b border-border/50 pb-6">
            <CardTitle className="text-2xl text-foreground">Complete your coach profile</CardTitle>
            <CardDescription className="text-muted-foreground">
              Fill in your coach and team details below to finish — or sign out if this
              isn&apos;t you.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                {error && (
                  <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <SectionHeader title="Your details" />
                <FormField control={form.control} name="fullName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl><Input placeholder="Jane Doe" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField control={form.control} name="dateOfBirth" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date of Birth</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="phoneNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl><Input type="tel" placeholder="(555) 123-4567" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="addressLine1" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Street Address</FormLabel>
                    <FormControl><Input placeholder="123 Main St" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-3 gap-4">
                  <FormField control={form.control} name="city" render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="state" render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl><StateSelector value={field.value} onChange={field.onChange} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="zipCode" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Zip Code</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <SectionHeader title="Verification" sub="A photo ID is required so an admin can verify you are an adult coach." />
                <FormField control={form.control} name="photoIdFile" render={() => (
                  <FormItem>
                    <FormLabel>Photo ID (School ID or Government ID)</FormLabel>
                    <FormControl>
                      <div
                        className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-border rounded-lg bg-background/50 hover:bg-accent transition-colors cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <UploadCloud className="w-7 h-7 text-muted-foreground mb-1.5" />
                        <p className="text-sm text-muted-foreground">
                          {file
                            ? <span className="font-semibold text-foreground">{(file as File).name}</span>
                            : <span>Click to upload PDF, JPG, or PNG (max 5 MB)</span>}
                        </p>
                        <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,image/jpeg,image/png" onChange={handleFileChange} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="space-y-3">
                  <FormField control={form.control} name="ageConfirmed" render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-border p-4 bg-accent/30">
                      <FormControl>
                        <Checkbox
                          checked={field.value === true}
                          onCheckedChange={(c) => field.onChange(c === true ? true : undefined)}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-foreground">I confirm I am 18 years of age or older</FormLabel>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="coppaAcknowledged" render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-border p-4 bg-accent/30">
                      <FormControl>
                        <Checkbox
                          checked={field.value === true}
                          onCheckedChange={(c) => field.onChange(c === true ? true : undefined)}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-foreground">COPPA Acknowledgement</FormLabel>
                        <p className="text-xs text-muted-foreground mt-1 leading-snug">I am responsible for supervising students and ensuring no PII of minors under 13 is uploaded.</p>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="tosAccepted" render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-border p-4 bg-accent/30">
                      <FormControl>
                        <Checkbox
                          checked={field.value === true}
                          onCheckedChange={(c) => field.onChange(c === true ? true : undefined)}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-foreground leading-snug">
                          I agree to the{' '}
                          <Link href="/legal/terms" className="text-primary hover:underline" target="_blank">Terms of Service</Link>
                          {' '}and{' '}
                          <Link href="/legal/privacy" className="text-primary hover:underline" target="_blank">Privacy Policy</Link>
                        </FormLabel>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )} />
                </div>

                <SectionHeader title="Your team" sub="Just the basics — the full portfolio is built after verification." />
                <FormField control={form.control} name="teamData.status" render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel>Team Status</FormLabel>
                    <FormControl>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <label className="flex flex-1 items-center gap-2 cursor-pointer p-3 border border-border bg-background/50 rounded-md hover:bg-accent transition-colors">
                          <input type="radio" {...field} value="existing" checked={field.value === 'existing'} onChange={() => field.onChange('existing')} className="w-4 h-4 accent-primary" />
                          <span className="font-medium text-foreground text-sm">Existing FTC Team</span>
                        </label>
                        <label className="flex flex-1 items-center gap-2 cursor-pointer p-3 border border-border bg-background/50 rounded-md hover:bg-accent transition-colors">
                          <input type="radio" {...field} value="incubator" checked={field.value === 'incubator'} onChange={() => field.onChange('incubator')} className="w-4 h-4 accent-primary" />
                          <span className="font-medium text-foreground text-sm">Incubator (New Team)</span>
                        </label>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                {teamStatus === 'existing' && (
                  <FormField control={form.control} name="teamData.ftcTeamNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>FTC Team Number</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="e.g. 12345"
                          value={field.value ?? ''}
                          onChange={(e) => { const n = parseInt(e.target.value); field.onChange(isNaN(n) ? undefined : n) }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
                <FormField control={form.control} name="teamData.teamName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Team Name</FormLabel>
                    <FormControl><Input placeholder="e.g. The RoboKnights" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="teamData.organization" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization / School <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                    <FormControl><Input placeholder="e.g. Lincoln High School" {...field} value={field.value ?? ''} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="teamData.city" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Team City</FormLabel>
                      <FormControl><Input placeholder="Austin" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="teamData.state" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Team State</FormLabel>
                      <FormControl><StateSelector value={field.value} onChange={field.onChange} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="teamData.taxStatus" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tax Status</FormLabel>
                    <FormControl>
                      <select
                        className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                      >
                        <option value="None">Standard / No tax-exempt status</option>
                        <option value="501c3">501(c)(3) Non-profit</option>
                        <option value="School">School / Educational Institution</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="teamData.missionStatement" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mission Statement</FormLabel>
                    <FormControl>
                      <Textarea placeholder="What is your team's overarching goal? (min 50 characters)" className="min-h-[90px] resize-none" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                {teamStatus === 'incubator' && (
                  <>
                    <FormField control={form.control} name="teamData.communityInterestText" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Community Interest</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Who wants this team to exist? Describe student and community interest." className="min-h-[70px] resize-none" {...field} value={field.value ?? ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="teamData.sustainabilityPlan" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sustainability Plan</FormLabel>
                        <FormControl>
                          <Textarea placeholder="How will the team keep running after the first season?" className="min-h-[70px] resize-none" {...field} value={field.value ?? ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="teamData.seedFundingGoalsCents" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Seed Funding Goal (USD)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            placeholder="e.g. 1500"
                            value={field.value !== undefined ? field.value / 100 : ''}
                            onChange={(e) => {
                              const n = parseFloat(e.target.value)
                              field.onChange(isNaN(n) ? undefined : Math.round(n * 100))
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-border/60">
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => signOut({ redirectUrl: '/login' })}
                  >
                    Sign out instead
                  </Button>
                  <Button type="submit" disabled={isPending} loading={isPending} className="px-8 font-semibold">
                    {isPending ? 'Saving…' : 'Complete profile'}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
          <CardFooter className="border-t border-border/50 py-4">
            <p className="text-xs text-muted-foreground">
              Meant to join as a sponsor? Choose &ldquo;I&apos;m a sponsor representative&rdquo; above, or
              contact <a href="mailto:support@ftcportal.dev" className="underline hover:text-foreground">support</a>.
            </p>
          </CardFooter>
        </Card>
      </div>
    </section>
  )
}
