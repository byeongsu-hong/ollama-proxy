import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { listVersions, parseUpdateArgs, updateBinary } from '../src/update'

type ReleaseAsset = {
  browser_download_url: string
  name: string
}

type ReleaseFixture = {
  assets: ReleaseAsset[]
  draft: boolean
  prerelease: boolean
  published_at: string | null
  tag_name: string
}

const assetName = 'ollama-proxy-darwin-arm64'
const latestRelease: ReleaseFixture = {
  assets: [
    { browser_download_url: 'https://example.test/assets/latest/binary', name: assetName },
    { browser_download_url: 'https://example.test/assets/latest/checksums', name: 'SHA256SUMS.txt' }
  ],
  draft: false,
  prerelease: false,
  published_at: '2026-04-21T00:00:00Z',
  tag_name: 'v0.0.4'
}

const currentRelease: ReleaseFixture = {
  assets: [],
  draft: false,
  prerelease: false,
  published_at: '2026-04-20T00:00:00Z',
  tag_name: 'v0.0.3'
}

const latestBinary = new TextEncoder().encode('new-binary')
const latestChecksum = createHash('sha256').update(latestBinary).digest('hex')
const createMockSpawnResult = (status: number) =>
  ({
    output: [null, null, null],
    pid: 0,
    signal: null,
    status,
    stderr: null,
    stdout: null
  }) as never

const createFetch = (): typeof fetch =>
  (async (input) => {
    const url = String(input)

    switch (url) {
      case 'https://api.github.com/repos/byeongsu-hong/ollama-proxy/releases/latest':
        return new Response(JSON.stringify(latestRelease), { status: 200 })
      case 'https://api.github.com/repos/byeongsu-hong/ollama-proxy/releases?per_page=20':
        return new Response(JSON.stringify([latestRelease, currentRelease]), { status: 200 })
      case 'https://api.github.com/repos/byeongsu-hong/ollama-proxy/releases/tags/v0.0.3':
        return new Response(JSON.stringify(currentRelease), { status: 200 })
      case 'https://api.github.com/repos/byeongsu-hong/ollama-proxy/releases/tags/v0.0.4':
        return new Response(JSON.stringify(latestRelease), { status: 200 })
      case 'https://example.test/assets/latest/binary':
        return new Response(latestBinary, { status: 200 })
      case 'https://example.test/assets/latest/checksums':
        return new Response(`${latestChecksum}  ${assetName}\n`, { status: 200 })
      default:
        return new Response('not found', { status: 404 })
    }
  }) as typeof fetch

