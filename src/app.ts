import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'

type Config = {
  ollamaBaseUrl: string
  cfAccessClientId?: string
  cfAccessClientSecret?: string
}

const ALLOWED_ENDPOINTS = [
  '/api/chat',
  '/api/embed',
  '/api/embeddings',
  '/v1/chat/completions',
  '/v1/embeddings'
] as const

const ALLOWED_METHOD = 'POST'

const secureEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

const buildTargetUrl = (baseUrl: string, requestUrl: string): string => {
  const input = new URL(requestUrl)
  const output = new URL(baseUrl)
  output.pathname = input.pathname
  output.search = input.search
  return output.toString()
}

const forward = async (request: Request, baseUrl: string): Promise<Response> => {
  const headers = new Headers(request.headers)
  headers.delete('host')

  const upstream = await fetch(buildTargetUrl(baseUrl, request.url), {
    method: request.method,
    headers,
    body: request.body
  })

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers
  })
}

const loadConfig = (env: Record<string, string | undefined>): Config => {
  const cfAccessClientId = env.CF_ACCESS_CLIENT_ID
  const cfAccessClientSecret = env.CF_ACCESS_CLIENT_SECRET

  if ((cfAccessClientId && !cfAccessClientSecret) || (!cfAccessClientId && cfAccessClientSecret)) {
    throw new Error('CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be configured together')
  }

  return {
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    cfAccessClientId,
    cfAccessClientSecret
  }
}

export const createApp = (config: Config): Hono => {
  const app = new Hono()

  app.use('*', async (c, next) => {
    if (!ALLOWED_ENDPOINTS.includes(c.req.path as (typeof ALLOWED_ENDPOINTS)[number]) || c.req.method !== ALLOWED_METHOD) {
      return c.json({ error: 'endpoint not allowed' }, 404)
    }

    if (config.cfAccessClientId && config.cfAccessClientSecret) {
      const clientId = c.req.header('CF-Access-Client-Id')
      const clientSecret = c.req.header('CF-Access-Client-Secret')

      if (
        !clientId ||
        !clientSecret ||
        !secureEqual(clientId, config.cfAccessClientId) ||
        !secureEqual(clientSecret, config.cfAccessClientSecret)
      ) {
        return c.json({ error: 'unauthorized' }, 401)
      }
    }

    await next()
  })

  for (const endpoint of ALLOWED_ENDPOINTS) {
    app.post(endpoint, (c) => forward(c.req.raw, config.ollamaBaseUrl))
  }

  return app
}

export const config = loadConfig(process.env)
