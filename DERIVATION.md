# Helvum derivation notice

Cordflow (previously developed as Helvum Next) is an unofficial modified work based in part on Helvum 0.6.2.

- Upstream project: <https://gitlab.freedesktop.org/pipewire/helvum>
- Upstream release: `0.6.2`
- Upstream commit: `e124603c1d15a8d6b51803068c01fcbb0f5d383a`
- Upstream license: `GPL-3.0-only`
- Original PipeWire implementation copyright: 2021 Tom A. Wagner

The files under `src-tauri/src/engine/pipewire/` adapt the upstream `src/pipewire_connection/mod.rs` and `src/pipewire_connection/state.rs`:

- `mod.rs` contains the connection and retry lifecycle.
- `adapter.rs` contains PipeWire command adaptation and volume POD serialization.
- `registry.rs` contains registry state, proxy listeners, DTO conversion, and removal cleanup.
- `metering.rs` contains output meter streams, stereo sampling, and spectrum analysis.

Each derived file retains the original copyright and license header and carries a prominent modification notice dated 2026.

`src-tauri/icons/icon.svg` is an exact copy of upstream `data/icons/org.pipewire.Helvum.svg`; `icon.png` is a mechanical raster conversion of that GPL-covered source asset.

The adaptation removes GTK and GLib UI dependencies, replaces GTK messages with typed graph envelopes and operation acknowledgements, validates operations against a testable domain state, supports ordered Tauri Channel subscribers, and keeps reconnect generations separate. Link creation continues to use PipeWire's `link-factory` and `object.linger=1`; removal continues to use registry `destroy_global`.

All other project files are new work unless their headers state otherwise.
