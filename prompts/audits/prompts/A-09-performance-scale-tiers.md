# A-09 — Performance, scale & tier limits

**Lane A (static — parallel-safe).** Audit id `A-09`.
**Outputs:** `prompts/audits/findings/A-09-findings.md` · `prompts/audits/handoff/A-09-claude-prompt.md`

> Read `prompts/audits/_CONTEXT-AUDIT.md` in full first.
> **This audit owns the "should I pay for Supabase Pro?" question.** The human wants a
> defensible answer with numbers, not a shrug. Every claim you make about a limit must cite
> the limit, the current usage or a stated projection, and the plan that raises it.

---

## You own

Query and index design across all 33 tables, the data-fetch patterns in every Server Component
and route handler, caching and revalidation, bundle size, the cron in `vercel.json`, and the
hosting/plan constraints of Supabase, Vercel, Clerk, Resend, and Sentry.

## Investigate

1. **Index coverage.** Extract every index from the migrations. Then extract every query in
   `app/**` and `lib/**` — every `.eq()`, `.in()`, `.order()`, `.range()`, `.textSearch()`, and
   every RPC's internal SQL — and match each against an index. Report every filter or sort with
   no supporting index, and every index nothing uses. **Pay special attention to the predicates
   inside RLS policies and `SECURITY DEFINER` helpers**: those run per row, and an unindexed
   predicate there is what turns a 200 ms page into a timeout. `current_sponsor_ids()` and
   `sponsor_can_view_team()` are the ones to scrutinize.
2. **N+1 and over-fetching.** Find every list page that queries per row, every `select('*')`
   pulling columns the page never renders (especially wide text and document columns), and
   every page issuing sequential awaits that could run in parallel. Name the page, the query,
   and the row count at which it becomes a problem.
3. **Unbounded reads.** Every query with no `limit`/`range`: the admin moderation queue, the
   audit log, notifications, the sponsor dashboard, CSV export, the impact report. State what
   happens at 10k, 100k, and 1M rows. `/api/admin/export` and the impact-report generation are
   the likeliest to blow a function's memory or the 300 s timeout — check whether they stream.
4. **Caching.** Which routes are static, dynamic, or ISR; where `revalidatePath`/`revalidateTag`
   is used; whether anything user-specific is cached where it could leak across users (that is
   a P0, not a performance bug); and whether `public_platform_stats` /
   `refresh_public_platform_stats()` is refreshed on a sane cadence.
5. **Connections.** Supabase free tier has a hard connection ceiling and the pooler matters.
   Count how many distinct clients a single page render creates. Confirm whether the session
   pooler or direct connection is used and whether that is right for serverless.
6. **Client bundle.** Find the largest `'use client'` boundaries and anything heavy imported
   into them (date libraries, editors, PDF, icon sets imported wholesale). Check whether
   `next/image` and `next/font` are used consistently. Run `npm run build` and quote the actual
   route sizes from the output as evidence — that build output is your best hard data.
7. **The cron.** `/api/cron/expire-submissions` at 02:00 UTC. On Vercel Hobby, cron is
   best-effort and limited in frequency. What breaks if it is late, skipped, or duplicated?
   Is it idempotent? How long does it take at scale, and does it approach the timeout?
8. **The tier table — this is the deliverable.** Build a row per service:

   | Service | Limit that binds first | Current or projected usage | Evidence | Plan that fixes it | Price |

   Cover at minimum: Supabase free (500 MB database, 1 GB storage, 5 GB egress, connection
   ceiling, **project pausing after 7 days idle**, no PITR, 2-day backups) vs Pro; Vercel Hobby
   (**no commercial use**, cron limits, function duration, concurrency) vs Pro; Clerk free MAU
   and the plan gate on **Organizations** and enterprise SSO connections; Resend free monthly
   volume and domain limits; Sentry free event quota. **Verify each limit against current
   published documentation rather than memory, and say so.** Then give a single ranked
   recommendation: what to upgrade first, at what trigger, and what it costs — plus what is
   *not* worth paying for yet.
9. **Growth model.** State your assumptions explicitly (teams, sponsors, submissions/team/year,
   documents/submission, emails/submission) and show the arithmetic. A wrong-but-explicit model
   is useful; an unstated one is not.

## Done when

Every unindexed hot predicate is named, the build output is quoted, and the tier table is
complete enough that the human can make the buy decision from it without further research.
