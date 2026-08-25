import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * What both sides see once a sponsor has said yes.
 *
 * This is the whole of the post-match experience. Everything that used to live downstream of
 * this moment -- an e-signature ceremony, a payment state machine, W-9 collection, tax
 * receipts -- was removed in migration 0111, because the platform never touches the money and
 * tracking a transaction it cannot observe meant asserting things it could not stand behind.
 *
 * So the product's job here is narrow and it should be done well: tell each party who the
 * other one is, what was agreed, and that the next move is theirs. The one genuinely useful
 * thing left is the counterparty's email address, which neither side can otherwise see --
 * v_sponsors_public deliberately omits contact_email (P0-4) and profiles_select is
 * own-row-plus-admin, so both directions are resolved server-side through the admin client
 * and passed down here already narrowed to a single address.
 *
 * Deliberately has no 'use client' and no server-only imports: it renders inside server
 * components today, and should stay droppable into a client tree without a refactor.
 */
export function MatchHandoffPanel({
  viewer,
  counterpartyName,
  counterpartyEmail,
  amountCents,
  askedForCents,
  teamName,
}: {
  viewer: 'coach' | 'sponsor'
  /** Sponsor company name for the coach's view; team name for the sponsor's. */
  counterpartyName: string
  /** null when it could not be resolved -- the contact line is then omitted rather than faked. */
  counterpartyEmail: string | null
  /** What the sponsor actually committed. */
  amountCents: number
  /** The original ask. Only rendered when it differs, i.e. this was a partial offer. */
  askedForCents?: number | null
  teamName: string
}) {
  const money = (cents: number) =>
    (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

  // A partial offer is the normal, healthy outcome of a negotiation, not a shortfall to
  // apologise for -- so it is stated plainly and only when it is actually true.
  const isPartial = typeof askedForCents === 'number' && askedForCents > amountCents

  const steps =
    viewer === 'coach'
      ? [
          `Reply to ${counterpartyName} to introduce yourself and confirm the amount.`,
          'Send them whatever their finance team needs — most will ask for a W-9 and an invoice or payment instructions.',
          'They pay your team directly by check, ACH or wire.',
        ]
      : [
          `Reply to ${teamName} to introduce yourself and confirm the amount.`,
          'Ask them for anything your AP department needs — typically a W-9 and payment instructions.',
          'Pay the team directly by check, ACH or wire.',
        ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What happens next</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-foreground">
          {viewer === 'coach' ? (
            <>
              <span className="font-medium">{counterpartyName}</span> committed{' '}
              <span className="font-medium tabular-nums">{money(amountCents)}</span> to {teamName}.
            </>
          ) : (
            <>
              You committed <span className="font-medium tabular-nums">{money(amountCents)}</span> to{' '}
              <span className="font-medium">{teamName}</span>.
            </>
          )}
          {isPartial && (
            <span className="text-muted-foreground">
              {' '}
              ({money(askedForCents!)} was requested.)
            </span>
          )}
        </p>

        <ol className="space-y-2 text-sm text-muted-foreground">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-medium tabular-nums text-foreground"
              >
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        {counterpartyEmail && (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {viewer === 'coach' ? 'Sponsor contact' : 'Team contact'}
            </p>
            <a
              href={`mailto:${counterpartyEmail}`}
              className="mt-0.5 block text-sm font-medium text-foreground underline underline-offset-2 hover:no-underline"
            >
              {counterpartyEmail}
            </a>
          </div>
        )}

        {/* Said once, plainly, on the one screen where someone might otherwise assume
            otherwise. The platform is a matchmaker; it is not a payment processor and
            never sees the funds. */}
        <p className="text-xs text-muted-foreground">
          Payment happens directly between the sponsor and the team. FTC Pitfund never
          receives, holds or transfers money, and does not track whether payment has been made.
        </p>
      </CardContent>
    </Card>
  )
}
