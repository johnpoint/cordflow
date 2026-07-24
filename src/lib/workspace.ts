export type WorkspaceId = 'flows' | 'mixer' | 'patchbay';
export type RoutingPolicy = 'stereo-auto' | 'manual-port';

export const workspaceStorageKey = 'cordflow.workspace';
export const legacyStableWorkspaceStorageKey = 'helvum-next.workspace';
export const legacyWorkspaceStorageKey = 'helvum-next.workspace-view';
export const advancedModeStorageKey = 'cordflow.advanced-mode';
export const legacyAdvancedModeStorageKey = 'helvum-next.custom-mode';

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
