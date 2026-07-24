import type {
  CreateLinkRequest,
  GraphDelta,
  GraphEnvelope,
  GraphSnapshot,
  LinkDto,
  OperationAck,
  OperationErrorCode,
  OperationFailure,
  OutputLevel,
  RemoveLinkRequest,
  SetDefaultAudioSinkRequest,
  SetDefaultAudioSourceRequest,
  SetOutputVolumeRequest,
} from '../generated/graph';
import type { GraphBridge, Unsubscribe } from './types';

export interface MockBridgeOptions {
  confirmationDelay?: number | null;
  reconnectDelay?: number;
  snapshot?: GraphSnapshot;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  storageKey?: string;
}

interface StoredMockState {
  generation: number;
  sequence: number;
  nextLinkId: number;
  handledOperations: string[];
  snapshot: GraphSnapshot;
}

export class MockGraphBridge implements GraphBridge {
  private generation = 1;
  private sequence = 0;
  private nextLinkId = 700;
  private readonly listeners = new Set<(envelope: GraphEnvelope) => void>();
  private readonly outputLevelListeners = new Set<(level: OutputLevel) => void>();
  private readonly handledOperations: Set<string>;
  private readonly confirmationDelay: number | null;
  private readonly reconnectDelay: number | undefined;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  private readonly storageKey: string;
  private reconnectScheduled = false;
  private outputMeterTimer: number | undefined;
  private snapshot: GraphSnapshot;

  constructor(options: MockBridgeOptions = {}) {
    this.confirmationDelay =
      options.confirmationDelay === undefined ? 180 : options.confirmationDelay;
    this.reconnectDelay = options.reconnectDelay;
    this.storage = options.storage;
    this.storageKey = options.storageKey ?? 'cordflow.mock';
    const stored = this.readStoredState();
    this.generation = stored?.generation ?? 1;
    this.sequence = stored?.sequence ?? 0;
    this.nextLinkId = stored?.nextLinkId ?? 700;
    this.handledOperations = new Set(stored?.handledOperations ?? []);
    this.snapshot = structuredClone(stored?.snapshot ?? options.snapshot ?? demoSnapshot());
    this.snapshot.defaultAudioSinkName ??= null;
    this.snapshot.defaultAudioSourceName ??= null;
    for (const node of this.snapshot.nodes) node.objectName ??= node.name;
  }

  async subscribe(onEnvelope: (envelope: GraphEnvelope) => void): Promise<Unsubscribe> {
    this.listeners.add(onEnvelope);
    onEnvelope(this.snapshotEnvelope());
    if (
      !this.reconnectScheduled &&
      this.reconnectDelay !== undefined &&
      this.snapshot.status.state !== 'connected'
    ) {
      this.reconnectScheduled = true;
      window.setTimeout(() => this.reconnect(), this.reconnectDelay);
    }
    return () => this.listeners.delete(onEnvelope);
  }

  async subscribeOutputLevels(onLevel: (level: OutputLevel) => void): Promise<Unsubscribe> {
    this.outputLevelListeners.add(onLevel);
    return () => this.outputLevelListeners.delete(onLevel);
  }

  async setOutputMetering(enabled: boolean): Promise<void> {
    if (this.outputMeterTimer !== undefined) {
      window.clearInterval(this.outputMeterTimer);
      this.outputMeterTimer = undefined;
    }
    if (!enabled) {
      for (const node of this.outputNodes()) {
        const silentSpectrum = Array(32).fill(0);
        this.emitOutputLevel({
          nodeId: node.id,
          peak: 0,
          spectrum: silentSpectrum,
          leftSpectrum: silentSpectrum,
          rightSpectrum: silentSpectrum,
        });
      }
      return;
    }
    this.emitMockOutputLevels();
    this.outputMeterTimer = window.setInterval(() => this.emitMockOutputLevels(), 80);
  }

  async getGraphSnapshot(): Promise<GraphEnvelope> {
    return this.snapshotEnvelope();
  }

