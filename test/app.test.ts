import { describe, expect, it, mock } from 'bun:test'
import { createApp } from '../src/app'

describe('createApp', () => {
  it('allows chat endpoint', async () => {
    const app = createApp({ ollamaBaseUrl: 'http://example.com' })
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.resolve(new Response('ok', { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    try {
      const response = await app.request('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ model: 'llama3', messages: [] }),
        headers: { 'content-type': 'application/json' }
      })

      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('blocks non-chat and non-embedding endpoints', async () => {
    const app = createApp({ ollamaBaseUrl: 'http://example.com' })

    const response = await app.request('/api/generate', { method: 'POST' })

    expect(response.status).toBe(404)
  })

  it('enforces Cloudflare Access service token headers when configured', async () => {
    const app = createApp({
      ollamaBaseUrl: 'http://example.com',
      cfAccessClientId: 'id',
      cfAccessClientSecret: 'secret'
    })

    const unauthorized = await app.request('/api/embed', { method: 'POST' })
    expect(unauthorized.status).toBe(401)

    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.resolve(new Response('ok', { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    try {
      const authorized = await app.request('/api/embed', {
        method: 'POST',
        headers: {
          'CF-Access-Client-Id': 'id',
          'CF-Access-Client-Secret': 'secret'
        },
        body: JSON.stringify({ model: 'mxbai-embed-large', input: 'hello' })
      })

      expect(authorized.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
