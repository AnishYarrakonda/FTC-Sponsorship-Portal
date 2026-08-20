import type { Metadata } from "next"
import { ClerkProvider } from "@clerk/nextjs"
import { Hanken_Grotesk, Fraunces, Geist_Mono } from "next/font/google"
import { Toaster } from "sonner"
import "./globals.css"
import { 
  ACCENT_TEXT, 
  ACCENT_GLOBE
} from "@/lib/site-config"

const hankenGrotesk = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans" })
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-serif" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  // `template` so each route contributes its own title instead of all 34 sharing one.
  title: {
    default: "FTC Pitfund",
    template: "%s · FTC Pitfund",
  },
  description: "The moderated sponsorship pipeline for FIRST Tech Challenge teams. Build a verified portfolio, send admin-reviewed pitches, and connect with sponsors.",
}

import { ThemeProvider } from "@/components/theme-provider"
import { GlobalShortcuts } from "@/components/global-shortcuts"
import { RoboticsCursor } from "@/components/robotics-cursor"
import { DotGridClient } from "@/components/ui/dot-grid-client"
import { MotionPreferences } from "@/components/motion/motion-preferences"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // NOTE (report §12, "the cheapest win in the audit"): the recommended
    // `clerkJSVariant="headless"` does NOT exist in @clerk/nextjs v7.5.7 — the prop was
    // removed after v5. Verified: `grep -rho "clerkJS[A-Za-z]*" node_modules/@clerk/`
    // yields only clerkJSScriptUrl / clerkJSUrl / clerkJSVersion. Applying it produced a
    // type error, not a saving. The bundle observation may still be valid, but the
    // prescribed fix is stale for this version — see docs/REMEDIATION-LOG.md.
    <ClerkProvider>
      <html
        lang="en"
        className={`${hankenGrotesk.variable} ${fraunces.variable} ${geistMono.variable}`}
        style={{
          // @ts-expect-error CSS custom properties are not in React.CSSProperties
          '--accent-text': ACCENT_TEXT,
          '--accent-globe': ACCENT_GLOBE,
        }}
        suppressHydrationWarning
      >
        <body>
          <ThemeProvider
            attribute="data-theme"
            defaultTheme="light"
            forcedTheme="light"
            enableSystem={false}
            disableTransitionOnChange
          >
            <MotionPreferences>
              {/* isolate creates a stacking context so the fixed canvas at z-index:-1 sits above the body background */}
              <div style={{ isolation: 'isolate', position: 'relative' }}>
                <DotGridClient />
                {children}
                <GlobalShortcuts />
                <RoboticsCursor />
                <Toaster richColors position="top-right" />
              </div>
            </MotionPreferences>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
