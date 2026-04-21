# @byeongsu-hong/ollama-proxy

Minimal Bun + Hono reverse proxy for Ollama that only exposes chat and embedding APIs.

It is designed for the common "put Ollama behind Cloudflare Tunnel + Access" setup without exposing the rest of the Ollama API surface.

## Features

- Only allows `POST` requests to Ollama chat and embedding endpoints
- Supports both Ollama native and OpenAI-compatible paths
- Optionally enforces Cloudflare Access service token headers
- Strips sensitive auth, forwarding, cookie, and hop-by-hop headers before proxying upstream
- Strips unsafe upstream response headers before returning to clients

## Allowed Endpoints

- `/api/chat`
- `/api/embed`
- `/api/embeddings`
- `/v1/chat/completions`
- `/v1/embeddings`

All other routes return `404`.

## Requirements

- Bun `>= 1.3.12`
- A reachable Ollama server

## Install

```bash
bun add @byeongsu-hong/ollama-proxy
```

To run it without adding it to your project:

```bash
bunx @byeongsu-hong/ollama-proxy
```

## Run

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434 \
PORT=3000 \
bunx @byeongsu-hong/ollama-proxy
```

For local development from the repository:

```bash
bun install
bun run dev
```

## Environment Variables

- `PORT`: Port to listen on. Defaults to `3000`.
- `OLLAMA_BASE_URL`: Base URL of your Ollama server. Defaults to `http://127.0.0.1:11434`.
- `CF_ACCESS_CLIENT_ID`: Optional Cloudflare Access service token client ID.
- `CF_ACCESS_CLIENT_SECRET`: Optional Cloudflare Access service token client secret.

`CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` must be set together. When configured, every allowed endpoint requires matching `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.

## Cloudflare Tunnel + Access

Example `cloudflared` ingress:

```yaml
ingress:
  - hostname: ollama.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Then:

1. Create a Cloudflare Access application for `ollama.example.com`.
2. Add a `Service Auth` policy.
3. Issue a service token.
4. Set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` in this proxy.

Clients can then call the proxy with:

```bash
curl https://ollama.example.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "CF-Access-Client-Id: <client-id>" \
  -H "CF-Access-Client-Secret: <client-secret>" \
  -d '{"model":"llama3","messages":[{"role":"user","content":"hello"}]}'
```

## Development

```bash
bun run test
bun run typecheck
```

## Publish Checklist

- Confirm you own the npm scope `@byeongsu-hong`
- Log in with `npm login`
- Publish with `npm publish --access public`

## License

Apache-2.0

## Repository

- Homepage: https://github.com/byeongsu-hong/ollama-proxy
- Issues: https://github.com/byeongsu-hong/ollama-proxy/issues
