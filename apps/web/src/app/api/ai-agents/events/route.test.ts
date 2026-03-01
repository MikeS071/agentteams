import { describe, expect, it, vi } from 'vitest'
import { setSession } from '@/test/mocks'

async function loadRoute() {
  return import('./route')
}

describe('api/ai-agents/events', () => {
  it('returns unauthorized without session', async () => {
    const { GET } = await loadRoute()
    setSession(null)

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('opens SSE stream', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    const stream = new ReadableStream<Uint8Array>()
    global.fetch = vi.fn().mockResolvedValueOnce(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch

    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('returns upstream error details', async () => {
    const { GET } = await loadRoute()
    setSession({ tenantId: 'tenant-1' })
    global.fetch = vi.fn().mockResolvedValueOnce(new Response('bad upstream', { status: 500, headers: { 'content-type': 'text/plain' } })) as typeof fetch

    const res = await GET()
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: 'Failed to open AI agents event stream' })
  })
})
