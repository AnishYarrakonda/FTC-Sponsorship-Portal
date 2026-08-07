'use client'

import { useState, useRef, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { sponsorSignupSchema, type SponsorSignupInput } from '@/lib/schemas/sponsor-signup'
import { createSponsorApplication } from '@/app/actions/auth'
import { schemaPlaceholderPassword } from '@/components/auth/complete-sponsor-application-form'
import { useSignUp } from '@clerk/nextjs/legacy'
import { useUser } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ChevronDown, ChevronRight, ChevronLeft, ArrowRight, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { describeActionError } from '@/lib/client-errors'

const INDUSTRIES = ['Technology', 'Manufacturing', 'Finance', 'Education', 'Healthcare', 'Energy', 'Retail', 'Other']
const FUNDING_FREQUENCIES = ['One-time', 'Quarterly', 'Annual'] as const
const FOCUS_AREAS = ['Engineering', 'Programming', 'Business/Marketing', 'Diversity & Inclusion', 'Community Outreach', 'General Support']
const STEP_LABELS = ['Account', 'Company', 'Sponsorship']

// Surface a readable message from a Clerk error payload.
function clerkErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { errors?: { longMessage?: string; message?: string }[] }
  return anyErr?.errors?.[0]?.longMessage ?? anyErr?.errors?.[0]?.message ?? fallback
}

