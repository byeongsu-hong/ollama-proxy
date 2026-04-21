#!/usr/bin/env sh

set -eu

COMPOSE_FILE="${OLLAMA_PROXY_E2E_COMPOSE_FILE:-docker-compose.e2e.yml}"
OLLAMA_PROXY_E2E_PORT="${OLLAMA_PROXY_E2E_PORT:-13000}"
OLLAMA_PROXY_E2E_BASE_URL="${OLLAMA_PROXY_E2E_BASE_URL:-http://127.0.0.1:${OLLAMA_PROXY_E2E_PORT}}"

export OLLAMA_PROXY_E2E_PORT
export OLLAMA_PROXY_E2E_BASE_URL

cleanup() {
  status=$?

  if [ "$status" -ne 0 ]; then
    docker compose -f "$COMPOSE_FILE" logs --no-color || true
  fi

  docker compose -f "$COMPOSE_FILE" down --remove-orphans -v || true
  exit "$status"
}

trap cleanup EXIT INT TERM

docker compose -f "$COMPOSE_FILE" up -d --build
bun test ./test/e2e.ts
