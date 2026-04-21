import { isStandaloneRuntime } from './systemd'

export const HELP_TEXT = `Usage:
  ollama-proxy serve
  ollama-proxy setup-systemd
  ollama-proxy help

Commands:
  serve          Start the proxy server (default)
  setup-systemd  Interactive wizard that installs and enables a systemd service
  help           Show this help
`

export const resolveCommand = (argv: string[], execPath: string): string => {
  const commandIndex = isStandaloneRuntime(execPath) ? 1 : 2
  return argv[commandIndex] ?? 'serve'
}
