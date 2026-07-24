import type { GraphEnvelope, NodeDto, OperationFailure, OutputLevel } from '../generated/graph';
import type { PendingLink } from '../graph/connection';
import { pendingHasExpired } from '../graph/connection';
import { emptyGraphState, reduceEnvelope, type GraphViewState } from '../graph/reducer';
import type { ApplicationVolumeItem, ApplicationVolumePreference } from '../applicationVolume';

export interface PendingRemoval {
  operationId: string;
  linkId: number;
  createdAt: number;
}

export interface PendingDefaultDevice {
  operationId: string;
  nodeId: number;
  nodeName: string;
  createdAt: number;
}

export interface PendingOutputVolume {
  operationId: string;
  nodeId: number;
  volumePercent: number | null;
  muted: boolean | null;
  createdAt: number;
  silent: boolean;
}

export type OutputSpectrumChannels = Pick<OutputLevel, 'leftSpectrum' | 'rightSpectrum'>;

export interface GraphSessionState {
  graph: GraphViewState;
  pendingLinks: PendingLink[];
  pendingRemovals: PendingRemoval[];
  pendingDefaultAudioSink: PendingDefaultDevice | null;
  pendingDefaultAudioSource: PendingDefaultDevice | null;
  pendingOutputVolumes: PendingOutputVolume[];
  queuedOutputVolumes: Record<number, number | undefined>;
  applicationVolumePreferences: ApplicationVolumePreference[];
  applicationVolumes: ApplicationVolumeItem[];
  outputLevels: Record<number, number | undefined>;
  outputSpectra: Record<number, OutputSpectrumChannels | undefined>;
  resyncing: boolean;
}

export type GraphSessionOperation =
  'create-link' | 'remove-link' | 'default-audio-sink' | 'default-audio-source' | 'output-volume';

export type GraphSessionEvent =
  | { type: 'graph-gap' }
  | { type: 'graph-read-failed'; message: string }
  | { type: 'resync-started' }
  | { type: 'resync-completed' }
  | { type: 'generation-changed'; generation: number }
  | { type: 'backend-reconnected' }
  | { type: 'backend-unavailable' }
  | { type: 'link-requested' }
  | { type: 'link-created' }
  | { type: 'link-removed'; linkId: number }
  | { type: 'default-audio-sink-requested'; node: NodeDto }
  | { type: 'default-audio-source-requested'; node: NodeDto }
  | { type: 'default-audio-sink-changed'; node: NodeDto | null }
  | { type: 'default-audio-source-changed'; node: NodeDto | null }
  | { type: 'output-volume-requested'; node: NodeDto }
  | { type: 'output-volume-changed'; node: NodeDto }
  | { type: 'application-volume-remembered'; name: string }
  | { type: 'operation-failed'; operation: GraphSessionOperation; message: string }
  | { type: 'confirmation-timeout'; operation: GraphSessionOperation };

export interface SessionEffect {
  type: 'send-queued-output-volume';
  nodeId: number;
  volumePercent: number;
}

export interface SessionReduction {
  state: GraphSessionState;
  events: GraphSessionEvent[];
  effects: SessionEffect[];
  needsResync: boolean;
}

export function emptyGraphSessionState(
  applicationVolumePreferences: ApplicationVolumePreference[] = [],
  applicationVolumes: ApplicationVolumeItem[] = [],
): GraphSessionState {
  return {
    graph: emptyGraphState(),
    pendingLinks: [],
    pendingRemovals: [],
    pendingDefaultAudioSink: null,
    pendingDefaultAudioSource: null,
    pendingOutputVolumes: [],
    queuedOutputVolumes: {},
    applicationVolumePreferences,
    applicationVolumes,
    outputLevels: {},
    outputSpectra: {},
    resyncing: false,
  };
}

