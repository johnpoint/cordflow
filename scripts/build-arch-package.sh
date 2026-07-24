#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(dirname -- "$script_dir")"
manifest_path="$project_dir/src-tauri/Cargo.toml"
packaging_dir="$project_dir/packaging/aur"
output_dir="$project_dir/src-tauri/target/release/bundle/arch"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/cordflow-arch-package.XXXXXX")"

cleanup() {
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

for command_name in cargo makepkg pnpm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Error: required command "%s" was not found.\n' "$command_name" >&2
    exit 1
  fi
done

cd "$project_dir"
pnpm build
cargo build \
  --frozen \
  --release \
  --features custom-protocol \
  --manifest-path "$manifest_path"

package_version="$(
  sed -n 's/^version = "\([^"]*\)"/\1/p' "$manifest_path" |
    head -n 1
)"
if [[ -z "$package_version" ]]; then
  printf 'Error: could not read the Cordflow version from %s.\n' "$manifest_path" >&2
  exit 1
fi

install -Dm644 "$packaging_dir/PKGBUILD.local" "$work_dir/PKGBUILD"
sed -i "s/^pkgver=.*/pkgver=$package_version/" "$work_dir/PKGBUILD"
install -Dm755 "$project_dir/src-tauri/target/release/cordflow" "$work_dir/cordflow"
install -Dm644 "$packaging_dir/cordflow.desktop" "$work_dir/cordflow.desktop"
install -Dm644 "$project_dir/src-tauri/icons/icon.png" "$work_dir/icon.png"
install -Dm644 \
  "$packaging_dir/io.github.johnpoint.Cordflow.metainfo.xml" \
  "$work_dir/io.github.johnpoint.Cordflow.metainfo.xml"
install -Dm644 "$project_dir/LICENSE" "$work_dir/LICENSE"
install -d "$output_dir"

(
  cd "$work_dir"
  PKGDEST="$output_dir" makepkg --clean --force
)

package_path="$(
  find "$output_dir" \
    -maxdepth 1 \
    -type f \
    -name "cordflow-${package_version}-*.pkg.tar.zst" \
    -print |
    sort |
    tail -n 1
)"
if [[ -z "$package_path" ]]; then
  printf 'Error: makepkg completed without producing the expected package.\n' >&2
  exit 1
fi

printf 'Arch package created: %s\n' "$package_path"
