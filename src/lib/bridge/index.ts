import {
  crowdedChooserSnapshot,
  deepTopologySnapshot,
  demoSnapshot,
  MockGraphBridge,
  stressSnapshot,
} from './mock';
import { TauriGraphBridge } from './tauri';
import type { GraphBridge } from './types';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function createGraphBridge(): GraphBridge {
  if (window.__TAURI_INTERNALS__) return new TauriGraphBridge();
  const parameters = new URLSearchParams(window.location.search);
  const scenario = parameters.get('scenario') ?? (parameters.has('stress') ? 'stress' : 'demo');
  const snapshot =
    scenario === 'stress'
      ? stressSnapshot()
      : scenario === 'crowded-chooser'
        ? crowdedChooserSnapshot()
        : scenario === 'deep'
          ? deepTopologySnapshot()
          : demoSnapshot();
  const reconnecting = scenario === 'reconnect';
  if (reconnecting) {
    snapshot.status = { state: 'disconnected', detail: 'Mock PipeWire connection lost' };
  }
  return new MockGraphBridge({
    confirmationDelay: scenario === 'timeout' ? null : undefined,
    reconnectDelay: reconnecting ? 300 : undefined,
    snapshot,
    storage: window.sessionStorage,
    storageKey: `cordflow.mock.${scenario}`,
  });
}

export type { GraphBridge, Unsubscribe } from './types';
