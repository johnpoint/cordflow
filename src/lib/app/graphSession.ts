import { writable, type Readable } from 'svelte/store';
import {
  isApplicationAudioNode,
  readApplicationVolumePreferences,
  reconcileApplicationVolumes,
  updateApplicationVolumePreference,
  writeApplicationVolumePreferences,
} from '../applicationVolume';
import type { GraphBridge, Unsubscribe } from '../bridge';
import type { GraphEnvelope, OperationFailure, OutputLevel } from '../generated/graph';
import { connectionExists, type NormalizedPorts } from '../graph/connection';
import {
  emptyGraphSessionState,
  expirePendingOperations,
  reduceOperationFailure,
  reduceSessionEnvelope,
  withoutQueuedVolume,
  type GraphSessionEvent,
  type GraphSessionState,
  type PendingDefaultDevice,
  type PendingOutputVolume,
  type PendingRemoval,
  type SessionReduction,
} from './sessionReducer';

type TimerHandle = ReturnType<typeof globalThis.setInterval>;
type AnimationFrameHandle = number;

export interface GraphSessionDependencies {
  bridge: GraphBridge;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  onEvent?: (event: GraphSessionEvent) => void;
  now?: () => number;
  setInterval?: (handler: () => void, timeout: number) => TimerHandle;
  clearInterval?: (handle: TimerHandle) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => AnimationFrameHandle;
  cancelAnimationFrame?: (handle: AnimationFrameHandle) => void;
  queueMicrotask?: (callback: () => void) => void;
  createOperationId?: (prefix: string) => string;
  warn?: (message: string, error: unknown) => void;
}

export interface GraphSession extends Readable<GraphSessionState> {
  start(options?: { outputMetering?: boolean }): void;
  stop(): void;
  resync(announceProgress?: boolean): Promise<void>;
  createLink(ports: NormalizedPorts): Promise<void>;
  removeLink(linkId: number): Promise<void>;
  setDefaultAudioSink(nodeId: number): Promise<void>;
  setDefaultAudioSource(nodeId: number): Promise<void>;
  setOutputVolume(
    nodeId: number,
    update: { volumePercent?: number; muted?: boolean },
    silent?: boolean,
  ): Promise<void>;
  setApplicationVolume(
    applicationId: string,
    update: { volumePercent?: number; muted?: boolean },
  ): void;
  setOutputMetering(enabled: boolean): void;
}

