import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { createHash } from 'node:crypto'
import packageJson from '../package.json' with { type: 'json' }

type Spawn = (command: string, args: string[]) => SpawnSyncReturns<Buffer>

type ReleaseAsset = {
  browser_download_url: string
  name: string
}

export type GitHubRelease = {
  assets: ReleaseAsset[]
  draft: boolean
  prerelease: boolean
  published_at: string | null
  tag_name: string
}

export type DetectAssetNameOptions = {
  arch?: NodeJS.Architecture
  platform?: NodeJS.Platform
  spawn?: Spawn
}

const DEFAULT_RELEASE_REPO = 'byeongsu-hong/ollama-proxy'
const DEFAULT_USER_AGENT = 'ollama-proxy'
const SOURCE_RUNTIME_BASENAMES = ['bun', 'bun-debug']
const CHECKSUMS_ASSET_NAME = 'SHA256SUMS.txt'

const defaultSpawn: Spawn = (command, args) => spawnSync(command, args)

const bufferToString = (value: Buffer | null): string => value?.toString('utf8') ?? ''

const detectLinuxVariant = (spawn: Spawn): '' | '-musl' => {
  const result = spawn('ldd', ['--version'])
  const output = `${bufferToString(result.stdout)}${bufferToString(result.stderr)}`.toLowerCase()
  return output.includes('musl') ? '-musl' : ''
}

const createGitHubHeaders = (token?: string): HeadersInit => ({
  accept: 'application/vnd.github+json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
  'user-agent': DEFAULT_USER_AGENT
})

const fetchGitHubJson = async <T>(url: string, fetchImpl: typeof fetch, token?: string): Promise<T> => {
  const response = await fetchImpl(url, {
    headers: createGitHubHeaders(token)
  })

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as T
}

export const CURRENT_VERSION = packageJson.version
export const CURRENT_VERSION_TAG = `v${CURRENT_VERSION}`
export const RELEASE_REPO = DEFAULT_RELEASE_REPO
export const RELEASE_CHECKSUMS_ASSET_NAME = CHECKSUMS_ASSET_NAME

export const normalizeVersionTag = (value: string): string => (value.startsWith('v') ? value : `v${value}`)

export const isStandaloneExecutable = (currentExecutablePath: string): boolean => {
  const basename = currentExecutablePath.split(/[\\/]/).pop() ?? currentExecutablePath
  return !SOURCE_RUNTIME_BASENAMES.includes(basename)
}

export const detectReleaseAssetName = ({
  arch = process.arch,
  platform = process.platform,
  spawn = defaultSpawn
}: DetectAssetNameOptions = {}): string => {
  if (platform === 'linux') {
    const variant = detectLinuxVariant(spawn)

    if (arch === 'x64') {
      return variant === '' ? 'ollama-proxy-linux-x64-baseline' : `ollama-proxy-linux-x64${variant}`
    }

    if (arch === 'arm64') {
      return `ollama-proxy-linux-arm64${variant}`
    }

    throw new Error(`unsupported architecture: ${arch}`)
  }

  if (platform === 'darwin') {
    if (arch === 'x64') {
      return 'ollama-proxy-darwin-x64-baseline'
    }

    if (arch === 'arm64') {
      return 'ollama-proxy-darwin-arm64'
    }

    throw new Error(`unsupported architecture: ${arch}`)
  }

  throw new Error(`unsupported operating system: ${platform}`)
}

export const parseChecksums = (content: string): Map<string, string> => {
  const entries = new Map<string, string>()

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    if (trimmed === '') {
      continue
    }

    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(trimmed)

    if (match) {
      entries.set(match[2], match[1].toLowerCase())
    }
  }

  return entries
}

export const verifyReleaseAssetChecksum = (assetName: string, asset: Uint8Array, checksums: string): void => {
  const expected = parseChecksums(checksums).get(assetName)

  if (!expected) {
    throw new Error(`missing checksum for ${assetName}`)
  }

  const actual = createHash('sha256').update(asset).digest('hex')

  if (actual !== expected) {
    throw new Error(`checksum verification failed for ${assetName}`)
  }
}

export const fetchReleaseList = async ({
  fetchImpl = fetch,
  repo = DEFAULT_RELEASE_REPO,
  token
}: {
  fetchImpl?: typeof fetch
  repo?: string
  token?: string
} = {}): Promise<GitHubRelease[]> =>
  fetchGitHubJson<GitHubRelease[]>(`https://api.github.com/repos/${repo}/releases?per_page=20`, fetchImpl, token)

export const fetchReleaseByTag = async ({
  fetchImpl = fetch,
  repo = DEFAULT_RELEASE_REPO,
  tag,
  token
}: {
  fetchImpl?: typeof fetch
  repo?: string
  tag: string
  token?: string
}): Promise<GitHubRelease> =>
  fetchGitHubJson<GitHubRelease>(
    `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(normalizeVersionTag(tag))}`,
    fetchImpl,
    token
  )

export const fetchLatestRelease = async ({
  fetchImpl = fetch,
  repo = DEFAULT_RELEASE_REPO,
  token
}: {
  fetchImpl?: typeof fetch
  repo?: string
  token?: string
} = {}): Promise<GitHubRelease> =>
  fetchGitHubJson<GitHubRelease>(`https://api.github.com/repos/${repo}/releases/latest`, fetchImpl, token)

export const findReleaseAsset = (release: GitHubRelease, assetName: string): ReleaseAsset => {
  const asset = release.assets.find((candidate) => candidate.name === assetName)

  if (!asset) {
    throw new Error(`release ${release.tag_name} does not contain asset ${assetName}`)
  }

  return asset
}

export const downloadReleaseAsset = async ({
  fetchImpl = fetch,
  token,
  url
}: {
  fetchImpl?: typeof fetch
  token?: string
  url: string
}): Promise<Uint8Array> => {
  const response = await fetchImpl(url, {
    headers: createGitHubHeaders(token)
  })

  if (!response.ok) {
    throw new Error(`asset download failed: ${response.status} ${response.statusText}`)
  }

  return new Uint8Array(await response.arrayBuffer())
}
