import { describe, expect, it, vi } from 'vitest'
import {
  mockCheckFeatureAccess,
  mockDbQuery,
  mockEncrypt,
  mockValidationFail,
  mockValidationSuccess,
  nextReq,
  okJson,
  setSession,
} from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/deploy/tokens', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('stores encrypted token', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockCheckFeatureAccess.mockResolvedValue(null)
    mockValidationSuccess({ provider: 'vercel', token: '1234567890abcdef' })
    global.fetch = vi.fn().mockImplementation(() => okJson({ user: { email: 'v@example.com' } })) as typeof fetch
    mockDbQuery.mockResolvedValueOnce({})

    const res = await POST(nextReq('http://localhost:3000/api/deploy/tokens', { method: 'POST' }))
    expect(mockEncrypt).toHaveBeenCalledWith('1234567890abcdef')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ provider: 'vercel', connected: true })
  })

  it('validates token payload', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockValidationFail()

    const res = await POST(nextReq('http://localhost:3000/api/deploy/tokens', { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('deletes stored token', async () => {
    const { DELETE } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockValidationSuccess({ provider: 'vercel' })
    mockDbQuery.mockResolvedValueOnce({})

    const res = await DELETE(nextReq('http://localhost:3000/api/deploy/tokens', { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
