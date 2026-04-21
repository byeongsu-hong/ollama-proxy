#!/usr/bin/env bun

import { fileURLToPath } from 'node:url'
import { HELP_TEXT, SETUP_SYSTEMD_HELP_TEXT, resolveCliArgs, resolveCommand } from './cli'
import { createApp, config } from './app'
import { setupSystemd } from './systemd'

const startServer = (): void => {
  const app = createApp(config)
  const port = Number(process.env.PORT ?? 3000)

  Bun.serve({
    port,
    fetch: app.fetch
  })

  console.log(`ollama proxy is running on :${port}`)
}

const command = resolveCommand(process.argv)
const args = resolveCliArgs(process.argv)

switch (command) {
  case 'serve':
    startServer()
    break

  case 'setup-systemd':
    if (args.includes('--help') || args.includes('-h')) {
      console.log(SETUP_SYSTEMD_HELP_TEXT)
      break
    }

    try {
      await setupSystemd({
        currentEntrypointPath: fileURLToPath(import.meta.url),
        currentExecutablePath: process.execPath
      })
    } catch {
      process.exitCode = 1
    }
    break

  case 'help':
  case '--help':
  case '-h':
    console.log(HELP_TEXT)
    break

  default:
    console.error(`unknown command: ${command}\n`)
    console.error(HELP_TEXT)
    process.exitCode = 1
}
