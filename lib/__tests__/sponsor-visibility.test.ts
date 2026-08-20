import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  SPONSOR_SUBMISSION_SELECT,
  SPONSOR_VISIBLE_SUBMISSION_COLUMNS,
  SPONSOR_FORBIDDEN_SUBMISSION_COLUMNS,
} from '../sponsor-visibility'

const SPONSOR_ROUTES = join(process.cwd(), 'app', '(sponsor)')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full)
  }
  return out
}

/** Comments describe the prohibition; only real code counts as a violation. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('sponsor-visible submission columns', () => {
  it('the allowlist and the denylist are disjoint', () => {
    const visible = new Set<string>(SPONSOR_VISIBLE_SUBMISSION_COLUMNS)
    for (const forbidden of SPONSOR_FORBIDDEN_SUBMISSION_COLUMNS) {
      expect(visible.has(forbidden), `${forbidden} must not be sponsor-visible`).toBe(false)
    }
  })

  it('the select fragment names no forbidden column and is never a wildcard', () => {
    expect(SPONSOR_SUBMISSION_SELECT).not.toContain('*')
    for (const forbidden of SPONSOR_FORBIDDEN_SUBMISSION_COLUMNS) {
      expect(SPONSOR_SUBMISSION_SELECT).not.toContain(forbidden)
    }
  })

  it('admin_feedback is the column this exists for', () => {
    // The admin's private note about the COACH. It survives re-approval, so a sponsor
    // reading a long-approved pitch would still see why it was once declined.
    expect(SPONSOR_FORBIDDEN_SUBMISSION_COLUMNS).toContain('admin_feedback')
    expect(SPONSOR_SUBMISSION_SELECT).not.toContain('admin_feedback')
  })

  it('NO sponsor route selects * from submissions', () => {
    const offenders: string[] = []
    for (const file of walk(SPONSOR_ROUTES)) {
      const src = stripComments(readFileSync(file, 'utf8'))
      // Match a submissions query whose select is a bare wildcard, across newlines.
      if (/from\(['"]submissions['"]\)[\s\S]{0,200}?\.select\(\s*[`'"]\s*\*/.test(src)) {
        offenders.push(file.replace(process.cwd() + '/', ''))
      }
    }
    expect(offenders).toEqual([])
  })

  it('every sponsor route that reads submission bodies uses the allowlist', () => {
    const files = walk(SPONSOR_ROUTES).filter((f) => {
      const src = stripComments(readFileSync(f, 'utf8'))
      // Count-only queries (`select('id', { count })`) read no body and need no allowlist.
      return /from\(['"]submissions['"]\)/.test(src) && !/count:\s*['"]exact['"]/.test(src)
    })
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(
        readFileSync(file, 'utf8'),
        `${file} queries submissions without SPONSOR_SUBMISSION_SELECT`
      ).toContain('SPONSOR_SUBMISSION_SELECT')
    }
  })
})
