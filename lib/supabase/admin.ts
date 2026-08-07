import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'
import { env } from '@/lib/env'
import { isDevAuthBypass, createMockSupabaseClient } from '@/lib/dev-bypass'
import { COACH_PREVIEW, createMockCoachClient } from '@/lib/dev-coach-preview'
import { SPONSOR_PREVIEW, createMockSupabaseClient as createMockSponsorClient } from '@/lib/dev-preview'

// IMPORTANT: Only use this in server-side code (Server Actions, Route Handlers).
// This client bypasses ALL Row Level Security policies.
// Required for: audit_log inserts, admin operations, email dispatch.
//
// Uses the project REST URL (NEXT_PUBLIC_SUPABASE_URL) + the service-role secret.
// Note: supabase-js speaks HTTP to the REST/Auth endpoints, so the first argument
// must be the project URL — NOT a Postgres pooler connection string.
export function createAdminClient() {
  // Dev-only: serve canned data so the portal works with no session. No-op in prod.
  if (isDevAuthBypass()) return createMockSupabaseClient()
  if (COACH_PREVIEW) return createMockCoachClient()
  // SPONSOR_PREVIEW was the one preview mode this function did not honour, so
  // `npm run dev:sponsor-preview` handed every server action a live service-role client
  // pointed at PRODUCTION while the pages around it rendered fixtures. Any mutation
  // reached through the preview portal was a real production write.
  if (SPONSOR_PREVIEW) return createMockSponsorClient()
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
