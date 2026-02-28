import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import {
  mockDbConnect,
  mockDbQuery,
  mockValidationFail,
  mockValidationSuccess,
  nextReq,
  okJson,
  setSession,
} from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/profile', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns profile', async () => {
    const { GET } = await loadRoute()
    setSession({ id: 'user-1', tenantId: 'tenant-1' })
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'u@e.com', name: 'User', image: null, created_at: '2026-01-01T00:00:00Z', has_password: true }] })
      .mockResolvedValueOnce({ rows: [{ provider: 'google' }] })
    global.fetch = vi.fn().mockImplementation(() => okJson({ profile: { timezone: 'UTC' } })) as typeof fetch

    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ profile: { id: 'user-1', email: 'u@e.com' } })
  })

  it('updates profile', async () => {
    const { PATCH } = await loadRoute()
    setSession({ id: 'user-1', tenantId: 'tenant-1' })
    mockValidationSuccess({ name: 'Updated' })
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'u@e.com', name: 'Updated', image: null, created_at: '2026-01-01T00:00:00Z' }] })
    global.fetch = vi.fn().mockImplementation(() => okJson({}, 200)) as typeof fetch

    const res = await PATCH(new NextRequest('http://localhost:3000/api/profile', { method: 'PATCH' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ profile: { name: 'Updated' } })
  })

  it('validates profile update body', async () => {
    const { PATCH } = await loadRoute()
    setSession({ id: 'user-1', tenantId: 'tenant-1' })
    mockValidationFail()

    const res = await PATCH(new NextRequest('http://localhost:3000/api/profile', { method: 'PATCH' }))
    expect(res.status).toBe(400)
  })

  it('deletes profile', async () => {
    const { DELETE } = await loadRoute()
    setSession({ id: 'user-1' })
    mockValidationSuccess({ confirmation: 'DELETE' })
    const client = { query: vi.fn().mockResolvedValue({}), release: vi.fn() }
    mockDbConnect.mockResolvedValueOnce(client)

    const res = await DELETE(nextReq('http://localhost:3000/api/profile', { method: 'DELETE' }) as NextRequest)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