  async createLink(request: CreateLinkRequest): Promise<OperationAck> {
    this.validateOperation(request.operationId, request.generation);
    const output = this.snapshot.ports.find((port) => port.id === request.outputPortId);
    const input = this.snapshot.ports.find((port) => port.id === request.inputPortId);
    if (!output || !input) this.fail(request.operationId, 'objectNotFound', 'Port disappeared');
    if (output.direction !== 'output' || input.direction !== 'input') {
      this.fail(request.operationId, 'directionMismatch', 'Expected output to input');
    }
    if (
      output.mediaType !== 'unknown' &&
      input.mediaType !== 'unknown' &&
      output.mediaType !== input.mediaType
    ) {
      this.fail(request.operationId, 'mediaTypeMismatch', 'Media types do not match');
    }
    if (
      this.snapshot.links.some(
        (link) =>
          link.outputPortId === request.outputPortId && link.inputPortId === request.inputPortId,
      )
    ) {
      this.fail(request.operationId, 'linkAlreadyExists', 'Link already exists');
    }

    const link: LinkDto = {
      id: this.nextLinkId++,
      outputPortId: request.outputPortId,
      inputPortId: request.inputPortId,
      active: true,
      mediaType: output.mediaType === 'unknown' ? input.mediaType : output.mediaType,
    };
    if (this.confirmationDelay !== null) {
      window.setTimeout(() => {
        this.snapshot.links.push(link);
        this.emitDelta({ type: 'linkAdded', data: link });
      }, this.confirmationDelay);
    }
    return { operationId: request.operationId, generation: this.generation };
  }

  async removeLink(request: RemoveLinkRequest): Promise<OperationAck> {
    this.validateOperation(request.operationId, request.generation);
    if (!this.snapshot.links.some((link) => link.id === request.linkId)) {
      this.fail(request.operationId, 'objectNotFound', 'Link disappeared');
    }
    if (this.confirmationDelay !== null) {
      window.setTimeout(() => {
        this.snapshot.links = this.snapshot.links.filter((link) => link.id !== request.linkId);
        this.emitDelta({ type: 'linkRemoved', data: { id: request.linkId } });
      }, this.confirmationDelay);
    }
    return { operationId: request.operationId, generation: this.generation };
  }

  async setDefaultAudioSink(request: SetDefaultAudioSinkRequest): Promise<OperationAck> {
    this.validateOperation(request.operationId, request.generation);
    const node = this.snapshot.nodes.find((candidate) => candidate.id === request.nodeId);
    const hasAudioInput = this.snapshot.ports.some(
      (port) =>
        port.nodeId === request.nodeId && port.direction === 'input' && port.mediaType === 'audio',
    );
    if (!node) this.fail(request.operationId, 'objectNotFound', 'Audio sink disappeared');
    if (!node.objectName || !hasAudioInput) {
      this.fail(request.operationId, 'invalidDefaultTarget', 'Node is not an audio sink');
    }
    if (this.confirmationDelay !== null) {
      window.setTimeout(() => {
        this.snapshot.defaultAudioSinkName = node.objectName!;
        this.emitDelta({
          type: 'defaultAudioSinkChanged',
          data: { name: node.objectName! },
        });
      }, this.confirmationDelay);
    }
    return { operationId: request.operationId, generation: this.generation };
  }

  async setDefaultAudioSource(request: SetDefaultAudioSourceRequest): Promise<OperationAck> {
    this.validateOperation(request.operationId, request.generation);
    const node = this.snapshot.nodes.find((candidate) => candidate.id === request.nodeId);
    const hasAudioOutput = this.snapshot.ports.some(
      (port) =>
        port.nodeId === request.nodeId && port.direction === 'output' && port.mediaType === 'audio',
    );
    const isAudioSource =
      node?.mediaClass === 'Audio/Source' || node?.mediaClass?.startsWith('Audio/Source/');
    if (!node) this.fail(request.operationId, 'objectNotFound', 'Audio source disappeared');
    if (!node.objectName || !hasAudioOutput || !isAudioSource) {
      this.fail(request.operationId, 'invalidDefaultTarget', 'Node is not an audio source');
    }
    if (this.confirmationDelay !== null) {
      window.setTimeout(() => {
        this.snapshot.defaultAudioSourceName = node.objectName!;
        this.emitDelta({
          type: 'defaultAudioSourceChanged',
          data: { name: node.objectName! },
        });
      }, this.confirmationDelay);
    }
    return { operationId: request.operationId, generation: this.generation };
  }

