import { describe, expect, it, vi } from 'vitest'
import { nextReq, setSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/ai-agents/[id]/reject/[actionId]', () => {
  it('returns unauthorized without session', async () => {
    const { POST } = await loadRoute()
    setSession(null)

    const res = await POST(nextReq('http://localhost:3000/api/ai-agents/h1/reject/a1', { method: 'POST' }), { params: { id: 'h1', actionId: 'a1' } })
    expect(res.status).toBe(401)
  })

  it('validates ids', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })

    const res = await POST(nextReq('http://localhost:3000/api/ai-agents//reject/', { method: 'POST' }), { params: { id: '', actionId: '' } })
    expect(res.status).toBe(400)
  })

  it('rejects action', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    global.fetch = vi.fn().mockResolvedValueOnce(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch

    const res = await POST(nextReq('http://localhost:3000/api/ai-agents/h1/reject/a1', { method: 'POST' }), { params: { id: 'h1', actionId: 'a1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
