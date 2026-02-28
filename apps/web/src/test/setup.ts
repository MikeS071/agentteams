import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'

process.env.NEXTAUTH_URL = 'http://localhost:3000'
process.env.SERVICE_API_KEY = 'test-service-key'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
process.env.STRIPE_SECRET_KEY = 'sk_test_key'
process.env.API_URL = 'http://localhost:8080'
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})
