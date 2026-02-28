import { describe, expect, it } from 'vitest'
import {
  mockCheckFeatureAccess,
  mockDbQuery,
  mockSchemaFail,
  mockSchemaSuccess,
  nextReq,
  setSession,
} from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/chat/history', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET(nextReq('http://localhost:3000/api/chat/history?conversationId=bad'))
    expect(res.status).toBe(401)
  })

  it('returns validation error for invalid query', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockSchemaFail('Invalid query params')

    const res = await GET(nextReq('http://localhost:3000/api/chat/history?conversationId=bad'))
    expect(res.status).toBe(400)
  })

  it('returns message history', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockCheckFeatureAccess.mockResolvedValue(null)
    mockSchemaSuccess({ conversationId: '11111111-1111-4111-8111-111111111111' })
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'm1', role: 'assistant', content: 'Hi', created_at: '2026-01-01T00:00:00Z' }] })

    const res = await GET(nextReq('http://localhost:3000/api/chat/history?conversationId=11111111-1111-4111-8111-111111111111'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ messages: [{ id: 'm1', role: 'assistant', content: 'Hi' }] })
  })
})
