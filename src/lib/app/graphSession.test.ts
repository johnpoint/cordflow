import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applicationVolumeStorageKey } from '../applicationVolume';
import { demoSnapshot, MockGraphBridge } from '../bridge/mock';
import type { GraphBridge, Unsubscribe } from '../bridge';
import type {
  CreateLinkRequest,
  GraphEnvelope,
  OperationAck,
  OutputLevel,
  RemoveLinkRequest,
  SetDefaultAudioSinkRequest,
  SetDefaultAudioSourceRequest,
  SetOutputVolumeRequest,
} from '../generated/graph';
import { createGraphSession } from './graphSession';
import type { GraphSessionEvent } from './sessionReducer';

afterEach(() => {
  vi.useRealTimers();
});

describe('createGraphSession', () => {
  it('keeps a command pending after its ACK until a graph event confirms it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const bridge = new MockGraphBridge({ confirmationDelay: null });
    const session = createGraphSession({
      bridge,
      storage: memoryStorage(),
      createOperationId: () => 'create-1',
    });
    session.start();

    await session.createLink({
      output: demoSnapshot().ports.find((port) => port.id === 12)!,
      input: demoSnapshot().ports.find((port) => port.id === 22)!,
    });

    expect(get(session).pendingLinks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(get(session).pendingLinks).toHaveLength(1);
    session.stop();
  });

  it('expires unconfirmed commands after five seconds and resyncs the graph', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const bridge = new MockGraphBridge({ confirmationDelay: null });
    const getSnapshot = vi.spyOn(bridge, 'getGraphSnapshot');
    const events: GraphSessionEvent[] = [];
    const session = createGraphSession({
      bridge,
      storage: memoryStorage(),
      onEvent: (event) => events.push(event),
      createOperationId: () => 'create-timeout',
    });
    session.start();
    await session.createLink({
      output: demoSnapshot().ports.find((port) => port.id === 12)!,
      input: demoSnapshot().ports.find((port) => port.id === 22)!,
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(get(session).pendingLinks).toEqual([]);
    expect(events).toContainEqual({
      type: 'confirmation-timeout',
      operation: 'create-link',
    });
    expect(getSnapshot).toHaveBeenCalledOnce();
    session.stop();
  });

  it('drops operations and transient meter state when the generation changes', async () => {
    vi.useFakeTimers();
    const bridge = new MockGraphBridge({ confirmationDelay: null });
    const events: GraphSessionEvent[] = [];
    const session = createGraphSession({
      bridge,
      storage: memoryStorage(),
      onEvent: (event) => events.push(event),
      createOperationId: () => 'old-generation',
    });
    session.start();
    await session.createLink({
      output: demoSnapshot().ports.find((port) => port.id === 12)!,
      input: demoSnapshot().ports.find((port) => port.id === 22)!,
    });
    expect(get(session).pendingLinks).toHaveLength(1);

    bridge.reconnect();

    expect(get(session).graph.generation).toBe(2);
    expect(get(session).pendingLinks).toEqual([]);
    expect(get(session).outputLevels).toEqual({});
    expect(events).toContainEqual({ type: 'generation-changed', generation: 2 });
    session.stop();
  });

  it('detects an envelope gap, reports it, and requests a fresh snapshot', async () => {
    const bridge = new TrackingBridge();
    const events: GraphSessionEvent[] = [];
    const session = createGraphSession({
      bridge,
      storage: memoryStorage(),
      onEvent: (event) => events.push(event),
    });
    session.start();
    await Promise.resolve();

    bridge.emitEnvelope({
      generation: 1,
      sequence: 2,
      payload: {
        type: 'status',
        data: { state: 'disconnected', detail: 'missed sequence 1' },
      },
    });
    await Promise.resolve();

    expect(events).toContainEqual({ type: 'graph-gap' });
    expect(bridge.snapshotRequests).toBe(1);
    expect(get(session).resyncing).toBe(false);
    session.stop();
  });

  it('clears a matching pending command when the graph reports an operation failure', async () => {
    const bridge = new TrackingBridge();
    const events: GraphSessionEvent[] = [];
    const session = createGraphSession({
      bridge,
      storage: memoryStorage(),
      onEvent: (event) => events.push(event),
      createOperationId: () => 'rejected-create',
    });
    session.start();
    await session.createLink({
      output: demoSnapshot().ports.find((port) => port.id === 12)!,
      input: demoSnapshot().ports.find((port) => port.id === 22)!,
    });

    bridge.emitEnvelope({
      generation: 1,
      sequence: 1,
      payload: {
        type: 'operationFailed',
        data: {
          operationId: 'rejected-create',
          code: 'backendRejected',
          message: 'link factory rejected the request',
        },
      },
    });

    expect(get(session).pendingLinks).toEqual([]);
    expect(events).toContainEqual({
      type: 'operation-failed',
      operation: 'create-link',
      message: 'link factory rejected the request',
    });
    session.stop();
  });

  it('coalesces rapid volume edits to the active request and the latest queued value', async () => {
    vi.useFakeTimers();
    const bridge = new MockGraphBridge({ confirmationDelay: 100 });
    const setOutputVolume = vi.spyOn(bridge, 'setOutputVolume');
    let operation = 0;
    const session = createGraphSession({
      bridge,
      storage: memoryStorage(),
      createOperationId: () => `volume-${++operation}`,
    });
    session.start();

    void session.setOutputVolume(3, { volumePercent: 70 });
    void session.setOutputVolume(3, { volumePercent: 71 });
    void session.setOutputVolume(3, { volumePercent: 72 });
    await Promise.resolve();

    expect(setOutputVolume).toHaveBeenCalledTimes(1);
    expect(setOutputVolume.mock.calls[0][0].volumePercent).toBe(70);
    expect(get(session).queuedOutputVolumes[3]).toBe(72);

    await vi.advanceTimersByTimeAsync(100);

    expect(setOutputVolume).toHaveBeenCalledTimes(2);
    expect(setOutputVolume.mock.calls[1][0].volumePercent).toBe(72);
    expect(get(session).queuedOutputVolumes[3]).toBeUndefined();
    session.stop();
  });

  it('restores a remembered application volume when its stream appears', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const storage = memoryStorage();
    storage.setItem(
      applicationVolumeStorageKey,
      JSON.stringify([
        {
          id: 'org.mozilla.firefox',
          name: 'Firefox',
          volumePercent: 42,
          muted: true,
          lastSeenAt: 99_000,
        },
      ]),
    );
    const bridge = new MockGraphBridge({ confirmationDelay: null });
    const setOutputVolume = vi.spyOn(bridge, 'setOutputVolume');
    const session = createGraphSession({
      bridge,
      storage,
      createOperationId: () => 'restore-firefox',
    });

    session.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(setOutputVolume).toHaveBeenCalledWith({
      operationId: 'restore-firefox',
      generation: 1,
      nodeId: 1,
      volumePercent: 42,
      muted: true,
    });
    session.stop();
  });

  it('owns metering, subscriptions, timers, and pending animation-frame cleanup', async () => {
    const bridge = new TrackingBridge();
    const clearedIntervals: unknown[] = [];
    let frameCallback: FrameRequestCallback | undefined;
    const cancelFrame = vi.fn();
    const session = createGraphSession({
      bridge,
      storage: memoryStorage(),
      setInterval: () => {
        const handle = Symbol('timer');
        return handle as unknown as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: (handle) => clearedIntervals.push(handle),
      requestAnimationFrame: (callback) => {
        frameCallback = callback;
        return 17;
      },
      cancelAnimationFrame: cancelFrame,
    });

    session.start({ outputMetering: true });
    await Promise.resolve();
    bridge.emitLevel();
    expect(frameCallback).toBeTypeOf('function');

    session.stop();
    await Promise.resolve();

    expect(bridge.metering).toEqual([true, false]);
    expect(bridge.graphUnsubscribed).toBe(1);
    expect(bridge.levelUnsubscribed).toBe(1);
    expect(clearedIntervals).toHaveLength(2);
    expect(cancelFrame).toHaveBeenCalledWith(17);
  });
});

class TrackingBridge implements GraphBridge {
  graphUnsubscribed = 0;
  levelUnsubscribed = 0;
  snapshotRequests = 0;
  metering: boolean[] = [];
  private graphListener: ((envelope: GraphEnvelope) => void) | undefined;
  private levelListener: ((level: OutputLevel) => void) | undefined;
  private readonly envelope: GraphEnvelope = {
    generation: 1,
    sequence: 0,
    payload: { type: 'snapshot', data: demoSnapshot() },
  };

  async subscribe(onEnvelope: (envelope: GraphEnvelope) => void): Promise<Unsubscribe> {
    this.graphListener = onEnvelope;
    onEnvelope(this.envelope);
    return () => {
      this.graphUnsubscribed += 1;
    };
  }

  async subscribeOutputLevels(onLevel: (level: OutputLevel) => void): Promise<Unsubscribe> {
    this.levelListener = onLevel;
    return () => {
      this.levelUnsubscribed += 1;
    };
  }

  async setOutputMetering(enabled: boolean): Promise<void> {
    this.metering.push(enabled);
  }

  async getGraphSnapshot(): Promise<GraphEnvelope> {
    this.snapshotRequests += 1;
    return this.envelope;
  }

  async createLink(request: CreateLinkRequest): Promise<OperationAck> {
    return ack(request.operationId);
  }

  async removeLink(request: RemoveLinkRequest): Promise<OperationAck> {
    return ack(request.operationId);
  }

  async setDefaultAudioSink(request: SetDefaultAudioSinkRequest): Promise<OperationAck> {
    return ack(request.operationId);
  }

  async setDefaultAudioSource(request: SetDefaultAudioSourceRequest): Promise<OperationAck> {
    return ack(request.operationId);
  }

  async setOutputVolume(request: SetOutputVolumeRequest): Promise<OperationAck> {
    return ack(request.operationId);
  }

  emitLevel(): void {
    const spectrum = Array(32).fill(0.2);
    this.levelListener?.({
      nodeId: 3,
      peak: 0.5,
      spectrum,
      leftSpectrum: spectrum,
      rightSpectrum: spectrum,
    });
  }

  emitEnvelope(envelope: GraphEnvelope): void {
    this.graphListener?.(envelope);
  }
}

function ack(operationId: string): OperationAck {
  return { operationId, generation: 1 };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
