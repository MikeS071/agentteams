import { describe, expect, it } from 'vitest'
import {
  mockDbQuery,
  mockValidationFail,
  mockValidationSuccess,
  nextReq,
  setSession,
} from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/onboarding', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns onboarding status', async () => {
    const { GET } = await loadRoute()
    setSession({ id: 'user-1' })
    mockDbQuery.mockResolvedValueOnce({ rows: [{ onboarding_completed_at: '2026-01-01T00:00:00Z' }] })

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ onboardingCompleted: true })
  })

  it('validates completion payload', async () => {
    const { POST } = await loadRoute()
    setSession({ id: 'user-1' })
    mockValidationFail()

    const res = await POST(nextReq('http://localhost:3000/api/onboarding', { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('completes onboarding', async () => {
    const { POST } = await loadRoute()
    setSession({ id: 'user-1' })
    mockValidationSuccess({ completed: true })
    mockDbQuery.mockResolvedValueOnce({})

    const res = await POST(nextReq('http://localhost:3000/api/onboarding', { method: 'POST' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, onboardingCompleted: true })
  })
})
