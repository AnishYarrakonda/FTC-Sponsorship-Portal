-- 0105_submissions_updated_at_index.sql
-- A-09-01 (P1): the admin dashboard filters submissions by `updated_at >= <7 days ago>`
-- and no index covered that column, so the query degrades to a sequential scan on the
-- dashboard's first paint — the page an admin opens before anything else.
--
-- DESC to match the ordering the dashboard reads in, so one index serves both the range
-- filter and the sort. Not partial: the window is relative to now(), so any WHERE clause
-- baked into the index would go stale the day after it was created.
--
-- CREATE INDEX (not CONCURRENTLY): the migration runner applies files inside a
-- transaction via `psql -f`, and CONCURRENTLY cannot run in one. submissions is small
-- enough that the brief lock is not worth splitting this into a separate manual step.
--
-- Idempotent: IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_submissions_updated_at
  ON public.submissions USING btree (updated_at DESC);

-- The two queries the finding actually cites are
--   .eq('status', 'approved'|'declined').gte('updated_at', sevenDaysAgo)
-- and a leading `updated_at` index cannot serve the equality. This composite makes both
-- of them index-only. The plain index above stays because it is what
-- `v_submission_summary ORDER BY updated_at DESC LIMIT 8` on the same page needs, and a
-- composite's second column cannot drive a bare sort.
--
-- Two indexes for one finding is deliberate, and each is named against the query it
-- serves so a future reader can drop one on evidence rather than on guesswork.
CREATE INDEX IF NOT EXISTS idx_submissions_status_updated_at
  ON public.submissions USING btree (status, updated_at DESC);
