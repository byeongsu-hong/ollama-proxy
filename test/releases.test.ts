import { createHash } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import {
  detectReleaseAssetName,
  normalizeVersionTag,
  parseChecksums,
  verifyReleaseAssetChecksum
} from '../src/releases'

const createSpawnResult = (stdout = '', stderr = '') =>
  ({
    output: [null, Buffer.from(stdout), Buffer.from(stderr)],
    pid: 0,
    signal: null,
    status: 0,
    stderr: Buffer.from(stderr),
    stdout: Buffer.from(stdout)
  }) as never

describe('release helpers', () => {
  it('normalizes version tags', () => {
    expect(normalizeVersionTag('0.1.1')).toBe('v0.1.1')
    expect(normalizeVersionTag('v0.1.1')).toBe('v0.1.1')
  })

  it('detects the correct release asset name across supported targets', () => {
    expect(detectReleaseAssetName({ platform: 'darwin', arch: 'arm64' })).toBe('ollama-proxy-darwin-arm64')
    expect(detectReleaseAssetName({ platform: 'darwin', arch: 'x64' })).toBe('ollama-proxy-darwin-x64-baseline')
    expect(
      detectReleaseAssetName({
        platform: 'linux',
        arch: 'x64',
        spawn: () => createSpawnResult('ldd (Ubuntu GLIBC 2.35)')
      })
    ).toBe('ollama-proxy-linux-x64-baseline')
    expect(
      detectReleaseAssetName({
        platform: 'linux',
        arch: 'arm64',
        spawn: () => createSpawnResult('', 'musl libc (aarch64)')
      })
    ).toBe('ollama-proxy-linux-arm64-musl')
  })

  it('parses and verifies published checksums', () => {
    const asset = new TextEncoder().encode('binary')
    const hash = createHash('sha256').update(asset).digest('hex')
    const checksums = `${hash}  ollama-proxy-darwin-arm64\n`

    expect(parseChecksums(checksums).get('ollama-proxy-darwin-arm64')).toBe(hash)
    expect(() => verifyReleaseAssetChecksum('ollama-proxy-darwin-arm64', asset, checksums)).not.toThrow()
  })
})