  async setOutputVolume(request: SetOutputVolumeRequest): Promise<OperationAck> {
    this.validateOperation(request.operationId, request.generation);
    const node = this.snapshot.nodes.find((candidate) => candidate.id === request.nodeId);
    const hasAudioInput = this.snapshot.ports.some(
      (port) =>
        port.nodeId === request.nodeId && port.direction === 'input' && port.mediaType === 'audio',
    );
    const hasAudioOutput = this.snapshot.ports.some(
      (port) =>
        port.nodeId === request.nodeId && port.direction === 'output' && port.mediaType === 'audio',
    );
    const isAudioSink =
      node?.mediaClass === 'Audio/Sink' || node?.mediaClass?.startsWith('Audio/Sink/');
    const isApplicationOutput =
      node?.mediaClass === 'Stream/Output/Audio' ||
      node?.mediaClass?.startsWith('Stream/Output/Audio/');
    if (!node) this.fail(request.operationId, 'objectNotFound', 'Audio sink disappeared');
    if ((!hasAudioInput || !isAudioSink) && (!hasAudioOutput || !isApplicationOutput)) {
      this.fail(
        request.operationId,
        'invalidDefaultTarget',
        'Node is not a controllable audio output',
      );
    }
    if (
      (request.volumePercent === null && request.muted === null) ||
      (request.volumePercent !== null && (request.volumePercent < 0 || request.volumePercent > 150))
    ) {
      this.fail(request.operationId, 'invalidVolume', 'Invalid output volume');
    }
    if (this.confirmationDelay !== null) {
      window.setTimeout(() => {
        if (request.volumePercent !== null) node.volumePercent = request.volumePercent;
        if (request.muted !== null) node.muted = request.muted;
        this.emitDelta({ type: 'nodeUpdated', data: structuredClone(node) });
      }, this.confirmationDelay);
    }
    return { operationId: request.operationId, generation: this.generation };
  }

  disconnect(detail = 'Mock PipeWire connection lost'): void {
    if (this.snapshot.status.state === 'disconnected') return;
    this.snapshot.status = { state: 'disconnected', detail };
    this.emitPayload({ type: 'status', data: structuredClone(this.snapshot.status) });
  }

  reconnect(): void {
    this.generation += 1;
    this.sequence = 0;
    this.handledOperations.clear();
    this.snapshot.status = { state: 'connected', detail: null };
    this.persist();
    this.emit(this.snapshotEnvelope());
  }

  private validateOperation(operationId: string, generation: number): void {
    if (this.handledOperations.has(operationId)) {
      this.fail(operationId, 'duplicateOperation', 'Duplicate operation');
    }
    this.handledOperations.add(operationId);
    this.persist();
    if (generation !== this.generation) {
      this.fail(operationId, 'staleGeneration', 'Stale graph generation');
    }
  }

  private fail(operationId: string, code: OperationErrorCode, message: string): never {
    const failure: OperationFailure = { operationId, code, message };
    throw failure;
  }

  private snapshotEnvelope(): GraphEnvelope {
    return {
      generation: this.generation,
      sequence: this.sequence,
      payload: { type: 'snapshot', data: structuredClone(this.snapshot) },
    };
  }

  private emitDelta(delta: GraphDelta): void {
    this.emitPayload({ type: 'delta', data: delta });
  }

  private emitPayload(payload: GraphEnvelope['payload']): void {
    const envelope = {
      generation: this.generation,
      sequence: ++this.sequence,
      payload,
    } satisfies GraphEnvelope;
    this.persist();
    this.emit(envelope);
  }

  private emit(envelope: GraphEnvelope): void {
    for (const listener of this.listeners) listener(structuredClone(envelope));
  }

  private outputNodes() {
    return this.snapshot.nodes.filter(
      (node) => node.mediaClass === 'Audio/Sink' || node.mediaClass?.startsWith('Audio/Sink/'),
    );
  }

