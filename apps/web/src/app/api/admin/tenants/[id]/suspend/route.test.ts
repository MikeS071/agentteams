import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { mockProxyAdminService, mockRequireAdminApiSession, mockSchemaFail, mockSchemaSuccess } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/admin/tenants/[id]/suspend', () => {
  it('blocks non-admin users', async () => {
    const { POST } = await loadRoute()
    mockRequireAdminApiSession.mockResolvedValueOnce({ response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } }) })

    const res = await POST(new NextRequest('http://localhost:3000/api/admin/tenants/t1/suspend', { method: 'POST' }), { params: { id: 't1' } })
    expect(res.status).toBe(403)
  })

  it('returns validation error for bad tenant id', async () => {
    const { POST } = await loadRoute()
    mockSchemaFail('Invalid tenant id')

    const res = await POST(new NextRequest('http://localhost:3000/api/admin/tenants//suspend', { method: 'POST' }), { params: { id: '' } })
    expect(res.status).toBe(400)
  })

  it('suspends tenant and handles already suspended', async () => {
    const { POST } = await loadRoute()
    mockSchemaSuccess({ id: 't1' })
    mockProxyAdminService.mockResolvedValueOnce({ ok: true, data: { status: 'suspended' } })

    const res = await POST(new NextRequest('http://localhost:3000/api/admin/tenants/t1/suspend', { method: 'POST' }), { params: { id: 't1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'suspended' })
  })
})
