import { describe, expect, it } from 'bun:test'
import { resolveCommand } from '../src/cli'

describe('resolveCommand', () => {
  it('uses argv[2] when running from bun source mode', () => {
    expect(resolveCommand(['/usr/local/bin/bun', '/repo/src/index.ts', 'help'], '/usr/local/bin/bun')).toBe('help')
  })

  it('uses argv[1] when running as a standalone binary', () => {
    expect(resolveCommand(['/usr/local/bin/ollama-proxy', 'help'], '/usr/local/bin/ollama-proxy')).toBe('help')
  })

  it('defaults to serve when no explicit command is provided', () => {
    expect(resolveCommand(['/usr/local/bin/ollama-proxy'], '/usr/local/bin/ollama-proxy')).toBe('serve')
  })
})
