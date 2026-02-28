export const fixtures = {
  user: {
    id: 'user-1',
    email: 'user@example.com',
    tenantId: 'tenant-1',
    name: 'Test User',
    image: 'https://example.com/avatar.png',
  },
  adminUser: {
    id: 'admin-1',
    email: 'admin@example.com',
    tenantId: 'tenant-admin',
    isAdmin: true,
  },
  tenant: {
    id: 'tenant-1',
    status: 'active',
  },
  model: {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
  },
  conversation: {
    id: '11111111-1111-4111-8111-111111111111',
    preview: 'Hello',
  },
  message: {
    id: 'msg-1',
    role: 'assistant' as const,
    content: 'Hi there',
  },
}
