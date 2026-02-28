import { describe, expect, it } from 'vitest'
import { mockDbQuery, setSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/billing/usage', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns usage payload with date-sorted transactions', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })

    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ date: '2026-01-01', input_tokens: '1', output_tokens: '2', cost_cents: '3' }] })
      .mockResolvedValueOnce({ rows: [{ model: 'GPT', total_tokens: '10', cost_cents: '20' }] })
      .mockResolvedValueOnce({ rows: [{ agent: 'a1', message_count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ balance_cents: '100' }] })
      .mockResolvedValueOnce({ rows: [{ created_at: '2026-01-01T00:00:00Z', amount_cents: '50', reason: 'credit purchase' }] })
      .mockResolvedValueOnce({ rows: [{ created_at: '2026-01-02T00:00:00Z', amount_cents: '10' }] })

    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({
      daily: [{ date: '2026-01-01', inputTokens: 1, outputTokens: 2, totalTokens: 3, costCents: 3 }],
      byModel: [{ model: 'GPT', totalTokens: 10, costCents: 20 }],
      byAgent: [{ agent: 'a1', messageCount: 2 }],
    })
    expect(Array.isArray(json.transactions)).toBe(true)
  })

  it('handles db errors', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockDbQuery.mockRejectedValueOnce(new Error('db'))

    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal error' })
  })
})