describe('update helpers', () => {
  it('parses update arguments', () => {
    expect(parseUpdateArgs(['--check'])).toEqual({ check: true, force: false, versionTag: undefined })
    expect(parseUpdateArgs(['--force'])).toEqual({ check: false, force: true, versionTag: undefined })
    expect(parseUpdateArgs(['0.0.4'])).toEqual({ check: false, force: false, versionTag: 'v0.0.4' })
    expect(parseUpdateArgs(['--version', 'v0.0.4'])).toEqual({ check: false, force: false, versionTag: 'v0.0.4' })
    expect(parseUpdateArgs(['--version', 'v0.0.4', '--force'])).toEqual({
      check: false,
      force: true,
      versionTag: 'v0.0.4'
    })
  })

  it('lists published versions and marks current/latest releases', async () => {
    const lines: string[] = []

    await listVersions({
      fetchImpl: createFetch(),
      stdout: {
        write: (chunk: string) => {
          lines.push(chunk)
          return true
        }
      } as never
    })

    expect(lines.join('')).toContain('v0.0.4\t2026-04-21 (latest)')
    expect(lines.join('')).toContain('v0.0.3\t2026-04-20 (current)')
  })

  it('checks the latest published version without mutating the binary', async () => {
    const lines: string[] = []

    await updateBinary({
      args: ['--check'],
      currentExecutablePath: '/usr/local/bin/bun',
      fetchImpl: createFetch(),
      stdout: {
        write: (chunk: string) => {
          lines.push(chunk)
          return true
        }
      } as never
    })

    expect(lines.join('')).toContain('current\tv0.0.3')
    expect(lines.join('')).toContain('latest\tv0.0.4')
  })

  it('updates a writable standalone binary in place after verifying checksums', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ollama-proxy-update-'))
    const executablePath = join(tempDir, 'ollama-proxy')
    const lines: string[] = []

    await writeFile(executablePath, 'old-binary')

    try {
      await updateBinary({
        arch: 'arm64',
        args: ['v0.0.4'],
        currentExecutablePath: executablePath,
        currentUid: 1000,
        fetchImpl: createFetch(),
        platform: 'darwin',
        stdout: {
          write: (chunk: string) => {
            lines.push(chunk)
            return true
          }
        } as never
      })

      expect((await readFile(executablePath)).toString()).toBe('new-binary')
      expect(lines.join('')).toContain(`Updating ${executablePath} from v0.0.3 to v0.0.4`)
      expect(lines.join('')).toContain('Updated to v0.0.4.')
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('requires --force to reinstall the current version', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ollama-proxy-update-current-'))
    const executablePath = join(tempDir, 'ollama-proxy')
    const lines: string[] = []

    await writeFile(executablePath, 'old-binary')

    try {
      await updateBinary({
        arch: 'arm64',
        args: ['v0.0.3'],
        currentExecutablePath: executablePath,
        currentUid: 1000,
        env: { OLLAMA_PROXY_REPO: 'byeongsu-hong/ollama-proxy' },
        fetchImpl: createFetch(),
        platform: 'darwin',
        stdout: {
          write: (chunk: string) => {
            lines.push(chunk)
            return true
          }
        } as never
      })

      expect((await readFile(executablePath)).toString()).toBe('old-binary')
      expect(lines.join('')).toContain('Already on v0.0.3. Use --force to reinstall it.')
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('reinstalls the current version when --force is set', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ollama-proxy-update-force-'))
    const executablePath = join(tempDir, 'ollama-proxy')
    const lines: string[] = []
    const currentBinary = new TextEncoder().encode('current-binary')
    const currentChecksum = createHash('sha256').update(currentBinary).digest('hex')
    const fetchCurrent = (async (input) => {
      const url = String(input)

      switch (url) {
        case 'https://api.github.com/repos/byeongsu-hong/ollama-proxy/releases/latest':
          return new Response(JSON.stringify(latestRelease), { status: 200 })
        case 'https://api.github.com/repos/byeongsu-hong/ollama-proxy/releases/tags/v0.0.3':
          return new Response(
            JSON.stringify({
              ...currentRelease,
              assets: [
                { browser_download_url: 'https://example.test/assets/current/binary', name: assetName },
                { browser_download_url: 'https://example.test/assets/current/checksums', name: 'SHA256SUMS.txt' }
              ]
            }),
            { status: 200 }
          )
        case 'https://example.test/assets/current/binary':
          return new Response(currentBinary, { status: 200 })
        case 'https://example.test/assets/current/checksums':
          return new Response(`${currentChecksum}  ${assetName}\n`, { status: 200 })
        default:
          return createFetch()(input)
      }
    }) as typeof fetch

    await writeFile(executablePath, 'old-binary')

    try {
      await updateBinary({
        arch: 'arm64',
        args: ['--version', 'v0.0.3', '--force'],
        currentExecutablePath: executablePath,
        currentUid: 1000,
        fetchImpl: fetchCurrent,
        platform: 'darwin',
        stdout: {
          write: (chunk: string) => {
            lines.push(chunk)
            return true
          }
        } as never
      })

      expect((await readFile(executablePath)).toString()).toBe('current-binary')
      expect(lines.join('')).toContain(`Updating ${executablePath} from v0.0.3 to v0.0.3`)
      expect(lines.join('')).toContain('Updated to v0.0.3.')
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('restarts the managed systemd service after a forced update', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ollama-proxy-update-systemd-'))
    const executablePath = join(tempDir, 'ollama-proxy')
    const serviceFilePath = join(tempDir, 'ollama-proxy.service')
    const linuxAssetName = 'ollama-proxy-linux-arm64'
    const linuxBinary = new TextEncoder().encode('linux-binary')
    const linuxChecksum = createHash('sha256').update(linuxBinary).digest('hex')
    const spawnCalls: Array<{ command: string; args: string[] }> = []
    const lines: string[] = []
    const fetchLinux = (async (input) => {
      const url = String(input)

      switch (url) {
        case 'https://api.github.com/repos/byeongsu-hong/ollama-proxy/releases/latest':
          return new Response(
            JSON.stringify({
              ...latestRelease,
              assets: [
                { browser_download_url: 'https://example.test/assets/linux/binary', name: linuxAssetName },
                { browser_download_url: 'https://example.test/assets/linux/checksums', name: 'SHA256SUMS.txt' }
              ]
            }),
            { status: 200 }
          )
        case 'https://api.github.com/repos/byeongsu-hong/ollama-proxy/releases/tags/v0.0.4':
          return new Response(
            JSON.stringify({
              ...latestRelease,
              assets: [
                { browser_download_url: 'https://example.test/assets/linux/binary', name: linuxAssetName },
                { browser_download_url: 'https://example.test/assets/linux/checksums', name: 'SHA256SUMS.txt' }
              ]
            }),
            { status: 200 }
          )
        case 'https://example.test/assets/linux/binary':
          return new Response(linuxBinary, { status: 200 })
        case 'https://example.test/assets/linux/checksums':
          return new Response(`${linuxChecksum}  ${linuxAssetName}\n`, { status: 200 })
        default:
          return createFetch()(input)
      }
    }) as typeof fetch

    await writeFile(executablePath, 'old-binary')
    await writeFile(serviceFilePath, '[Unit]\nDescription=Ollama Proxy\n')

    try {
      await updateBinary({
        arch: 'arm64',
        args: ['--version', 'v0.0.4', '--force'],
        currentExecutablePath: executablePath,
        currentUid: 0,
        env: {
          OLLAMA_PROXY_SYSTEMD_SERVICE: 'ollama-proxy',
          OLLAMA_PROXY_SYSTEMD_SERVICE_FILE: serviceFilePath
        },
        fetchImpl: fetchLinux,
        platform: 'linux',
        spawn: (command, args) => {
          spawnCalls.push({ args, command })
          return createMockSpawnResult(0)
        },
        stdout: {
          write: (chunk: string) => {
            lines.push(chunk)
            return true
          }
        } as never
      })

      expect((await readFile(executablePath)).toString()).toBe('linux-binary')
      expect(spawnCalls).toContainEqual({ command: 'systemctl', args: ['restart', 'ollama-proxy'] })
      expect(lines.join('')).toContain('Restarting systemd service ollama-proxy.')
      expect(lines.join('')).toContain('Restarted ollama-proxy.')
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('rejects update installs when running from source mode', async () => {
    await expect(
      updateBinary({
        args: [],
        currentExecutablePath: '/usr/local/bin/bun',
        fetchImpl: createFetch()
      })
    ).rejects.toThrow('update is only supported for standalone release binaries')
  })
})