  private emitMockOutputLevels(): void {
    const time = performance.now() / 1_000;
    for (const node of this.outputNodes()) {
      const carrier = Math.abs(Math.sin(time * (1.9 + (node.id % 4) * 0.31) + node.id));
      const pulse = Math.abs(Math.sin(time * 0.37 + node.id * 0.7));
      const peak = Math.min(1.12, 0.025 + carrier * (0.28 + pulse * 0.62));
      const channelSpectrum = (phase: number) =>
        Array.from({ length: 32 }, (_, band) => {
          const bass = Math.exp(-Math.pow((band - 7 - Math.sin(time + phase) * 2) / 4.5, 2));
          const presence = Math.exp(
            -Math.pow((band - 19 - Math.cos(time * 0.7 + phase) * 3) / 6, 2),
          );
          const movement =
            0.55 + 0.45 * Math.abs(Math.sin(time * (1.1 + band * 0.035) + band + phase * 2.4));
          return Math.min(1.12, peak * (bass * 0.78 + presence * 0.52 + 0.04) * movement);
        });
      const leftSpectrum = channelSpectrum(0);
      const rightSpectrum = channelSpectrum(0.64);
      const spectrum = leftSpectrum.map((amplitude, band) =>
        Math.max(amplitude, rightSpectrum[band] ?? 0),
      );
      this.emitOutputLevel({ nodeId: node.id, peak, spectrum, leftSpectrum, rightSpectrum });
    }
  }

  private emitOutputLevel(level: OutputLevel): void {
    for (const listener of this.outputLevelListeners) listener(structuredClone(level));
  }

  private persist(): void {
    if (!this.storage) return;
    const state: StoredMockState = {
      generation: this.generation,
      sequence: this.sequence,
      nextLinkId: this.nextLinkId,
      handledOperations: [...this.handledOperations],
      snapshot: this.snapshot,
    };
    this.storage.setItem(this.storageKey, JSON.stringify(state));
  }

  private readStoredState(): StoredMockState | null {
    const serialized = this.storage?.getItem(this.storageKey);
    if (!serialized) return null;
    try {
      return JSON.parse(serialized) as StoredMockState;
    } catch {
      return null;
    }
  }
}

