import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stderr as defaultStderr, stdin as defaultStdin, stdout as defaultStdout } from 'node:process'

export type RuntimeKind = 'standalone' | 'source'

type Prompter = {
  question: (query: string) => Promise<string>
  close: () => void
}

type Spawn = (command: string, args: string[]) => SpawnSyncReturns<Buffer>

type CommonSystemdConfig = {
  envFilePath: string
  serviceName: string
}

type StandaloneSystemdConfig = CommonSystemdConfig & {
  binaryPath: string
  runtimeKind: 'standalone'
}

type SourceSystemdConfig = CommonSystemdConfig & {
  entrypointPath: string
  runtimeKind: 'source'
}

export type SystemdServiceConfig = StandaloneSystemdConfig | SourceSystemdConfig

export type EnvironmentConfig = {
  cfAccessClientId?: string
  cfAccessClientSecret?: string
  ollamaBaseUrl: string
  port: number
}

type SetupSystemdOptions = {
  currentExecutablePath: string
  currentEntrypointPath: string
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  spawn?: Spawn
  stderr?: typeof defaultStderr
  stdin?: typeof defaultStdin
  stdout?: typeof defaultStdout
}

const DEFAULT_BINARY_PATH = '/usr/local/bin/ollama-proxy'
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_PORT = 3000
const DEFAULT_SERVICE_NAME = 'ollama-proxy'

const DEFAULT_SERVICE_FILE_PATH = (serviceName: string): string =>
  `/etc/systemd/system/${serviceName}.service`

const DEFAULT_ENV_FILE_PATH = (serviceName: string): string =>
  `/etc/${serviceName}/${serviceName}.env`

const SOURCE_RUNTIME_BASENAMES = ['bun', 'bun-debug']

const createPrompter = (stdin = defaultStdin, stdout = defaultStdout): Prompter =>
  createInterface({ input: stdin, output: stdout })

const formatPrompt = (label: string, defaultValue?: string): string =>
  defaultValue ? `${label} [${defaultValue}]: ` : `${label}: `

const normalizeOptionalValue = (value: string): string | undefined => {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const promptText = async (prompter: Prompter, label: string, defaultValue?: string): Promise<string> => {
  const answer = (await prompter.question(formatPrompt(label, defaultValue))).trim()
  return answer === '' ? (defaultValue ?? '') : answer
}

const promptOptionalText = async (
  prompter: Prompter,
  label: string,
  defaultValue?: string
): Promise<string | undefined> => normalizeOptionalValue(await promptText(prompter, label, defaultValue))

const promptYesNo = async (
  prompter: Prompter,
  label: string,
  defaultValue: boolean
): Promise<boolean> => {
  const hint = defaultValue ? 'Y/n' : 'y/N'
  const answer = (await prompter.question(`${label} [${hint}]: `)).trim().toLowerCase()

  if (answer === '') {
    return defaultValue
  }

  return answer === 'y' || answer === 'yes'
}

const promptPort = async (prompter: Prompter, defaultPort: number): Promise<number> => {
  while (true) {
    const answer = await promptText(prompter, 'Listen port', String(defaultPort))
    const port = Number(answer)

    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      return port
    }
  }
}

const quoteEnvironmentValue = (value: string): string => {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value
  }

  return JSON.stringify(value)
}

const escapeExecArg = (value: string): string => {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value
  }

  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

const getExecStartArgs = (config: SystemdServiceConfig): string[] => {
  if (config.runtimeKind === 'standalone') {
    return [config.binaryPath, 'serve']
  }

  return ['/usr/bin/env', 'bun', 'run', config.entrypointPath, 'serve']
}

export const isStandaloneRuntime = (currentExecutablePath: string): boolean => {
  const name = basename(currentExecutablePath)
  return !SOURCE_RUNTIME_BASENAMES.includes(name)
}

export const renderEnvironmentFile = (config: EnvironmentConfig): string => {
  const lines = [
    `PORT=${quoteEnvironmentValue(String(config.port))}`,
    `OLLAMA_BASE_URL=${quoteEnvironmentValue(config.ollamaBaseUrl)}`
  ]

  if (config.cfAccessClientId && config.cfAccessClientSecret) {
    lines.push(`CF_ACCESS_CLIENT_ID=${quoteEnvironmentValue(config.cfAccessClientId)}`)
    lines.push(`CF_ACCESS_CLIENT_SECRET=${quoteEnvironmentValue(config.cfAccessClientSecret)}`)
  }

  return `${lines.join('\n')}\n`
}

export const renderSystemdUnit = (config: SystemdServiceConfig): string => {
  const execStart = getExecStartArgs(config).map(escapeExecArg).join(' ')

  return [
    '[Unit]',
    'Description=Ollama Proxy',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `EnvironmentFile=${config.envFilePath}`,
    `ExecStart=${execStart}`,
    'Restart=always',
    'RestartSec=2',
    'StandardOutput=journal',
    'StandardError=journal',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    ''
  ].join('\n')
}

