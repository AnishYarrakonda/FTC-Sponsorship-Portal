'use client'

import { useState, useRef, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { loginSchema, type LoginInput } from '@/lib/schemas/auth'
import { useSignIn } from '@clerk/nextjs/legacy'
import { useAuth } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { useSearchParams, useRouter } from 'next/navigation'
import { safeInternalPath } from '@/lib/client-errors'

// Map known Clerk error codes to friendly, actionable messages (wrong password
// vs unknown email vs rate-limited), falling back to Clerk's own message.
function friendlyClerkError(err: unknown, fallback: string): string {
  const anyErr = err as {
    status?: number
    errors?: { code?: string; longMessage?: string; message?: string }[]
  }
  const first = anyErr?.errors?.[0]
  switch (first?.code) {
    case 'form_identifier_not_found':
      return 'No account found with that email address. Check for typos, or create an account below.'
    case 'form_password_incorrect':
      return 'That password is incorrect. Try again, or use “Forgot password?” to reset it.'
    case 'too_many_requests':
    case 'rate_limit_exceeded':
      return 'Too many attempts — you have been temporarily rate-limited. Wait a minute and try again.'
    case 'form_code_incorrect':
      return 'That code is incorrect. Double-check the 6 digits and try again.'
    case 'verification_expired':
      return 'That code has expired. Use “Resend code” to get a fresh one.'
    case 'user_locked':
      return 'Your account is temporarily locked after too many failed attempts. Try again later or reset your password.'
    default:
      if (anyErr?.status === 429) {
        return 'Too many attempts — please wait a minute and try again.'
      }
      return first?.longMessage ?? first?.message ?? fallback
  }
}

const RESEND_COOLDOWN_SECONDS = 30
const CODE_EXPIRY_MS = 10 * 60 * 1000 // Clerk email codes last ~10 minutes

type Mode = 'login' | 'device-verify' | 'forgot-request' | 'forgot-reset'

export function LoginForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const resetSuccess = searchParams.get('reset') === 'success'
  const accountDeleted = searchParams.get('deleted') === '1'
  // Open-redirect guard. `redirect_url` is attacker-controllable
  // (…/login?redirect_url=https://evil.example/) and was fed straight into
  // router.push() at three sites below. middleware.ts only ever sets a pathname, so
  // anything that is not a same-origin path is not ours and is discarded.
  const redirectUrl = safeInternalPath(searchParams.get('redirect_url'))
  const { isLoaded, signIn, setActive } = useSignIn()
  const { isLoaded: authLoaded, isSignedIn } = useAuth()

  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [mode, setMode] = useState<Mode>('login')

  // Forgot-password local state
  const [resetEmail, setResetEmail] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [resetNewPassword, setResetNewPassword] = useState('')

  // Client Trust (new-device verification) local state
  const [deviceCode, setDeviceCode] = useState('')
  const [deviceEmail, setDeviceEmail] = useState('')
  const [deviceEmailId, setDeviceEmailId] = useState('')
  const [deviceCodeSentAt, setDeviceCodeSentAt] = useState<number | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)

  // Tick the resend cooldown down once per second while active.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setInterval(() => setResendCooldown((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [resendCooldown])

  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // If the visitor already has an active Clerk session, the login form is a
  // dead end — Clerk's signIn.create() would throw "You're already signed in."
  // Bounce them straight to the dashboard instead of showing that error.
  useEffect(() => {
    if (authLoaded && isSignedIn) {
      router.replace('/dashboard')
    }
  }, [authLoaded, isSignedIn, router])

  // The reactive effect above does NOT fire when the page is restored from the
  // browser's back/forward cache (bfcache) — React's state is frozen and reused,
  // so a user pressing Back lands on the stale form. The `pageshow` event with
  // `persisted === true` is the only signal for a bfcache restore; re-check the
  // live Clerk instance there and redirect if a session exists.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (
        e.persisted &&
        (window as unknown as { Clerk?: { user?: unknown } }).Clerk?.user
      ) {
        router.replace('/dashboard')
      }
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [router])

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const setSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    setSize();

    type P = { x: number; y: number; v: number; o: number };
    let ps: P[] = [];
    let raf = 0;

    const make = () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      v: Math.random() * 0.25 + 0.05,
      o: Math.random() * 0.35 + 0.15,
    });

    const init = () => {
      ps = [];
      const count = Math.floor((canvas.width * canvas.height) / 9000);
      for (let i = 0; i < count; i++) ps.push(make());
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const isDark = !document.documentElement.hasAttribute('data-theme') || document.documentElement.getAttribute('data-theme') === 'dark';
      ps.forEach((p) => {
        p.y -= p.v;
        if (p.y < 0) {
          p.x = Math.random() * canvas.width;
          p.y = canvas.height + Math.random() * 40;
          p.v = Math.random() * 0.25 + 0.05;
          p.o = Math.random() * 0.35 + 0.15;
        }
        ctx.fillStyle = isDark ? `rgba(250,250,250,${p.o})` : `rgba(0,0,0,${p.o * 0.5})`;
        ctx.fillRect(p.x, p.y, 0.7, 2.2);
      });
      raf = requestAnimationFrame(draw);
    };

    const onResize = () => {
      setSize();
      init();
    };

    window.addEventListener("resize", onResize);
    init();
    raf = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function onSubmit(values: LoginInput) {
    if (!isLoaded || !signIn) return
    // Guard against submitting a stale autofilled form while already signed in
    // (Clerk would reject signIn.create with "You're already signed in.").
    if (isSignedIn) {
      router.replace('/dashboard')
      return
    }
    setIsPending(true)
    setError(null)
    try {
      const result = await signIn.create({
        identifier: values.email,
        password: values.password,
      })
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId })
        router.push(redirectUrl)
      } else if (result.status === 'needs_client_trust' || result.status === 'needs_second_factor') {
        // Password verified, but Clerk's Client Trust feature requires confirming
        // an emailed code before issuing a session on a new / untrusted device.
        const emailFactor = result.supportedSecondFactors?.find(
          (f) => f.strategy === 'email_code'
        )
        if (!emailFactor || emailFactor.strategy !== 'email_code') {
          setError('Unable to complete sign in. Please try again.')
          setIsPending(false)
          return
        }
        await signIn.prepareSecondFactor({
          strategy: 'email_code',
          emailAddressId: emailFactor.emailAddressId,
        })
        setDeviceEmail(emailFactor.safeIdentifier ?? values.email)
        setDeviceEmailId(emailFactor.emailAddressId)
        setDeviceCode('')
        setDeviceCodeSentAt(Date.now())
        setResendCooldown(RESEND_COOLDOWN_SECONDS)
        setMode('device-verify')
        setIsPending(false)
      } else {
        setError('Unable to complete sign in. Please try again.')
        setIsPending(false)
      }
    } catch (err) {
      setError(friendlyClerkError(err, 'Invalid email or password.'))
      setIsPending(false)
    }
  }

  // Client Trust — verify the emailed code to trust this device, then sign in.
  async function submitDeviceCode() {
    if (!isLoaded || !signIn) return
    setError(null)
    if (!deviceCode.trim()) {
      setError('Enter the 6-digit code sent to your email.')
      return
    }
    setIsPending(true)
    try {
      const result = await signIn.attemptSecondFactor({
        strategy: 'email_code',
        code: deviceCode.trim(),
      })
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId })
        router.push(redirectUrl)
      } else {
        setError('Unable to complete sign in. Please try again.')
        setIsPending(false)
      }
    } catch (err) {
      // Codes only live ~10 minutes — if this one is stale, say so explicitly
      // instead of a generic "invalid code".
      if (deviceCodeSentAt && Date.now() - deviceCodeSentAt > CODE_EXPIRY_MS) {
        setError('That code has expired (codes last about 10 minutes). Use “Resend code” to get a fresh one.')
      } else {
        setError(friendlyClerkError(err, 'Invalid code. Please try again.'))
      }
      setIsPending(false)
    }
  }

  // Client Trust — resend the device-verification code (cooldown-gated).
  async function resendDeviceCode() {
    if (!isLoaded || !signIn || !deviceEmailId || resendCooldown > 0) return
    setError(null)
    setIsPending(true)
    try {
      await signIn.prepareSecondFactor({ strategy: 'email_code', emailAddressId: deviceEmailId })
      setDeviceCode('')
      setDeviceCodeSentAt(Date.now())
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      setError(friendlyClerkError(err, 'Could not resend the code. Please try again.'))
    } finally {
      setIsPending(false)
    }
  }

  // Forgot password — Step 1: send the reset code to the email.
  async function sendResetCode() {
    if (!isLoaded || !signIn) return
    setError(null)
    if (!resetEmail.trim()) {
      setError('Enter your email address to receive a reset code.')
      return
    }
    setIsPending(true)
    try {
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier: resetEmail.trim(),
      })
      setMode('forgot-reset')
    } catch (err) {
      setError(friendlyClerkError(err, 'Could not send reset code. Check the email and try again.'))
    } finally {
      setIsPending(false)
    }
  }

  // Forgot password — Step 2: submit the code + new password.
  async function submitResetPassword() {
    if (!isLoaded || !signIn) return
    setError(null)
    if (!resetCode.trim()) {
      setError('Enter the 6-digit code sent to your email.')
      return
    }
    if (resetNewPassword.length < 12) {
      setError('Password must be at least 12 characters and include uppercase, lowercase, and a number.')
      return
    }
    setIsPending(true)
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: resetCode.trim(),
        password: resetNewPassword,
      })
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId })
        router.push(redirectUrl)
      } else {
        setError('Unable to reset password. Please try again.')
        setIsPending(false)
      }
    } catch (err) {
      setError(friendlyClerkError(err, 'Invalid code or password. Please try again.'))
      setIsPending(false)
    }
  }

  function backToLogin() {
    setMode('login')
    setError(null)
    setResetCode('')
    setResetNewPassword('')
    setDeviceCode('')
    setIsPending(false)
  }

  const cardTitle =
    mode === 'login' ? 'Log In'
      : mode === 'device-verify' ? 'Verify Your Device'
        : 'Reset Password'
  const cardDescription =
    mode === 'login'
      ? 'Welcome back. Access your sponsorship portal.'
      : mode === 'device-verify'
        ? 'For your security, enter the code we emailed to confirm this device.'
        : mode === 'forgot-request'
          ? 'Enter your email and we’ll send you a reset code.'
          : 'Enter the code we emailed you and choose a new password.'

  // Already authenticated — render a quiet redirecting state instead of the
  // sign-in form (the effects above are navigating to /dashboard).
  if (authLoaded && isSignedIn) {
    return (
      <section className="fixed inset-0 grid place-items-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">You’re already signed in. Redirecting…</p>
      </section>
    )
  }

  return (
    <section className="fixed inset-0 bg-background text-foreground overflow-y-auto">
      <style dangerouslySetInnerHTML={{ __html: `
        .accent-lines{position:absolute;inset:0;pointer-events:none;opacity:.7}
        .hline,.vline{position:absolute;background:var(--border);will-change:transform,opacity}
        .hline{left:0;right:0;height:1px;transform:scaleX(0);transform-origin:50% 50%;animation:drawX .8s cubic-bezier(.22,.61,.36,1) forwards}
        .vline{top:0;bottom:0;width:1px;transform:scaleY(0);transform-origin:50% 0%;animation:drawY .9s cubic-bezier(.22,.61,.36,1) forwards}
        .hline:nth-child(1){top:18%;animation-delay:.12s}
        .hline:nth-child(2){top:50%;animation-delay:.22s}
        .hline:nth-child(3){top:82%;animation-delay:.32s}
        .vline:nth-child(4){left:22%;animation-delay:.42s}
        .vline:nth-child(5){left:50%;animation-delay:.54s}
        .vline:nth-child(6){left:78%;animation-delay:.66s}
        @keyframes drawX{0%{transform:scaleX(0);opacity:0}60%{opacity:.95}100%{transform:scaleX(1);opacity:.7}}
        @keyframes drawY{0%{transform:scaleY(0);opacity:0}60%{opacity:.95}100%{transform:scaleY(1);opacity:.7}}

        .card-animate {
          opacity: 0;
          transform: translateY(20px);
          animation: fadeUp 0.8s cubic-bezier(.22,.61,.36,1) 0.4s forwards;
        }
        @keyframes fadeUp {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      ` }} />

      {/* Animated accent lines */}
      <div className="accent-lines fixed inset-0">
        <div className="hline" />
        <div className="hline" />
        <div className="hline" />
        <div className="vline" />
        <div className="vline" />
        <div className="vline" />
      </div>

      {/* Particles */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full pointer-events-none dark:opacity-50 opacity-40 mix-blend-multiply dark:mix-blend-screen"
      />

      {/* Header */}
      <header className="fixed left-0 right-0 top-0 flex items-center justify-between px-6 py-4 border-b border-border/80 z-20 bg-background/50 backdrop-blur">
        <Link href="/" className="text-xs tracking-[0.14em] uppercase text-muted-foreground hover:text-foreground transition-colors">
          PITFUND
        </Link>
        <Link href="/signup">
          <Button
            variant="outline"
            className="h-9 rounded-lg border-border bg-card text-foreground hover:bg-accent"
          >
            <span className="mr-2">Sign Up</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
      </header>

      {/* Centered Login Card */}
      <div className="min-h-screen w-full grid place-items-center px-4 py-24 relative z-10">
        <Card className="card-animate w-full max-w-md border-border bg-card/70 backdrop-blur shadow-2xl">
          <CardHeader className="border-b border-border/50 pb-6 text-center">
            <CardTitle className="text-2xl text-foreground font-semibold tracking-tight">{cardTitle}</CardTitle>
            <CardDescription className="text-muted-foreground mt-2">
              {cardDescription}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-8">
            {/* Shared alerts */}
            {resetSuccess && mode === 'login' && (
              <Alert className="bg-emerald-500/10 border-emerald-500/20 text-status-success mb-6">
                <AlertDescription>Password updated successfully. Log in with your new password.</AlertDescription>
              </Alert>
            )}
            {accountDeleted && mode === 'login' && (
              <Alert className="bg-emerald-500/10 border-emerald-500/20 text-status-success mb-6">
                <AlertDescription>
                  Your account was deleted. All of your data has been removed — thanks for being part of the
                  portal. You can create a new account any time.
                </AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive mb-6">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* LOGIN MODE */}
            {mode === 'login' && (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground/80">Email Address</FormLabel>
                        <FormControl>
                          <Input
                            type="email" autoComplete="email"
                            className="bg-background border-input text-foreground placeholder:text-muted-foreground h-11"
                            placeholder="coach@example.com"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-foreground/80">Password</FormLabel>
                          <button
                            type="button"
                            onClick={() => {
                              setError(null)
                              setResetEmail(form.getValues('email'))
                              setMode('forgot-request')
                            }}
                            className="text-sm font-medium text-primary hover:underline underline-offset-4 transition-colors"
                          >
                            Forgot password?
                          </button>
                        </div>
                        <FormControl>
                          <Input
                            type="password"
                            autoComplete="current-password"
                            className="bg-background border-input text-foreground h-11"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full h-11 bg-primary text-primary-foreground font-semibold text-base transition-all duration-200"
                    disabled={isPending || !isLoaded}
                  >
                    {isPending ? 'Authenticating...' : 'Log In'}
                  </Button>
                </form>
              </Form>
            )}

            {/* CLIENT TRUST — VERIFY NEW DEVICE */}
            {mode === 'device-verify' && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="device-verification-code" className="text-sm font-medium text-foreground/80">Verification Code</label>
                  <Input
                    id="device-verification-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="bg-background border-input text-foreground placeholder:text-muted-foreground h-11 tracking-[0.3em] text-center"
                    placeholder="123456"
                    value={deviceCode}
                    onChange={(e) => setDeviceCode(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    We emailed a 6-digit code to {deviceEmail || 'your email'}. Codes expire after about 10 minutes.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={submitDeviceCode}
                  className="w-full h-11 bg-primary text-primary-foreground font-semibold text-base"
                  disabled={isPending || !isLoaded}
                >
                  {isPending ? 'Verifying…' : 'Verify & Sign In'}
                </Button>
                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resendDeviceCode}
                    className="border-border bg-transparent"
                    disabled={isPending || resendCooldown > 0}
                  >
                    {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
                  </Button>
                  <button
                    type="button"
                    onClick={backToLogin}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Back to login
                  </button>
                </div>
              </div>
            )}

            {/* FORGOT PASSWORD — REQUEST CODE */}
            {mode === 'forgot-request' && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="reset-email-address" className="text-sm font-medium text-foreground/80">Email Address</label>
                  <Input
                    id="reset-email-address"
                    type="email" autoComplete="email"
                    className="bg-background border-input text-foreground placeholder:text-muted-foreground h-11"
                    placeholder="coach@example.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  onClick={sendResetCode}
                  className="w-full h-11 bg-primary text-primary-foreground font-semibold text-base"
                  disabled={isPending || !isLoaded}
                >
                  {isPending ? 'Sending…' : 'Send Reset Code'}
                </Button>
                <button
                  type="button"
                  onClick={backToLogin}
                  className="flex items-center justify-center w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back to login
                </button>
              </div>
            )}

            {/* FORGOT PASSWORD — ENTER CODE + NEW PASSWORD */}
            {mode === 'forgot-reset' && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="reset-verification-code" className="text-sm font-medium text-foreground/80">Verification Code</label>
                  <Input
                    id="reset-verification-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="bg-background border-input text-foreground placeholder:text-muted-foreground h-11 tracking-[0.3em] text-center"
                    placeholder="123456"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    We emailed a 6-digit code to {resetEmail || 'your email'}.
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="reset-new-password" className="text-sm font-medium text-foreground/80">New Password</label>
                  <Input
                    id="reset-new-password"
                    type="password"
                    autoComplete="new-password"
                    className="bg-background border-input text-foreground h-11"
                    value={resetNewPassword}
                    onChange={(e) => setResetNewPassword(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Must be at least 12 characters and include uppercase, lowercase, and a number.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={submitResetPassword}
                  className="w-full h-11 bg-primary text-primary-foreground font-semibold text-base"
                  disabled={isPending || !isLoaded}
                >
                  {isPending ? 'Resetting…' : 'Reset Password & Sign In'}
                </Button>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setMode('forgot-request')}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Resend code
                  </button>
                  <button
                    type="button"
                    onClick={backToLogin}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Back to login
                  </button>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="border-t border-border/50 flex justify-center py-6 bg-accent/10 rounded-b-xl">
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="text-foreground hover:underline font-medium">
                Create one
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </section>
  )
}
