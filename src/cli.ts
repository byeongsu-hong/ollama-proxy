export const HELP_TEXT = `Usage:
  ollama-proxy serve
  ollama-proxy versions
  ollama-proxy update [--check] [--version <tag>]
  ollama-proxy setup-systemd
  ollama-proxy disable
  ollama-proxy uninstall
  ollama-proxy help

Commands:
  serve          Start the proxy server (default)
  versions       List published release versions
  update         Update a standalone release binary from GitHub Releases
  setup-systemd  Interactive wizard that installs and enables a systemd service
  disable        Interactive wizard that disables and stops a systemd service
  uninstall      Interactive wizard that disables and removes a systemd service
  help           Show this help
`

export const SETUP_SYSTEMD_HELP_TEXT = `Usage:
  ollama-proxy setup-systemd

Description:
  Interactive wizard that installs and enables a systemd service on Linux.
`

export const UNINSTALL_HELP_TEXT = `Usage:
  ollama-proxy uninstall

Description:
  Interactive wizard that disables and removes a systemd service on Linux.
`

export const DISABLE_HELP_TEXT = `Usage:
  ollama-proxy disable

Description:
  Interactive wizard that disables and stops a systemd service on Linux.
`

export const UPDATE_HELP_TEXT = `Usage:
  ollama-proxy update
  ollama-proxy update --check
  ollama-proxy update --version <tag>

Description:
  Update a standalone release binary from GitHub Releases.
`

export const VERSIONS_HELP_TEXT = `Usage:
  ollama-proxy versions

Description:
  List published release versions from GitHub Releases.
`

const INTERNAL_BUN_ENTRYPOINT_PATTERN = /(?:^|[\\/])\$bunfs(?:[\\/]|$)/
const SCRIPT_ENTRYPOINT_PATTERN = /\.(?:[cm]?[jt]sx?)$/
const KNOWN_COMMANDS = new Set(['serve', 'versions', 'update', 'setup-systemd', 'disable', 'uninstall', 'help'])
const HELP_FLAGS = new Set(['--help', '-h'])

const isInternalStandaloneEntrypoint = (value: string): boolean =>
  INTERNAL_BUN_ENTRYPOINT_PATTERN.test(value) || value === '/$bunfs/root/index.js'

const isEntrypointArg = (value: string): boolean =>
  isInternalStandaloneEntrypoint(value) || SCRIPT_ENTRYPOINT_PATTERN.test(value)

const isKnownCliToken = (value: string | undefined): boolean =>
  value !== undefined && (KNOWN_COMMANDS.has(value) || HELP_FLAGS.has(value))

export const resolveCliArgs = (argv: string[]): string[] => {
  const rawArgs = argv.slice(1)

  if (rawArgs.length === 0) {
    return []
  }

  const [firstArg, secondArg] = rawArgs

  if (isKnownCliToken(firstArg)) {
    return rawArgs
  }

  if (isEntrypointArg(firstArg) && isKnownCliToken(secondArg)) {
    return rawArgs.slice(1)
  }

  return rawArgs
}

export const resolveCommand = (argv: string[]): string => resolveCliArgs(argv)[0] ?? 'serve'
