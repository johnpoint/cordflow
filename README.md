# Cordflow

Cordflow is a Linux desktop application for managing PipeWire audio. It combines an
output mixer, guided stereo routing, and an optional port-level patchbay in one
keyboard-accessible interface.

The interface is available in English and Simplified Chinese.

> [!IMPORTANT]
> Cordflow is currently a source-development MVP. This repository does not yet publish
> installers or distribution packages, so the application must be run or built from source.
> Native mode connects to—and can change—the active PipeWire graph.

Cordflow is an **unofficial derivative** of
[Helvum](https://gitlab.freedesktop.org/pipewire/helvum). It is not affiliated with or
endorsed by the Helvum or PipeWire maintainers.

## What you can do

| Workspace             | Use it to                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Output mixer**      | Adjust device and application volume, mute outputs, choose the default output, and monitor live levels and a stereo spectrum.                                            |
| **Audio routing**     | View source-centred signal flows and create routes from a source, through optional processors, to one or more output devices. Stereo channels are matched automatically. |
| **Advanced patchbay** | Inspect the full PipeWire port topology and create individual port connections with a mouse or keyboard. Enable it with **Advanced mode** in the bottom bar.             |

Cordflow also lets you change the system's default playback and input devices from the
bottom bar. Application volume settings are remembered for seven days, including for
short-lived streams such as notification sounds.

## Run from source

Cordflow currently supports Linux with PipeWire and WirePlumber.

### Requirements

- Rust 1.94 or newer
- Node.js 22 or newer
- pnpm 11
- PipeWire development headers
- WebKitGTK 4.1 and the standard
  [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/)
- A running PipeWire and WirePlumber session for native mode

On Arch Linux, the required system libraries are provided by `base-devel`, `pipewire`,
`wireplumber`, `webkit2gtk-4.1`, `gtk3`, `libayatana-appindicator`, and `librsvg`.

### Start the native application

```sh
git clone https://github.com/johnpoint/cordflow.git
cd cordflow
pnpm install --frozen-lockfile
./scripts/start.sh
```

The startup script connects Cordflow to your current PipeWire session. It also installs
the locked JavaScript dependencies automatically if they are missing. The same startup
command is available as `pnpm start`.

To build an unbundled release binary instead:

```sh
pnpm build:tauri
./src-tauri/target/release/cordflow
```

### Preview the interface without changing system audio

```sh
./scripts/start.sh --web
```

Browser mode uses a deterministic mock audio graph. It is useful for exploring the
interface or working on the frontend, but its controls do not affect PipeWire.

## First steps

1. Open **Output mixer** to adjust output-device volume and mute state. Use the
   **Application volume** tab for per-application controls.
2. Open **Audio routing** and choose **Create audio flow** to connect a source to one or
   more outputs. Processing nodes can be inserted in signal order.
3. Use **Edit** in the bottom bar to change the default input or playback device.
4. Open **Settings** to switch between English and Simplified Chinese. Use the
   **Advanced mode** switch in the bottom bar to make the advanced patchbay available.

In the advanced patchbay, drag between compatible ports or select a starting port and a
highlighted target. With the keyboard, use <kbd>Tab</kbd> to move between compatible
targets, <kbd>Enter</kbd> to connect, and <kbd>Esc</kbd> to cancel.

## Behavior worth knowing

- Routes created in the regular workspaces use PipeWire channel metadata to match stereo
  pairs. Common FL/FR and left/right port names are used as a fallback.
- A stereo route is shown as one route and both channels are disconnected together from
  regular routing controls. The advanced patchbay works with individual ports.
- When one processed source feeds multiple devices, Cordflow reuses the processing chain
  and adds each device as a downstream branch.
- Created links use `object.linger=1`, so they can remain after Cordflow closes. Remove a
  route in Cordflow when you no longer want it.
- Changing the default input or playback device affects newly auto-routed streams. It does
  not rewrite explicit links that already exist in the graph.
- Cordflow resynchronizes after PipeWire reconnects. While the backend is unavailable,
  graph-changing controls remain unavailable.
- Output volume can be raised above 100%; Cordflow warns because software gain may clip or
  distort the signal.

## Current scope

This MVP focuses on inspecting the live graph, controlling output volume and defaults,
and creating or removing routes. Debian packages are built by CI after every successful
push or manual workflow run. Presets, free-form graph layout, undo history, and general
background routing policies are not yet included.

## Troubleshooting

### The native window is empty or gray

The startup script disables WebKitGTK's DMA-BUF renderer by default to avoid empty windows
on affected GBM/Wayland drivers. To test your current driver without this compatibility
setting, run:

```sh
WEBKIT_DISABLE_DMABUF_RENDERER=0 ./scripts/start.sh
```

### The interface is incorrectly scaled on Wayland

Do not launch Cordflow with `GDK_BACKEND=x11`. Forcing X11 sends the window through
XWayland and can bypass the compositor's DPI scale. The startup script's DMA-BUF workaround
keeps native Wayland scaling enabled.

### Browser mode does not show my devices

This is expected. `--web` always uses mock data; start the native application to connect to
the local PipeWire graph.

## Development and verification

The application uses Tauri 2, Svelte 5, TypeScript, Rust, and `pipewire-rs`.

Run the main frontend and Rust checks with:

```sh
pnpm security:check
pnpm check
pnpm lint
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Additional end-to-end and integration checks are available:

```sh
pnpm test:e2e
pnpm test:pipewire-live
pnpm build:tauri
pnpm build:deb
```

`pnpm test:pipewire-live` creates an isolated temporary PipeWire daemon and temporary
one-channel nodes. It verifies link creation, persistence, removal, retry, and reconnect
behavior without connecting to or changing the desktop PipeWire daemon.

The committed TypeScript IPC contract is generated from Rust `ts-rs` declarations:

```sh
pnpm types:generate
pnpm types:check
```

`pnpm build:deb` writes the Debian package to
`src-tauri/target/release/bundle/deb/`. Successful push and manually triggered CI runs
upload the package as a `cordflow-deb-amd64-<commit>` workflow artifact retained for 30
days.

## License and provenance

Cordflow is licensed under [`GPL-3.0-only`](LICENSE). Its PipeWire integration is derived
from Helvum 0.6.2 at commit `e124603c1d15a8d6b51803068c01fcbb0f5d383a`;
original notices are retained in adapted files. See [DERIVATION.md](DERIVATION.md) for
exact provenance and modification notes.