export function SponsorSignupWizard() {
  const router = useRouter()
  const { isLoaded, signUp, setActive } = useSignUp()
  const { isLoaded: userLoaded, isSignedIn, user } = useUser()
  const [step, setStep] = useState(1)
  const totalSteps = 3
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Email-code verification sub-step (between Account and Company steps).
  const [showEmailVerify, setShowEmailVerify] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)
  const [verifyCode, setVerifyCode] = useState('')
  const [verifyPending, setVerifyPending] = useState(false)

  // A Clerk session is already active but no profile exists yet (e.g. the user
  // came from /complete-profile after a signup that crashed post-verification).
  // The Account step is already done, so the wizard resumes at Company.
  const [resumedFromSession, setResumedFromSession] = useState(false)
  const minStep = resumedFromSession ? 2 : 1

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const setSize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
    setSize()

    type P = { x: number; y: number; v: number; o: number }
    let ps: P[] = []
    let raf = 0

    const make = () => ({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, v: Math.random() * 0.25 + 0.05, o: Math.random() * 0.35 + 0.15 })
    const init = () => { ps = []; const c = Math.floor((canvas.width * canvas.height) / 9000); for (let i = 0; i < c; i++) ps.push(make()) }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const isDark = !document.documentElement.hasAttribute('data-theme') || document.documentElement.getAttribute('data-theme') === 'dark'
      ps.forEach(p => {
        p.y -= p.v
        if (p.y < 0) { p.x = Math.random() * canvas.width; p.y = canvas.height + Math.random() * 40; p.v = Math.random() * 0.25 + 0.05; p.o = Math.random() * 0.35 + 0.15 }
        ctx.fillStyle = isDark ? `rgba(250,250,250,${p.o})` : `rgba(0,0,0,${p.o * 0.5})`
        ctx.fillRect(p.x, p.y, 0.7, 2.2)
      })
      raf = requestAnimationFrame(draw)
    }
    const onResize = () => { setSize(); init() }
    window.addEventListener('resize', onResize)
    init()
    raf = requestAnimationFrame(draw)
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(raf) }
  }, [])

  const form = useForm<SponsorSignupInput>({
    resolver: zodResolver(sponsorSignupSchema) as any,
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
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
    mode: 'onTouched'
  })

  // Resume mode: skip the Account step when a Clerk session is already active
  // and the user has no profile yet (no role mirrored into publicMetadata —
  // UX hint only, never used for authorization). `signUp` is unusable with an
  // active session, so the account fields are satisfied from the session
  // instead: real email + name from Clerk, and a throwaway placeholder for
  // the schema's password fields (Clerk already owns the real credential).
  useEffect(() => {
    if (resumedFromSession || !userLoaded || !isSignedIn || !user) return
    if (user.publicMetadata?.role) return
    const sessionEmail =
      user.primaryEmailAddress?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? ''
    const placeholder = schemaPlaceholderPassword()
    form.setValue('email', sessionEmail)
    if (user.fullName) form.setValue('fullName', user.fullName)
    form.setValue('password', placeholder)
    form.setValue('confirmPassword', placeholder)
    setEmailVerified(true)
    setShowEmailVerify(false)
    setResumedFromSession(true)
    setStep(prev => Math.max(prev, 2))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumedFromSession, userLoaded, isSignedIn, user])

  const nextStep = async () => {
    let fieldsToValidate: any[] = []
    if (step === 1) fieldsToValidate = ['fullName', 'email', 'password', 'confirmPassword']
    if (step === 2) fieldsToValidate = resumedFromSession
      ? ['fullName', 'companyName', 'industry', 'website', 'phoneNumber', 'companyAddress']
      : ['companyName', 'industry', 'website', 'phoneNumber', 'companyAddress']

    const isValid = await form.trigger(fieldsToValidate)
    if (!isValid) return

    // Leaving the Account step: create the Clerk user + send the email code.
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

    setStep(prev => Math.min(prev + 1, totalSteps))
    window.scrollTo(0, 0)
  }

  // Email-code verification: confirm the code, activate the Clerk session,
  // then advance to the Company step.
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

  const prevStep = () => { setStep(prev => Math.max(prev - 1, minStep)); window.scrollTo(0, 0) }

  async function onSubmit(values: SponsorSignupInput) {
    setIsPending(true)
    setError(null)
    try {
      const result = await createSponsorApplication(values)
      if (result?.error) { setError(result.error); setIsPending(false); return }

      // Matches the previous flow: sponsors land on the awaiting-verification page.
      router.push('/awaiting-verification')
    } catch (e) {
      setError(describeActionError(e, 'createSponsorApplication'))
      setIsPending(false)
    }
  }

  const toggleFocusArea = (area: string) => {
    const current = form.getValues('industryFocus') || []
    form.setValue('industryFocus', current.includes(area) ? current.filter(a => a !== area) : [...current, area], { shouldValidate: true })
  }

  return (
    <section className="fixed inset-0 bg-background text-foreground overflow-y-auto">
      <style dangerouslySetInnerHTML={{ __html: `
        .accent-lines{position:absolute;inset:0;pointer-events:none;opacity:.7}
        .hline,.vline{position:absolute;background:var(--border);will-change:transform,opacity}
        .hline{left:0;right:0;height:1px;transform:scaleX(0);transform-origin:50% 50%;animation:drawX .8s cubic-bezier(.22,.61,.36,1) forwards}
        .vline{top:0;bottom:0;width:1px;transform:scaleY(0);transform-origin:50% 0%;animation:drawY .9s cubic-bezier(.22,.61,.36,1) forwards}
        .hline:nth-child(1){top:18%;animation-delay:.12s}.hline:nth-child(2){top:50%;animation-delay:.22s}.hline:nth-child(3){top:82%;animation-delay:.32s}
        .vline:nth-child(4){left:22%;animation-delay:.42s}.vline:nth-child(5){left:50%;animation-delay:.54s}.vline:nth-child(6){left:78%;animation-delay:.66s}
        @keyframes drawX{0%{transform:scaleX(0);opacity:0}60%{opacity:.95}100%{transform:scaleX(1);opacity:.7}}
        @keyframes drawY{0%{transform:scaleY(0);opacity:0}60%{opacity:.95}100%{transform:scaleY(1);opacity:.7}}
        .card-animate{opacity:0;transform:translateY(20px);animation:fadeUp .8s cubic-bezier(.22,.61,.36,1) .4s forwards}
        @keyframes fadeUp{to{opacity:1;transform:translateY(0)}}
      ` }} />

      <div className="accent-lines fixed inset-0">
        <div className="hline" /><div className="hline" /><div className="hline" />
        <div className="vline" /><div className="vline" /><div className="vline" />
      </div>
      <canvas ref={canvasRef} className="fixed inset-0 w-full h-full pointer-events-none opacity-40" />

      <header className="fixed left-0 right-0 top-0 flex items-center justify-between px-6 py-4 border-b border-border/80 z-20 bg-background/50 backdrop-blur">
        <Link href="/" className="text-xs tracking-[0.14em] uppercase text-muted-foreground hover:text-foreground transition-colors">MATCHMAKER</Link>
        <Link href="/login">
          <Button variant="outline" className="h-9 rounded-lg border-border bg-card text-foreground hover:bg-accent">
            <span className="mr-2">Login</span><ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </header>

      <div className="min-h-screen w-full grid place-items-center px-4 py-24 relative z-10">
        <Card className="card-animate w-full max-w-2xl border-border bg-card/70 backdrop-blur shadow-2xl">
          <CardHeader className="border-b border-border/50 pb-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <CardTitle className="text-2xl text-foreground">Sponsor Registration</CardTitle>
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
                    <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${done || active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
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
              {!showEmailVerify && step === 1 && "Set up your representative account."}
              {!showEmailVerify && step === 2 && "Tell us about your organization."}
              {!showEmailVerify && step === 3 && "Define your sponsorship goals and accept our policies."}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            {showEmailVerify ? (
              <div className="space-y-6 text-foreground">
                {error && (
                  <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <label htmlFor="sponsor-verification-code" className="text-sm font-medium text-foreground/80">Verification Code</label>
                  <Input
                    id="sponsor-verification-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="tracking-[0.3em] text-center h-11"
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
                  className="w-full bg-primary text-primary-foreground hover:opacity-90 font-semibold"
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
                  <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
                    <AlertDescription>{error}</AlertDescription>
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
                          <FormItem><FormLabel>Representative Name</FormLabel><FormControl><Input placeholder="Jane Doe" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="email" render={({ field }) => (
                          <FormItem><FormLabel>Work Email Address</FormLabel><FormControl><Input type="email" autoComplete="email" placeholder="jane@company.com" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                          <FormField control={form.control} name="password" render={({ field }) => (
                            <FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" autoComplete="new-password" {...field} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                            <FormItem><FormLabel>Confirm Password</FormLabel><FormControl><Input type="password" autoComplete="new-password" {...field} /></FormControl><FormMessage /></FormItem>
                          )} />
                        </div>
                        <p className="text-xs text-muted-foreground">Password must be at least 12 characters and include uppercase, lowercase, and a number.</p>
                      </>
                    )}

                    {/* STEP 2: Company */}
                    {step === 2 && (
                      <>
                        {resumedFromSession && (
                          <>
                            <Alert className="bg-primary/5 border-primary/20">
                              <AlertDescription className="text-sm text-foreground">
                                You&apos;re signed in as{' '}
                                <span className="font-medium">{form.watch('email') || 'your verified email'}</span>.
                                Your account is ready — finish your company details below.
                              </AlertDescription>
                            </Alert>
                            <FormField control={form.control} name="fullName" render={({ field }) => (
                              <FormItem><FormLabel>Representative Name</FormLabel><FormControl><Input placeholder="Jane Doe" {...field} /></FormControl><FormMessage /></FormItem>
                            )} />
                          </>
                        )}
                        <FormField control={form.control} name="companyName" render={({ field }) => (
                          <FormItem><FormLabel>Company Name</FormLabel><FormControl><Input placeholder="e.g. TechCorp Solutions" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
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
                      </>
                    )}

                    {/* STEP 3: Sponsorship + Compliance */}
                    {step === 3 && (
                      <>
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

                        <div className="border-t border-border pt-5 space-y-3">
                          <p className="text-sm font-medium text-foreground">Agreements</p>
                          <FormField control={form.control} name="ageConfirmed" render={({ field }) => (
                            <FormItem className="flex items-start space-x-3 space-y-0 rounded-md border border-border p-4 bg-accent/30">
                              <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                              <FormLabel className="text-sm leading-snug">I confirm I am 18 or older and authorized to represent this company.</FormLabel>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="coppaAcknowledged" render={({ field }) => (
                            <FormItem className="flex items-start space-x-3 space-y-0 rounded-md border border-border p-4 bg-accent/30">
                              <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                              <div className="space-y-1 leading-none">
                                <FormLabel className="text-sm">COPPA & PII Policy</FormLabel>
                                <p className="text-xs text-muted-foreground mt-1">I will not collect student PII through this platform.</p>
                              </div>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="tosAccepted" render={({ field }) => (
                            <FormItem className="flex items-start space-x-3 space-y-0 rounded-md border border-border p-4 bg-accent/30">
                              <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                              <FormLabel className="text-sm leading-snug">
                                I agree to the{' '}
                                <Link href="/legal/terms" className="text-primary hover:underline" target="_blank">Terms of Service</Link>
                              </FormLabel>
                            </FormItem>
                          )} />
                        </div>

                        {/* Summary */}
                        <div className="border rounded-lg p-4 bg-background/50 space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Summary</p>
                          <div className="text-sm grid grid-cols-2 gap-y-1.5 text-muted-foreground">
                            <span>Company:</span><span className="text-foreground">{form.watch('companyName') || '—'}</span>
                            <span>Representative:</span><span className="text-foreground">{form.watch('fullName') || '—'}</span>
                            <span>Annual Cap:</span><span className="text-foreground">${(form.watch('proposedCapCents') / 100).toLocaleString()}</span>
                            <span>Focus:</span><span className="text-foreground">{form.watch('industryFocus')?.join(', ') || '—'}</span>
                          </div>
                        </div>
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>

                <div className="flex justify-between pt-6 border-t border-border/80 mt-8">
                  {step > minStep ? (
                    <Button type="button" variant="outline" onClick={prevStep} className="bg-background">
                      <ChevronLeft className="w-4 h-4 mr-2" /> Back
                    </Button>
                  ) : <div />}

                  {step < totalSteps ? (
                    <Button type="button" onClick={nextStep} disabled={step === 1 && (isPending || !isLoaded)} className="bg-primary text-primary-foreground">
                      {step === 1 && isPending ? 'Sending code…' : <>Next <ChevronRight className="w-4 h-4 ml-2" /></>}
                    </Button>
                  ) : (
                    <Button type="submit" size="lg" disabled={isPending} className="bg-primary text-primary-foreground font-semibold px-8">
                      {isPending ? 'Processing…' : 'Submit Application'}
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
