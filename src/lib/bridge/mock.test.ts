import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutputLevel } from '../generated/graph';
import { deepTopologySnapshot, MockGraphBridge, stressSnapshot } from './mock';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

afterEach(() => vi.useRealTimers());

describe('MockGraphBridge', () => {
  it('acknowledges then confirms create and remove through deltas', async () => {
    vi.useFakeTimers();
    const bridge = new MockGraphBridge({ confirmationDelay: 100 });
    const envelopes: string[] = [];
    await bridge.subscribe((envelope) => envelopes.push(envelope.payload.type));

    const ack = await bridge.createLink({
      operationId: 'create',
      generation: 1,
      outputPortId: 12,
      inputPortId: 22,
    });
    expect(ack.operationId).toBe('create');
    expect(envelopes).toEqual(['snapshot']);

    await vi.advanceTimersByTimeAsync(100);
    const snapshot = await bridge.getGraphSnapshot();
    expect(snapshot.payload.type).toBe('snapshot');
    if (snapshot.payload.type !== 'snapshot') throw new Error('expected snapshot');
    const created = snapshot.payload.data.links.find(
      (link) => link.outputPortId === 12 && link.inputPortId === 22,
    );
    expect(created).toBeDefined();
    expect(envelopes).toEqual(['snapshot', 'delta']);

    await bridge.removeLink({
      operationId: 'remove',
      generation: 1,
      linkId: created!.id,
    });
    await vi.advanceTimersByTimeAsync(100);
    const afterRemove = await bridge.getGraphSnapshot();
    if (afterRemove.payload.type !== 'snapshot') throw new Error('expected snapshot');
    expect(afterRemove.payload.data.links.some((link) => link.id === created!.id)).toBe(false);
  });

  it('rejects duplicate operations', async () => {
    const bridge = new MockGraphBridge();
    const request = {
      operationId: 'duplicate',
      generation: 1,
      outputPortId: 12,
      inputPortId: 22,
    };
    await bridge.createLink(request);
    await expect(bridge.createLink(request)).rejects.toMatchObject({ code: 'duplicateOperation' });
  });

  it('acknowledges and confirms a new default audio sink', async () => {
    vi.useFakeTimers();
    const bridge = new MockGraphBridge({ confirmationDelay: 100 });
    const deltas: string[] = [];
    await bridge.subscribe((envelope) => {
      if (envelope.payload.type === 'delta') deltas.push(envelope.payload.data.type);
    });

    const ack = await bridge.setDefaultAudioSink({
      operationId: 'set-default',
      generation: 1,
      nodeId: 2,
    });
    expect(ack.operationId).toBe('set-default');

    await vi.advanceTimersByTimeAsync(100);
    const current = await bridge.getGraphSnapshot();
    if (current.payload.type !== 'snapshot') throw new Error('expected snapshot');
    expect(current.payload.data.defaultAudioSinkName).toBe('easyeffects_sink');
    expect(deltas).toEqual(['defaultAudioSinkChanged']);
  });

  it('rejects a node without an audio input as the default sink', async () => {
    const bridge = new MockGraphBridge();
    await expect(
      bridge.setDefaultAudioSink({
        operationId: 'invalid-default',
        generation: 1,
        nodeId: 1,
      }),
    ).rejects.toMatchObject({ code: 'invalidDefaultTarget' });
  });

  it('acknowledges and confirms a new default audio source', async () => {
    vi.useFakeTimers();
    const bridge = new MockGraphBridge({ confirmationDelay: 100 });
    const deltas: string[] = [];
    await bridge.subscribe((envelope) => {
      if (envelope.payload.type === 'delta') deltas.push(envelope.payload.data.type);
    });

    const ack = await bridge.setDefaultAudioSource({
      operationId: 'set-default-source',
      generation: 1,
      nodeId: 71,
    });
    expect(ack.operationId).toBe('set-default-source');

    await vi.advanceTimersByTimeAsync(100);
    const current = await bridge.getGraphSnapshot();
    if (current.payload.type !== 'snapshot') throw new Error('expected snapshot');
    expect(current.payload.data.defaultAudioSourceName).toBe('alsa_input.usb');
    expect(deltas).toEqual(['defaultAudioSourceChanged']);
  });

  it('rejects an application stream as the default audio source', async () => {
    const bridge = new MockGraphBridge();
    await expect(
      bridge.setDefaultAudioSource({
        operationId: 'invalid-default-source',
        generation: 1,
        nodeId: 1,
      }),
    ).rejects.toMatchObject({ code: 'invalidDefaultTarget' });
  });

  it('acknowledges and confirms output volume and mute changes', async () => {
    vi.useFakeTimers();
    const bridge = new MockGraphBridge({ confirmationDelay: 100 });
    const deltas: string[] = [];
    await bridge.subscribe((envelope) => {
      if (envelope.payload.type === 'delta') deltas.push(envelope.payload.data.type);
    });

    await bridge.setOutputVolume({
      operationId: 'set-volume',
      generation: 1,
      nodeId: 3,
      volumePercent: 80,
      muted: true,
    });
    await vi.advanceTimersByTimeAsync(100);

    const current = await bridge.getGraphSnapshot();
    if (current.payload.type !== 'snapshot') throw new Error('expected snapshot');
    expect(current.payload.data.nodes.find((node) => node.id === 3)).toMatchObject({
      volumePercent: 80,
      muted: true,
    });
    expect(deltas).toEqual(['nodeUpdated']);
  });

  it('acknowledges and confirms application stream volume changes', async () => {
    vi.useFakeTimers();
    const bridge = new MockGraphBridge({ confirmationDelay: 100 });

    await bridge.setOutputVolume({
      operationId: 'set-application-volume',
      generation: 1,
      nodeId: 1,
      volumePercent: 24,
      muted: true,
    });
    await vi.advanceTimersByTimeAsync(100);

    const current = await bridge.getGraphSnapshot();
    if (current.payload.type !== 'snapshot') throw new Error('expected snapshot');
    expect(current.payload.data.nodes.find((node) => node.id === 1)).toMatchObject({
      applicationId: 'org.mozilla.firefox',
      mediaClass: 'Stream/Output/Audio',
      volumePercent: 24,
      muted: true,
    });
  });

  it('publishes live output levels only while metering is enabled', async () => {
    vi.useFakeTimers();
    const bridge = new MockGraphBridge();
    const levels: OutputLevel[] = [];
    const unsubscribe = await bridge.subscribeOutputLevels((level) => levels.push(level));

    await bridge.setOutputMetering(true);
    expect(levels.some((level) => level.nodeId === 3 && level.peak > 0)).toBe(true);
    expect(levels.some((level) => level.spectrum.some((band) => band > 0))).toBe(true);
    expect(levels.some((level) => level.leftSpectrum.some((band) => band > 0))).toBe(true);
    expect(levels.some((level) => level.rightSpectrum.some((band) => band > 0))).toBe(true);
    expect(
      levels.some((level) =>
        level.leftSpectrum.some(
          (amplitude, band) => amplitude !== (level.rightSpectrum[band] ?? amplitude),
        ),
      ),
    ).toBe(true);
    const enabledCount = levels.length;
    await vi.advanceTimersByTimeAsync(160);
    expect(levels.length).toBeGreaterThan(enabledCount);

    await bridge.setOutputMetering(false);
    const stoppedCount = levels.length;
    await vi.advanceTimersByTimeAsync(240);
    expect(levels).toHaveLength(stoppedCount);
    expect(levels.at(-1)?.peak).toBe(0);
    expect(levels.at(-1)?.spectrum.every((band) => band === 0)).toBe(true);
    expect(levels.at(-1)?.leftSpectrum.every((band) => band === 0)).toBe(true);
    expect(levels.at(-1)?.rightSpectrum.every((band) => band === 0)).toBe(true);
    unsubscribe();
  });

  it('can acknowledge without confirming so the UI timeout path is testable', async () => {
    vi.useFakeTimers();
    const bridge = new MockGraphBridge({ confirmationDelay: null });
    await bridge.createLink({
      operationId: 'never-confirmed',
      generation: 1,
      outputPortId: 12,
      inputPortId: 22,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    const snapshot = await bridge.getGraphSnapshot();
    if (snapshot.payload.type !== 'snapshot') throw new Error('expected snapshot');
    expect(
      snapshot.payload.data.links.some(
        (link) => link.outputPortId === 12 && link.inputPortId === 22,
      ),
    ).toBe(false);
  });

  it('increments generation and publishes a fresh snapshot on reconnect', async () => {
    const snapshot = stressSnapshot();
    snapshot.status = { state: 'disconnected', detail: 'offline' };
    const bridge = new MockGraphBridge({ snapshot });
    const envelopes: Array<{ generation: number; sequence: number; type: string }> = [];
    await bridge.subscribe((envelope) =>
      envelopes.push({
        generation: envelope.generation,
        sequence: envelope.sequence,
        type: envelope.payload.type,
      }),
    );

    bridge.reconnect();

    expect(envelopes).toEqual([
      { generation: 1, sequence: 0, type: 'snapshot' },
      { generation: 2, sequence: 0, type: 'snapshot' },
    ]);
    const current = await bridge.getGraphSnapshot();
    expect(current.generation).toBe(2);
    expect(current.payload.type === 'snapshot' && current.payload.data.status.state).toBe(
      'connected',
    );
  });

  it('restores confirmed backend state after a window reload', async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const first = new MockGraphBridge({ confirmationDelay: 10, storage });
    await first.createLink({
      operationId: 'persist-create',
      generation: 1,
      outputPortId: 12,
      inputPortId: 22,
    });
    await vi.advanceTimersByTimeAsync(10);

    const reloaded = new MockGraphBridge({ storage });
    const restored = await reloaded.getGraphSnapshot();
    if (restored.payload.type !== 'snapshot') throw new Error('expected snapshot');
    expect(
      restored.payload.data.links.some(
        (link) => link.outputPortId === 12 && link.inputPortId === 22,
      ),
    ).toBe(true);
  });

  it('builds the 50 node, 200 port, 100 link stress fixture without duplicate IDs', () => {
    const snapshot = stressSnapshot();
    expect(snapshot.nodes).toHaveLength(50);
    expect(snapshot.ports).toHaveLength(200);
    expect(snapshot.links).toHaveLength(100);
    expect(new Set(snapshot.links.map((link) => link.id)).size).toBe(100);
    expect(new Set(snapshot.links.map((link) => link.outputPortId)).size).toBe(100);
  });

  it('provides a five-stage topology fixture for browser layout coverage', () => {
    const snapshot = deepTopologySnapshot();
    expect(snapshot.nodes).toHaveLength(5);
    expect(snapshot.links).toHaveLength(4);
  });
});
