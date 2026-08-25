# Go-live cutover

**Everything that can be done in code is done.** What remains is four phases of dashboard
work against three services. Budget **~30 minutes of clicking, plus up to 48 hours of waiting
for DNS.**

Do the phases in order. Phase B cannot start until Phase A's CNAME resolves, and Phase C
cannot start until Phase B says "verified".

**Cost: $0.** The team already owns `exodiusftc.com`. There is nothing to buy.

---

## Before you start — what already exists

| Thing | State |
|---|---|
| `exodiusftc.com` | **Owned by the team.** Registrar/DNS at GoDaddy (`ns13/ns14.domaincontrol.com`) |
| `exodiusftc.com` + `www` | The team's public site, hosted on **Netlify**. **Do not disturb.** |
| Resend sending | **Fully verified.** SPF at `send.`, DKIM at `resend._domainkey`, SES feedback MX. Email works today |
| DMARC | **Missing.** The one real email gap. Fixed in Phase A |
| Clerk | Development instance `desired-guppy-89.clerk.accounts.dev`. Fixed in Phase B |
| App URL | `ftc-sponsorship-portal.vercel.app`. Fixed in Phase C |
| Production data | **All test data.** One seeded admin, three "dev testing" sponsors, one orphaned ledger row. Cleared in Phase D |

---

## ⚠️ The one thing that can break the team's website

GoDaddy and Vercel will both offer to take over the domain's **nameservers**. Vercel's own
CLI suggests it:

```
b) Change your Domain's nameservers to the intended set detailed above.
```

**Do not do this.** The apex `exodiusftc.com` and `www` point at Netlify and serve the team's
public site. Moving nameservers to Vercel hands Vercel authority over the whole domain and the
team site goes dark until every existing record is rebuilt there.

**Add the individual records below and nothing else.**

---

## Phase A — DNS at GoDaddy (10 minutes, then wait)

Sign in to GoDaddy → **My Products → exodiusftc.com → DNS → Manage Zones**.

Add these three records:

| Type | Name / Host | Value | TTL | Why |
|---|---|---|---|---|
| `CNAME` | `pitfund` | `d0b957cc64a8c9ba.vercel-dns-017.com.` | 1 hour | Points the app at Vercel |
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:exodiusftc@gmail.com; fo=1; adkim=r; aspf=r` | **600** | Email auth policy at the apex |
| `TXT` | `_dmarc.send` | `v=DMARC1; p=none; rua=mailto:exodiusftc@gmail.com; fo=1; adkim=r; aspf=r` | **600** | Same, for the subdomain Resend sends from |

Notes:
- GoDaddy wants the **host only** (`pitfund`, `_dmarc`), not the full name. It appends the domain.
- If GoDaddy rejects the trailing dot on the CNAME value, drop it.
- **Both DMARC records are required.** A policy on `send.` does not protect the parent domain,
  and an apex with no DMARC is a spoofing target regardless of what the subdomain publishes.
- `p=none` means "monitor, don't reject" — deliberate, so a misconfiguration cannot silently bin
  real mail. **Keep TTL at 600** during the ramp; that is what makes rollback fast. The staged
  ramp to `p=quarantine` and then `p=reject` is in `docs/email-deliverability.md` §3 and §11.
- Point `rua=` at a mailbox someone actually reads.

**Verify before moving on:**

```bash
dig +short pitfund.exodiusftc.com CNAME
dig +short _dmarc.exodiusftc.com      TXT
dig +short _dmarc.send.exodiusftc.com TXT
curl -sI https://pitfund.exodiusftc.com | head -1     # expect HTTP/2 200
```

Note `dig` takes **one record type per query** — `dig name TXT CNAME A` does not do what it
looks like it does; it treats the extra types as hostnames and quietly returns misleading
results. One record type at a time.

Confirm the team site still works: `curl -sI https://exodiusftc.com | head -1`

---

## Phase B — Clerk production instance (15 minutes, then wait)

**This is the step that must happen before the first real coach signs up.** Development-mode
accounts **cannot be migrated** to production. Anyone who signs up before this switch has to
sign up again afterwards. Right now that number is zero, so the cost is zero. It will never
be cheaper.

There is no API for this — Clerk creates production instances through the dashboard only.

1. **Clerk dashboard** → instance dropdown (top-left, currently says "Development") →
   **Create production instance** → **Clone settings from development**.
2. Set the application domain to **`pitfund.exodiusftc.com`**.
3. Clerk shows a **Domains** page with roughly five DNS records — hosts like `clerk`,
   `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey`. **The values are unique to your
   instance; copy them from the dashboard.** Add each at GoDaddy exactly as shown.
4. Wait for Clerk to report **verified**. Usually under an hour; Clerk warns it can take 48.
5. **Set the password policy again — it does not clone.** 12+ characters, upper, lower, number.
   The app's Zod schemas deliberately do not validate passwords; Clerk owns that rule, so if
   you skip this the policy silently becomes Clerk's weaker default.
