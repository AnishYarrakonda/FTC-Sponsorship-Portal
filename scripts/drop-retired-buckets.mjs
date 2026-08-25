#!/usr/bin/env node
/**
 * Empties and deletes the two storage buckets retired by migration 0111:
 *   executed-agreements  (signed sponsorship agreements + the prepared-*.html drafts)
 *   tax-documents        (team W-9 uploads)
 *
 * WHY THIS IS A SCRIPT AND NOT PART OF THE MIGRATION
 * Supabase installs a trigger that refuses BOTH `DELETE FROM storage.objects` and
 * `DELETE FROM storage.buckets`:
 *     "Direct deletion from storage tables is not allowed. Use the Storage API instead."
 * The guard is correct -- a SQL delete removes the metadata row without telling the storage
 * backend to remove the file, orphaning the blob permanently. So the SQL layer can only drop
 * the buckets' RLS policies (0111 does) and assert they are empty (0111 does). Actually
 * removing them has to come through the API, i.e. here.
 *
 * ORDER: run this AFTER 0111. It is safe to run before, and safe to run twice -- a missing
 * bucket is reported and skipped, not treated as an error.
 *
 * Usage:  node scripts/drop-retired-buckets.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const RETIRED_BUCKETS = ['executed-agreements', 'tax-documents']

function loadEnv() {
  // Shell env wins over .env.local, matching the rest of the scripts/ directory: an operator
  // who exported a different project on purpose must not be silently overridden by a file.
  const fromShell = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
  if (fromShell.NEXT_PUBLIC_SUPABASE_URL && fromShell.SUPABASE_SERVICE_ROLE_KEY) return fromShell

  const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const parsed = Object.fromEntries(
    text
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
      })
  )
  return { ...parsed, ...Object.fromEntries(Object.entries(fromShell).filter(([, v]) => v)) }
}

const env = loadEnv()
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

/**
 * Objects are partitioned by Clerk user id (`<clerk_sub>/<team_or_submission_id>/<file>`), so a
 * flat list() of the bucket root returns FOLDERS, not files. Recurse, or you will "empty" a
 * bucket that is still full.
 */
async function walk(bucket, prefix = '') {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
  const files = []
  for (const entry of data ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.id === null) files.push(...(await walk(bucket, path)))
    else files.push(path)
  }
  return files
}

const { data: buckets, error: listErr } = await admin.storage.listBuckets()
if (listErr) throw new Error(`listBuckets: ${listErr.message}`)
const present = new Set((buckets ?? []).map((b) => b.name))

let removedAny = false
for (const bucket of RETIRED_BUCKETS) {
  if (!present.has(bucket)) {
    console.log(`${bucket}: already gone`)
    continue
  }

  const paths = await walk(bucket)
  if (paths.length > 0) {
    console.log(`${bucket}: removing ${paths.length} object(s)`)
    const { error } = await admin.storage.from(bucket).remove(paths)
    if (error) throw new Error(`remove from ${bucket}: ${error.message}`)

    const left = await walk(bucket)
    if (left.length > 0) throw new Error(`${bucket}: ${left.length} object(s) survived removal`)
  }

  const { error: delErr } = await admin.storage.deleteBucket(bucket)
  if (delErr) throw new Error(`deleteBucket ${bucket}: ${delErr.message}`)
  console.log(`${bucket}: deleted`)
  removedAny = true
}

console.log(removedAny ? '\nRetired buckets removed.' : '\nNothing to do.')
