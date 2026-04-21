#!/usr/bin/env bun

import { createApp, config } from './app'

const app = createApp(config)

const port = Number(process.env.PORT ?? 3000)

Bun.serve({
  port,
  fetch: app.fetch
})

console.log(`ollama proxy is running on :${port}`)
