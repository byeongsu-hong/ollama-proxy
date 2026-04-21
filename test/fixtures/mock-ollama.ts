import { Hono } from 'hono'

const app = new Hono()
const port = Number(process.env.PORT ?? 11434)
const prefix = (process.env.MOCK_OLLAMA_PREFIX ?? '').replace(/\/$/, '')

const endpoints = ['/api/chat', '/api/embed', '/api/embeddings', '/v1/chat/completions', '/v1/embeddings'] as const

const toRoutePath = (path: string): string => `${prefix}${path}` || '/'

app.get('/healthz', (c) => c.json({ ok: true }))

for (const endpoint of endpoints) {
  app.post(toRoutePath(endpoint), async (c) => {
    const bodyText = await c.req.raw.text()
    let bodyJson: unknown = null

    if (bodyText !== '') {
      try {
        bodyJson = JSON.parse(bodyText)
      } catch {
        bodyJson = bodyText
      }
    }

    return c.json({
      body_json: bodyJson,
      body_text: bodyText,
      headers: Object.fromEntries([...c.req.raw.headers.entries()].sort(([left], [right]) => left.localeCompare(right))),
      method: c.req.method,
      upstream_path: c.req.path
    })
  })
}

Bun.serve({
  port,
  fetch: app.fetch
})

console.log(`mock ollama is running on :${port}${prefix || '/'}`)
