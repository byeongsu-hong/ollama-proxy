import { timingSafeEqual } from 'node:crypto'
import { Hono, type MiddlewareHandler } from 'hono'

type LogFn = (message: string) => void

type Config = {
  ollamaBaseUrl: string
  cfAccessClientId?: string
  cfAccessClientSecret?: string
  log?: LogFn
}

type CloudflareAccessAuthSource =
  | 'not-required'
  | 'jwt-assertion'
  | 'service-token-headers'
  | 'partial-service-token-headers'
  | 'invalid-service-token-headers'
  | 'missing'

const ALLOWED_ENDPOINTS: ReadonlySet<string> = new Set([
  '/api/chat',
  '/api/embed',
  '/api/embeddings',
  '/v1/chat/completions',
  '/v1/embeddings'
] as const)

const ALLOWED_METHOD = 'POST'

const REQUEST_HEADERS_TO_STRIP = new Set([
  'authorization',
  'cf-connecting-ip',
  'cf-access-client-id',
  'cf-access-client-secret',
  'cf-access-token',
  'cf-access-jwt-assertion',
  'connection',
  'cookie',
  'forwarded',
  'host'
] as const)

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
] as const)

const FORWARDING_REQUEST_HEADERS = new Set([
  'true-client-ip',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-real-ip'
] as const)

const RESPONSE_HEADERS_TO_STRIP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'set-cookie',
  'trailer',
  'transfer-encoding',
  'upgrade'
] as const)

const secureEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

const defaultLog: LogFn = (message) => {
  console.log(message)
}

const trimTrailingSlash = (value: string): string => (value.endsWith('/') ? value.slice(0, -1) : value)

const ensureLeadingSlash = (value: string): string => (value.startsWith('/') ? value : `/${value}`)

const mergeUrlPath = (basePath: string, requestPath: string): string => {
  const normalizedBasePath = basePath === '/' ? '' : trimTrailingSlash(basePath)
  const normalizedRequestPath = ensureLeadingSlash(requestPath)
  return `${normalizedBasePath}${normalizedRequestPath}` || '/'
}

const buildTargetUrl = (baseUrl: string, requestUrl: string): string => {
  const input = new URL(requestUrl)
  const output = new URL(baseUrl)
  output.pathname = mergeUrlPath(output.pathname, input.pathname)
  output.search = input.search
  return output.toString()
}

const normalizeHeaderValue = (value: string | undefined | null): string | undefined => {
  const trimmed = value?.trim()
  return trimmed === '' ? undefined : trimmed
}

const getCloudflareAccessAuthSource = (request: Request, config: Config): CloudflareAccessAuthSource => {
  if (!requiresCloudflareAccess(config)) {
    return 'not-required'
  }

  if (looksLikeJwt(request.headers.get('Cf-Access-Jwt-Assertion'))) {
    return 'jwt-assertion'
  }

  const clientId = normalizeHeaderValue(request.headers.get('CF-Access-Client-Id'))
  const clientSecret = normalizeHeaderValue(request.headers.get('CF-Access-Client-Secret'))

  if (!clientId && !clientSecret) {
    return 'missing'
  }

  if (!clientId || !clientSecret) {
    return 'partial-service-token-headers'
  }

  return secureEqual(clientId, config.cfAccessClientId!) && secureEqual(clientSecret, config.cfAccessClientSecret!)
    ? 'service-token-headers'
    : 'invalid-service-token-headers'
}

const formatRequestLog = (request: Request, status: number, durationMs: number, config: Config): string => {
  const url = new URL(request.url)
  const authSource = getCloudflareAccessAuthSource(request, config)

  return JSON.stringify({
    ts: new Date().toISOString(),
    event: 'request',
    method: request.method,
    path: url.pathname,
    has_query: url.search !== '',
    status,
    duration_ms: Number(durationMs.toFixed(2)),
    ...(requiresCloudflareAccess(config)
      ? {
          cf_access_required: true,
          cf_access_auth_source: authSource,
          cf_access_client_id_present: request.headers.has('CF-Access-Client-Id'),
          cf_access_client_secret_present: request.headers.has('CF-Access-Client-Secret'),
          cf_access_jwt_assertion_present: request.headers.has('Cf-Access-Jwt-Assertion')
        }
      : {})
  })
}

const getConnectionHeaderTokens = (headers: Headers): string[] =>
  (headers.get('connection') ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)

const deleteHeaders = (headers: Headers, names: Iterable<string>): void => {
  for (const header of names) {
    headers.delete(header)
  }
}

const buildForwardHeaders = (requestHeaders: Headers): Headers => {
  const headers = new Headers(requestHeaders)
  deleteHeaders(headers, REQUEST_HEADERS_TO_STRIP)
  deleteHeaders(headers, HOP_BY_HOP_REQUEST_HEADERS)
  deleteHeaders(headers, FORWARDING_REQUEST_HEADERS)
  deleteHeaders(headers, getConnectionHeaderTokens(requestHeaders))
  return headers
}

const buildResponseHeaders = (upstreamHeaders: Headers): Headers => {
  const headers = new Headers(upstreamHeaders)
  deleteHeaders(headers, RESPONSE_HEADERS_TO_STRIP)
  deleteHeaders(headers, getConnectionHeaderTokens(upstreamHeaders))
  return headers
}

const requiresCloudflareAccess = (config: Config): boolean =>
  Boolean(config.cfAccessClientId && config.cfAccessClientSecret)

const looksLikeJwt = (value: string | null): boolean =>
  value !== null && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)

const hasValidCloudflareAccessHeaders = (request: Request, config: Config): boolean => {
  const source = getCloudflareAccessAuthSource(request, config)
  return source === 'not-required' || source === 'jwt-assertion' || source === 'service-token-headers'
}

const isAllowedRequest = (path: string, method: string): boolean =>
  method === ALLOWED_METHOD && ALLOWED_ENDPOINTS.has(path)

const createRequestLogger = (log: LogFn, config: Config): MiddlewareHandler => {
  return async (c, next) => {
    const startedAt = performance.now()

    try {
      await next()
    } finally {
      const durationMs = performance.now() - startedAt
      const status = c.finalized ? c.res.status : 500
        log(formatRequestLog(c.req.raw, status, durationMs, config))
      }
    }
  }

const forward = async (request: Request, baseUrl: string): Promise<Response> => {
  const upstream = await fetch(buildTargetUrl(baseUrl, request.url), {
    method: request.method,
    headers: buildForwardHeaders(request.headers),
    body: request.body,
    signal: request.signal
  })

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildResponseHeaders(upstream.headers)
  })
}

const loadConfig = (env: Record<string, string | undefined>): Config => {
  const cfAccessClientId = normalizeHeaderValue(env.CF_ACCESS_CLIENT_ID)
  const cfAccessClientSecret = normalizeHeaderValue(env.CF_ACCESS_CLIENT_SECRET)

  if (Boolean(cfAccessClientId) !== Boolean(cfAccessClientSecret)) {
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
  const log = config.log ?? defaultLog

  app.use('*', createRequestLogger(log, config))

  app.use('*', async (c, next) => {
    if (!isAllowedRequest(c.req.path, c.req.method)) {
      return c.json({ error: 'endpoint not allowed' }, 404)
    }

    if (!hasValidCloudflareAccessHeaders(c.req.raw, config)) {
      return c.json({ error: 'unauthorized' }, 401)
    }

    await next()
  })

  for (const endpoint of ALLOWED_ENDPOINTS) {
    app.post(endpoint, (c) => forward(c.req.raw, config.ollamaBaseUrl))
  }

  return app
}

export const config = loadConfig(process.env)
