import { describe, expect, it } from 'vitest'
import { mockCheckFeatureAccess, mockDbQuery, setSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/chat/conversations', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns forbidden when feature disabled', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockCheckFeatureAccess.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Feature not available on your plan' }), { status: 403, headers: { 'content-type': 'application/json' } }))

    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('lists conversations', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: 'c1', preview: 'Hello', created_at: '2026-01-01T00:00:00Z', last_activity_at: '2026-01-01T00:00:00Z' }],
    })

    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ conversations: [{ id: 'c1', preview: 'Hello' }] })
  })
})
