import { describe, expect, it } from 'bun:test'
import { resolveCliArgs, resolveCommand } from '../src/cli'

describe('resolveCommand', () => {
  it('skips the source entrypoint when running from bun source mode', () => {
    expect(resolveCommand(['/usr/local/bin/bun', '/repo/src/index.ts', 'help'])).toBe('help')
  })

  it('uses the first CLI token when running as a standalone binary', () => {
    expect(resolveCommand(['/usr/local/bin/ollama-proxy', 'help'])).toBe('help')
  })

  it('defaults to serve when no explicit command is provided', () => {
    expect(resolveCommand(['/usr/local/bin/ollama-proxy'])).toBe('serve')
  })

  it('skips Bun standalone internal entrypoint arguments', () => {
    expect(
      resolveCommand(['/usr/local/bin/ollama-proxy', '/$bunfs/root/index.js', 'setup-systemd', '--help'])
    ).toBe('setup-systemd')
  })

  it('preserves command flags after removing the Bun standalone entrypoint argument', () => {
    expect(
      resolveCliArgs(['/usr/local/bin/ollama-proxy', '/$bunfs/root/index.js', 'setup-systemd', '--help'])
    ).toEqual(['setup-systemd', '--help'])
  })

  it('defaults to serve when the standalone runtime injects only an internal Bun entrypoint', () => {
    expect(resolveCliArgs(['/usr/local/bin/ollama-proxy', '/$bunfs/root/index.js'])).toEqual([])
    expect(resolveCommand(['/usr/local/bin/ollama-proxy', '/$bunfs/root/index.js'])).toBe('serve')
  })

  it('keeps unknown commands intact instead of treating them as entrypoints', () => {
    expect(resolveCommand(['/usr/local/bin/ollama-proxy', 'bogus-command'])).toBe('bogus-command')
  })

  it('recognizes the uninstall command', () => {
    expect(resolveCommand(['/usr/local/bin/ollama-proxy', 'uninstall'])).toBe('uninstall')
  })

  it('recognizes the disable command', () => {
    expect(resolveCommand(['/usr/local/bin/ollama-proxy', 'disable'])).toBe('disable')
  })

  it('recognizes the versions and update commands', () => {
    expect(resolveCommand(['/usr/local/bin/ollama-proxy', 'version'])).toBe('version')
    expect(resolveCommand(['/usr/local/bin/ollama-proxy', 'versions'])).toBe('versions')
    expect(resolveCommand(['/usr/local/bin/ollama-proxy', 'update'])).toBe('update')
  })

  it('accepts help flags directly in source mode', () => {
    expect(resolveCliArgs(['/usr/local/bin/bun', '/repo/src/index.ts', '--help'])).toEqual(['--help'])
  })
})