export function createGraphSession(dependencies: GraphSessionDependencies): GraphSession {
  const now = dependencies.now ?? Date.now;
  const scheduleInterval =
    dependencies.setInterval ?? ((handler, timeout) => globalThis.setInterval(handler, timeout));
  const cancelInterval =
    dependencies.clearInterval ?? ((handle) => globalThis.clearInterval(handle));
  const scheduleFrame =
    dependencies.requestAnimationFrame ??
    ((callback) => globalThis.requestAnimationFrame(callback));
  const cancelFrame =
    dependencies.cancelAnimationFrame ?? ((handle) => globalThis.cancelAnimationFrame(handle));
  const scheduleMicrotask = dependencies.queueMicrotask ?? globalThis.queueMicrotask;
  const createOperationId =
    dependencies.createOperationId ??
    ((prefix: string) =>
      `${prefix}-${globalThis.crypto.randomUUID?.() ?? `${now()}-${Math.random()}`}`);
  const warn =
    dependencies.warn ??
    ((message: string, error: unknown) => {
      console.warn(message, error);
    });

  let applicationVolumePreferences = readApplicationVolumePreferences(dependencies.storage, now());
  applicationVolumePreferences = writeApplicationVolumePreferences(
    dependencies.storage,
    applicationVolumePreferences,
    now(),
  );
  const initialReconciliation = reconcileApplicationVolumes(
    applicationVolumePreferences,
    [],
    [],
    now(),
  );
  let current = emptyGraphSessionState(
    applicationVolumePreferences,
    initialReconciliation.applications,
  );
  const store = writable(current);
  const observedApplicationNodeIds = new Set<number>();
  const pendingOutputLevels: Record<number, number | undefined> = {};
  const pendingOutputSpectra: GraphSessionState['outputSpectra'] = {};
  let outputLevelFrame: AnimationFrameHandle | null = null;
  let pendingTimer: TimerHandle | null = null;
  let applicationMemoryTimer: TimerHandle | null = null;
  let unsubscribeGraph: Unsubscribe | undefined;
  let unsubscribeOutputLevels: Unsubscribe | undefined;
  let outputLevelSubscriptionReady = false;
  let desiredOutputMetering = false;
  let started = false;
  let lifecycle = 0;

  function publish(next: GraphSessionState): void {
    current = next;
    store.set(next);
  }

  function emit(event: GraphSessionEvent): void {
    dependencies.onEvent?.(event);
  }

  function applyReduction(reduction: SessionReduction): void {
    if (reduction.state !== current) publish(reduction.state);
    for (const event of reduction.events) {
      if (event.type === 'generation-changed') {
        observedApplicationNodeIds.clear();
        clearPendingOutputLevelFrame();
      }
      emit(event);
    }
    for (const effect of reduction.effects) {
      if (effect.type === 'send-queued-output-volume') {
        void setOutputVolume(effect.nodeId, { volumePercent: effect.volumePercent });
      }
    }
    if (reduction.needsResync) void resync(false);
  }

  function onEnvelope(envelope: GraphEnvelope): void {
    const previous = current;
    const reduction = reduceSessionEnvelope(current, envelope);
    applyReduction(reduction);
    if (
      !reduction.needsResync &&
      reduction.state !== previous &&
      reduction.state.graph.generation >= 0
    ) {
      reconcileApplicationVolumeState();
    }
  }

  function onOutputLevel(level: OutputLevel): void {
    pendingOutputLevels[level.nodeId] = level.peak;
    pendingOutputSpectra[level.nodeId] = {
      leftSpectrum: level.leftSpectrum,
      rightSpectrum: level.rightSpectrum,
    };
    if (outputLevelFrame !== null) return;
    outputLevelFrame = scheduleFrame(() => {
      publish({
        ...current,
        outputLevels: { ...current.outputLevels, ...pendingOutputLevels },
        outputSpectra: { ...current.outputSpectra, ...pendingOutputSpectra },
      });
      for (const key of Object.keys(pendingOutputLevels)) {
        delete pendingOutputLevels[Number(key)];
      }
      for (const key of Object.keys(pendingOutputSpectra)) {
        delete pendingOutputSpectra[Number(key)];
      }
      outputLevelFrame = null;
    });
  }

  function reconcileApplicationVolumeState(at = now()): void {
    const reconciliation = reconcileApplicationVolumes(
      current.applicationVolumePreferences,
      current.graph.nodes,
      current.graph.ports,
      at,
    );
    const preferences = writeApplicationVolumePreferences(
      dependencies.storage,
      reconciliation.preferences,
      at,
    );
    publish({
      ...current,
      applicationVolumePreferences: preferences,
      applicationVolumes: reconciliation.applications,
    });

    const currentNodeIds = new Set(current.graph.nodes.map((node) => node.id));
    for (const nodeId of observedApplicationNodeIds) {
      if (!currentNodeIds.has(nodeId)) observedApplicationNodeIds.delete(nodeId);
    }
    for (const application of reconciliation.applications) {
      for (const nodeId of application.nodeIds) {
        if (
          reconciliation.rememberedNodeIds.includes(nodeId) &&
          !observedApplicationNodeIds.has(nodeId)
        ) {
          const node = current.graph.nodes.find((candidate) => candidate.id === nodeId);
          if (
            node &&
            (node.volumePercent !== application.volumePercent || node.muted !== application.muted)
          ) {
            scheduleMicrotask(() => {
              void setOutputVolume(
                nodeId,
                {
                  volumePercent: application.volumePercent,
                  muted: application.muted,
                },
                true,
              );
            });
          }
        }
        observedApplicationNodeIds.add(nodeId);
      }
    }
  }

  function checkPendingTimeouts(): void {
    applyReduction(expirePendingOperations(current, now()));
  }

  function syncOutputMetering(): void {
    if (!outputLevelSubscriptionReady) return;
    void dependencies.bridge.setOutputMetering(desiredOutputMetering).catch((error) => {
      warn('Could not update PipeWire output metering state', error);
    });
  }

  function start(options: { outputMetering?: boolean } = {}): void {
    if (started) return;
    started = true;
    lifecycle += 1;
    const activeLifecycle = lifecycle;
    desiredOutputMetering = options.outputMetering ?? desiredOutputMetering;
    void dependencies.bridge
      .subscribe(onEnvelope)
      .then((stopSubscription) => {
        if (!started || activeLifecycle !== lifecycle) {
          stopSubscription();
          return;
        }
        unsubscribeGraph = stopSubscription;
      })
      .catch((error) => emit({ type: 'graph-read-failed', message: errorMessage(error) }));
    void dependencies.bridge
      .subscribeOutputLevels(onOutputLevel)
      .then((stopSubscription) => {
        if (!started || activeLifecycle !== lifecycle) {
          stopSubscription();
          return;
        }
        unsubscribeOutputLevels = stopSubscription;
        outputLevelSubscriptionReady = true;
        syncOutputMetering();
      })
      .catch((error) => {
        warn('Could not subscribe to PipeWire output levels', error);
      });
    pendingTimer = scheduleInterval(checkPendingTimeouts, 250);
    applicationMemoryTimer = scheduleInterval(() => reconcileApplicationVolumeState(), 60_000);
  }

  function stop(): void {
    if (!started) return;
    started = false;
    lifecycle += 1;
    unsubscribeGraph?.();
    unsubscribeGraph = undefined;
    unsubscribeOutputLevels?.();
    unsubscribeOutputLevels = undefined;
    outputLevelSubscriptionReady = false;
    desiredOutputMetering = false;
    void dependencies.bridge.setOutputMetering(false).catch((error) => {
      warn('Could not update PipeWire output metering state', error);
    });
    clearPendingOutputLevelFrame();
    if (pendingTimer !== null) {
      cancelInterval(pendingTimer);
      pendingTimer = null;
    }
    if (applicationMemoryTimer !== null) {
      cancelInterval(applicationMemoryTimer);
      applicationMemoryTimer = null;
    }
  }

  function clearPendingOutputLevelFrame(): void {
    if (outputLevelFrame !== null) {
      cancelFrame(outputLevelFrame);
      outputLevelFrame = null;
    }
    for (const key of Object.keys(pendingOutputLevels)) {
      delete pendingOutputLevels[Number(key)];
    }
    for (const key of Object.keys(pendingOutputSpectra)) {
      delete pendingOutputSpectra[Number(key)];
    }
  }

  async function resync(announceProgress = true): Promise<void> {
    if (current.resyncing) return;
    publish({ ...current, resyncing: true });
    if (announceProgress) emit({ type: 'resync-started' });
    try {
      onEnvelope(await dependencies.bridge.getGraphSnapshot());
      if (announceProgress) emit({ type: 'resync-completed' });
    } catch (error) {
      emit({ type: 'graph-read-failed', message: errorMessage(error) });
    } finally {
      publish({ ...current, resyncing: false });
    }
  }

  async function createLink(ports: NormalizedPorts): Promise<void> {
    if (
      connectionExists(current.graph.links, current.pendingLinks, ports.output.id, ports.input.id)
    ) {
      return;
    }
    const pending = {
      operationId: createOperationId('create'),
      generation: current.graph.generation,
      outputPortId: ports.output.id,
      inputPortId: ports.input.id,
      createdAt: now(),
    };
    publish({ ...current, pendingLinks: [...current.pendingLinks, pending] });
    emit({ type: 'link-requested' });
    try {
      await dependencies.bridge.createLink({
        operationId: pending.operationId,
        generation: pending.generation,
        outputPortId: pending.outputPortId,
        inputPortId: pending.inputPortId,
      });
    } catch (error) {
      rejectOperation(pending.operationId, error);
    }
  }

  async function removeLink(linkId: number): Promise<void> {
    if (current.pendingRemovals.some((pending) => pending.linkId === linkId)) return;
    const pending: PendingRemoval = {
      operationId: createOperationId('remove'),
      linkId,
      createdAt: now(),
    };
    publish({ ...current, pendingRemovals: [...current.pendingRemovals, pending] });
    try {
      await dependencies.bridge.removeLink({
        operationId: pending.operationId,
        generation: current.graph.generation,
        linkId,
      });
    } catch (error) {
      rejectOperation(pending.operationId, error);
    }
  }

  async function setDefaultAudioSink(nodeId: number): Promise<void> {
    const node = current.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node?.objectName || node.objectName === current.graph.defaultAudioSinkName) return;
    const hasAudioInput = current.graph.ports.some(
      (port) => port.nodeId === node.id && port.direction === 'input' && port.mediaType === 'audio',
    );
    if (!hasAudioInput) return;
    const pending: PendingDefaultDevice = {
      operationId: createOperationId('default-sink'),
      nodeId: node.id,
      nodeName: node.objectName,
      createdAt: now(),
    };
    publish({ ...current, pendingDefaultAudioSink: pending });
    emit({ type: 'default-audio-sink-requested', node });
    try {
      await dependencies.bridge.setDefaultAudioSink({
        operationId: pending.operationId,
        generation: current.graph.generation,
        nodeId: pending.nodeId,
      });
    } catch (error) {
      rejectOperation(pending.operationId, error);
    }
  }

  async function setDefaultAudioSource(nodeId: number): Promise<void> {
    const node = current.graph.nodes.find((candidate) => candidate.id === nodeId);
    const isAudioSource =
      node?.mediaClass === 'Audio/Source' || node?.mediaClass?.startsWith('Audio/Source/');
    const hasAudioOutput = current.graph.ports.some(
      (port) => port.nodeId === nodeId && port.direction === 'output' && port.mediaType === 'audio',
    );
    if (
      !node?.objectName ||
      !isAudioSource ||
      !hasAudioOutput ||
      node.objectName === current.graph.defaultAudioSourceName
    ) {
      return;
    }
    const pending: PendingDefaultDevice = {
      operationId: createOperationId('default-source'),
      nodeId: node.id,
      nodeName: node.objectName,
      createdAt: now(),
    };
    publish({ ...current, pendingDefaultAudioSource: pending });
    emit({ type: 'default-audio-source-requested', node });
    try {
      await dependencies.bridge.setDefaultAudioSource({
        operationId: pending.operationId,
        generation: current.graph.generation,
        nodeId: pending.nodeId,
      });
    } catch (error) {
      rejectOperation(pending.operationId, error);
    }
  }

  async function setOutputVolume(
    nodeId: number,
    update: { volumePercent?: number; muted?: boolean },
    silent = false,
  ): Promise<void> {
    const node = current.graph.nodes.find((candidate) => candidate.id === nodeId);
    const isAudioSink =
      node &&
      (node.mediaClass === 'Audio/Sink' || node.mediaClass?.startsWith('Audio/Sink/')) &&
      current.graph.ports.some(
        (port) =>
          port.nodeId === node.id && port.direction === 'input' && port.mediaType === 'audio',
      );
    const isApplicationOutput =
      node &&
      isApplicationAudioNode(node) &&
      current.graph.ports.some(
        (port) =>
          port.nodeId === node.id && port.direction === 'output' && port.mediaType === 'audio',
      );
    if (!node || (!isAudioSink && !isApplicationOutput)) return;

    const activeRequest = current.pendingOutputVolumes.find((pending) => pending.nodeId === nodeId);
    if (activeRequest) {
      if (update.volumePercent !== undefined) {
        if (update.volumePercent !== activeRequest.volumePercent) {
          publish({
            ...current,
            queuedOutputVolumes: {
              ...current.queuedOutputVolumes,
              [nodeId]: update.volumePercent,
            },
          });
        } else if (current.queuedOutputVolumes[nodeId] !== undefined) {
          publish({
            ...current,
            queuedOutputVolumes: withoutQueuedVolume(current.queuedOutputVolumes, nodeId),
          });
        }
      }
      return;
    }
    if (
      update.volumePercent !== undefined &&
      update.muted === undefined &&
      update.volumePercent === node.volumePercent
    ) {
      return;
    }

    const pending: PendingOutputVolume = {
      operationId: createOperationId('output-volume'),
      nodeId,
      volumePercent: update.volumePercent ?? null,
      muted: update.muted ?? null,
      createdAt: now(),
      silent,
    };
    publish({
      ...current,
      pendingOutputVolumes: [...current.pendingOutputVolumes, pending],
    });
    if (update.muted !== undefined && !silent) {
      emit({ type: 'output-volume-requested', node });
    }
    try {
      await dependencies.bridge.setOutputVolume({
        operationId: pending.operationId,
        generation: current.graph.generation,
        nodeId,
        volumePercent: pending.volumePercent,
        muted: pending.muted,
      });
    } catch (error) {
      rejectOperation(pending.operationId, error);
    }
  }

  function setApplicationVolume(
    applicationId: string,
    update: { volumePercent?: number; muted?: boolean },
  ): void {
    const at = now();
    const preferences = writeApplicationVolumePreferences(
      dependencies.storage,
      updateApplicationVolumePreference(
        current.applicationVolumePreferences,
        applicationId,
        update,
        at,
      ),
      at,
    );
    const reconciliation = reconcileApplicationVolumes(
      preferences,
      current.graph.nodes,
      current.graph.ports,
      at,
    );
    publish({
      ...current,
      applicationVolumePreferences: reconciliation.preferences,
      applicationVolumes: reconciliation.applications,
    });
    const application = reconciliation.applications.find(
      (candidate) => candidate.id === applicationId,
    );
    if (!application) return;
    for (const nodeId of application.nodeIds) {
      void setOutputVolume(nodeId, update);
    }
    if (!application.active) {
      emit({ type: 'application-volume-remembered', name: application.name });
    }
  }

  function setOutputMetering(enabled: boolean): void {
    desiredOutputMetering = enabled;
    syncOutputMetering();
  }

  function rejectOperation(operationId: string, error: unknown): void {
    const failure: OperationFailure = {
      operationId,
      code: 'backendRejected',
      message: errorMessage(error),
    };
    const reduction = reduceOperationFailure(current, failure);
    if (reduction.state !== current) {
      publish(reduction.state);
      for (const event of reduction.events) emit(event);
    }
    // A graph-side OperationFailed event can race the command rejection. It has
    // already surfaced the same failure, so do not emit a duplicate notice.
  }

  return {
    subscribe: store.subscribe,
    start,
    stop,
    resync,
    createLink,
    removeLink,
    setDefaultAudioSink,
    setDefaultAudioSource,
    setOutputVolume,
    setApplicationVolume,
    setOutputMetering,
  };
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}
