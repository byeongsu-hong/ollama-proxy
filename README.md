# ollama-proxy

Minimal Bun + Hono reverse proxy for Ollama that only exposes chat and embedding APIs.

## Exposed endpoints

Only `POST` requests to these endpoints are allowed:

- `/api/chat`
- `/api/embed`
- `/api/embeddings`
- `/v1/chat/completions`
- `/v1/embeddings`

All other endpoints return `404`.

## Run locally

```bash
bun install
bun run src/index.ts
```

Environment variables:

- `PORT` (default: `3000`)
- `OLLAMA_BASE_URL` (default: `http://127.0.0.1:11434`)

## Cloudflare Tunnel + Access integration

Configure a Cloudflare Tunnel to this proxy service and protect the route with Cloudflare Access. Then set service token values in the proxy:

- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

When both are set, every allowed endpoint requires matching `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.

Example `cloudflared` tunnel ingress:

```yaml
ingress:
  - hostname: ollama.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Then in Cloudflare Zero Trust, create an Access policy for `ollama.example.com` and issue a service token for trusted clients.

## Test

```bash
bun test
```
