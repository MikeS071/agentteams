import { NextResponse } from 'next/server'
import { vi } from 'vitest'
import { fixtures } from './fixtures'

export const mockGetServerSession = vi.fn()
export const mockDbQuery = vi.fn()
export const mockDbConnect = vi.fn()
export const mockVerifyMutationOrigin = vi.fn(() => null)
export const mockBuildServiceHeaders = vi.fn(() => ({ 'X-Service-API-Key': 'test-service-key' }))
export const mockParseJSONBody = vi.fn()
export const mockParseWithSchema = vi.fn()
export const mockCheckFeatureAccess = vi.fn(async (): Promise<Response | null> => null)
export const mockRequireAdminApiSession = vi.fn(async (): Promise<
  { session: { user: typeof fixtures.adminUser } } | { response: Response }
> => ({ session: { user: fixtures.adminUser } }))
export const mockProxyAdminService = vi.fn()
export const mockStripeConstructEvent = vi.fn()
export const mockStripeCustomerCreate = vi.fn()
export const mockStripeCheckoutCreate = vi.fn()
export const mockEncrypt = vi.fn((input: string) => `enc(${input})`)
export const mockBcryptHash = vi.fn(async (value: string) => `hash:${value}`)
export const mockBcryptCompare = vi.fn(async () => true)

vi.mock('next-auth', () => ({
  getServerSession: mockGetServerSession,
}))

vi.mock('@/lib/db', () => ({
  default: {
    query: mockDbQuery,
    connect: mockDbConnect,
  },
}))

vi.mock('@/lib/security', () => ({
  verifyMutationOrigin: mockVerifyMutationOrigin,
  buildServiceHeaders: mockBuildServiceHeaders,
}))

vi.mock('@/lib/validation', async () => {
  const actual = await vi.importActual<typeof import('@/lib/validation')>('@/lib/validation')
  mockParseJSONBody.mockImplementation(actual.parseJSONBody)
  mockParseWithSchema.mockImplementation(actual.parseWithSchema)
  return {
    ...actual,
    parseJSONBody: ((...args: Parameters<typeof actual.parseJSONBody>) =>
      mockParseJSONBody(...args)) as typeof actual.parseJSONBody,
    parseWithSchema: ((...args: Parameters<typeof actual.parseWithSchema>) =>
      mockParseWithSchema(...args)) as typeof actual.parseWithSchema,
  }
})

vi.mock('@/lib/feature-policies', () => ({
  checkFeatureAccess: mockCheckFeatureAccess,
}))

vi.mock('@/lib/admin', () => ({
  requireAdminApiSession: mockRequireAdminApiSession,
}))

vi.mock('@/lib/admin-service', () => ({
  proxyAdminService: mockProxyAdminService,
}))

vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn(() => ({
    webhooks: {
      constructEvent: mockStripeConstructEvent,
    },
    customers: {
      create: mockStripeCustomerCreate,
    },
    checkout: {
      sessions: {
        create: mockStripeCheckoutCreate,
      },
    },
  })),
}))

vi.mock('@/lib/crypto', () => ({
  encrypt: mockEncrypt,
}))

vi.mock('bcryptjs', async () => {
  const actual = await vi.importActual<typeof import('bcryptjs')>('bcryptjs')
  return {
    ...actual,
    hash: mockBcryptHash,
    compare: mockBcryptCompare,
  }
})

vi.mock('@/lib/auth-provisioning', () => ({
  ensureStripeCustomer: vi.fn(async () => undefined),
  provisionTenantContainer: vi.fn(async () => undefined),
  normalizeEmail: vi.fn((email: string) => email.trim().toLowerCase()),
}))

export function setSession(user: Partial<typeof fixtures.user> | null, extras: Record<string, unknown> = {}) {
  if (!user) {
    mockGetServerSession.mockResolvedValue(null)
    return
  }

  mockGetServerSession.mockResolvedValue({
    user: {
      id: user.id ?? fixtures.user.id,
      email: user.email ?? fixtures.user.email,
      tenantId: user.tenantId ?? fixtures.user.tenantId,
      name: user.name ?? fixtures.user.name,
      image: user.image ?? fixtures.user.image,
      ...extras,
    },
  })
}

export function okJson(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
}

export function okText(text: string, status = 200, contentType = 'text/plain') {
  return Promise.resolve(new Response(text, {
    status,
    headers: { 'content-type': contentType },
  }))
}

export function nextReq(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has('origin')) {
    headers.set('origin', 'http://localhost:3000')
  }
  return new Request(url, { ...init, headers })
}

export function mockValidationSuccess(data: unknown) {
  mockParseJSONBody.mockResolvedValueOnce({ success: true, data })
}

export function mockValidationFail(message = 'Invalid request body') {
  mockParseJSONBody.mockResolvedValueOnce({
    success: false,
    response: NextResponse.json({ error: message }, { status: 400 }),
  })
}

export function mockSchemaSuccess(data: unknown) {
  mockParseWithSchema.mockReturnValueOnce({ success: true, data })
}

export function mockSchemaFail(message = 'Invalid request') {
  mockParseWithSchema.mockReturnValueOnce({
    success: false,
    response: NextResponse.json({ error: message }, { status: 400 }),
  })
}
