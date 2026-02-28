import { describe, expect, it } from 'vitest'
import { mockDbQuery, setSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/models', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('lists available models', async () => {
    const { GET } = await loadRoute()
    setSession({ id: 'user-1' })
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'm1', name: 'Model 1', provider: 'openai' }] })

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ models: [{ id: 'm1', name: 'Model 1', provider: 'openai' }] })
  })
})
