import { describe, it, expect, vi } from 'vitest'
import {
  extractMergeFields,
  validateTemplateBody,
  renderAgreement,
  UnknownMergeFieldError,
  MissingMergeFieldError,
} from '../agreements/render'
import { exampleMergeContext, MERGE_FIELD_KEYS } from '../agreements/merge-fields'

const FULL_BODY = MERGE_FIELD_KEYS.map((k) => `<p>{{ ${k} }}</p>`).join('\n')

describe('extractMergeFields / validateTemplateBody', () => {
  it('extracts every distinct token, tolerating whitespace inside braces', () => {
    const body = '<p>{{sponsor_company_name}} and {{ team_name }} and {{sponsor_company_name}}</p>'
    expect(extractMergeFields(body)).toEqual(['sponsor_company_name', 'team_name'])
  })

  it('accepts a body referencing only known fields', () => {
    const result = validateTemplateBody(FULL_BODY)
    expect(result.ok).toBe(true)
  })

  it('rejects a body referencing an unknown field, naming it', () => {
    const result = validateTemplateBody('<p>{{ sponsor_company_name }} {{ not_a_real_field }}</p>')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.unknown).toEqual(['not_a_real_field'])
  })
})

describe('renderAgreement', () => {
  it('renders every registry field correctly with a full context', () => {
    const ctx = exampleMergeContext()
    const { html } = renderAgreement(FULL_BODY, ctx)
    for (const key of MERGE_FIELD_KEYS) {
      expect(html).toContain(ctx[key])
    }
  })

  it('throws UnknownMergeFieldError naming the token', () => {
    expect(() => renderAgreement('<p>{{ bogus_field }}</p>', exampleMergeContext())).toThrow(
      UnknownMergeFieldError,
    )
  })

  it.each([undefined, null, '', '   '])(
    'throws MissingMergeFieldError listing all missing keys for value %p, and produces no output',
    (value) => {
      const ctx = { ...exampleMergeContext(), team_name: value as unknown as string, season: value as unknown as string }
      let caught: unknown
      try {
        renderAgreement('<p>{{ team_name }} {{ season }}</p>', ctx)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(MissingMergeFieldError)
      expect((caught as MissingMergeFieldError).keys.sort()).toEqual(['season', 'team_name'])
    },
  )

  it('is deterministic: two calls with identical inputs are byte-identical, even across a clock change', () => {
    const ctx = exampleMergeContext()
    const first = renderAgreement(FULL_BODY, ctx).html
    const second = renderAgreement(FULL_BODY, ctx).html
    expect(first).toBe(second)

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'))
    const third = renderAgreement(FULL_BODY, ctx).html
    vi.useRealTimers()
    expect(third).toBe(first)
  })

  it('HTML-escapes a merge value', () => {
    const ctx = { ...exampleMergeContext(), sponsor_company_name: '<script>alert(1)</script>' }
    const { html } = renderAgreement('<p>{{ sponsor_company_name }}</p>', ctx)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('strips a disallowed tag in the template body via DOMPurify', () => {
    const ctx = exampleMergeContext()
    const { html } = renderAgreement('<p>{{ team_name }}</p><script>alert(1)</script>', ctx)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert(1)')
  })

  it('validateTemplateBody accepts the seeded body shape (all known tokens)', () => {
    const seedBody = `<h2>1. Parties and Effective Date</h2>
<p>{{ sponsor_company_name }} and {{ team_legal_payee_name }} for FTC Team {{ team_number }}
({{ team_name }}) of {{ team_organization }}, {{ team_city }}, {{ team_state }}, effective
{{ agreement_date }}.</p>
<p>{{ amount_formatted }} for the {{ season }} season, facilitated by {{ platform_name }}.
Signed by {{ sponsor_contact_name }}.</p>`
    const result = validateTemplateBody(seedBody)
    expect(result.ok).toBe(true)
  })
})
