import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { mockProxyAdminService, mockRequireAdminApiSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/admin/tenants', () => {
  it('blocks non-admin users', async () => {
    const { GET } = await loadRoute()
    mockRequireAdminApiSession.mockResolvedValueOnce({ response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } }) })

    const res = await GET(new NextRequest('http://localhost:3000/api/admin/tenants'))
    expect(res.status).toBe(403)
  })

  it('lists tenants', async () => {
    const { GET } = await loadRoute()
    mockProxyAdminService.mockResolvedValueOnce({ ok: true, data: { tenants: [{ id: 't1', email: 'a@a.com', status: 'active' }] } })

    const res = await GET(new NextRequest('http://localhost:3000/api/admin/tenants'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ tenants: [{ id: 't1', email: 'a@a.com', status: 'active' }] })
  })

  it('filters tenants by query', async () => {
    const { GET } = await loadRoute()
    mockProxyAdminService.mockResolvedValueOnce({ ok: true, data: { tenants: [{ id: 't1', email: 'x@a.com', status: 'active' }, { id: 't2', email: 'z@b.com', status: 'suspended' }] } })

    const res = await GET(new NextRequest('http://localhost:3000/api/admin/tenants?q=suspended'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ tenants: [{ id: 't2', email: 'z@b.com', status: 'suspended' }] })
  })
})
