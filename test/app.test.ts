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
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('http://example.com/api/chat')
      expect(init.method).toBe('POST')
      expect(new Headers(init.headers).get('content-type')).toBe('application/json')
      expect(await new Response(init.body).text()).toBe(JSON.stringify({ model: 'llama3', messages: [] }))
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
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('http://example.com/api/embed')
      expect(init.method).toBe('POST')
      expect(await new Response(init.body).text()).toBe(JSON.stringify({ model: 'mxbai-embed-large', input: 'hello' }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not forward Cloudflare Access credentials or cookies upstream', async () => {
    const app = createApp({
      ollamaBaseUrl: 'http://example.com',
      cfAccessClientId: 'id',
      cfAccessClientSecret: 'secret'
    })

    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.resolve(new Response('ok', { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    try {
      const response = await app.request('/api/embed', {
        method: 'POST',
        headers: {
          'CF-Access-Client-Id': 'id',
          'CF-Access-Client-Secret': 'secret',
          'CF-Access-Token': 'token',
          'CF-Access-Jwt-Assertion': 'jwt',
          Cookie: 'CF_Authorization=session; other=ok',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: 'mxbai-embed-large', input: 'hello' })
      })

      expect(response.status).toBe(200)
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      const headers = new Headers(init.headers)
      expect(headers.get('cf-access-client-id')).toBeNull()
      expect(headers.get('cf-access-client-secret')).toBeNull()
      expect(headers.get('cf-access-token')).toBeNull()
      expect(headers.get('cf-access-jwt-assertion')).toBeNull()
      expect(headers.get('cookie')).toBeNull()
      expect(headers.get('content-type')).toBe('application/json')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not forward authorization or hop-by-hop request headers upstream', async () => {
    const app = createApp({ ollamaBaseUrl: 'http://example.com' })
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.resolve(new Response('ok', { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    try {
      const response = await app.request('/api/chat', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-test',
          'Proxy-Authorization': 'Basic abc123',
          Connection: 'keep-alive, upgrade, x-custom-hop',
          'Keep-Alive': 'timeout=5',
          Upgrade: 'websocket',
          TE: 'trailers',
          Trailer: 'x-trailer',
          'Transfer-Encoding': 'chunked',
          'X-Custom-Hop': 'secret',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: 'llama3', messages: [] })
      })

      expect(response.status).toBe(200)
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      const headers = new Headers(init.headers)
      expect(headers.get('authorization')).toBeNull()
      expect(headers.get('proxy-authorization')).toBeNull()
      expect(headers.get('connection')).toBeNull()
      expect(headers.get('keep-alive')).toBeNull()
      expect(headers.get('upgrade')).toBeNull()
      expect(headers.get('te')).toBeNull()
      expect(headers.get('trailer')).toBeNull()
      expect(headers.get('transfer-encoding')).toBeNull()
      expect(headers.get('x-custom-hop')).toBeNull()
      expect(headers.get('content-type')).toBe('application/json')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not forward client-supplied forwarding or source IP headers upstream', async () => {
    const app = createApp({ ollamaBaseUrl: 'http://example.com' })
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.resolve(new Response('ok', { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    try {
      const response = await app.request('/api/embed', {
        method: 'POST',
        headers: {
          Forwarded: 'for=198.51.100.4;proto=https;host=proxy.example.com',
          'X-Forwarded-For': '198.51.100.4',
          'X-Forwarded-Host': 'proxy.example.com',
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Port': '443',
          'X-Real-IP': '198.51.100.4',
          'CF-Connecting-IP': '198.51.100.4',
          'True-Client-IP': '198.51.100.4',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: 'mxbai-embed-large', input: 'hello' })
      })

      expect(response.status).toBe(200)
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      const headers = new Headers(init.headers)
      expect(headers.get('forwarded')).toBeNull()
      expect(headers.get('x-forwarded-for')).toBeNull()
      expect(headers.get('x-forwarded-host')).toBeNull()
      expect(headers.get('x-forwarded-proto')).toBeNull()
      expect(headers.get('x-forwarded-port')).toBeNull()
      expect(headers.get('x-real-ip')).toBeNull()
      expect(headers.get('cf-connecting-ip')).toBeNull()
      expect(headers.get('true-client-ip')).toBeNull()
      expect(headers.get('content-type')).toBe('application/json')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('preserves any base path configured in OLLAMA_BASE_URL', async () => {
    const app = createApp({ ollamaBaseUrl: 'http://example.com/ollama' })
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() => Promise.resolve(new Response('ok', { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    try {
      const response = await app.request('/v1/embeddings?format=float', {
        method: 'POST',
        body: JSON.stringify({ model: 'mxbai-embed-large', input: 'hello' }),
        headers: { 'content-type': 'application/json' }
      })

      expect(response.status).toBe(200)
      const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('http://example.com/ollama/v1/embeddings?format=float')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('forwards the request abort signal upstream', async () => {
    const app = createApp({ ollamaBaseUrl: 'http://example.com' })
    const originalFetch = globalThis.fetch
    const controller = new AbortController()
    const fetchMock = mock((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      return Promise.resolve(new Response('ok', { status: 200 }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    try {
      const response = await app.request('/api/chat', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ model: 'llama3', messages: [] }),
        headers: { 'content-type': 'application/json' }
      })

      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not forward unsafe upstream response headers to the client', async () => {
    const app = createApp({ ollamaBaseUrl: 'http://example.com' })
    const originalFetch = globalThis.fetch
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response('ok', {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
            'Set-Cookie': 'session=abc; HttpOnly',
            Connection: 'keep-alive',
            'Keep-Alive': 'timeout=5',
            'Proxy-Authenticate': 'Basic realm=proxy',
            Trailer: 'x-trailer',
            'Transfer-Encoding': 'chunked',
            Upgrade: 'websocket'
          }
        })
      )
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    try {
      const response = await app.request('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ model: 'llama3', messages: [] }),
        headers: { 'content-type': 'application/json' }
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/plain')
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(response.headers.get('connection')).toBeNull()
      expect(response.headers.get('keep-alive')).toBeNull()
      expect(response.headers.get('proxy-authenticate')).toBeNull()
      expect(response.headers.get('trailer')).toBeNull()
      expect(response.headers.get('transfer-encoding')).toBeNull()
      expect(response.headers.get('upgrade')).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
