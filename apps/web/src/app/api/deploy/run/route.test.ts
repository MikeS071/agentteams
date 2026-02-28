import { describe, expect, it, vi } from 'vitest'
import {
  mockCheckFeatureAccess,
  mockValidationFail,
  mockValidationSuccess,
  nextReq,
  okJson,
  setSession,
} from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/deploy/run', () => {
  it('returns unauthorized without session', async () => {
    const { POST } = await loadRoute()
    setSession(null)

    const res = await POST(nextReq('http://localhost:3000/api/deploy/run', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  it('returns validation error', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockValidationFail()

    const res = await POST(nextReq('http://localhost:3000/api/deploy/run', { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('rejects missing supabase connection details', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockValidationSuccess({ projectName: 'proj', target: 'supabase' })

    const res = await POST(nextReq('http://localhost:3000/api/deploy/run', { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('triggers deploy run', async () => {
    const { POST } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    mockCheckFeatureAccess.mockResolvedValue(null)
    mockValidationSuccess({ projectName: 'proj', target: 'vercel', repoUrl: '', branch: 'main' })
    global.fetch = vi.fn().mockImplementation(() => okJson({ id: 'run1', provider: 'vercel', status: 'queued' })) as typeof fetch

    const res = await POST(nextReq('http://localhost:3000/api/deploy/run', { method: 'POST' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ runs: [{ id: 'run1', provider: 'vercel' }] })
  })
})