export function reduceSessionEnvelope(
  state: GraphSessionState,
  envelope: GraphEnvelope,
): SessionReduction {
  const previousGraph = state.graph;
  const previousLinkIds = new Set(previousGraph.links.map((link) => link.id));
  const graphResult = reduceEnvelope(previousGraph, envelope);
  if (graphResult.needsResync) {
    return {
      state,
      events: [{ type: 'graph-gap' }],
      effects: [],
      needsResync: true,
    };
  }
  if (!graphResult.applied) return unchanged(state);

  const graph = graphResult.state;
  const generationChanged = graph.generation !== previousGraph.generation;
  let next: GraphSessionState = generationChanged
    ? {
        ...state,
        graph,
        pendingLinks: state.pendingLinks.filter(
          (pending) => pending.generation === graph.generation,
        ),
        pendingRemovals: [],
        pendingDefaultAudioSink: null,
        pendingDefaultAudioSource: null,
        pendingOutputVolumes: [],
        queuedOutputVolumes: {},
        outputLevels: {},
        outputSpectra: {},
      }
    : { ...state, graph };
  const events: GraphSessionEvent[] = generationChanged
    ? [{ type: 'generation-changed', generation: graph.generation }]
    : [];
  const effects: SessionEffect[] = [];

  next = {
    ...next,
    pendingLinks: next.pendingLinks.filter(
      (pending) =>
        !graph.links.some(
          (link) =>
            link.outputPortId === pending.outputPortId && link.inputPortId === pending.inputPortId,
        ),
    ),
    pendingRemovals: next.pendingRemovals.filter((pending) =>
      graph.links.some((link) => link.id === pending.linkId),
    ),
  };

  if (graphResult.operationFailure) {
    const failureResult = reduceOperationFailure(next, graphResult.operationFailure);
    next = failureResult.state;
    events.push(...failureResult.events);
  }

  if (envelope.payload.type === 'delta' && envelope.payload.data.type === 'linkAdded') {
    const link = envelope.payload.data.data;
    next = {
      ...next,
      pendingLinks: next.pendingLinks.filter(
        (pending) =>
          pending.outputPortId !== link.outputPortId || pending.inputPortId !== link.inputPortId,
      ),
    };
    if (!previousLinkIds.has(link.id)) events.push({ type: 'link-created' });
  }

  if (envelope.payload.type === 'delta' && envelope.payload.data.type === 'linkRemoved') {
    const linkId = envelope.payload.data.data.id;
    next = {
      ...next,
      pendingRemovals: next.pendingRemovals.filter((pending) => pending.linkId !== linkId),
    };
    events.push({ type: 'link-removed', linkId });
  }

  if (envelope.payload.type === 'delta' && envelope.payload.data.type === 'nodeUpdated') {
    const node = envelope.payload.data.data;
    const confirmed = next.pendingOutputVolumes.filter(
      (pending) =>
        pending.nodeId === node.id &&
        (pending.volumePercent === null || pending.volumePercent === node.volumePercent) &&
        (pending.muted === null || pending.muted === node.muted),
    );
    if (confirmed.length > 0) {
      const pendingOutputVolumes = next.pendingOutputVolumes.filter(
        (pending) => !confirmed.includes(pending),
      );
      const queuedVolume = next.queuedOutputVolumes[node.id];
      let queuedOutputVolumes = next.queuedOutputVolumes;
      if (!pendingOutputVolumes.some((pending) => pending.nodeId === node.id)) {
        queuedOutputVolumes = withoutQueuedVolume(queuedOutputVolumes, node.id);
        if (queuedVolume !== undefined && queuedVolume !== node.volumePercent) {
          effects.push({
            type: 'send-queued-output-volume',
            nodeId: node.id,
            volumePercent: queuedVolume,
          });
        }
      }
      next = { ...next, pendingOutputVolumes, queuedOutputVolumes };
      if (
        confirmed.some((pending) => pending.muted !== null) &&
        confirmed.some((pending) => !pending.silent)
      ) {
        events.push({ type: 'output-volume-changed', node });
      }
    }
  }

  if (
    envelope.payload.type === 'delta' &&
    envelope.payload.data.type === 'defaultAudioSinkChanged' &&
    graph.defaultAudioSinkName !== previousGraph.defaultAudioSinkName
  ) {
    if (next.pendingDefaultAudioSink?.nodeName === graph.defaultAudioSinkName) {
      next = { ...next, pendingDefaultAudioSink: null };
    }
    events.push({
      type: 'default-audio-sink-changed',
      node: graph.nodes.find((node) => node.objectName === graph.defaultAudioSinkName) ?? null,
    });
  }

  if (
    envelope.payload.type === 'delta' &&
    envelope.payload.data.type === 'defaultAudioSourceChanged' &&
    graph.defaultAudioSourceName !== previousGraph.defaultAudioSourceName
  ) {
    if (next.pendingDefaultAudioSource?.nodeName === graph.defaultAudioSourceName) {
      next = { ...next, pendingDefaultAudioSource: null };
    }
    events.push({
      type: 'default-audio-source-changed',
      node: graph.nodes.find((node) => node.objectName === graph.defaultAudioSourceName) ?? null,
    });
  }

  if (
    previousGraph.generation >= 0 &&
    previousGraph.status.state !== 'connected' &&
    graph.status.state === 'connected'
  ) {
    events.push({ type: 'backend-reconnected' });
  } else if (graph.status.state === 'disconnected') {
    events.push({ type: 'backend-unavailable' });
  }

  return { state: next, events, effects, needsResync: false };
}

