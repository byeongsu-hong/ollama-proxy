#!/usr/bin/env sh

set -eu

REPO="${OLLAMA_PROXY_REPO:-byeongsu-hong/ollama-proxy}"
INSTALL_DIR="${OLLAMA_PROXY_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="${OLLAMA_PROXY_BINARY_NAME:-ollama-proxy}"
VERSION="${OLLAMA_PROXY_VERSION:-latest}"

detect_os() {
  case "$(uname -s)" in
    Linux) printf '%s' "linux" ;;
    Darwin) printf '%s' "darwin" ;;
    *)
      printf '%s\n' "unsupported operating system: $(uname -s)" >&2
      exit 1
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf '%s' "x64" ;;
    arm64|aarch64) printf '%s' "arm64" ;;
    *)
      printf '%s\n' "unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

detect_linux_variant() {
  if [ "$(detect_os)" != "linux" ]; then
    return 0
  fi

  if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
    printf '%s' "-musl"
    return 0
  fi

  printf '%s' ""
}

detect_asset_name() {
  os="$(detect_os)"
  arch="$(detect_arch)"

  if [ "$os" = "linux" ]; then
    variant="$(detect_linux_variant)"

    if [ "$arch" = "x64" ] && [ -z "$variant" ]; then
      printf '%s' "ollama-proxy-linux-x64-baseline"
      return 0
    fi

    printf '%s' "ollama-proxy-${os}-${arch}${variant}"
    return 0
  fi

  if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
    printf '%s' "ollama-proxy-darwin-x64-baseline"
    return 0
  fi

  printf '%s' "ollama-proxy-${os}-${arch}"
}

build_download_url() {
  asset_name="$(detect_asset_name)"

  if [ "$VERSION" = "latest" ]; then
    printf '%s' "https://github.com/${REPO}/releases/latest/download/${asset_name}"
    return 0
  fi

  printf '%s' "https://github.com/${REPO}/releases/download/${VERSION}/${asset_name}"
}

main() {
  asset_name="$(detect_asset_name)"
  download_url="$(build_download_url)"
  temp_file="$(mktemp "${TMPDIR:-/tmp}/ollama-proxy.XXXXXX")"
  destination="${INSTALL_DIR%/}/${BINARY_NAME}"

  trap 'rm -f "$temp_file"' EXIT INT TERM

  printf '%s\n' "Downloading ${asset_name} from ${download_url}"
  curl -fsSL "$download_url" -o "$temp_file"
  chmod +x "$temp_file"
  mkdir -p "$INSTALL_DIR"

  if command -v install >/dev/null 2>&1; then
    install -m 755 "$temp_file" "$destination"
  else
    cp "$temp_file" "$destination"
    chmod 755 "$destination"
  fi

  printf '%s\n' "Installed ${destination}"
  printf '%s\n' "Run '${destination} setup-systemd' as root to install a systemd service."
}

main "$@"
