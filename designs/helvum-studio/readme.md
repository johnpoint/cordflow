# Cordflow Studio Design System

Cordflow Studio is a desktop product adaptation of the OpenCode design system imported into `DESIGN.md` with `getdesign`. It applies OpenCode's mono typography, warm cream canvas, ink-first hierarchy, flat hairline structure, ASCII markers, and 0/4px geometry to Cordflow's accessible PipeWire workflows.

## Product context and sources

The system was authored from the production Svelte code in `src/App.svelte`, `src/app.css`, and `src/lib/components/`, plus the behavior contracts in `src/**/*.test.ts` and `e2e/graph.spec.ts`. PipeWire DTOs and routing algorithms remain the source of truth for product behavior.

## Content fundamentals

- Prefer concrete verbs: “Add output”, “Disconnect route”, “Set as default”.
- Explain consequences before expert terminology. Keep “PipeWire”, node IDs, port IDs, and channel names available where they help diagnosis.
- Use sentence case in English and compact, direct labels in Simplified Chinese.
- Do not use emoji as interface icons. Icons always have visible text or an accessible name.
- Persistent failures describe the failed action and remain until dismissed. Background progress and success are short and announced through `aria-live`.

## Visual foundations

Cordflow Studio uses OpenCode's warm cream `#fdfcfc` canvas, near-black `#201d1d` ink, one-pixel warm hairlines, no shadows or gradients, and an all-monospace type stack. Berkeley Mono remains the preferred face; JetBrains Mono, IBM Plex Mono, system monospace faces, and CJK monospace fonts are explicit fallbacks. Audio, video, and MIDI each retain a product signal color, but color is never the only encoding. The ambient stereo spectrum uses the same `#0056b3` deep blue for both channels and distinguishes them by half-width position: the current frame is 0.18 opacity, with a persistent 2px peak-envelope contour above it at 0.38 opacity. The contour is computed only from the current spectrum; each band carries 30% of its visual rise above the current band as upward momentum, then begins releasing on the next falling sample with no peak hold. Release follows a nonlinear 1.5-power ease-in over 700ms, starting slowly at the peak and accelerating toward the current band for a longer inertial travel. It never drops below the current band, stores no historical spectrum frames, and has no opacity fade animation. Reduced-motion mode hides the contour. Body copy starts at 13px, support copy at 11px, controls at 32px, primary actions at 36px, and port targets at 34px.

Containers and navigation are square. Interactive controls use the single OpenCode 4px radius; circular shapes are reserved for status dots and port sockets whose function depends on them. Switches use square tracks with rectangular thumbs, while sliders use straight tracks with compact rectangular faders. Hover uses the `#f1eeee` surface, focus is a three-pixel Apple Blue outline, and primary actions use ink on cream. Motion stays between 120–160ms and collapses to zero under `prefers-reduced-motion`.

Scrollable regions use a 10px square track with a compact four-pixel ink-gray thumb, one-pixel hairline structure, no end buttons, and no rounded corners. The thumb darkens on hover while the canvas-colored track stays visually subordinate.

Layouts use a single-line top bar, a compact horizontal workspace switcher, and modular work areas. Output mixer and Audio routing remain one click away; Advanced patchbay appears when advanced mode is enabled. Only topology canvases and long route lists intentionally scroll.

## Iconography

Use compact ASCII markers such as `[+]`, `[x]`, `[=]`, and `[..]` only where they add information. Keep visible text or accessible names for every action. Media sockets and functional switch/thumb geometry may remain graphical because their shape communicates state.

## Components

- Button and IconButton — ordinary, primary, ghost, and destructive actions.
- DeviceSelector and StatusBadge — compact global device and backend state.
- WorkspaceNav and ModeSwitch — Output mixer first, Audio routing second, and a default-off expert control that reveals Advanced patchbay.
- Dialog and Notice — modal focus boundaries and persistent/temporary feedback.
- RouteLane — a source-centered, scan-friendly audio route.
- VolumeControl — device identity, live dBFS fill merged into the volume rail, numeric volume, scale, mute, and gain warning.
- NodeCard and PortSocket — readable patchbay topology targets.
- ConnectionRow and Drawer — selected-link summary, detailed routes, and local disconnection.

## Component behavior contracts

Controls expose `disabled` and selected states explicitly. Dialogs trap focus, close on Escape, block the background, and return focus to the trigger. Workspace selection uses `aria-current="page"`. Port sockets expose media type in their accessible name. Drawers preserve collapsed/expanded preference. Destructive controls live beside the selected route or link instead of in global chrome.

## Index

- `tokens/` — semantic color, type, spacing, radius, shadow, target, and motion tokens.
- `components/` — reusable React specimens compiled into `_ds_bundle.js`.
- `guidelines/` — foundation cards.
- `ui_kits/helvum/` — a Studio Console starting point.
- `preview.html` — generated single-file review surface.
