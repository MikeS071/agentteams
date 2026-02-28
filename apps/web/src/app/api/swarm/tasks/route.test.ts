import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { setSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/swarm/tasks', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('lists tasks', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    global.fetch = vi.fn().mockResolvedValueOnce(new Response('{"tasks":[{"id":"t1"}]}', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tasks: [{ id: 't1' }] })
  })

  it('validates POST body', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })

    const res = await POST(new NextRequest('http://localhost:3000/api/swarm/tasks', { method: 'POST', body: JSON.stringify({ task: '' }) }))
    expect(res.status).toBe(400)
  })

  it('creates task', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    global.fetch = vi.fn().mockResolvedValueOnce(new Response('{"id":"t1"}', { status: 202, headers: { 'content-type': 'application/json' } })) as typeof fetch

    const res = await POST(new NextRequest('http://localhost:3000/api/swarm/tasks', { method: 'POST', body: JSON.stringify({ task: 'Build it' }) }))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ id: 't1' })
  })
})
