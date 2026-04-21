import { describe, expect, it } from 'bun:test'
import { normalizeBuildVersionTag, resolveCurrentVersionTag } from '../src/version'

describe('version helpers', () => {
  it('normalizes valid build version tags', () => {
    expect(normalizeBuildVersionTag('v0.0.2')).toBe('v0.0.2')
    expect(normalizeBuildVersionTag('0.0.2')).toBe('v0.0.2')
    expect(normalizeBuildVersionTag(' v0.0.2 ')).toBe('v0.0.2')
  })

  it('ignores non-version build labels', () => {
    expect(normalizeBuildVersionTag('main')).toBeUndefined()
    expect(normalizeBuildVersionTag('feature/test')).toBeUndefined()
    expect(normalizeBuildVersionTag('')).toBeUndefined()
  })

  it('prefers an embedded build version tag over package.json version', () => {
    expect(resolveCurrentVersionTag('v0.0.2', '0.0.3')).toBe('v0.0.2')
    expect(resolveCurrentVersionTag(undefined, '0.0.3')).toBe('v0.0.3')
  })
})
