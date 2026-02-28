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

describe('api/chat', () => {
  it('returns unauthorized without session', async () => {
    const { POST } = await loadRoute()
    setSession(null)

    const res = await POST(nextReq('http://localhost:3000/api/chat', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  it('returns validation error', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockValidationFail()

    const res = await POST(nextReq('http://localhost:3000/api/chat', { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('handles streaming fallback error', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockValidationSuccess({ message: 'Hi', stream: true })
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('stream failed'))
      .mockResolvedValueOnce(new Response('upstream fail', { status: 500 })) as typeof fetch

    const res = await POST(nextReq('http://localhost:3000/api/chat', { method: 'POST' }))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'Channel router error' })
  })

  it('sends message successfully', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockValidationSuccess({ message: 'Hi', stream: false, conversationId: '11111111-1111-4111-8111-111111111111' })
    mockCheckFeatureAccess.mockResolvedValue(null)
    global.fetch = vi.fn().mockImplementation(() => okJson({ content: 'Hello', conversation_id: '11111111-1111-4111-8111-111111111111' })) as typeof fetch

    const res = await POST(nextReq('http://localhost:3000/api/chat', { method: 'POST' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ message: { role: 'assistant', content: 'Hello' } })
  })
})
