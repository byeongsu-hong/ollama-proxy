import { constants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { stdout as defaultStdout, stderr as defaultStderr } from 'node:process'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  RELEASE_CHECKSUMS_ASSET_NAME,
  RELEASE_REPO,
  detectReleaseAssetName,
  downloadReleaseAsset,
  fetchLatestRelease,
  fetchReleaseByTag,
  fetchReleaseList,
  findReleaseAsset,
  isStandaloneExecutable,
  normalizeVersionTag,
  verifyReleaseAssetChecksum
} from './releases'
import { hasManagedSystemdService, resolveSystemdServiceName } from './systemd'
import { CURRENT_VERSION_TAG } from './version'

type Spawn = (command: string, args: string[]) => SpawnSyncReturns<Buffer>

type CommonOptions = {
  arch?: NodeJS.Architecture
  currentUid?: number
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  platform?: NodeJS.Platform
  spawn?: Spawn
  stderr?: typeof defaultStderr
  stdout?: typeof defaultStdout
}

type UpdateOptions = CommonOptions & {
  args: string[]
  currentExecutablePath: string
}

type VersionsOptions = CommonOptions

type ParsedUpdateArgs = {
  check: boolean
  force: boolean
  versionTag?: string
}

const defaultSpawn: Spawn = (command, args) =>
  spawnSync(command, args, {
    stdio: 'inherit'
  })

const findExistingParentDir = async (path: string): Promise<string> => {
  let current = path

  while (true) {
    try {
      await access(current)
      return current
    } catch {
      const next = dirname(current)

      if (next === current) {
        return current
      }

      current = next
    }
  }
}

const isWritable = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

const runCommand = (spawn: Spawn, command: string, args: string[]): void => {
  const result = spawn(command, args)

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

const getReleaseContext = (env: Record<string, string | undefined>) => ({
  repo: env.OLLAMA_PROXY_REPO ?? RELEASE_REPO,
  token: env.GITHUB_TOKEN
})

const restartManagedSystemdService = async ({
  currentUid,
  env,
  platform,
  spawn,
  stdout
}: {
  currentUid: number
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  spawn: Spawn
  stdout: typeof defaultStdout
}): Promise<void> => {
  if (platform !== 'linux' || !(await hasManagedSystemdService(env))) {
    return
  }

  const serviceName = resolveSystemdServiceName(env)
  stdout.write(`Restarting systemd service ${serviceName}.\n`)

  if (currentUid === 0) {
    runCommand(spawn, 'systemctl', ['restart', serviceName])
  } else {
    runCommand(spawn, 'sudo', ['systemctl', 'restart', serviceName])
  }

  stdout.write(`Restarted ${serviceName}.\n`)
}

const installBinary = async ({
  currentExecutablePath,
  currentUid,
  downloadedBinary,
  spawn,
  stdout
}: {
  currentExecutablePath: string
  currentUid: number
  downloadedBinary: Uint8Array
  spawn: Spawn
  stdout: typeof defaultStdout
}): Promise<void> => {
  const destinationDir = dirname(currentExecutablePath)
  const writableParent = await findExistingParentDir(destinationDir)
  const needsSudo = currentUid !== 0 && !(await isWritable(writableParent))

  if (!needsSudo) {
    await mkdir(destinationDir, { recursive: true })
    const stagedPath = join(destinationDir, `.ollama-proxy-update-${process.pid}-${Date.now()}`)

    await writeFile(stagedPath, downloadedBinary)
    await chmod(stagedPath, 0o755)
    await rename(stagedPath, currentExecutablePath)
    return
  }

  stdout.write(`Updating ${currentExecutablePath} requires root privileges. You may be prompted for your sudo password.\n`)

  const tempDir = await mkdtemp(join(tmpdir(), 'ollama-proxy-update-root-'))
  const tempFile = join(tempDir, 'ollama-proxy')

  try {
    await writeFile(tempFile, downloadedBinary)
    await chmod(tempFile, 0o755)
    runCommand(spawn, 'sudo', ['mkdir', '-p', destinationDir])
    runCommand(spawn, 'sudo', ['install', '-m', '755', tempFile, currentExecutablePath])
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
}

export const parseUpdateArgs = (args: string[]): ParsedUpdateArgs => {
  let check = false
  let force = false
  let versionTag: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--check') {
      check = true
      continue
    }

    if (arg === '--force') {
      force = true
      continue
    }

    if (arg === '--version') {
      const next = args[index + 1]

      if (!next) {
        throw new Error('--version requires a value')
      }

      versionTag = normalizeVersionTag(next)
      index += 1
      continue
    }

    if (!arg.startsWith('-') && !versionTag) {
      versionTag = normalizeVersionTag(arg)
      continue
    }

    throw new Error(`unknown update option: ${arg}`)
  }

  return { check, force, versionTag }
}

