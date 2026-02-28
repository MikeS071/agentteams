import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { mockDbQuery, mockValidationFail, mockValidationSuccess, setSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/profile/password', () => {
  it('returns unauthorized without session', async () => {
    const { POST } = await loadRoute()
    setSession(null)

    const res = await POST(new NextRequest('http://localhost:3000/api/profile/password', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  it('returns validation error', async () => {
    const { POST } = await loadRoute()
    setSession({ id: 'user-1' })
    mockValidationFail()

    const res = await POST(new NextRequest('http://localhost:3000/api/profile/password', { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('rejects wrong current password', async () => {
    const { POST } = await loadRoute()
    setSession({ id: 'user-1' })
    mockValidationSuccess({ currentPassword: 'oldpassword', newPassword: 'newpassword' })
    mockDbQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'hash' }] })
    const bcrypt = await import('bcryptjs')
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false)

    const res = await POST(new NextRequest('http://localhost:3000/api/profile/password', { method: 'POST' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Current password is incorrect' })
  })

  it('changes password successfully', async () => {
    const { POST } = await loadRoute()
    setSession({ id: 'user-1' })
    mockValidationSuccess({ currentPassword: 'oldpassword', newPassword: 'newpassword' })
    mockDbQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'hash' }] }).mockResolvedValueOnce({})

    const res = await POST(new NextRequest('http://localhost:3000/api/profile/password', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
