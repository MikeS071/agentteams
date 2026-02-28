import { describe, expect, it } from 'vitest'
import { mockDbQuery, setSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/tenant/status', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns not found when tenant missing', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockDbQuery.mockResolvedValueOnce({ rows: [] })

    const res = await GET()
    expect(res.status).toBe(404)
  })

  it('returns tenant status', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockDbQuery.mockResolvedValueOnce({ rows: [{ status: 'active' }] })

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'active' })
  })
})