6. **Register the new instance with Supabase.** Supabase dashboard → **Authentication →
   Third-party auth** → add the **production** Clerk instance.
   **If you skip this, every page loads but renders empty** — RLS rejects every row because
   Supabase no longer trusts the token. It looks exactly like a data bug and is a config bug.
   It is the single most likely way this cutover goes wrong.
7. **Create the webhook.** Clerk → **Webhooks** → endpoint
   `https://pitfund.exodiusftc.com/api/webhooks/clerk`, subscribed to **`user.deleted`** and
   **`user.updated`**. Copy the new signing secret (`whsec_…`) for Phase C.

---

## Phase C — Flip Vercel's environment (5 minutes)

Four variables. All four, or the app half-switches and breaks.

```bash
for v in NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY \
         CLERK_WEBHOOK_SIGNING_SECRET NEXT_PUBLIC_APP_URL; do
  vercel env rm  "$v" production --yes
  vercel env add "$v" production      # paste the value when prompted
done
```

| Variable | New value |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` from the production instance |
| `CLERK_SECRET_KEY` | `sk_live_…` from the production instance |
| `CLERK_WEBHOOK_SIGNING_SECRET` | `whsec_…` from Phase B step 7 |
| `NEXT_PUBLIC_APP_URL` | `https://pitfund.exodiusftc.com` |

`NEXT_PUBLIC_APP_URL` is load-bearing: **every link in every outgoing email is built from it.**
If it still says `vercel.app`, sponsors get links to the old host.

Then redeploy — env changes do not take effect until you do, and there is no Git integration:

```bash
vercel deploy --prod --yes
```

---

## Phase D — Clear the test data (5 minutes)

Production currently holds only test data:

- one profile, `admin+clerk_test@example.com`, linked to a **development** Clerk user id that
  will be meaningless after Phase B
- three sponsors named "dev testing"
- one `transactions_ledger` row for **$2,000** with `submission_id = NULL`, left over from a
  test decision. `void_match_atomic` cannot reverse it — a void needs a submission to point at.

**Supabase Free has no automatic backups. Take a dump first.**

```bash
/opt/homebrew/opt/libpq/bin/pg_dump "$DATABASE_URL" > ~/pitfund-preLaunch-$(date +%F).sql
```

Then:

```sql
BEGIN;
DELETE FROM transactions_ledger;          -- the orphaned $2,000 test row
UPDATE sponsors SET funding_used_cents = 0;
DELETE FROM sponsors  WHERE company_name ILIKE 'dev testing%';
DELETE FROM notifications;
DELETE FROM profiles  WHERE email LIKE '%clerk_test@example.com';
-- Confirm the invariant still holds before you commit:
SELECT count(*) AS drift_rows FROM detect_capacity_drift();   -- must be 0
COMMIT;
```

`transactions_ledger` is append-only **by design**, and deleting from it is normally forbidden —
a reversal is a compensating negative row, never a delete. This is the one legitimate exception:
clearing test fixtures before launch, not reversing a business record. After this, the rule
applies absolutely.

**Then create the real admin.** Sign up normally at
`https://pitfund.exodiusftc.com/signup`, then:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'you@exodiusftc.com';
```

Sign out and back in — admin navigation should appear.

---

## Phase E — Verify

```bash
npm run typecheck && npm run lint && npm test && npm run build
node scripts/verify-backlog.mjs        # 17.3 (DMARC) should now pass
curl -s https://pitfund.exodiusftc.com/api/health
curl -sI https://exodiusftc.com | head -1    # team site still alive
```

Then by hand, on the real domain:

1. Sign up as a coach → verify email → build a team → submit a pitch.
2. As admin: approve → dispatch. **Confirm the sponsor email arrives and its links point at
   `pitfund.exodiusftc.com`.**
3. As sponsor: accept in full. Then on another pitch, counter-offer a smaller amount.
4. Confirm both sides receive the handshake email with each other's contact details.
5. `/admin/capacity` → drift is zero.

Check the login page is served from **`accounts.pitfund.exodiusftc.com`**, not
`desired-guppy-89.clerk.accounts.dev`. That is the proof Phase B took effect.

---

## If it goes wrong

**Roll back the deployment** — Vercel → Deployments → the previous one → **Promote to
Production**. 30 seconds. See `docs/RUNBOOK.md`.

Rollback restores the old code *and* the old environment, which means it puts the development
Clerk instance back. That is a working state, so it is a safe place to land while you work out
what went wrong.

| Symptom | Cause |
|---|---|
| Every page loads but is empty | Phase B step 6 — Clerk not registered with Supabase |
| Nobody can sign in | Phase C — key mismatch, or you flipped only some of the four |
| Emails arrive with `vercel.app` links | Phase C — `NEXT_PUBLIC_APP_URL` not updated |
| Team website went down | Nameservers were moved. Restore GoDaddy's `ns13/ns14.domaincontrol.com` |
| Clerk still says development | Phase C not redeployed — env changes need a new deploy |