export function demoSnapshot(): GraphSnapshot {
  return {
    status: { state: 'connected', detail: null },
    defaultAudioSinkName: 'alsa_output.pci',
    defaultAudioSourceName: 'alsa_input.pci',
    nodes: [
      {
        id: 1,
        name: 'Firefox',
        mediaName: 'Firefox',
        applicationId: 'org.mozilla.firefox',
        applicationName: 'Firefox',
        mediaClass: 'Stream/Output/Audio',
        objectName: 'stream.firefox',
        kind: 'output',
        volumePercent: 100,
        muted: false,
      },
      {
        id: 2,
        name: 'easyeffects_sink',
        mediaName: 'EasyEffects',
        mediaClass: 'Audio/Sink/Virtual',
        objectName: 'easyeffects_sink',
        kind: 'duplex',
        volumePercent: 100,
        muted: false,
      },
      {
        id: 3,
        name: 'alsa_output.pci',
        mediaName: 'Built-in Audio',
        mediaClass: 'Audio/Sink',
        objectName: 'alsa_output.pci',
        kind: 'input',
        volumePercent: 65,
        muted: false,
      },
      {
        id: 4,
        name: 'usb_midi',
        mediaName: 'USB MIDI Controller',
        objectName: 'usb_midi',
        kind: 'output',
      },
      {
        id: 5,
        name: 'synth',
        mediaName: 'Software Synth',
        objectName: 'synth',
        kind: 'input',
      },
      {
        id: 6,
        name: 'camera',
        mediaName: 'USB Camera',
        objectName: 'camera',
        kind: 'output',
      },
      {
        id: 7,
        name: 'obs',
        mediaName: 'OBS Studio',
        objectName: 'obs',
        kind: 'input',
      },
      {
        id: 70,
        name: 'alsa_input.pci',
        mediaName: 'Built-in Microphone',
        mediaClass: 'Audio/Source',
        objectName: 'alsa_input.pci',
        kind: 'output',
      },
      {
        id: 71,
        name: 'alsa_input.usb',
        mediaName: 'USB Microphone',
        mediaClass: 'Audio/Source',
        objectName: 'alsa_input.usb',
        kind: 'output',
      },
    ],
    ports: [
      {
        id: 11,
        nodeId: 1,
        name: 'output_FL',
        channel: 'FL',
        direction: 'output',
        mediaType: 'audio',
      },
      {
        id: 12,
        nodeId: 1,
        name: 'output_FR',
        channel: 'FR',
        direction: 'output',
        mediaType: 'audio',
      },
      {
        id: 21,
        nodeId: 2,
        name: 'input_FL',
        channel: 'FL',
        direction: 'input',
        mediaType: 'audio',
      },
      {
        id: 22,
        nodeId: 2,
        name: 'input_FR',
        channel: 'FR',
        direction: 'input',
        mediaType: 'audio',
      },
      {
        id: 23,
        nodeId: 2,
        name: 'output_FL',
        channel: 'FL',
        direction: 'output',
        mediaType: 'audio',
      },
      {
        id: 24,
        nodeId: 2,
        name: 'output_FR',
        channel: 'FR',
        direction: 'output',
        mediaType: 'audio',
      },
      {
        id: 31,
        nodeId: 3,
        name: 'playback_FL',
        channel: 'FL',
        direction: 'input',
        mediaType: 'audio',
      },
      {
        id: 32,
        nodeId: 3,
        name: 'playback_FR',
        channel: 'FR',
        direction: 'input',
        mediaType: 'audio',
      },
      { id: 41, nodeId: 4, name: 'midi_out', direction: 'output', mediaType: 'midi' },
      { id: 42, nodeId: 5, name: 'midi_in', direction: 'input', mediaType: 'midi' },
      { id: 51, nodeId: 6, name: 'capture_0', direction: 'output', mediaType: 'video' },
      { id: 52, nodeId: 7, name: 'video_in', direction: 'input', mediaType: 'video' },
      {
        id: 6_101,
        nodeId: 70,
        name: 'capture_FL',
        channel: 'FL',
        direction: 'output',
        mediaType: 'audio',
      },
      {
        id: 6_102,
        nodeId: 70,
        name: 'capture_FR',
        channel: 'FR',
        direction: 'output',
        mediaType: 'audio',
      },
      {
        id: 6_111,
        nodeId: 71,
        name: 'capture_MONO',
        channel: 'MONO',
        direction: 'output',
        mediaType: 'audio',
      },
    ],
    links: [
      {
        id: 101,
        outputPortId: 11,
        inputPortId: 21,
        active: true,
        mediaType: 'audio',
      },
      {
        id: 102,
        outputPortId: 23,
        inputPortId: 31,
        active: true,
        mediaType: 'audio',
      },
    ],
  };
}

export function crowdedChooserSnapshot(): GraphSnapshot {
  const snapshot = demoSnapshot();
  for (let index = 0; index < 12; index += 1) {
    const nodeId = 800 + index;
    snapshot.nodes.push({
      id: nodeId,
      name: `unused-audio-target-${index}`,
      mediaName: `Unused audio target ${index + 1}`,
      mediaClass: 'Audio/Sink',
      objectName: `unused-audio-target-${index}`,
      kind: 'input',
      volumePercent: 50 + index * 5,
      muted: false,
    });
    snapshot.ports.push({
      id: 900 + index,
      nodeId,
      name: `playback_${index}`,
      direction: 'input',
      mediaType: 'audio',
    });
  }
  return snapshot;
}

