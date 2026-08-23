'use client'

import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { signupSchema, type SignupInput } from '@/lib/schemas/auth'
import { LIMITS } from '@/lib/schemas/limits'
import { createCoachProfile } from '@/app/actions/auth'
import { lookupFTCTeam } from '@/app/actions/team'
import { useSignUp } from '@clerk/nextjs/legacy'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ChevronDown, ChevronRight, ChevronLeft, UploadCloud, ArrowRight, AlertCircle } from 'lucide-react'
import { StateSelector } from '@/components/ui/state-selector'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { describeActionError } from '@/lib/client-errors'

const STEP_LABELS = ['Account', 'Verification', 'Your Team']

function SectionHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="pt-1">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h3>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

// Surface a readable message from a Clerk error payload.
function clerkErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { errors?: { longMessage?: string; message?: string }[] }
  return anyErr?.errors?.[0]?.longMessage ?? anyErr?.errors?.[0]?.message ?? fallback
}

export function SignupWizard() {
  const router = useRouter()
  const { isLoaded, signUp, setActive } = useSignUp()
  const [step, setStep] = useState(1)
  const totalSteps = 3
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [isLookingUp, setIsLookingUp] = useState(false)
  const [lookupSuccess, setLookupSuccess] = useState(false)
  const [lookupSource, setLookupSource] = useState<'first_api' | 'ftcscout' | 'cache' | 'none' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Email-code verification sub-step (between Account and Verification steps).
  const [showEmailVerify, setShowEmailVerify] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)
  const [verifyCode, setVerifyCode] = useState('')
  const [verifyPending, setVerifyPending] = useState(false)

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema) as any,
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
      dateOfBirth: '',
      phoneNumber: '',
      addressLine1: '',
      city: '',
      state: '',
      zipCode: '',
      referralSource: '',
      photoIdUrl: undefined,
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
      }
    },
    mode: 'onTouched'
  })

  const teamStatus = form.watch('teamData.status')
  const file = form.watch('photoIdFile')

  const nextStep = async () => {
    let fieldsToValidate: any[] = []
    if (step === 1) fieldsToValidate = ['fullName', 'email', 'password', 'confirmPassword']
    if (step === 2) fieldsToValidate = [
      'dateOfBirth', 'phoneNumber', 'addressLine1', 'city', 'state', 'zipCode',
      'photoIdFile', 'ageConfirmed', 'coppaAcknowledged', 'tosAccepted',
    ]

    const isValid = await form.trigger(fieldsToValidate)
    if (!isValid) return

    // Leaving the Account step: create the Clerk user + send the email code,
    // unless the email is already verified (e.g. user navigated back and forth).
    if (step === 1 && !emailVerified) {
      if (!isLoaded || !signUp) return
      setError(null)
      setIsPending(true)
      try {
        await signUp.create({
          emailAddress: form.getValues('email'),
          password: form.getValues('password'),
        })
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
        setShowEmailVerify(true)
        setIsPending(false)
        window.scrollTo(0, 0)
      } catch (err) {
        setError(clerkErrorMessage(err, 'Could not start sign up. Please check your details and try again.'))
        setIsPending(false)
      }
      return
    }

    if (step === 2 && !file) {
      form.setError('photoIdFile', { message: 'Photo ID is required' })
      return
    }

    setStep(prev => Math.min(prev + 1, totalSteps))
    window.scrollTo(0, 0)
  }

  // Email-code verification: confirm the code, activate the Clerk session,
  // then advance to the Verification step. The user is now authenticated for
  // the remaining steps; the photo-ID File stays in memory until final submit.
  async function handleVerifyEmail() {
    if (!isLoaded || !signUp) return
    if (!verifyCode.trim()) {
      setError('Enter the 6-digit code sent to your email.')
      return
    }
    setError(null)
    setVerifyPending(true)
    try {
      const result = await signUp.attemptEmailAddressVerification({ code: verifyCode.trim() })
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId })
        setEmailVerified(true)
        setShowEmailVerify(false)
        setVerifyPending(false)
        setStep(2)
        window.scrollTo(0, 0)
      } else {
        setError('Verification incomplete. Please try the code again.')
        setVerifyPending(false)
      }
    } catch (err) {
      setError(clerkErrorMessage(err, 'Invalid or expired code. Please try again.'))
      setVerifyPending(false)
    }
  }

  async function resendVerifyCode() {
    if (!isLoaded || !signUp) return
    setError(null)
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
    } catch (err) {
      setError(clerkErrorMessage(err, 'Could not resend the code. Please try again.'))
    }
  }

  const prevStep = () => {
    setStep(prev => Math.max(prev - 1, 1))
    window.scrollTo(0, 0)
  }

  async function handleLookup() {
    const teamNumber = form.getValues('teamData.ftcTeamNumber')
    if (!teamNumber) {
      form.setError('teamData.ftcTeamNumber', { message: 'Enter a team number first' })
      return
    }
    setIsLookingUp(true)
    setLookupSuccess(false)
    setLookupSource(null)
    const result = await lookupFTCTeam(teamNumber)
    setIsLookingUp(false)
    if (result.error || !result.team) {
      form.setError('teamData.ftcTeamNumber', { message: result.error ?? 'Team not found in FIRST registry' })
      return
    }
    form.setValue('teamData.teamName', result.team.team_name, { shouldValidate: true })
    if (result.team.city) form.setValue('teamData.city', result.team.city, { shouldValidate: true })
    if (result.team.state) form.setValue('teamData.state', result.team.state, { shouldValidate: true })
    form.clearErrors('teamData.ftcTeamNumber')
    setLookupSuccess(true)
    setLookupSource(result.source)
  }

  // No blocking here — the wizard only autofills and writes pending_team_data; the
  // team row (and any hard enforcement) is created later, after admin verification.
  function lookupProvenanceCopy(source: typeof lookupSource): string {
    switch (source) {
      case 'first_api':
        return 'Verified against the official FIRST roster.'
      case 'ftcscout':
        return 'Matched via FTCScout — pending official confirmation.'
      case 'cache':
        return 'Matched against a cached FIRST roster record.'
      default:
        return 'The FIRST roster is temporarily unavailable; an admin will confirm your team number after signup.'
    }
  }

  // Tracks a failure of createCoachProfile AFTER the Clerk session is already
  // active (the account exists but the profile row doesn't yet). The action is
  // idempotent (upsert on clerk_user_id), so retrying with the same data is safe.
  const [profileFailed, setProfileFailed] = useState(false)

  async function onSubmit(values: SignupInput) {
    setIsPending(true)
    setError(null)

    // The photoIdFile is not JSON-serializable; send it as a separate FormData part.
    const { photoIdFile, ...jsonValues } = values
    const formData = new FormData()
    formData.append('data', JSON.stringify(jsonValues))
    if (photoIdFile) {
      formData.append('photoIdFile', photoIdFile)
    }

    try {
      const result = await createCoachProfile(formData)

      if (result?.error) {
        setError(result.error)
        setProfileFailed(true)
        setIsPending(false)
        return
      }

      setProfileFailed(false)
      // Matches the previous flow: coaches proceed to upload/await verification.
      router.push('/upload-credentials')
    } catch (e) {
      // The Clerk account already exists at this point, so leaving the form dead here
      // stranded the user with a session and no profile row and no way to retry.
      setError(describeActionError(e, 'createCoachProfile'))
      setProfileFailed(true)
      setIsPending(false)
    }
  }

  // Re-invoke the profile action with the data already in the form.
  function retryProfileCreation() {
    void form.handleSubmit(onSubmit)()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      form.setValue('photoIdFile', e.target.files[0], { shouldValidate: true })
      form.clearErrors('photoIdFile')
    }
  }

  return (
    <section className="fixed inset-0 overflow-y-auto bg-[radial-gradient(ellipse_at_top,hsl(var(--accent)/0.3),transparent_60%)] bg-background text-foreground">
      <header className="fixed left-0 right-0 top-0 flex items-center justify-between px-6 py-4 border-b border-border/80 z-20 bg-background/50 backdrop-blur">
        <Link href="/" className="text-xs tracking-[0.14em] uppercase text-muted-foreground hover:text-foreground transition-colors">
          PITFUND
        </Link>
        <Link href="/login">
          <Button variant="outline" className="h-9 rounded-lg border-border bg-card text-foreground hover:bg-accent">
            <span className="mr-2">Login</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </header>

      <div className="min-h-screen w-full grid place-items-center px-4 py-24 relative z-10">
        <Card className="w-full max-w-2xl border-border bg-card/70 backdrop-blur shadow-2xl">
          <CardHeader className="border-b border-border/50 pb-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <CardTitle className="text-2xl text-foreground">Coach Registration</CardTitle>
              <span className="text-sm font-medium text-muted-foreground">Step {step} of {totalSteps}</span>
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-3">
              {STEP_LABELS.map((label, i) => {
                const n = i + 1
                const active = n === step
                const done = n < step
                return (
                  <div key={label} className="flex items-center gap-2 flex-1 min-w-0">
                    <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${done ? 'bg-primary text-primary-foreground' : active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      {done ? '✓' : n}
                    </div>
                    <span className={`text-xs truncate ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{label}</span>
                    {i < STEP_LABELS.length - 1 && <div className={`flex-1 h-px transition-colors ${done ? 'bg-primary' : 'bg-border'}`} />}
                  </div>
                )
              })}
            </div>

            <CardDescription className="text-base text-muted-foreground">
              {showEmailVerify && "Confirm your email to continue."}
              {!showEmailVerify && step === 1 && "Set up your account credentials."}
              {!showEmailVerify && step === 2 && "Verify your identity and accept our policies."}
              {!showEmailVerify && step === 3 && "Tell us about your team."}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            {showEmailVerify ? (
              <div className="space-y-6 text-foreground">
                {error && (
                  <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-text">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <label htmlFor="signup-verification-code" className="text-sm font-medium text-foreground/80">Verification Code</label>
                  <Input
                    id="signup-verification-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="bg-background border-input text-foreground placeholder:text-muted-foreground tracking-[0.3em] text-center h-11"
                    placeholder="123456"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    We emailed a 6-digit code to {form.getValues('email') || 'your email'}. Enter it to verify your account.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={handleVerifyEmail}
                  size="lg"
                  disabled={verifyPending || !isLoaded}
                  className="w-full bg-primary text-primary-foreground font-semibold"
                >
                  {verifyPending ? 'Verifying…' : 'Verify Email'}
                </Button>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={resendVerifyCode}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Resend code
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowEmailVerify(false); setError(null); setVerifyCode('') }}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" /> Edit account details
                  </button>
                </div>
              </div>
            ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 text-foreground">
                {error && (
                  <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-text">
                    <AlertDescription>
                      <span>{error}</span>
                      {profileFailed && (
                        <span className="block mt-2">
                          Your account and email verification are safe — only the final profile step failed,
                          and retrying will not create a duplicate.
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={retryProfileCreation}
                            disabled={isPending}
                            className="ml-0 mt-2 block border-destructive/40 text-destructive-text hover:bg-destructive/10"
                          >
                            {isPending ? 'Retrying…' : 'Retry'}
                          </Button>
                        </span>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                <AnimatePresence mode="wait">
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-5"
                  >
                    {/* STEP 1: Account */}
                    {step === 1 && (
                      <>
                        <FormField control={form.control} name="fullName" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/80">Full Name</FormLabel>
                            <FormControl><Input className="bg-background border-input text-foreground placeholder:text-muted-foreground" placeholder="Jane Doe" maxLength={LIMITS.fullName} {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="email" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/80">Email Address</FormLabel>
                            <FormControl><Input className="bg-background border-input text-foreground placeholder:text-muted-foreground" type="email" autoComplete="email" placeholder="coach@example.com" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                          <FormField control={form.control} name="password" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/80">Password</FormLabel>
                              <FormControl><Input className="bg-background border-input text-foreground" type="password" autoComplete="new-password" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/80">Confirm Password</FormLabel>
                              <FormControl><Input className="bg-background border-input text-foreground" type="password" autoComplete="new-password" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <p className="text-xs text-muted-foreground">Password must be at least 12 characters and include uppercase, lowercase, and a number.</p>
                      </>
                    )}

                    {/* STEP 2: Identity + Compliance */}
                    {step === 2 && (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                          <FormField control={form.control} name="dateOfBirth" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/80">Date of Birth</FormLabel>
                              <FormControl><Input className="bg-background border-input text-foreground" type="date" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="phoneNumber" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/80">Phone Number</FormLabel>
                              <FormControl><Input className="bg-background border-input text-foreground placeholder:text-muted-foreground" type="tel" placeholder="(555) 123-4567" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>
                        <FormField control={form.control} name="addressLine1" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/80">Street Address</FormLabel>
                            <FormControl><Input className="bg-background border-input text-foreground placeholder:text-muted-foreground" placeholder="123 Main St" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="grid grid-cols-3 gap-4">
                          <FormField control={form.control} name="city" render={({ field }) => (
                            <FormItem className="col-span-1">
                              <FormLabel className="text-foreground/80">City</FormLabel>
                              <FormControl><Input className="bg-background border-input text-foreground" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="state" render={({ field }) => (
                            <FormItem className="col-span-1">
                              <FormLabel className="text-foreground/80">State</FormLabel>
                              <FormControl><StateSelector value={field.value} onChange={field.onChange} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="zipCode" render={({ field }) => (
                            <FormItem className="col-span-1">
                              <FormLabel className="text-foreground/80">Zip Code</FormLabel>
                              <FormControl><Input className="bg-background border-input text-foreground" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>

                        <FormField control={form.control} name="photoIdFile" render={() => (
                          <FormItem>
                            <FormLabel className="text-foreground/80">Photo ID (School ID or Government ID)</FormLabel>
                            <FormControl>
                              {/* A-08-01. Same fix as /upload-credentials: a <label> plus
                                  an sr-only input, so the control is reachable by Tab,
                                  announced with its name, and shows focus on the visible
                                  box. `hidden` took it out of the tab order completely. */}
                              <label
                                htmlFor="signup-photo-id"
                                className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-border rounded-lg bg-background/50 hover:bg-accent transition-colors cursor-pointer focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
                              >
                                <UploadCloud className="w-7 h-7 text-muted-foreground mb-1.5" aria-hidden="true" />
                                <p className="text-sm text-muted-foreground">
                                  {file
                                    ? <span className="font-semibold text-foreground">{file.name}</span>
                                    : <span>Click to upload PDF, JPG, or PNG (max 5 MB)</span>}
                                </p>
                                <input id="signup-photo-id" type="file" ref={fileInputRef} className="sr-only" accept=".pdf,image/jpeg,image/png" onChange={handleFileChange} />
                              </label>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <div className="space-y-3 pt-1">
                          <FormField control={form.control} name="ageConfirmed" render={({ field }) => (
                            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-border p-4 bg-accent/30">
                              <FormControl>
                                <Checkbox
                                  className="border-border data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
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
                                  className="border-border data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
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
                                  className="border-border data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
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

                        <FormField control={form.control} name="referralSource" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/80">How did you hear about us? <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                            <FormControl><Input className="bg-background border-input text-foreground placeholder:text-muted-foreground" placeholder="e.g. FIRST forum, another coach..." {...field} /></FormControl>
                          </FormItem>
                        )} />
                      </>
                    )}

                    {/* STEP 3: Team & Mission */}
                    {step === 3 && (
                      <>
                        {form.formState.errors.teamData?.root && (
                          <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-text">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{form.formState.errors.teamData.root.message}</AlertDescription>
                          </Alert>
                        )}

                        <SectionHeading title="Team identity" sub="Who you are — the rest of the portfolio is built after verification." />
                        <FormField control={form.control} name="teamData.status" render={({ field }) => (
                          <FormItem className="space-y-2">
                            <FormLabel className="text-foreground/80">Team Status</FormLabel>
                            <FormControl>
                              <div className="flex flex-col sm:flex-row gap-3">
                                <label className="flex flex-1 items-center gap-2 cursor-pointer p-4 border border-border bg-background/50 rounded-md hover:bg-accent transition-colors">
                                  <input type="radio" {...field} value="existing" checked={field.value === 'existing'} onChange={() => { field.onChange('existing'); setLookupSuccess(false) }} className="w-4 h-4 accent-primary" />
                                  <span className="font-medium text-foreground">Existing FTC Team</span>
                                </label>
                                <label className="flex flex-1 items-center gap-2 cursor-pointer p-4 border border-border bg-background/50 rounded-md hover:bg-accent transition-colors">
                                  <input type="radio" {...field} value="incubator" checked={field.value === 'incubator'} onChange={() => { field.onChange('incubator'); setLookupSuccess(false) }} className="w-4 h-4 accent-primary" />
                                  <span className="font-medium text-foreground">Incubator (New Team)</span>
                                </label>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />

                        {teamStatus === 'existing' && (
                          <FormField control={form.control} name="teamData.ftcTeamNumber" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/80">FTC Team Number</FormLabel>
                              <FormControl>
                                <div className="flex gap-2">
                                  <Input
                                    className="bg-background border-input text-foreground placeholder:text-muted-foreground"
                                    placeholder="e.g. 12345"
                                    type="number"
                                    value={field.value ?? ''}
                                    onChange={(e) => { const n = parseInt(e.target.value); field.onChange(isNaN(n) ? undefined : n); setLookupSuccess(false) }}
                                  />
                                  <Button type="button" variant="outline" onClick={handleLookup} disabled={isLookingUp} className="shrink-0 bg-card border-border text-foreground hover:bg-accent">
                                    {isLookingUp ? 'Looking up…' : 'Lookup'}
                                  </Button>
                                </div>
                              </FormControl>
                              {lookupSuccess && <p className="text-sm text-status-success font-medium">✓ Team found in FIRST registry</p>}
                              <FormMessage />
                            </FormItem>
                          )} />
                        )}

                        <FormField control={form.control} name="teamData.teamName" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/80">Team Name</FormLabel>
                            <FormControl><Input className="bg-background border-input text-foreground placeholder:text-muted-foreground" placeholder="e.g. The RoboKnights" maxLength={LIMITS.teamName} {...field} /></FormControl>
                            {lookupSuccess && lookupSource && teamStatus === 'existing' && (
                              <p className="text-xs text-muted-foreground">{lookupProvenanceCopy(lookupSource)}</p>
                            )}
                            <FormMessage />
                          </FormItem>
                        )} />

                        <FormField control={form.control} name="teamData.organization" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/80">Organization / School <span className="text-muted-foreground font-normal">(Optional)</span></FormLabel>
                            <FormControl><Input className="bg-background border-input text-foreground placeholder:text-muted-foreground" placeholder="e.g. Lincoln High School" maxLength={LIMITS.organization} {...field} value={field.value ?? ''} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <SectionHeading title="Location" />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={form.control} name="teamData.city" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/80">Team City</FormLabel>
                              <FormControl><Input className="bg-background border-input text-foreground placeholder:text-muted-foreground" placeholder="Austin" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="teamData.state" render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/80">Team State</FormLabel>
                              <FormControl><StateSelector value={field.value} onChange={field.onChange} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>

                        <SectionHeading title="Mission & funding" />
                        <FormField control={form.control} name="teamData.taxStatus" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/80">Tax Status</FormLabel>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <FormControl>
                                  <Button variant="outline" className="w-full justify-between font-normal bg-background border-input text-foreground hover:bg-accent">
                                    {field.value === 'None' ? 'Standard / No tax-exempt status' : field.value === '501c3' ? '501(c)(3) Non-profit' : field.value === 'School' ? 'School / Educational Institution' : 'Select tax status'}
                                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                  </Button>
                                </FormControl>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="w-full min-w-[300px] bg-background border-border text-foreground">
                                <DropdownMenuItem className="hover:bg-accent focus:bg-accent cursor-pointer" onClick={() => field.onChange('None')}>Standard / No tax-exempt status</DropdownMenuItem>
                                <DropdownMenuItem className="hover:bg-accent focus:bg-accent cursor-pointer" onClick={() => field.onChange('501c3')}>501(c)(3) Non-profit</DropdownMenuItem>
                                <DropdownMenuItem className="hover:bg-accent focus:bg-accent cursor-pointer" onClick={() => field.onChange('School')}>School / Educational Institution</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <FormMessage />
                          </FormItem>
                        )} />

                        <FormField control={form.control} name="teamData.missionStatement" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/80">Mission Statement</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="What is your team's overarching goal? (min 50 characters)"
                                className="min-h-[90px] resize-none bg-background border-input text-foreground placeholder:text-muted-foreground"
                                maxLength={LIMITS.mission}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />

                        {teamStatus === 'incubator' && (
                          <>
                            <SectionHeading title="New team details" sub="Help sponsors understand why this team should exist." />
                            <FormField control={form.control} name="teamData.communityInterestText" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-foreground/80">Community Interest</FormLabel>
                                <FormControl>
                                  <Textarea
                                    placeholder="Who wants this team to exist? Describe student and community interest."
                                    className="min-h-[70px] resize-none bg-background border-input text-foreground placeholder:text-muted-foreground"
                                    {...field}
                                    value={field.value ?? ''}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name="teamData.sustainabilityPlan" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-foreground/80">Sustainability Plan</FormLabel>
                                <FormControl>
                                  <Textarea
                                    placeholder="How will the team keep running after the first season?"
                                    className="min-h-[70px] resize-none bg-background border-input text-foreground placeholder:text-muted-foreground"
                                    {...field}
                                    value={field.value ?? ''}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name="teamData.seedFundingGoalsCents" render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-foreground/80">Seed Funding Goal (USD)</FormLabel>
                                <FormControl>
                                  <Input
                                    className="bg-background border-input text-foreground placeholder:text-muted-foreground"
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
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>

                <div className="flex justify-between pt-6 border-t border-border/80 mt-8">
                  {step > 1 ? (
                    <Button type="button" variant="outline" onClick={prevStep} className="bg-background border-input text-foreground hover:bg-accent">
                      <ChevronLeft className="w-4 h-4 mr-2" /> Back
                    </Button>
                  ) : <div />}

                  {step < totalSteps ? (
                    <Button type="button" onClick={nextStep} disabled={step === 1 && (isPending || !isLoaded)} className="bg-primary text-primary-foreground">
                      {step === 1 && isPending ? 'Sending code…' : <>Next <ChevronRight className="w-4 h-4 ml-2" /></>}
                    </Button>
                  ) : (
                    <Button type="submit" size="lg" disabled={isPending} className="bg-primary text-primary-foreground font-semibold px-8">
                      {isPending ? 'Submitting…' : 'Complete Registration'}
                    </Button>
                  )}
                </div>
              </form>
            </Form>
            )}
          </CardContent>
          <CardFooter className="border-t border-border/50 flex justify-center py-5">
            <p className="text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/login" className="text-foreground hover:underline font-medium">Log in</Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </section>
  )
}
