import Image from 'next/image'
import type { SponsorImpactPayload } from '@/lib/impact-report/build'
import { isRecognitionBenefitType, recognitionBenefitLabel } from '@/lib/recognition'
import { RichText } from '@/components/ui/rich-text'

/**
 * The print-optimised report body. A Server Component: it renders a stored payload and
 * has no interactivity beyond the print button its parent supplies.
 *
 * Print rules live here rather than in the shell: `@page` has no Tailwind variant, and
 * `[data-print-hide]` is the contract the portal chrome opts into so this page never has
 * to restructure the shell to hide it.
 */
export function ImpactReportView({ payload }: { payload: SponsorImpactPayload }) {
  const money = (cents: number) =>
    `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

  const benefitLabel = (b: string) =>
    isRecognitionBenefitType(b) ? recognitionBenefitLabel(b) : b

  return (
    <>
      <style>{`
        @page { size: letter; margin: 0.6in; }
        @media print {
          [data-print-hide] { display: none !important; }
          .impact-team-card { break-inside: avoid; page-break-inside: avoid; }
          body { background: #fff; }
        }
      `}</style>

      <article className="space-y-8">
        <header className="flex items-start justify-between gap-6 border-b border-border pb-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Community impact report
            </p>
            <h1 className="mt-1 text-3xl font-semibold">{payload.sponsor.company_name}</h1>
            <p className="text-muted-foreground">{payload.year}</p>
          </div>
          {payload.sponsor.logo_url && (
            <Image
              src={payload.sponsor.logo_url}
              alt={payload.sponsor.company_name}
              width={96}
              height={96}
              unoptimized
              loading="eager"
              className="h-16 w-auto object-contain"
            />
          )}
        </header>

        <section>
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Summary
          </h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            {[
              ['Pledged', money(payload.totals.pledged_cents)],
              ['Received by teams', money(payload.totals.received_cents)],
              ['Outstanding', money(payload.totals.outstanding_cents)],
              ['Teams supported', String(payload.totals.teams_supported)],
              ['Students reached', payload.totals.students_reached.toLocaleString('en-US')],
              ['Volunteer hours', payload.totals.volunteer_hours.toLocaleString('en-US')],
              ['Events hosted', String(payload.totals.events_hosted)],
              ['Benefits promised', String(payload.totals.benefits_promised)],
              ['Benefits delivered', String(payload.totals.benefits_delivered)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border p-4">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="space-y-6">
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Teams supported
          </h2>

          {payload.teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sponsorships were pledged in {payload.year}.
            </p>
          ) : (
            payload.teams.map((section, i) => {
              const t = section.team
              const delivered = section.recognition.benefits.filter((b) => b.status === 'delivered')
              return (
                <div key={i} className="impact-team-card space-y-4 rounded-xl border border-border p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold">
                        {t.ftc_team_number ? `Team ${t.ftc_team_number} · ` : ''}
                        {t.team_name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {[t.organization, [t.city, t.state].filter(Boolean).join(', '), t.tax_status]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    {t.logo_url && (
                      <Image
                        src={t.logo_url}
                        alt={t.team_name}
                        width={64}
                        height={64}
                        unoptimized
                        loading="eager"
                        className="h-12 w-auto object-contain"
                      />
                    )}
                  </div>

                  {t.tagline && <p className="text-sm italic text-muted-foreground">{t.tagline}</p>}

                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      ['Students reached', t.students_reached],
                      ['Events hosted', t.events_hosted],
                      ['Volunteer hours', t.volunteer_hours],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-lg border border-border p-3 text-center">
                        <p className="text-xl font-semibold tabular-nums">
                          {(value as number | null)?.toLocaleString('en-US') ?? '—'}
                        </p>
                        <p className="text-xs text-muted-foreground">{label}</p>
                      </div>
                    ))}
                  </div>

                  {t.mission_statement && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                        Mission
                      </p>
                      {/* B-03-02. The CSR audience for a year-end report should not be
                          shown raw markup. Rendered, matching the sponsor-facing pitch. */}
                      <RichText html={t.mission_statement} className="mt-1 text-sm leading-relaxed" />
                    </div>
                  )}

                  {section.achievements.length > 0 && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                        Awards &amp; outcomes
                      </p>
                      <ul className="mt-1 space-y-1 text-sm">
                        {section.achievements.map((a, j) => (
                          <li key={j}>
                            <span className="font-medium">{a.award ?? 'Award'}</span>
                            {a.event_name ? ` — ${a.event_name}` : ''}
                            {a.season ? ` (${a.season})` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      Recognition{section.recognition.tier_name ? ` · ${section.recognition.tier_name}` : ''}
                    </p>
                    {section.recognition.benefits.length === 0 ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        No recognition benefits were attached to this sponsorship.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-1 text-sm">
                        {section.recognition.benefits.map((b, j) => (
                          <li key={j}>
                            {benefitLabel(b.benefit_type)} — {b.status.replace(/_/g, ' ')}
                            {b.delivered_at
                              ? ` (${new Date(b.delivered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`
                              : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {delivered.some((b) => b.proof_url) && (
                    <div className="flex flex-wrap gap-3">
                      {delivered
                        .filter((b) => b.proof_url)
                        .map((b, j) => (
                          <Image
                            key={j}
                            src={b.proof_url as string}
                            alt={`${benefitLabel(b.benefit_type)} proof`}
                            width={160}
                            height={120}
                            unoptimized
                            loading="eager"
                            className="h-28 w-auto rounded-md border border-border object-cover"
                          />
                        ))}
                    </div>
                  )}

                  {t.media_urls.length > 0 && (
                    <div className="flex flex-wrap gap-3">
                      {t.media_urls.map((url, j) => (
                        <Image
                          key={j}
                          src={url}
                          alt={`${t.team_name} portfolio`}
                          width={160}
                          height={120}
                          unoptimized
                          loading="eager"
                          className="h-28 w-auto rounded-md border border-border object-cover"
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </section>

        <footer className="space-y-2 border-t border-border pt-6 text-xs text-muted-foreground">
          {payload.footnotes.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
          {/* Printed copies must be traceable back to the snapshot they came from. */}
          <p>
            Generated {new Date(payload.generated_at).toLocaleString('en-US')} · payload schema v
            {payload.schema_version}
          </p>
        </footer>
      </article>
    </>
  )
}
