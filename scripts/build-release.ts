import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type ReleaseTarget = {
  assetName: string
  target: string
}

const RELEASE_TARGETS: readonly ReleaseTarget[] = [
  { assetName: 'ollama-proxy-linux-x64-baseline', target: 'bun-linux-x64-baseline' },
  { assetName: 'ollama-proxy-linux-arm64', target: 'bun-linux-arm64' },
  { assetName: 'ollama-proxy-linux-x64-musl', target: 'bun-linux-x64-musl' },
  { assetName: 'ollama-proxy-linux-arm64-musl', target: 'bun-linux-arm64-musl' },
  { assetName: 'ollama-proxy-darwin-x64-baseline', target: 'bun-darwin-x64-baseline' },
  { assetName: 'ollama-proxy-darwin-arm64', target: 'bun-darwin-arm64' },
  { assetName: 'ollama-proxy-windows-x64-baseline.exe', target: 'bun-windows-x64-baseline' },
  { assetName: 'ollama-proxy-windows-arm64.exe', target: 'bun-windows-arm64' }
] as const

const rootDir = resolve(import.meta.dir, '..')
const entrypoint = resolve(rootDir, 'src/index.ts')
const outputDir = resolve(rootDir, 'dist/release')

const selectedTargets = process.argv.slice(2)

const targets =
  selectedTargets.length === 0
    ? RELEASE_TARGETS
    : RELEASE_TARGETS.filter(({ target }) => selectedTargets.includes(target))

const unknownTargets = selectedTargets.filter(
  (target) => !RELEASE_TARGETS.some((releaseTarget) => releaseTarget.target === target)
)

if (unknownTargets.length > 0) {
  throw new Error(`Unknown release target(s): ${unknownTargets.join(', ')}`)
}

if (targets.length === 0) {
  throw new Error('No release targets selected')
}

await rm(outputDir, { force: true, recursive: true })
await mkdir(outputDir, { recursive: true })

const checksumLines: string[] = []

for (const { assetName, target } of targets) {
  const outfile = resolve(outputDir, assetName)
  const result = await Bun.build({
    bytecode: false,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadPackageJson: false,
      autoloadTsconfig: false,
      outfile,
      target
    },
    entrypoints: [entrypoint],
    minify: true,
    sourcemap: 'none'
  })

  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join('\n')
    throw new Error(`Failed to build ${target}\n${messages}`)
  }

  const hash = createHash('sha256')
  hash.update(Buffer.from(await Bun.file(outfile).arrayBuffer()))
  checksumLines.push(`${hash.digest('hex')}  ${assetName}`)
  console.log(`built ${assetName}`)
}

await writeFile(resolve(outputDir, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`)
console.log(`release artifacts written to ${outputDir}`)