const ensureParentDirectory = async (path: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
}

const installStandaloneBinary = async (fromPath: string, toPath: string): Promise<void> => {
  await ensureParentDirectory(toPath)

  if (resolve(fromPath) !== resolve(toPath)) {
    await copyFile(fromPath, toPath)
  }

  await chmod(toPath, 0o755)
}

const runSystemctl = (spawn: Spawn, args: string[]): void => {
  const result = spawn('systemctl', args)

  if (result.status !== 0) {
    throw new Error(`systemctl ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

const defaultSpawn: Spawn = (command, args) =>
  spawnSync(command, args, {
    stdio: 'inherit'
  })

export const setupSystemd = async ({
  currentEntrypointPath,
  currentExecutablePath,
  env = process.env,
  platform = process.platform,
  spawn = defaultSpawn,
  stderr = defaultStderr,
  stdin = defaultStdin,
  stdout = defaultStdout
}: SetupSystemdOptions): Promise<void> => {
  if (platform !== 'linux') {
    throw new Error('setup-systemd is only supported on Linux')
  }

  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new Error('setup-systemd must be run as root, for example with sudo')
  }

  const runtimeKind: RuntimeKind = isStandaloneRuntime(currentExecutablePath) ? 'standalone' : 'source'
  const prompter = createPrompter(stdin, stdout)

  try {
    const serviceName = await promptText(prompter, 'Service name', DEFAULT_SERVICE_NAME)
    const envFilePath = await promptText(prompter, 'Environment file path', DEFAULT_ENV_FILE_PATH(serviceName))
    const port = await promptPort(prompter, Number(env.PORT ?? DEFAULT_PORT))
    const ollamaBaseUrl = await promptText(prompter, 'OLLAMA_BASE_URL', env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL)
    const useCloudflareAccess = await promptYesNo(
      prompter,
      'Configure Cloudflare Access service token headers',
      Boolean(env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET)
    )

    const cfAccessClientId = useCloudflareAccess
      ? await promptOptionalText(prompter, 'CF_ACCESS_CLIENT_ID', env.CF_ACCESS_CLIENT_ID)
      : undefined
    const cfAccessClientSecret = useCloudflareAccess
      ? await promptOptionalText(prompter, 'CF_ACCESS_CLIENT_SECRET', env.CF_ACCESS_CLIENT_SECRET)
      : undefined

    if (Boolean(cfAccessClientId) !== Boolean(cfAccessClientSecret)) {
      throw new Error('CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be provided together')
    }

    const systemdConfig: SystemdServiceConfig =
      runtimeKind === 'standalone'
        ? {
            binaryPath: await promptText(prompter, 'Binary install path', DEFAULT_BINARY_PATH),
            envFilePath,
            runtimeKind,
            serviceName
          }
        : {
            entrypointPath: currentEntrypointPath,
            envFilePath,
            runtimeKind,
            serviceName
          }

    const serviceFilePath = DEFAULT_SERVICE_FILE_PATH(serviceName)

    stdout.write(
      `\nPreparing ${serviceName}\n- unit: ${serviceFilePath}\n- env: ${envFilePath}\n- mode: ${runtimeKind}\n`
    )

    if (systemdConfig.runtimeKind === 'standalone') {
      stdout.write(`- binary: ${systemdConfig.binaryPath}\n`)
    } else {
      stdout.write(`- entrypoint: ${currentEntrypointPath}\n`)
      stdout.write('Running from source mode. Release binaries are recommended for production installs.\n')
    }

    const confirmed = await promptYesNo(prompter, 'Write files and enable the service now', true)

    if (!confirmed) {
      stdout.write('Aborted.\n')
      return
    }

    if (systemdConfig.runtimeKind === 'standalone') {
      await installStandaloneBinary(currentExecutablePath, systemdConfig.binaryPath)
    }

    const environmentFile = renderEnvironmentFile({
      cfAccessClientId,
      cfAccessClientSecret,
      ollamaBaseUrl,
      port
    })

    await ensureParentDirectory(envFilePath)
    await writeFile(envFilePath, environmentFile, { mode: 0o600 })
    await ensureParentDirectory(serviceFilePath)
    await writeFile(serviceFilePath, renderSystemdUnit(systemdConfig), { mode: 0o644 })

    runSystemctl(spawn, ['daemon-reload'])
    runSystemctl(spawn, ['enable', '--now', serviceName])

    stdout.write(
      `Installed ${serviceName}. Inspect logs with:\n  journalctl -u ${serviceName} -f\n`
    )
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    throw error
  } finally {
    prompter.close()
  }
}
