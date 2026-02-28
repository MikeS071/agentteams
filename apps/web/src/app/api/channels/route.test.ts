import { describe, expect, it, vi } from 'vitest'
import { nextReq, okJson, setSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/channels', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('lists channels', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    global.fetch = vi.fn().mockImplementation(() => okJson({ channels: [{ id: 'c1' }] })) as typeof fetch

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ channels: [{ id: 'c1' }] })
  })

  it('deletes a channel and validates id', async () => {
    const { DELETE } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })

    const bad = await DELETE(nextReq('http://localhost:3000/api/channels', { method: 'DELETE' }))
    expect(bad.status).toBe(400)

    global.fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })) as typeof fetch
    const ok = await DELETE(nextReq('http://localhost:3000/api/channels?id=chan-1', { method: 'DELETE' }))
    expect(ok.status).toBe(204)
  })
})
