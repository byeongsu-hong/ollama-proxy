import packageJson from '../package.json' with { type: 'json' }

declare const __OLLAMA_PROXY_BUILD_VERSION__: string | undefined

const VERSION_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

export const CURRENT_VERSION = packageJson.version

export const normalizeBuildVersionTag = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim()

  if (!trimmed) {
    return undefined
  }

  const candidate = trimmed.startsWith('v') ? trimmed : `v${trimmed}`
  return VERSION_TAG_PATTERN.test(candidate) ? candidate : undefined
}

export const resolveCurrentVersionTag = (
  buildVersion: string | null | undefined,
  packageVersion = CURRENT_VERSION
): string => normalizeBuildVersionTag(buildVersion) ?? `v${packageVersion}`

export const CURRENT_VERSION_TAG = resolveCurrentVersionTag(
  typeof __OLLAMA_PROXY_BUILD_VERSION__ === 'string' ? __OLLAMA_PROXY_BUILD_VERSION__ : undefined
)
