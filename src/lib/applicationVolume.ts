import type { NodeDto, PortDto } from './generated/graph';

export const applicationVolumeStorageKey = 'cordflow.application-volumes';
export const applicationVolumeRetentionMs = 7 * 24 * 60 * 60 * 1_000;

export interface ApplicationVolumePreference {
  id: string;
  name: string;
  volumePercent: number;
  muted: boolean;
  lastSeenAt: number;
}

export interface ApplicationVolumeItem extends ApplicationVolumePreference {
  nodeIds: number[];
  active: boolean;
}

export interface ApplicationVolumeReconciliation {
  preferences: ApplicationVolumePreference[];
  applications: ApplicationVolumeItem[];
  rememberedNodeIds: number[];
}

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizedVolume(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(150, Math.max(0, Math.round(value)));
}

export function isApplicationAudioNode(node: NodeDto): boolean {
  return (
    node.mediaClass === 'Stream/Output/Audio' ||
    node.mediaClass?.startsWith('Stream/Output/Audio/') === true
  );
}

export function applicationIdentity(
  node: NodeDto,
): Pick<ApplicationVolumePreference, 'id' | 'name'> | null {
  if (!isApplicationAudioNode(node)) return null;
  const id =
    nonEmpty(node.applicationId) ??
    nonEmpty(node.objectName) ??
    nonEmpty(node.applicationName) ??
    nonEmpty(node.name);
  if (!id) return null;
  const name =
    nonEmpty(node.applicationName) ??
    nonEmpty(node.mediaName) ??
    nonEmpty(node.name) ??
    nonEmpty(node.objectName) ??
    id;
  return { id, name };
}

export function pruneApplicationVolumePreferences(
  preferences: ApplicationVolumePreference[],
  now = Date.now(),
): ApplicationVolumePreference[] {
  const cutoff = now - applicationVolumeRetentionMs;
  const unique = new Map<string, ApplicationVolumePreference>();
  for (const preference of preferences) {
    const id = nonEmpty(preference.id);
    const name = nonEmpty(preference.name);
    const volumePercent = normalizedVolume(preference.volumePercent);
    if (
      !id ||
      !name ||
      volumePercent === null ||
      typeof preference.muted !== 'boolean' ||
      !Number.isFinite(preference.lastSeenAt) ||
      preference.lastSeenAt < cutoff ||
      preference.lastSeenAt > now + 60_000
    ) {
      continue;
    }
    const normalized = {
      id,
      name,
      volumePercent,
      muted: preference.muted,
      lastSeenAt: preference.lastSeenAt,
    };
    const previous = unique.get(id);
    if (!previous || normalized.lastSeenAt >= previous.lastSeenAt) unique.set(id, normalized);
  }
  return [...unique.values()];
}

export function readApplicationVolumePreferences(
  storage: Pick<Storage, 'getItem'>,
  now = Date.now(),
): ApplicationVolumePreference[] {
  const serialized = storage.getItem(applicationVolumeStorageKey);
  if (!serialized) return [];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return [];
    return pruneApplicationVolumePreferences(
      value.filter(
        (entry): entry is ApplicationVolumePreference =>
          typeof entry === 'object' && entry !== null,
      ) as ApplicationVolumePreference[],
      now,
    );
  } catch {
    return [];
  }
}

export function writeApplicationVolumePreferences(
  storage: Pick<Storage, 'setItem'>,
  preferences: ApplicationVolumePreference[],
  now = Date.now(),
): ApplicationVolumePreference[] {
  const retained = pruneApplicationVolumePreferences(preferences, now);
  storage.setItem(applicationVolumeStorageKey, JSON.stringify(retained));
  return retained;
}

export function reconcileApplicationVolumes(
  preferences: ApplicationVolumePreference[],
  nodes: NodeDto[],
  ports: PortDto[],
  now = Date.now(),
): ApplicationVolumeReconciliation {
  const retained = pruneApplicationVolumePreferences(preferences, now);
  const rememberedIds = new Set(retained.map((preference) => preference.id));
  const nextPreferences = new Map(retained.map((preference) => [preference.id, { ...preference }]));
  const activeNodes = new Map<string, NodeDto[]>();

  for (const node of nodes) {
    const identity = applicationIdentity(node);
    if (
      !identity ||
      !ports.some(
        (port) =>
          port.nodeId === node.id && port.direction === 'output' && port.mediaType === 'audio',
      )
    ) {
      continue;
    }
    const groupedNodes = activeNodes.get(identity.id) ?? [];
    groupedNodes.push(node);
    activeNodes.set(identity.id, groupedNodes);

    const existing = nextPreferences.get(identity.id);
    nextPreferences.set(identity.id, {
      id: identity.id,
      name: identity.name,
      volumePercent: existing?.volumePercent ?? normalizedVolume(node.volumePercent) ?? 100,
      muted: existing?.muted ?? node.muted ?? false,
      lastSeenAt: now,
    });
  }

  const next = [...nextPreferences.values()];
  // Preserve the preference insertion order so volume edits and short-lived
  // stream activity cannot move a control while the user is interacting with it.
  const applications = next.map((preference): ApplicationVolumeItem => {
    const groupedNodes = activeNodes.get(preference.id) ?? [];
    return {
      ...preference,
      nodeIds: groupedNodes.map((node) => node.id),
      active: groupedNodes.length > 0,
    };
  });
  const rememberedNodeIds = [...activeNodes.entries()]
    .filter(([id]) => rememberedIds.has(id))
    .flatMap(([, groupedNodes]) => groupedNodes.map((node) => node.id));

  return {
    preferences: next,
    applications,
    rememberedNodeIds,
  };
}

export function updateApplicationVolumePreference(
  preferences: ApplicationVolumePreference[],
  applicationId: string,
  update: { volumePercent?: number; muted?: boolean },
  now = Date.now(),
): ApplicationVolumePreference[] {
  return preferences.map((preference) => {
    if (preference.id !== applicationId) return preference;
    return {
      ...preference,
      volumePercent:
        update.volumePercent === undefined
          ? preference.volumePercent
          : (normalizedVolume(update.volumePercent) ?? preference.volumePercent),
      muted: update.muted ?? preference.muted,
      lastSeenAt: now,
    };
  });
}
