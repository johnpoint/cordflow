import { describe, expect, it, vi } from 'vitest';
import {
  advancedModeStorageKey,
  hideInactiveNodesStorageKey,
  migrateWorkspacePreference,
  mixerVolumeViewStorageKey,
  outputSpectrumEnabledStorageKey,
  readAdvancedModePreference,
  readHideInactiveNodesPreference,
  readMixerVolumeViewPreference,
  readOutputSpectrumPreference,
  workspaceRoutingPolicy,
  workspaceStorageKey,
} from './workspace';

function storageWith(values: Record<string, string>) {
  const store = new Map(Object.entries(values));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
  };
}

describe('workspace preferences', () => {
  it('keeps the new stable workspace preference', () => {
    const storage = storageWith({ [workspaceStorageKey]: 'mixer' });
    expect(migrateWorkspacePreference(storage)).toBe('mixer');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('maps legacy custom mode and topology to the advanced patchbay', () => {
    const custom = storageWith({ 'helvum-next.custom-mode': 'true' });
    const topology = storageWith({ 'helvum-next.workspace-view': 'topology' });
    expect(migrateWorkspacePreference(custom)).toBe('patchbay');
    expect(migrateWorkspacePreference(topology)).toBe('patchbay');
  });

  it('migrates the previous stable workspace key to the Cordflow namespace', () => {
    const storage = storageWith({ 'helvum-next.workspace': 'flows' });
    expect(migrateWorkspacePreference(storage)).toBe('flows');
    expect(storage.setItem).toHaveBeenCalledWith(workspaceStorageKey, 'flows');
  });

  it('maps legacy pages and defaults new users to the output mixer', () => {
    expect(
      migrateWorkspacePreference(storageWith({ 'helvum-next.workspace-view': 'volumes' })),
    ).toBe('mixer');
    expect(migrateWorkspacePreference(storageWith({ 'helvum-next.workspace-view': 'flows' }))).toBe(
      'flows',
    );
    expect(migrateWorkspacePreference(storageWith({}))).toBe('mixer');
  });

  it('keeps advanced mode off by default and honors an explicit preference', () => {
    expect(readAdvancedModePreference(storageWith({}))).toBe(false);
    expect(readAdvancedModePreference(storageWith({ [advancedModeStorageKey]: 'false' }))).toBe(
      false,
    );
    expect(readAdvancedModePreference(storageWith({ [advancedModeStorageKey]: 'true' }))).toBe(
      true,
    );
  });

  it('keeps inactive patchbay nodes visible by default and honors the saved filter', () => {
    expect(readHideInactiveNodesPreference(storageWith({}))).toBe(false);
    expect(
      readHideInactiveNodesPreference(storageWith({ [hideInactiveNodesStorageKey]: 'true' })),
    ).toBe(true);
  });

  it('keeps the mixer volume subview preference with the existing storage key', () => {
    expect(readMixerVolumeViewPreference(storageWith({}))).toBe('devices');
    expect(
      readMixerVolumeViewPreference(storageWith({ [mixerVolumeViewStorageKey]: 'applications' })),
    ).toBe('applications');
    expect(
      readMixerVolumeViewPreference(storageWith({ [mixerVolumeViewStorageKey]: 'unknown' })),
    ).toBe('devices');
  });

  it('keeps the output spectrum background enabled unless explicitly disabled', () => {
    expect(readOutputSpectrumPreference(storageWith({}))).toBe(true);
    expect(
      readOutputSpectrumPreference(storageWith({ [outputSpectrumEnabledStorageKey]: 'false' })),
    ).toBe(false);
    expect(
      readOutputSpectrumPreference(storageWith({ [outputSpectrumEnabledStorageKey]: 'true' })),
    ).toBe(true);
  });

  it('keeps an existing advanced workspace available during migration', () => {
    expect(readAdvancedModePreference(storageWith({ [workspaceStorageKey]: 'patchbay' }))).toBe(
      true,
    );
    expect(
      readAdvancedModePreference(storageWith({ 'helvum-next.workspace-view': 'topology' })),
    ).toBe(true);
  });

  it('binds routing policy to the workspace', () => {
    expect(workspaceRoutingPolicy('flows')).toBe('stereo-auto');
    expect(workspaceRoutingPolicy('patchbay')).toBe('manual-port');
    expect(workspaceRoutingPolicy('mixer')).toBeNull();
  });
});
