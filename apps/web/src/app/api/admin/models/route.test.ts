import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { NextResponse } from 'next/server'
import {
  mockProxyAdminService,
  mockRequireAdminApiSession,
  mockValidationFail,
  mockValidationSuccess,
} from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/admin/models', () => {
  it('blocks non-admin users', async () => {
    const { GET } = await loadRoute()
    mockRequireAdminApiSession.mockResolvedValueOnce({ response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })

    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('lists models', async () => {
    const { GET } = await loadRoute()
    mockProxyAdminService.mockResolvedValueOnce({ ok: true, data: { models: [{ id: 'm1', name: 'Model 1', provider: 'openai', cost_per_1k_input: 1, cost_per_1k_output: 2, markup_pct: 10, enabled: true }] } })

    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ models: [{ id: 'm1', name: 'Model 1' }] })
  })

  it('validates create payload', async () => {
    const { POST } = await loadRoute()
    mockValidationFail()

    const res = await POST(new NextRequest('http://localhost:3000/api/admin/models', { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('creates model', async () => {
    const { POST } = await loadRoute()
    mockValidationSuccess({ name: 'Model 1', provider: 'openai', costPer1kInput: 1, costPer1kOutput: 2, markupPct: 10 })
    mockProxyAdminService.mockResolvedValueOnce({ ok: true, data: { model: { id: 'm1', name: 'Model 1', provider: 'openai', cost_per_1k_input: 1, cost_per_1k_output: 2, markup_pct: 10, enabled: true } } })

    const res = await POST(new NextRequest('http://localhost:3000/api/admin/models', { method: 'POST' }))
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({ model: { id: 'm1' } })
  })
})
