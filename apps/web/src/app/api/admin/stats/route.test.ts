import { describe, expect, it } from 'vitest'
import { NextResponse } from 'next/server'
import { mockProxyAdminService, mockRequireAdminApiSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/admin/stats', () => {
  it('blocks non-admin users', async () => {
    const { GET } = await loadRoute()
    mockRequireAdminApiSession.mockResolvedValueOnce({ response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })

    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('returns platform stats', async () => {
    const { GET } = await loadRoute()
    mockProxyAdminService.mockResolvedValueOnce({ ok: true, data: { tenants: 10, users: 25 } })

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tenants: 10, users: 25 })
  })
})
