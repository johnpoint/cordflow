# Cordflow

Cordflow is an accessible PipeWire audio router and output mixer focused on readable source-centred audio flows, a dynamic port-topology view, and complete mouse and keyboard paths for managing PipeWire links. It is an **unofficial derivative** of [Helvum](https://gitlab.freedesktop.org/pipewire/helvum); Cordflow is its own product name and is not affiliated with the upstream project.

The MVP uses Tauri 2, Svelte 5, TypeScript, Rust, and `pipewire-rs`. It displays nodes and ports, creates persistent links with `object.linger=1`, removes links by registry ID, survives PipeWire reconnects, and exposes readable output, routing, and connection controls. English is the default language and Simplified Chinese is included.

Cordflow opens on **Output mixer**, followed by **Audio routing** and the optional
**Advanced patchbay**. Advanced mode is off by default and only controls whether the manual
per-port patchbay is available; it does not hide or change the ordinary workspaces. Default
input and playback devices remain visible in the bottom bar and can be changed through the
explicit Edit action.

Output mixer presents one row per output device with volume, mute, default-device actions,
gain warnings, and live output level feedback. A device/application tab switches to
per-application volume controls; recently observed applications remain available for seven
days so short notification streams can still be adjusted after playback stops. The current
default output also drives a real-time 32-band stereo spectrum with independently sampled left
and right channels.

Audio routing matches stereo channels automatically. PipeWire's `audio.channel` metadata is
preferred, with common FL/FR and left/right port names as a fallback. Paired links are
presented as one stereo route and disconnect together from every ordinary routing entry point.
When a processed source feeds multiple devices, the processing chain remains shared and each
device is added as another downstream branch.

The guided creation workflow collects a complete route before changing PipeWire: choose an
audio source, optionally add processors in signal order, select one or more output devices,
then create the flow. Existing hops are reused and only missing stereo-aligned links are
submitted. Advanced patchbay keeps drag, click, and complete keyboard paths for manual
single-port routing without changing the automatic stereo policy used elsewhere.

The native backend writes WirePlumber's configured default sink or source metadata and waits
for the active default metadata update before the UI reports success. Default-device changes
apply to newly auto-routed streams; they do not rewrite explicit links already shown in the
graph.

> This project is not affiliated with or endorsed by the PipeWire or Helvum maintainers.

## Status

This repository contains the source-development MVP. Packaging, presets, search, free-form
layout, undo history, and general background route policies are intentionally out of scope.

## Development

System requirements on Linux:

- Rust 1.94 or newer
- Node.js 22 or newer and pnpm 11
- PipeWire development headers
- PipeWire command-line tools and WirePlumber for the isolated live smoke test
- WebKitGTK 4.1 and the standard Tauri 2 Linux prerequisites

On Arch Linux, the relevant packages are provided by `base-devel`, `pipewire`,
`wireplumber`, `webkit2gtk-4.1`, `gtk3`, `libayatana-appindicator`, and `librsvg`.

```sh
pnpm install
./scripts/start.sh
```

The startup script launches the native application against the local PipeWire daemon by
default. It installs JavaScript dependencies from the lockfile when they are missing.
The same command is also available as `pnpm start`.

To start the browser development server with its deterministic mock graph:

```sh
./scripts/start.sh --web
```

On Linux, Cordflow disables WebKitGTK's DMA-BUF renderer before startup. This avoids
empty gray windows on affected GBM/Wayland drivers while retaining native Wayland DPI
scaling. Set `WEBKIT_DISABLE_DMABUF_RENDERER=0` explicitly to override the compatibility
default when testing a driver update.

On a scaled Wayland desktop, start the binary without `GDK_BACKEND=x11`. Forcing X11
routes the window through XWayland and can bypass the compositor's DPI scale; the DMA-BUF
fallback above already handles the gray-window issue while keeping native Wayland scaling.

## Verification

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm security:check
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm test:pipewire-live
pnpm build:tauri
```

`pnpm test:pipewire-live` starts its own PipeWire daemon under a temporary runtime
directory. It creates only temporary one-channel nodes, verifies create/confirm,
`object.linger=1` across an engine reopen, removal, daemon-loss retry, and reconnect
generation behavior, then removes the entire temporary runtime. It never connects to
or changes the desktop PipeWire daemon.

The committed TypeScript IPC contract is generated from Rust `ts-rs` declarations with
`pnpm types:generate` and checked for drift by `pnpm types:check`.

## License and provenance

Cordflow is licensed under `GPL-3.0-only`. The PipeWire integration is derived from Helvum 0.6.2 at commit `e124603c1d15a8d6b51803068c01fcbb0f5d383a`; original notices are retained in adapted files. See [DERIVATION.md](DERIVATION.md) for exact provenance and modification notes.
