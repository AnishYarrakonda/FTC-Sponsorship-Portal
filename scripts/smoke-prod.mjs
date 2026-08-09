#!/usr/bin/env node
/**
 * Production smoke check — hits a deployed instance and verifies the public
 * surface responds correctly. No secrets required.
 *
 * Usage:
 *   BASE_URL=https://ftc-sponsorship-portal.vercel.app node scripts/smoke-prod.mjs
 *
 * Exits non-zero if any check fails.
 */

const BASE_URL = (process.env.BASE_URL ?? '').replace(/\/+$/, '')

if (!BASE_URL) {
  console.error('BASE_URL env var is required, e.g. BASE_URL=https://ftc-sponsorship-portal.vercel.app')
  process.exit(2)
}

const TIMEOUT_MS = 15_000

/** fetch with timeout; never follows redirects so we can assert on them. */
async function probe(path, { redirect = 'follow' } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      redirect,
      signal: controller.signal,
      headers: { 'user-agent': 'ftc-smoke-prod/1.0' },
    })
    const text = await res.text().catch(() => '')
    return { res, text }
  } finally {
    clearTimeout(timer)
  }
}

/** @type {{name: string, run: () => Promise<string|null>}[]} checks return null on pass, reason string on fail */
const checks = [
  {
    name: 'GET / — 200 + marketing copy + current branding',
    async run() {
      const { res, text } = await probe('/')
      if (res.status !== 200) return `status ${res.status}`
      if (!/FIRST Tech Challenge/i.test(text)) return 'missing expected marketing copy ("FIRST Tech Challenge")'
      if (!/Pitfund/i.test(text)) return 'landing page does not mention "Pitfund" — rebrand did not ship'
      // A half-applied rename is worse than none: it reads as an abandoned product.
      if (/Matchmaker/i.test(text)) return 'landing page still contains the old "Matchmaker" name'
      return null
    },
  },
  {
    name: 'GET /api/health — 200 { ok: true }',
    async run() {
      const { res, text } = await probe('/api/health')
      if (res.status !== 200) return `status ${res.status}`
      let body
      try {
        body = JSON.parse(text)
      } catch {
        return 'response is not JSON'
      }
      if (body.ok !== true) return `ok !== true (got ${JSON.stringify(body)})`
      return null
    },
  },
  {
    name: 'GET /login — 200',
    async run() {
      const { res } = await probe('/login')
      return res.status === 200 ? null : `status ${res.status}`
    },
  },
  {
    name: 'GET /signup — 200',
    async run() {
      const { res } = await probe('/signup')
      return res.status === 200 ? null : `status ${res.status}`
    },
  },
  {
    name: 'GET /legal/privacy — 200 + retention policy published',
    async run() {
      const { res, text } = await probe('/legal/privacy')
      if (res.status !== 200) return `status ${res.status}`
      // The retention guarantee is a commitment to users, not decoration: if this
      // section ever silently disappears the policy no longer matches what the code does.
      if (!/Data Retention/i.test(text)) return 'missing the "Data Retention" section'
      return null
    },
  },
  {
    name: 'GET /legal/terms — 200',
    async run() {
      const { res } = await probe('/legal/terms')
      return res.status === 200 ? null : `status ${res.status}`
    },
  },
  {
    name: 'GET /sponsors/apply — 200 (public sponsor intake)',
    async run() {
      const { res } = await probe('/sponsors/apply')
      return res.status === 200 ? null : `status ${res.status}`
    },
  },
  {
    // P0-8 removed '/teams(.*)' from the public matcher and deleted the public
    // portfolio page — sponsor reach is the token-gated /sponsor-view/[token] route.
    // A team slug must NOT be publicly readable any more.
    name: 'GET /teams/<slug> — no longer public (never 200)',
    async run() {
      const { res } = await probe('/teams/definitely-not-a-real-team-smoke-check', {
        redirect: 'manual',
      })
      if (res.status === 200) return 'a /teams/* page rendered publicly — P0-8 regression'
      return res.status < 500 ? null : `status ${res.status}`
    },
  },
  {
    // Only PUBLIC route prefixes reach Next's 404 — clerkMiddleware redirects
    // unknown non-public paths to /login (asserted separately below).
    name: 'GET unknown public route (/legal/<garbage>) — 404',
    async run() {
      const { res } = await probe('/legal/definitely-not-a-real-page-smoke-check')
      return res.status === 404 ? null : `status ${res.status}`
    },
  },
  {
    name: 'GET unknown non-public route — redirects to /login (no 5xx)',
    async run() {
      const { res } = await probe('/definitely-not-a-real-route-smoke-check', {
        redirect: 'manual',
      })
      if (res.status >= 500) return `status ${res.status}`
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location') ?? ''
        return /\/login/.test(location) ? null : `redirected to unexpected "${location}"`
      }
      // A direct 404 (e.g. if middleware rules change) is also acceptable.
      return res.status === 404 ? null : `status ${res.status} (expected 3xx→/login or 404)`
    },
  },
  {
    name: 'GET /api/admin/queue/count unauthenticated — 401/403 JSON, no redirect',
    async run() {
      const { res, text } = await probe('/api/admin/queue/count', { redirect: 'manual' })
      if (res.status >= 300 && res.status < 400) {
        return `redirected (${res.status} → ${res.headers.get('location') ?? '?'}) — API routes must return JSON errors`
      }
      if (res.status !== 401 && res.status !== 403) return `status ${res.status} (expected 401/403)`
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) return `content-type "${contentType}" is not JSON`
      try {
        JSON.parse(text)
      } catch {
        return 'body is not valid JSON'
      }
      return null
    },
  },
]

const results = []
let failed = 0
let skipped = 0

for (const check of checks) {
  let outcome
  try {
    outcome = await check.run()
  } catch (err) {
    outcome = err?.name === 'AbortError' ? `timed out after ${TIMEOUT_MS}ms` : `threw: ${err?.message ?? err}`
  }

  if (outcome === 'SKIP') {
    skipped++
    results.push({ Check: check.name, Result: 'SKIP', Detail: 'SEED_TEAM_SLUG not set' })
  } else if (outcome === null) {
    results.push({ Check: check.name, Result: 'PASS', Detail: '' })
  } else {
    failed++
    results.push({ Check: check.name, Result: 'FAIL', Detail: outcome })
  }
}

console.log(`\nSmoke check against ${BASE_URL}\n`)
console.table(results)
console.log(
  `${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`
)

process.exit(failed > 0 ? 1 : 0)
