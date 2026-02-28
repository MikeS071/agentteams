import { describe, expect, it } from 'vitest'
import {
  mockDbQuery,
  mockStripeCheckoutCreate,
  mockStripeCustomerCreate,
  mockValidationFail,
  mockValidationSuccess,
  nextReq,
  setSession,
} from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/billing/checkout', () => {
  it('returns unauthorized without session', async () => {
    const { POST } = await loadRoute()
    setSession(null)

    const res = await POST(nextReq('http://localhost:3000/api/billing/checkout', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  it('returns validation error', async () => {
    const { POST } = await loadRoute()
    setSession({ id: 'user-1', tenantId: 'tenant-1' })
    mockValidationFail()

    const res = await POST(nextReq('http://localhost:3000/api/billing/checkout', { method: 'POST' }))
    expect(res.status).toBe(400)
  })

  it('rejects invalid package amount', async () => {
    const { POST } = await loadRoute()
    setSession({ id: 'user-1', tenantId: 'tenant-1' })
    mockValidationSuccess({ amount: 13 })

    const res = await POST(nextReq('http://localhost:3000/api/billing/checkout', { method: 'POST' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid amount' })
  })

  it('creates checkout session', async () => {
    const { POST } = await loadRoute()
    setSession({ id: 'user-1', tenantId: 'tenant-1', email: 'u@example.com' })
    mockValidationSuccess({ amount: 25 })
    mockDbQuery.mockResolvedValueOnce({ rows: [{ stripe_customer_id: null }] }).mockResolvedValueOnce({})
    mockStripeCustomerCreate.mockResolvedValueOnce({ id: 'cus_1' })
    mockStripeCheckoutCreate.mockResolvedValueOnce({ url: 'https://stripe/checkout' })

    const res = await POST(nextReq('http://localhost:3000/api/billing/checkout', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://stripe/checkout' })
  })
})
