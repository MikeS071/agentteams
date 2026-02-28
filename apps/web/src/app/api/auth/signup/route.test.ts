import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mockDbConnect,
  mockDbQuery,
  mockValidationFail,
  mockValidationSuccess,
  nextReq,
} from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/auth/signup', () => {
  let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    client = {
      query: vi.fn(),
      release: vi.fn(),
    }
    mockDbConnect.mockResolvedValue(client)
  })

  it('returns validation error for missing fields', async () => {
    const { POST } = await loadRoute()
    mockValidationFail()

    const res = await POST(nextReq('http://localhost:3000/api/auth/signup', { method: 'POST' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request body' })
  })

  it('returns conflict for duplicate email', async () => {
    const { POST } = await loadRoute()
    mockValidationSuccess({ email: 'user@example.com', password: 'strongpass1' })
    client.query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rows: [{ id: 'exists' }] }).mockResolvedValueOnce({})

    const res = await POST(nextReq('http://localhost:3000/api/auth/signup', { method: 'POST' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'An account with that email already exists' })
  })

  it('creates user and tenant successfully', async () => {
    const { POST } = await loadRoute()
    mockValidationSuccess({ email: 'user@example.com', password: 'strongpass1' })

    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tenant-1' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})

    const res = await POST(nextReq('http://localhost:3000/api/auth/signup', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('handles db failure', async () => {
    const { POST } = await loadRoute()
    mockValidationSuccess({ email: 'user@example.com', password: 'strongpass1' })
    client.query.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({})

    const res = await POST(nextReq('http://localhost:3000/api/auth/signup', { method: 'POST' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Signup failed' })
  })
})
