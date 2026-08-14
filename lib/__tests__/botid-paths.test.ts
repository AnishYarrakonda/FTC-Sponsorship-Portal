import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BOTID_PROXY_PREFIX } from '@/lib/botid-paths'

/**
 * BOTID_PROXY_PREFIX is mirrored from a private constant inside the `botid` package. If a
 * botid upgrade changes it, middleware.ts stops treating the challenge traffic as public,
 * clerkMiddleware 307s it to /login, and checkBotId() starts calling every anonymous human
 * a bot. That failure is silent in the UI, so it gets caught here instead.
 */
describe('BOTID_PROXY_PREFIX', () => {
  it('matches the prefix the installed botid package rewrites', () => {
    const configSrc = readFileSync(
      path.resolve(__dirname, '../../node_modules/botid/dist/next/config/index.mjs'),
      'utf8'
    )
    expect(configSrc).toContain(BOTID_PROXY_PREFIX)
  })

  it('is listed as a public route in middleware.ts', () => {
    const middlewareSrc = readFileSync(path.resolve(__dirname, '../../middleware.ts'), 'utf8')
    expect(middlewareSrc).toContain('BOTID_PROXY_PREFIX')
  })
})
