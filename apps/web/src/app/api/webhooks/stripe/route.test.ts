import { describe, expect, it, vi } from 'vitest'
import { mockDbQuery, mockStripeConstructEvent, nextReq, okJson } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/webhooks/stripe', () => {
  it('rejects invalid stripe signature', async () => {
    const { POST } = await loadRoute()
    mockStripeConstructEvent.mockImplementationOnce(() => {
      throw new Error('bad signature')
    })

    const req = nextReq('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'bad', origin: 'http://localhost:3000' },
      body: '{}',
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid webhook signature' })
  })

  it('credits tenant on checkout.session.completed', async () => {
    const { POST } = await loadRoute()
    global.fetch = vi.fn().mockImplementation(() => okJson({}, 200)) as typeof fetch
    mockStripeConstructEvent.mockReturnValueOnce({
      type: 'checkout.session.completed',
      data: { object: { amount_total: 2500, metadata: { tenantId: 'tenant-1' } } },
    })

    const req = nextReq('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'sig', origin: 'http://localhost:3000' },
      body: '{}',
    })

    const res = await POST(req)
    expect(mockDbQuery).toHaveBeenCalled()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ received: true, tenantId: 'tenant-1', credited_cents: 2500 })
  })

  it('acknowledges unknown events', async () => {
    const { POST } = await loadRoute()
    mockStripeConstructEvent.mockReturnValueOnce({ type: 'invoice.paid', data: { object: {} } })

    const req = nextReq('http://localhost:3000/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'sig', origin: 'http://localhost:3000' },
      body: '{}',
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
  })
})
