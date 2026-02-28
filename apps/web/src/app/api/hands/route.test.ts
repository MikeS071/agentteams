import { describe, expect, it, vi } from 'vitest'
import { setSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/hands', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('lists hands', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    global.fetch = vi.fn().mockResolvedValueOnce(new Response('{"hands":[{"id":"h1"}]}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hands: [{ id: 'h1' }] })
  })

  it('handles upstream failure', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('boom')) as typeof fetch

    const res = await GET()
    expect(res.status).toBe(500)
  })
})
