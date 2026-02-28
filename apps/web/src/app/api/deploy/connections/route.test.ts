import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import {
  mockCheckFeatureAccess,
  mockDbQuery,
  mockValidationSuccess,
  setSession,
} from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/deploy/connections', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('lists connections', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockCheckFeatureAccess.mockResolvedValue(null)
    mockDbQuery.mockResolvedValueOnce({ rows: [{ provider: 'vercel', provider_user_id: 'u1', connected_at: '2026-01-01T00:00:00Z' }] })

    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ connections: [{ provider: 'vercel', providerUserId: 'u1' }] })
  })

  it('deletes a connection', async () => {
    const { DELETE } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockValidationSuccess({ provider: 'vercel' })
    mockCheckFeatureAccess.mockResolvedValue(null)
    mockDbQuery.mockResolvedValueOnce({})

    const res = await DELETE(new NextRequest('http://localhost:3000/api/deploy/connections?provider=vercel', { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