export const listVersions = async ({
  env = process.env,
  fetchImpl = fetch,
  stdout = defaultStdout
}: VersionsOptions = {}): Promise<void> => {
  const { repo, token } = getReleaseContext(env)
  const releases = await fetchReleaseList({ fetchImpl, repo, token })

  if (releases.length === 0) {
    stdout.write('No releases found.\n')
    return
  }

  for (const [index, release] of releases.entries()) {
    const labels = []

    if (index === 0) {
      labels.push('latest')
    }

    if (release.tag_name === CURRENT_VERSION_TAG) {
      labels.push('current')
    }

    if (release.prerelease) {
      labels.push('prerelease')
    }

    const publishedAt = release.published_at ? release.published_at.slice(0, 10) : 'unknown-date'
    const suffix = labels.length > 0 ? ` (${labels.join(', ')})` : ''
    stdout.write(`${release.tag_name}\t${publishedAt}${suffix}\n`)
  }
}

export const updateBinary = async ({
  args,
  currentExecutablePath,
  currentUid = typeof process.getuid === 'function' ? process.getuid() : 0,
  env = process.env,
  fetchImpl = fetch,
  platform = process.platform,
  arch = process.arch,
  spawn = defaultSpawn,
  stderr = defaultStderr,
  stdout = defaultStdout
}: UpdateOptions): Promise<void> => {
  const { check, force, versionTag } = parseUpdateArgs(args)
  const { repo, token } = getReleaseContext(env)

  if (check) {
    const latestRelease = await fetchLatestRelease({ fetchImpl, repo, token })
    stdout.write(`current\t${CURRENT_VERSION_TAG}\n`)
    stdout.write(`latest\t${latestRelease.tag_name}\n`)
    return
  }

  if (!isStandaloneExecutable(currentExecutablePath)) {
    throw new Error('update is only supported for standalone release binaries')
  }

  const latestRelease = await fetchLatestRelease({ fetchImpl, repo, token })
  const targetRelease = versionTag
    ? await fetchReleaseByTag({ fetchImpl, repo, tag: versionTag, token })
    : latestRelease

  if (targetRelease.tag_name === CURRENT_VERSION_TAG && !force) {
    stdout.write(`Already on ${targetRelease.tag_name}. Use --force to reinstall it.\n`)
    return
  }

  try {
    const assetName = detectReleaseAssetName({ arch, platform, spawn })
    const binaryAsset = findReleaseAsset(targetRelease, assetName)
    const checksumsAsset = findReleaseAsset(targetRelease, RELEASE_CHECKSUMS_ASSET_NAME)

    stdout.write(`Updating ${currentExecutablePath} from ${CURRENT_VERSION_TAG} to ${targetRelease.tag_name}\n`)

    const [downloadedBinary, downloadedChecksums] = await Promise.all([
      downloadReleaseAsset({ fetchImpl, token, url: binaryAsset.browser_download_url }),
      downloadReleaseAsset({ fetchImpl, token, url: checksumsAsset.browser_download_url })
    ])

    const checksums = new TextDecoder().decode(downloadedChecksums)
    verifyReleaseAssetChecksum(assetName, downloadedBinary, checksums)

    await installBinary({
      currentExecutablePath,
      currentUid,
      downloadedBinary,
      spawn,
      stdout
    })

    if (force) {
      await restartManagedSystemdService({
        currentUid,
        env,
        platform,
        spawn,
        stdout
      })
    }

    stdout.write(`Updated to ${targetRelease.tag_name}.\n`)
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    throw error
  }
}
