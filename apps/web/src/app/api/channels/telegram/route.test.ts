import { describe, expect, it, vi } from 'vitest'
import {
  mockCheckFeatureAccess,
  mockValidationFail,
  mockValidationSuccess,
  nextReq,
  okJson,
  setSession,
} from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/channels/telegram', () => {
  it('returns unauthorized without session', async () => {
    const { POST } = await loadRoute()
    setSession(null)

    const res = await POST(nextReq('http://localhost:3000/api/channels/telegram', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  it('validates payload', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockValidationFail()

    const res = await POST(nextReq('http://localhost:3000/api/channels/telegram', { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('sets up webhook connection', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockCheckFeatureAccess.mockResolvedValue(null)
    mockValidationSuccess({ botToken: 'token' })
    global.fetch = vi.fn().mockImplementation(() => okJson({ status: 'connected' })) as typeof fetch

    const res = await POST(nextReq('http://localhost:3000/api/channels/telegram', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'connected' })
  })
})
