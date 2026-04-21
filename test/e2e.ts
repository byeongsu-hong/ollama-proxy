import { beforeAll, describe, expect, it } from 'bun:test'

const proxyBaseUrl = process.env.OLLAMA_PROXY_E2E_BASE_URL ?? 'http://127.0.0.1:3000'
const authHeaders = {
  'CF-Access-Client-Id': 'test-id',
  'CF-Access-Client-Secret': 'test-secret',
  'Content-Type': 'application/json'
}

const requestBody = {
  messages: [{ content: 'hello from e2e', role: 'user' }],
  model: 'llama3'
}

const waitForProxy = async (): Promise<void> => {
  let lastError: unknown

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${proxyBaseUrl}/api/chat`, {
        body: JSON.stringify(requestBody),
        headers: authHeaders,
        method: 'POST'
      })

      if (response.ok) {
        return
      }

      lastError = new Error(`unexpected status: ${response.status}`)
    } catch (error) {
      lastError = error
    }

    await Bun.sleep(500)
  }

  throw lastError instanceof Error ? lastError : new Error('proxy did not become ready in time')
}

beforeAll(async () => {
  await waitForProxy()
}, 30_000)

describe('docker e2e', () => {
  it('rejects protected requests without Cloudflare Access headers', async () => {
    const response = await fetch(`${proxyBaseUrl}/v1/chat/completions`, {
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(401)
  })

  it('forwards allowed requests to the configured upstream base path', async () => {
    const response = await fetch(`${proxyBaseUrl}/v1/chat/completions`, {
      body: JSON.stringify(requestBody),
      headers: authHeaders,
      method: 'POST'
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      body_json: typeof requestBody
      method: string
      upstream_path: string
    }
    expect(payload.method).toBe('POST')
    expect(payload.upstream_path).toBe('/ollama/v1/chat/completions')
    expect(payload.body_json).toEqual(requestBody)
  })

  it('accepts forwarded Access JWT assertions', async () => {
    const response = await fetch(`${proxyBaseUrl}/api/embed`, {
      body: JSON.stringify({ input: 'hello', model: 'mxbai-embed-large' }),
      headers: {
        'CF-Access-Jwt-Assertion': 'header.payload.signature',
        'Content-Type': 'application/json'
      },
      method: 'POST'
    })

    expect(response.status).toBe(200)
  })

  it('strips sensitive and hop-by-hop headers before proxying upstream', async () => {
    const response = await fetch(`${proxyBaseUrl}/api/chat`, {
      body: JSON.stringify(requestBody),
      headers: {
        ...authHeaders,
        Authorization: 'Bearer secret',
        Connection: 'keep-alive, x-custom-hop',
        Cookie: 'session=abc',
        'CF-Access-Jwt-Assertion': 'header.payload.signature',
        'X-Custom-Hop': 'secret-hop'
      },
      method: 'POST'
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      headers: Record<string, string>
    }

    expect(payload.headers.authorization).toBeUndefined()
    expect(payload.headers.cookie).toBeUndefined()
    expect(payload.headers['cf-access-client-id']).toBeUndefined()
    expect(payload.headers['cf-access-client-secret']).toBeUndefined()
    expect(payload.headers['cf-access-jwt-assertion']).toBeUndefined()
    expect(payload.headers['x-custom-hop']).toBeUndefined()
    expect(payload.headers['content-type']).toBe('application/json')
  })

  it('blocks non-whitelisted endpoints', async () => {
    const response = await fetch(`${proxyBaseUrl}/api/generate`, {
      body: JSON.stringify(requestBody),
      headers: authHeaders,
      method: 'POST'
    })

    expect(response.status).toBe(404)
  })
})
