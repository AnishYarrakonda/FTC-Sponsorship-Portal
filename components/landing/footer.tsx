import Link from 'next/link'
import { Globe, Mail, AtSign } from 'lucide-react'
import {
  FOOTER_COLUMNS,
  FOOTER_SOCIALS,
  CURRENT_SEASON,
  BUILT_BY,
  IDEA_BY,
  TEAM_NAME,
  TEAM_NUMBER,
} from '@/lib/site-config'

const ICON_MAP = { Globe, Mail, AtSign } as const
type IconKey = keyof typeof ICON_MAP

export function LandingFooter() {
  return (
    <footer className="border-t border-border bg-background mt-12">
      <div className="mx-auto max-w-[1440px] px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          {/* brand column */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 text-primary">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-primary">
                <path d="M9 1L16.5 5.5V12.5L9 17L1.5 12.5V5.5L9 1Z" stroke="currentColor" strokeWidth="1.5" />
                <path d="M9 4L14 7V11.5L9 14.5L4 11.5V7L9 4Z" stroke="currentColor" strokeWidth="1" opacity="0.5" />
              </svg>
              <span className="text-sm font-semibold tracking-tight text-foreground">FTC Pitfund</span>
            </div>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
              The moderated sponsorship pipeline for FIRST Tech Challenge. Built for coaches,
              enforced by row-level security.
            </p>
            <div className="mt-6 flex items-center gap-2">
              {FOOTER_SOCIALS.map((s) => {
                const Icon = ICON_MAP[s.icon as IconKey]
                return (
                  <a
                    key={s.label}
                    href={s.href}
                    aria-label={s.label}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary shadow-sm"
                  >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
                  </a>
                )
              })}
            </div>
          </div>

          {/* link columns */}
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="text-xs font-mono uppercase tracking-[0.2em] text-foreground">{col.title}</div>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-[14px] text-muted-foreground hover:text-primary transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 border-t border-border pt-6 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span suppressHydrationWarning>© {new Date().getFullYear()} FTC Pitfund</span>
            <span className="font-mono text-xs">Built for Season {CURRENT_SEASON}</span>
          </div>
          <div className="mt-5 space-y-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
              FIRST Tech Challenge Team {TEAM_NAME} #{TEAM_NUMBER}
            </p>
            <p className="pt-1 text-[13px] text-foreground">
              Built by three of its members. Designed and engineered by{' '}
              <span className="font-medium">{BUILT_BY}</span>
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              From an original idea by{' '}
              {IDEA_BY.map((c, i) => (
                <span key={c.name}>
                  {i > 0 && ' and '}
                  {c.name} <span className="text-muted-foreground/70">({c.role})</span>
                </span>
              ))}
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
