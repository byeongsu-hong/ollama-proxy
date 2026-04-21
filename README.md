# @byeongsu-hong/ollama-proxy

Minimal reverse proxy for Ollama that only exposes chat and embedding APIs.

It is designed for the common "put Ollama behind Cloudflare Tunnel + Access" setup without exposing the rest of the Ollama API surface. The primary distribution is a standalone release binary built with Bun's executable compiler.

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

- A reachable Ollama server
- Bun `>= 1.3.12` for local development only

## Install

Recommended: install a standalone binary from GitHub Releases.

```bash
curl -fsSL https://github.com/byeongsu-hong/ollama-proxy/releases/latest/download/install.sh | sh
```

The installer writes to `/usr/local/bin` by default and will invoke `sudo` automatically if that path needs root privileges. To avoid `sudo`, install into a user-writable directory:

```bash
curl -fsSL https://github.com/byeongsu-hong/ollama-proxy/releases/latest/download/install.sh | \
  OLLAMA_PROXY_INSTALL_DIR="$HOME/.local/bin" sh
```

Or download a binary manually from the Releases page:

```bash
https://github.com/byeongsu-hong/ollama-proxy/releases
```

The installer downloads the matching release asset and verifies it against the published `SHA256SUMS.txt`.

To list published versions:

```bash
ollama-proxy versions
```

To check whether a newer release is available:

```bash
ollama-proxy update --check
```

To update a standalone installed binary in place:

```bash
ollama-proxy update
```

If the binary lives under a root-owned path such as `/usr/local/bin`, the updater will prompt for `sudo` when replacing it.

Or install a specific release:

```bash
ollama-proxy update --version v0.1.1
```

## Run

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434 \
PORT=3000 \
ollama-proxy serve
```

The default command is `serve`, so this also works:

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434 \
PORT=3000 \
ollama-proxy
```

## Release Assets

Release builds are generated for:

- Linux x64 baseline
- Linux arm64
- Linux x64 musl
- Linux arm64 musl
- macOS x64 baseline
- macOS arm64
- Windows x64 baseline
- Windows arm64

The x64 release uses Bun's baseline targets for broader CPU compatibility. Bun executable target details:
- https://bun.com/docs/bundler/executables

## systemd

If you installed the standalone binary, the easiest setup is the built-in wizard:

```bash
sudo ollama-proxy setup-systemd
```

It will:

1. Copy the current binary into place
2. Write an environment file under `/etc/...`
3. Write a unit file under `/etc/systemd/system/...`
4. Run `systemctl daemon-reload`
5. Run `systemctl enable --now ...`

Logs are written to stdout as JSON lines with request method, path, status, and latency. When Cloudflare Access protection is enabled, logs also include the auth source (`service-token-headers`, `jwt-assertion`, and related failure states) without logging secret values. Sensitive headers and query strings are not logged. After systemd installation:

```bash
sudo journalctl -u ollama-proxy -f
```

To disable and remove the service later:

```bash
sudo ollama-proxy uninstall
```

The uninstall wizard disables and stops the unit, removes the systemd unit file and environment file, runs `systemctl daemon-reload`, and can optionally remove the installed standalone binary.

If you only want to stop the service and remove it from startup without deleting files:

```bash
sudo ollama-proxy disable
```

Static example files are also included under [`deploy/`](./deploy).

## Development

For local development from the repository:

```bash
bun install
bun run dev
```

You can still run the source version directly with Bun:

```bash
bun run src/index.ts serve
```

```bash
bun run test
bun run typecheck
bun run build:release
```

## Docker E2E

For a full local end-to-end check, the repository includes a Docker-based test stack with:

- `proxy`: this app
- `mock-ollama`: a lightweight upstream fixture

Bring the stack up manually:

```bash
bun run docker:e2e:up
bun run test:e2e
bun run docker:e2e:down
```

Or run the whole flow with automatic cleanup:

```bash
bun run test:e2e:docker
```

The stack binds the proxy to `127.0.0.1:13000` by default so it does not fight with a local dev server on port `3000`. Override it if needed:

```bash
OLLAMA_PROXY_E2E_PORT=18080 bun run test:e2e:docker
```

## Environment Variables

- `PORT`: Port to listen on. Defaults to `3000`.
- `OLLAMA_BASE_URL`: Base URL of your Ollama server. Defaults to `http://127.0.0.1:11434`.
- `CF_ACCESS_CLIENT_ID`: Optional Cloudflare Access service token client ID.
- `CF_ACCESS_CLIENT_SECRET`: Optional Cloudflare Access service token client secret.

`CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` must be set together. When configured, every allowed endpoint requires either:

- matching `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers, or
- a Cloudflare Access-authenticated request forwarded to origin with `Cf-Access-Jwt-Assertion`

For the common Cloudflare Tunnel + Access setup, the second path is what you usually want. If your origin is directly reachable from the Internet, do not rely on header presence alone. Restrict origin access to `cloudflared` or enable Tunnel-side Access JWT validation.

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

## Release Process

Tag and push a version such as `v0.1.0`. The GitHub Actions workflow builds standalone binaries for every supported target and uploads them to the release.

## Package Distribution

An npm package is still published for source-based Bun users:

```bash
bun add @byeongsu-hong/ollama-proxy
```

## License

Apache-2.0

## Repository

- Homepage: https://github.com/byeongsu-hong/ollama-proxy
- Issues: https://github.com/byeongsu-hong/ollama-proxy/issues
