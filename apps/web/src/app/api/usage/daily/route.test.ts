import { describe, expect, it } from 'vitest'
import { mockDbQuery, setSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/usage/daily', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns daily usage breakdown', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockDbQuery.mockResolvedValueOnce({ rows: [{ date: '2026-01-01', input_tokens: '100', output_tokens: '50', cost_cents: '25' }] })

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ date: '2026-01-01', inputTokens: 100, outputTokens: 50, cost: 0.25 }])
  })

  it('handles errors', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockDbQuery.mockRejectedValueOnce(new Error('db'))

    const res = await GET()
    expect(res.status).toBe(500)
  })
})
