// `server-only` throws when resolved outside a React Server Component graph, which is
// exactly what makes it useful in `lib/credentials-retention.ts` — that module drives
// storage deletion through the service-role client and must never reach the browser.
//
// Vitest runs in jsdom, so the real package would abort any test that imports a guarded
// module. Aliased to this no-op in vitest.config.ts so the guard stays enforced in the
// Next build (the only place it matters) without making guarded code untestable.
export {}
