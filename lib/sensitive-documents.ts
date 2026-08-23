/**
 * A-06-03. Shared constant for the two admin queues that mint signed URLs for government
 * photo IDs and W-9s.
 *
 * Lives here rather than in app/actions/sensitive-documents.ts because every export of a
 * `'use server'` file must be an async server action — the same constraint that put
 * mapDecisionError in lib/decision-followup.ts and mapBudgetItems in lib/dispatch-budget.ts.
 *
 * 60 seconds, down from 1800. A signed Supabase Storage URL carries its own authorization:
 * anyone holding the string can fetch the document with no session, from anywhere. The
 * inline <img>/<iframe> fetches immediately, and the "open externally" control re-mints
 * through the server action rather than reusing this URL, so the short window costs nothing.
 */
export const SENSITIVE_DOCUMENT_URL_TTL_SECONDS = 60
