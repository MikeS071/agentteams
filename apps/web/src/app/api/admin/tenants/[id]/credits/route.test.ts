import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import {
  mockProxyAdminService,
  mockRequireAdminApiSession,
  mockSchemaSuccess,
  mockValidationSuccess,
  nextReq,
} from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/admin/tenants/[id]/credits', () => {
  it('blocks non-admin users', async () => {
    const { POST } = await loadRoute()
    mockRequireAdminApiSession.mockResolvedValueOnce({ response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } }) })

    const res = await POST(new NextRequest('http://localhost:3000/api/admin/tenants/t1/credits', { method: 'POST' }), { params: { id: 't1' } })
    expect(res.status).toBe(403)
  })

  it('rejects negative/zero amount', async () => {
    const { POST } = await loadRoute()
    mockSchemaSuccess({ id: 't1' })
    mockValidationSuccess({ amountCents: 0, reason: 'manual' })

    const res = await POST(nextReq('http://localhost:3000/api/admin/tenants/t1/credits', { method: 'POST' }) as NextRequest, { params: { id: 't1' } })
    expect(res.status).toBe(400)
  })

  it('adds credits', async () => {
    const { POST } = await loadRoute()
    mockSchemaSuccess({ id: 't1' })
    mockValidationSuccess({ amountCents: 1000, reason: 'topup' })
    mockProxyAdminService.mockResolvedValueOnce({ ok: true, data: { balanceCents: 5000 } })

    const res = await POST(nextReq('http://localhost:3000/api/admin/tenants/t1/credits', { method: 'POST' }) as NextRequest, { params: { id: 't1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ balanceCents: 5000 })
  })
})
