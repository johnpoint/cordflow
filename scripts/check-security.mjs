import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const expectedCommands = [
  'subscribe_graph',
  'subscribe_output_levels',
  'set_output_metering',
  'get_graph_snapshot',
  'create_link',
  'remove_link',
  'set_default_audio_sink',
  'set_default_audio_source',
  'set_output_volume',
];
const expectedPermissions = expectedCommands.map(
  (command) => `allow-${command.replaceAll('_', '-')}`,
);
const expectedCapabilityPermissions = [
  'default',
  'core:window:allow-minimize',
  'core:window:allow-toggle-maximize',
  'core:window:allow-close',
  'core:window:allow-start-dragging',
];

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [tauriConfigText, capabilityText, permissionText, buildText, packageText, cargoText] =
  await Promise.all([
    read('src-tauri/tauri.conf.json'),
    read('src-tauri/capabilities/main.json'),
    read('src-tauri/permissions/default.toml'),
    read('src-tauri/build.rs'),
    read('package.json'),
    read('src-tauri/Cargo.toml'),
  ]);

const tauriConfig = JSON.parse(tauriConfigText);
const capability = JSON.parse(capabilityText);
const packageJson = JSON.parse(packageText);
assert.equal(tauriConfig.identifier, 'io.github.johnpoint.Cordflow');
assert.deepEqual(tauriConfig.app.security.capabilities, ['main']);
assert.deepEqual(capability.windows, ['main']);
assert.deepEqual(capability.permissions, expectedCapabilityPermissions);

const defaultPermissions = [...permissionText.matchAll(/"([a-z][a-z0-9-]+)"/g)].map(
  (match) => match[1],
);
assert.deepEqual(defaultPermissions, expectedPermissions);

const declaredCommands = [...buildText.matchAll(/"([a-z][a-z0-9_]+)"/g)]
  .map((match) => match[1])
  .filter((value) => value !== 'failed');
assert.deepEqual(declaredCommands, expectedCommands);

const tauriPlugins = Object.keys({
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
}).filter((name) => name.startsWith('@tauri-apps/plugin-'));
assert.deepEqual(tauriPlugins, []);
assert.match(cargoText, /tauri = \{ version = "2\.11\.5", features = \["tray-icon"\] \}/);
assert.match(cargoText, /custom-protocol = \["tauri\/custom-protocol"\]/);

console.log(
  'Tauri capability exposes exactly the nine approved audio and frameless-window commands, while the native tray adds no webview permission.',
);
