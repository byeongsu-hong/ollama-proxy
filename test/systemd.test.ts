import { describe, expect, it } from 'bun:test'
import {
  isStandaloneRuntime,
  renderEnvironmentFile,
  renderSystemdUnit
} from '../src/systemd'

describe('systemd helpers', () => {
  it('renders an environment file with optional Cloudflare credentials', () => {
    const output = renderEnvironmentFile({
      cfAccessClientId: 'id',
      cfAccessClientSecret: 'secret',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      port: 3000
    })

    expect(output).toContain('PORT=3000')
    expect(output).toContain('OLLAMA_BASE_URL=http://127.0.0.1:11434')
    expect(output).toContain('CF_ACCESS_CLIENT_ID=id')
    expect(output).toContain('CF_ACCESS_CLIENT_SECRET=secret')
  })

  it('omits Cloudflare credentials from the environment file when unset', () => {
    const output = renderEnvironmentFile({
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      port: 3000
    })

    expect(output).not.toContain('CF_ACCESS_CLIENT_ID')
    expect(output).not.toContain('CF_ACCESS_CLIENT_SECRET')
  })

  it('renders a standalone systemd unit', () => {
    const output = renderSystemdUnit({
      binaryPath: '/usr/local/bin/ollama-proxy',
      envFilePath: '/etc/ollama-proxy/ollama-proxy.env',
      runtimeKind: 'standalone',
      serviceName: 'ollama-proxy'
    })

    expect(output).toContain('EnvironmentFile=/etc/ollama-proxy/ollama-proxy.env')
    expect(output).toContain('ExecStart=/usr/local/bin/ollama-proxy serve')
  })

  it('renders a source-mode systemd unit', () => {
    const output = renderSystemdUnit({
      entrypointPath: '/srv/ollama-proxy/src/index.ts',
      envFilePath: '/etc/ollama-proxy/ollama-proxy.env',
      runtimeKind: 'source',
      serviceName: 'ollama-proxy'
    })

    expect(output).toContain('ExecStart=/usr/bin/env bun run /srv/ollama-proxy/src/index.ts serve')
  })

  it('detects whether the current process is a standalone binary', () => {
    expect(isStandaloneRuntime('/usr/local/bin/ollama-proxy')).toBe(true)
    expect(isStandaloneRuntime('/Users/eddy/.bun/bin/bun')).toBe(false)
  })
})