export function deepTopologySnapshot(): GraphSnapshot {
  return {
    status: { state: 'connected', detail: null },
    defaultAudioSinkName: 'speakers',
    defaultAudioSourceName: null,
    nodes: [
      {
        id: 1,
        name: 'player',
        mediaName: 'Music Player',
        objectName: 'player',
        kind: 'output',
      },
      {
        id: 2,
        name: 'effects-input',
        mediaName: 'Effects Input',
        objectName: 'effects-input',
        kind: 'duplex',
      },
      {
        id: 3,
        name: 'equalizer',
        mediaName: 'Equalizer',
        objectName: 'equalizer',
        kind: 'duplex',
      },
      {
        id: 4,
        name: 'limiter',
        mediaName: 'Limiter',
        objectName: 'limiter',
        kind: 'duplex',
      },
      {
        id: 5,
        name: 'speakers',
        mediaName: 'Speakers',
        mediaClass: 'Audio/Sink',
        objectName: 'speakers',
        kind: 'input',
        volumePercent: 72,
        muted: false,
      },
    ],
    ports: [
      { id: 11, nodeId: 1, name: 'output', direction: 'output', mediaType: 'audio' },
      { id: 21, nodeId: 2, name: 'input', direction: 'input', mediaType: 'audio' },
      { id: 22, nodeId: 2, name: 'output', direction: 'output', mediaType: 'audio' },
      { id: 31, nodeId: 3, name: 'input', direction: 'input', mediaType: 'audio' },
      { id: 32, nodeId: 3, name: 'output', direction: 'output', mediaType: 'audio' },
      { id: 41, nodeId: 4, name: 'input', direction: 'input', mediaType: 'audio' },
      { id: 42, nodeId: 4, name: 'output', direction: 'output', mediaType: 'audio' },
      { id: 51, nodeId: 5, name: 'playback', direction: 'input', mediaType: 'audio' },
    ],
    links: [
      { id: 101, outputPortId: 11, inputPortId: 21, active: true, mediaType: 'audio' },
      { id: 102, outputPortId: 22, inputPortId: 31, active: true, mediaType: 'audio' },
      { id: 103, outputPortId: 32, inputPortId: 41, active: true, mediaType: 'audio' },
      { id: 104, outputPortId: 42, inputPortId: 51, active: true, mediaType: 'audio' },
    ],
  };
}

export function stressSnapshot(): GraphSnapshot {
  const nodes: GraphSnapshot['nodes'] = [];
  const ports: GraphSnapshot['ports'] = [];
  const outputs: GraphSnapshot['ports'] = [];
  const inputs: GraphSnapshot['ports'] = [];
  const mediaTypes = ['audio', 'video', 'midi', 'unknown'] as const;
  let portId = 2_000;

  for (let index = 0; index < 50; index += 1) {
    const kind = index < 17 ? 'output' : index < 33 ? 'duplex' : 'input';
    const nodeId = 1_000 + index;
    nodes.push({
      id: nodeId,
      name: `stress-node-${index.toString().padStart(2, '0')}`,
      mediaName:
        index === 0
          ? '2025年 ROG 顶级旗舰 PC 装机攻略与超长应用标题 bilibili'
          : `Stress Node ${index.toString().padStart(2, '0')}`,
      objectName: `stress-node-${index.toString().padStart(2, '0')}`,
      kind,
    });

    for (let offset = 0; offset < 4; offset += 1) {
      const direction =
        kind === 'output' ? 'output' : kind === 'input' ? 'input' : offset < 2 ? 'input' : 'output';
      const port = {
        id: portId++,
        nodeId,
        name:
          index === 0
            ? `${direction}_channel_with_an_intentionally_long_pipewire_port_name_${offset}`
            : `${direction}_${offset}`,
        direction,
        mediaType: mediaTypes[(index + offset) % mediaTypes.length],
      } as const;
      ports.push(port);
      (direction === 'output' ? outputs : inputs).push(port);
    }
  }

  for (let index = 0; index < inputs.length; index += 1) {
    inputs[index] = { ...inputs[index], mediaType: outputs[index].mediaType };
    const portIndex = ports.findIndex((port) => port.id === inputs[index].id);
    ports[portIndex] = inputs[index];
  }

  return {
    status: { state: 'connected', detail: null },
    defaultAudioSinkName: 'stress-node-33',
    defaultAudioSourceName: null,
    nodes,
    ports,
    links: outputs.map((output, index) => ({
      id: 3_000 + index,
      outputPortId: output.id,
      inputPortId: inputs[index].id,
      active: true,
      mediaType: output.mediaType,
    })),
  };
}
