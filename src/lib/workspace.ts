export type WorkspaceId = 'flows' | 'mixer' | 'patchbay';
export type RoutingPolicy = 'stereo-auto' | 'manual-port';
export type MixerVolumeView = 'devices' | 'applications';

export const workspaceStorageKey = 'cordflow.workspace';
export const legacyStableWorkspaceStorageKey = 'helvum-next.workspace';
export const legacyWorkspaceStorageKey = 'helvum-next.workspace-view';
export const advancedModeStorageKey = 'cordflow.advanced-mode';
export const legacyAdvancedModeStorageKey = 'helvum-next.custom-mode';
export const hideInactiveNodesStorageKey = 'cordflow.patchbay-hide-inactive-nodes';
export const mixerVolumeViewStorageKey = 'cordflow.mixer-volume-view';
export const outputSpectrumEnabledStorageKey = 'cordflow.output-spectrum-enabled';

export function workspaceRoutingPolicy(workspace: WorkspaceId): RoutingPolicy | null {
  if (workspace === 'flows') return 'stereo-auto';
  if (workspace === 'patchbay') return 'manual-port';
  return null;
}

export function readAdvancedModePreference(storage: Pick<Storage, 'getItem'>): boolean {
  const explicit = storage.getItem(advancedModeStorageKey);
  if (explicit !== null) return explicit === 'true';
  const legacyExplicit = storage.getItem(legacyAdvancedModeStorageKey);
  if (legacyExplicit !== null) return legacyExplicit === 'true';

  return (
    storage.getItem(workspaceStorageKey) === 'patchbay' ||
    storage.getItem(legacyStableWorkspaceStorageKey) === 'patchbay' ||
    storage.getItem(legacyWorkspaceStorageKey) === 'topology'
  );
}

export function readHideInactiveNodesPreference(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(hideInactiveNodesStorageKey) === 'true';
}

export function readMixerVolumeViewPreference(storage: Pick<Storage, 'getItem'>): MixerVolumeView {
  return storage.getItem(mixerVolumeViewStorageKey) === 'applications' ? 'applications' : 'devices';
}

export function readOutputSpectrumPreference(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(outputSpectrumEnabledStorageKey) !== 'false';
}

export function migrateWorkspacePreference(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): WorkspaceId {
  const current = storage.getItem(workspaceStorageKey);
  if (current === 'flows' || current === 'mixer' || current === 'patchbay') return current;

  const legacyStable = storage.getItem(legacyStableWorkspaceStorageKey);
  const legacyView = storage.getItem(legacyWorkspaceStorageKey);
  const legacyCustomMode = storage.getItem(legacyAdvancedModeStorageKey) === 'true';
  const migrated: WorkspaceId =
    legacyStable === 'flows' || legacyStable === 'mixer' || legacyStable === 'patchbay'
      ? legacyStable
      : legacyCustomMode || legacyView === 'topology'
        ? 'patchbay'
        : legacyView === 'volumes'
          ? 'mixer'
          : legacyView === 'flows'
            ? 'flows'
            : 'mixer';
  storage.setItem(workspaceStorageKey, migrated);
  return migrated;
}
