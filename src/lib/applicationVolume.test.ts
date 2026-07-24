import { describe, expect, it } from 'vitest';
import type { NodeDto, PortDto } from './generated/graph';
import {
  applicationVolumeRetentionMs,
  applicationVolumeStorageKey,
  readApplicationVolumePreferences,
  reconcileApplicationVolumes,
  updateApplicationVolumePreference,
  writeApplicationVolumePreferences,
} from './applicationVolume';

const now = 1_800_000_000_000;
const firefox: NodeDto = {
  id: 11,
  name: 'Firefox audio',
  mediaName: 'Notification',
  applicationId: 'org.mozilla.firefox',
  applicationName: 'Firefox',
  mediaClass: 'Stream/Output/Audio',
  objectName: 'stream.firefox.11',
  kind: 'output',
  volumePercent: 80,
  muted: false,
};
const ports: PortDto[] = [
  {
    id: 111,
    nodeId: 11,
    name: 'output_FL',
    direction: 'output',
    mediaType: 'audio',
  },
];

describe('application volume memory', () => {
  it('groups short-lived streams by stable application id and preserves remembered settings', () => {
    const secondStream = {
      ...firefox,
      id: 12,
      objectName: 'stream.firefox.12',
      volumePercent: 100,
    };
    const result = reconcileApplicationVolumes(
      [
        {
          id: 'org.mozilla.firefox',
          name: 'Old Firefox name',
          volumePercent: 35,
          muted: true,
          lastSeenAt: now - 10_000,
        },
      ],
      [firefox, secondStream],
      [...ports, { ...ports[0], id: 121, nodeId: 12 }],
      now,
    );

    expect(result.applications).toEqual([
      expect.objectContaining({
        id: 'org.mozilla.firefox',
        name: 'Firefox',
        volumePercent: 35,
        muted: true,
        active: true,
        nodeIds: [11, 12],
        lastSeenAt: now,
      }),
    ]);
    expect(result.rememberedNodeIds).toEqual([11, 12]);
  });

  it('keeps an inactive application for seven days and then expires it', () => {
    const preference = {
      id: 'org.mozilla.firefox',
      name: 'Firefox',
      volumePercent: 42,
      muted: false,
      lastSeenAt: now - applicationVolumeRetentionMs + 1,
    };
    expect(reconcileApplicationVolumes([preference], [], [], now).applications).toEqual([
      expect.objectContaining({ active: false, nodeIds: [] }),
    ]);
    expect(
      reconcileApplicationVolumes(
        [{ ...preference, lastSeenAt: now - applicationVolumeRetentionMs }],
        [],
        [],
        now + 1,
      ).applications,
    ).toEqual([]);
  });

  it('stores offline edits so the next application stream can inherit them', () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };
    const remembered = updateApplicationVolumePreference(
      [
        {
          id: 'org.mozilla.firefox',
          name: 'Firefox',
          volumePercent: 100,
          muted: false,
          lastSeenAt: now - 20_000,
        },
      ],
      'org.mozilla.firefox',
      { volumePercent: 25, muted: true },
      now,
    );
    writeApplicationVolumePreferences(adapter, remembered, now);

    expect(storage.has(applicationVolumeStorageKey)).toBe(true);
    expect(readApplicationVolumePreferences(adapter, now)).toEqual([
      expect.objectContaining({ volumePercent: 25, muted: true, lastSeenAt: now }),
    ]);
    expect(
      reconcileApplicationVolumes(remembered, [firefox], ports, now).rememberedNodeIds,
    ).toEqual([11]);
  });

  it('drops malformed storage without breaking startup', () => {
    expect(readApplicationVolumePreferences({ getItem: () => '{"unexpected":true}' }, now)).toEqual(
      [],
    );
    expect(readApplicationVolumePreferences({ getItem: () => '{broken' }, now)).toEqual([]);
  });
});
