#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(dirname -- "$script_dir")"
mode="native"

usage() {
  cat <<'EOF'
Usage: ./scripts/start.sh [OPTION] [-- APP_ARGUMENTS...]

Start Cordflow in one of the following modes:
  --native       Start the native Tauri application (default)
  --web          Start the browser development server with the mock graph
  -h, --help     Show this help message

Any arguments after the mode are passed to Tauri or Vite.
EOF
}

case "${1:-}" in
  --native)
    mode="native"
    shift
    ;;
  --web)
    mode="web"
    shift
    ;;
  -h | --help)
    usage
    exit 0
    ;;
esac

if [[ "${1:-}" == "--" ]]; then
  shift
fi

require_command() {
  local command_name="$1"
  local install_hint="$2"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Error: required command "%s" was not found.\n' "$command_name" >&2
    printf 'Install %s and try again.\n' "$install_hint" >&2
    exit 1
  fi
}

require_command node "Node.js 22 or newer"
require_command pnpm "pnpm 11"

if [[ "$mode" == "native" ]]; then
  require_command cargo "Rust 1.94 or newer"
fi

cd "$project_dir"

if [[ ! -x node_modules/.bin/vite || ! -x node_modules/.bin/tauri ]]; then
  printf 'Project dependencies are missing; installing them with pnpm...\n'
  pnpm install --frozen-lockfile
fi

if [[ "$mode" == "web" ]]; then
  printf 'Starting Cordflow in browser mode (mock graph)...\n'
  exec pnpm dev "$@"
fi

printf 'Starting Cordflow in native mode (local PipeWire graph)...\n'
exec pnpm tauri dev "$@"
