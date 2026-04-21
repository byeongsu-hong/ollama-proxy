import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import {
  disableSystemd,
  isStandaloneRuntime,
  renderEnvironmentFile,
  renderSystemdUnit,
  uninstallSystemd
} from '../src/systemd'

const createMockSpawnResult = (status: number) =>
  ({
    output: [null, null, null],
    pid: 0,
    signal: null,
    status,
    stderr: null,
    stdout: null
  }) as never

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
    expect(isStandaloneRuntime('/home/tester/.bun/bin/bun')).toBe(false)
  })

  it('disables a systemd service without removing files', async () => {
    const spawnCalls: string[][] = []
    let closed = false
    const output: string[] = []
    const answers = ['ollama-proxy', 'y']

    await disableSystemd({
      currentUid: 0,
      platform: 'linux',
      prompter: {
        close: () => {
          closed = true
        },
        question: async () => answers.shift() ?? ''
      },
      spawn: (_command, args) => {
        spawnCalls.push(args)
        return createMockSpawnResult(0)
      },
      stderr: { write: () => true } as never,
      stdout: {
        write: (chunk: string) => {
          output.push(chunk)
          return true
        }
      } as never
    })

    expect(spawnCalls).toEqual([
      ['disable', '--now', 'ollama-proxy'],
      ['reset-failed', 'ollama-proxy']
    ])
    expect(output.join('')).toContain('Disabled ollama-proxy.')
    expect(closed).toBe(true)
  })

  it('uninstalls a systemd service and optionally removes the standalone binary', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ollama-proxy-uninstall-'))
    const serviceFilePath = join(tempDir, 'ollama-proxy.service')
    const envFilePath = join(tempDir, 'ollama-proxy.env')
    const binaryPath = join(tempDir, 'ollama-proxy')
    const spawnCalls: string[][] = []
    let closed = false

    await writeFile(serviceFilePath, 'unit')
    await writeFile(envFilePath, 'env')
    await writeFile(binaryPath, 'binary')

    const output: string[] = []
    const answers = ['ollama-proxy', serviceFilePath, envFilePath, 'y', binaryPath, 'y']

    try {
      await uninstallSystemd({
        currentExecutablePath: '/usr/local/bin/ollama-proxy',
        currentUid: 0,
        platform: 'linux',
        prompter: {
          close: () => {
            closed = true
          },
          question: async () => answers.shift() ?? ''
        },
        spawn: (_command, args) => {
          spawnCalls.push(args)
          return createMockSpawnResult(0)
        },
        stderr: { write: () => true } as never,
        stdout: {
          write: (chunk: string) => {
            output.push(chunk)
            return true
          }
        } as never
      })

      expect(await Bun.file(serviceFilePath).exists()).toBe(false)
      expect(await Bun.file(envFilePath).exists()).toBe(false)
      expect(await Bun.file(binaryPath).exists()).toBe(false)
      expect(spawnCalls).toEqual([
        ['disable', '--now', 'ollama-proxy'],
        ['reset-failed', 'ollama-proxy'],
        ['daemon-reload']
      ])
      expect(output.join('')).toContain('Removed ollama-proxy.')
      expect(closed).toBe(true)
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('continues uninstall cleanup when disable/reset-failed systemctl calls fail', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ollama-proxy-uninstall-'))
    const serviceFilePath = join(tempDir, 'ollama-proxy.service')
    const envDir = join(tempDir, 'etc')
    const envFilePath = join(envDir, 'ollama-proxy.env')
    const statuses = [1, 1, 0]
    const spawnCalls: string[][] = []
    const answers = ['ollama-proxy', serviceFilePath, envFilePath, 'n', 'y']

    await mkdir(envDir, { recursive: true })
    await writeFile(serviceFilePath, 'unit')
    await writeFile(envFilePath, 'env')

    try {
      await uninstallSystemd({
        currentExecutablePath: '/usr/local/bin/ollama-proxy',
        currentUid: 0,
        platform: 'linux',
        prompter: {
          close: () => {},
          question: async () => answers.shift() ?? ''
        },
        spawn: (_command, args) => {
          spawnCalls.push(args)
          return createMockSpawnResult(statuses.shift() ?? 0)
        },
        stderr: { write: () => true } as never,
        stdout: { write: () => true } as never
      })

      expect(await Bun.file(serviceFilePath).exists()).toBe(false)
      expect(await Bun.file(envFilePath).exists()).toBe(false)
      expect(spawnCalls).toEqual([
        ['disable', '--now', 'ollama-proxy'],
        ['reset-failed', 'ollama-proxy'],
        ['daemon-reload']
      ])
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })
})