export function reduceOperationFailure(
  state: GraphSessionState,
  failure: OperationFailure,
): Pick<SessionReduction, 'state' | 'events'> {
  if (!failure.operationId) return { state, events: [] };
  const operationId = failure.operationId;
  const isCreation = state.pendingLinks.some((pending) => pending.operationId === operationId);
  const isRemoval = state.pendingRemovals.some((pending) => pending.operationId === operationId);
  const isDefaultAudioSink = state.pendingDefaultAudioSink?.operationId === operationId;
  const isDefaultAudioSource = state.pendingDefaultAudioSource?.operationId === operationId;
  const failedOutputVolume = state.pendingOutputVolumes.find(
    (pending) => pending.operationId === operationId,
  );
  const operation = operationForMatches(
    isCreation,
    isRemoval,
    isDefaultAudioSink,
    isDefaultAudioSource,
    failedOutputVolume !== undefined,
  );
  if (!operation) return { state, events: [] };

  return {
    state: {
      ...state,
      pendingLinks: state.pendingLinks.filter((pending) => pending.operationId !== operationId),
      pendingRemovals: state.pendingRemovals.filter(
        (pending) => pending.operationId !== operationId,
      ),
      pendingDefaultAudioSink: isDefaultAudioSink ? null : state.pendingDefaultAudioSink,
      pendingDefaultAudioSource: isDefaultAudioSource ? null : state.pendingDefaultAudioSource,
      pendingOutputVolumes: state.pendingOutputVolumes.filter(
        (pending) => pending.operationId !== operationId,
      ),
      queuedOutputVolumes: failedOutputVolume
        ? withoutQueuedVolume(state.queuedOutputVolumes, failedOutputVolume.nodeId)
        : state.queuedOutputVolumes,
    },
    events: [{ type: 'operation-failed', operation, message: failure.message }],
  };
}

export function expirePendingOperations(state: GraphSessionState, now: number): SessionReduction {
  const expiredLinks = state.pendingLinks.filter((pending) => pendingHasExpired(pending, now));
  const expiredRemovals = state.pendingRemovals.filter(
    (pending) => now - pending.createdAt >= 5_000,
  );
  const defaultAudioSinkExpired =
    state.pendingDefaultAudioSink !== null &&
    now - state.pendingDefaultAudioSink.createdAt >= 5_000;
  const defaultAudioSourceExpired =
    state.pendingDefaultAudioSource !== null &&
    now - state.pendingDefaultAudioSource.createdAt >= 5_000;
  const expiredOutputVolumes = state.pendingOutputVolumes.filter(
    (pending) => now - pending.createdAt >= 5_000,
  );
  if (
    expiredLinks.length === 0 &&
    expiredRemovals.length === 0 &&
    !defaultAudioSinkExpired &&
    !defaultAudioSourceExpired &&
    expiredOutputVolumes.length === 0
  ) {
    return unchanged(state);
  }

  let queuedOutputVolumes = state.queuedOutputVolumes;
  for (const pending of expiredOutputVolumes) {
    queuedOutputVolumes = withoutQueuedVolume(queuedOutputVolumes, pending.nodeId);
  }
  const operation: GraphSessionOperation =
    expiredOutputVolumes.length > 0
      ? 'output-volume'
      : defaultAudioSourceExpired
        ? 'default-audio-source'
        : defaultAudioSinkExpired
          ? 'default-audio-sink'
          : expiredRemovals.length > 0
            ? 'remove-link'
            : 'create-link';

  return {
    state: {
      ...state,
      pendingLinks: state.pendingLinks.filter((pending) => !expiredLinks.includes(pending)),
      pendingRemovals: state.pendingRemovals.filter(
        (pending) => !expiredRemovals.includes(pending),
      ),
      pendingDefaultAudioSink: defaultAudioSinkExpired ? null : state.pendingDefaultAudioSink,
      pendingDefaultAudioSource: defaultAudioSourceExpired ? null : state.pendingDefaultAudioSource,
      pendingOutputVolumes: state.pendingOutputVolumes.filter(
        (pending) => !expiredOutputVolumes.includes(pending),
      ),
      queuedOutputVolumes,
    },
    events: [{ type: 'confirmation-timeout', operation }],
    effects: [],
    needsResync: true,
  };
}

export function withoutQueuedVolume(
  queued: Record<number, number | undefined>,
  nodeId: number,
): Record<number, number | undefined> {
  if (queued[nodeId] === undefined) return queued;
  const next = { ...queued };
  delete next[nodeId];
  return next;
}

function operationForMatches(
  creation: boolean,
  removal: boolean,
  defaultSink: boolean,
  defaultSource: boolean,
  outputVolume: boolean,
): GraphSessionOperation | null {
  if (outputVolume) return 'output-volume';
  if (defaultSource) return 'default-audio-source';
  if (defaultSink) return 'default-audio-sink';
  if (removal) return 'remove-link';
  if (creation) return 'create-link';
  return null;
}

function unchanged(state: GraphSessionState): SessionReduction {
  return { state, events: [], effects: [], needsResync: false };
}
