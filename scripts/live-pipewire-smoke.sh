#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(dirname -- "$script_dir")"
runtime_dir="$(mktemp -d -t cordflow-pipewire.XXXXXX)"
chmod 700 "$runtime_dir"

export XDG_RUNTIME_DIR="$runtime_dir"
export PIPEWIRE_RUNTIME_DIR="$runtime_dir"
export XDG_CONFIG_HOME="$runtime_dir/config"
export XDG_CACHE_HOME="$runtime_dir/cache"
export XDG_STATE_HOME="$runtime_dir/state"
export PIPEWIRE_DEBUG=0
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"

daemon_pid=""
policy_pid=""
loopback_pid=""
reconnect_test_pid=""

cleanup() {
  set +e
  if [[ -n "$reconnect_test_pid" ]]; then
    kill "$reconnect_test_pid" 2>/dev/null
    wait "$reconnect_test_pid" 2>/dev/null
  fi
  if [[ -n "$loopback_pid" ]]; then
    kill "$loopback_pid" 2>/dev/null
    wait "$loopback_pid" 2>/dev/null
  fi
  if [[ -n "$policy_pid" ]]; then
    kill "$policy_pid" 2>/dev/null
    wait "$policy_pid" 2>/dev/null
  fi
  if [[ -n "$daemon_pid" ]]; then
    kill "$daemon_pid" 2>/dev/null
    wait "$daemon_pid" 2>/dev/null
  fi
  rm -rf -- "$runtime_dir"
}
trap cleanup EXIT INT TERM

wait_for_daemon() {
  local attempt
  for attempt in $(seq 1 100); do
    if pw-cli info 0 >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "$daemon_pid" 2>/dev/null; then
      printf 'Isolated PipeWire daemon exited unexpectedly.\n' >&2
      sed -n '1,240p' "$runtime_dir/pipewire.log" >&2
      return 1
    fi
    sleep 0.05
  done
  printf 'Timed out waiting for the isolated PipeWire daemon.\n' >&2
  return 1
}

start_daemon() {
  pipewire >"$runtime_dir/pipewire.log" 2>&1 &
  daemon_pid=$!
  wait_for_daemon
  wireplumber --profile policy >"$runtime_dir/wireplumber.log" 2>&1 &
  policy_pid=$!
}

wait_for_nodes() {
  local input_name="$1"
  local output_name="$2"
  local attempt
  for attempt in $(seq 1 100); do
    if pw-dump >"$runtime_dir/current-dump.json" 2>/dev/null &&
      grep -Fq "$input_name" "$runtime_dir/current-dump.json" &&
      grep -Fq "$output_name" "$runtime_dir/current-dump.json"; then
      return 0
    fi
    if ! kill -0 "$loopback_pid" 2>/dev/null; then
      printf 'Temporary loopback client exited unexpectedly.\n' >&2
      sed -n '1,240p' "$runtime_dir/loopback.log" >&2
      return 1
    fi
    sleep 0.05
  done
  printf 'Timed out waiting for temporary PipeWire nodes.\n' >&2
  return 1
}

cd "$project_dir"

printf 'Starting an isolated PipeWire daemon in %s\n' "$runtime_dir"
start_daemon

suffix="$$"
input_node="cordflow-smoke-input-$suffix"
output_node="cordflow-smoke-output-$suffix"
loopback_name="cordflow-smoke-loopback-$suffix"

pw-loopback \
  --name "$loopback_name" \
  --channels 1 \
  --channel-map '[ MONO ]' \
  --capture-props "{\"node.name\":\"$input_node\",\"node.description\":\"$input_node\",\"node.autoconnect\":false,\"node.dont-reconnect\":true,\"media.class\":\"Stream/Input/Audio\"}" \
  --playback-props "{\"node.name\":\"$output_node\",\"node.description\":\"$output_node\",\"node.autoconnect\":false,\"node.dont-reconnect\":true,\"media.class\":\"Stream/Output/Audio\"}" \
  >"$runtime_dir/loopback.log" 2>&1 &
loopback_pid=$!
wait_for_nodes "$input_node" "$output_node"

printf 'Testing live create, Registry confirmation, linger across engine reopen, and remove.\n'
CORDFLOW_TEST_OUTPUT_NODE="$output_node" \
  CORDFLOW_TEST_INPUT_NODE="$input_node" \
  cargo test --manifest-path src-tauri/Cargo.toml \
  engine::tests::live_pipewire_create_persist_reopen_remove -- \
  --ignored --exact --nocapture

kill "$loopback_pid"
wait "$loopback_pid" 2>/dev/null || true
loopback_pid=""

marker="$runtime_dir/restart-ready"
reconnect_log="$runtime_dir/reconnect-test.log"
printf 'Testing daemon loss, automatic retry, and a fresh reconnect generation.\n'
CORDFLOW_RESTART_READY="$marker" \
  cargo test --manifest-path src-tauri/Cargo.toml \
  engine::tests::live_pipewire_recovers_after_daemon_restart -- \
  --ignored --exact --nocapture >"$reconnect_log" 2>&1 &
reconnect_test_pid=$!

for attempt in $(seq 1 120); do
  if [[ -f "$marker" ]]; then
    break
  fi
  if ! kill -0 "$reconnect_test_pid" 2>/dev/null; then
    cat "$reconnect_log" >&2
    exit 1
  fi
  sleep 0.05
done
if [[ ! -f "$marker" ]]; then
  printf 'Reconnect test did not become ready.\n' >&2
  cat "$reconnect_log" >&2
  exit 1
fi

kill "$policy_pid"
wait "$policy_pid" 2>/dev/null || true
policy_pid=""
kill "$daemon_pid"
wait "$daemon_pid" 2>/dev/null || true
daemon_pid=""
sleep 1
start_daemon

if ! wait "$reconnect_test_pid"; then
  cat "$reconnect_log" >&2
  exit 1
fi
reconnect_test_pid=""
cat "$reconnect_log"

printf 'Isolated live PipeWire smoke test passed without touching the desktop daemon.\n'
