import { describe, expect, it } from 'vitest'
import { mockDbQuery, setSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/billing/balance', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns credit balance', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockDbQuery.mockResolvedValueOnce({ rows: [{ balance_cents: 500 }] })

    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      balanceCents: 500,
      initialCreditCents: 1000,
      remainingPct: 50,
    })
  })

  it('handles db error', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockDbQuery.mockRejectedValueOnce(new Error('db'))

    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal error' })
  })
})
