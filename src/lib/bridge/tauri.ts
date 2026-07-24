import { Channel, invoke } from '@tauri-apps/api/core';
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
import type { GraphBridge, Unsubscribe } from './types';

export class TauriGraphBridge implements GraphBridge {
  async subscribe(onEnvelope: (envelope: GraphEnvelope) => void): Promise<Unsubscribe> {
    const channel = new Channel<GraphEnvelope>();
    let active = true;
    channel.onmessage = (envelope) => {
      if (active) onEnvelope(envelope);
    };
    await invoke<void>('subscribe_graph', { channel });
    return () => {
      active = false;
    };
  }

  async subscribeOutputLevels(onLevel: (level: OutputLevel) => void): Promise<Unsubscribe> {
    const channel = new Channel<OutputLevel>();
    let active = true;
    channel.onmessage = (level) => {
      if (active) onLevel(level);
    };
    await invoke<void>('subscribe_output_levels', { channel });
    return () => {
      active = false;
    };
  }

  setOutputMetering(enabled: boolean): Promise<void> {
    return invoke<void>('set_output_metering', { enabled });
  }

  getGraphSnapshot(): Promise<GraphEnvelope> {
    return invoke<GraphEnvelope>('get_graph_snapshot');
  }

  createLink(request: CreateLinkRequest): Promise<OperationAck> {
    return invoke<OperationAck>('create_link', { request });
  }

  removeLink(request: RemoveLinkRequest): Promise<OperationAck> {
    return invoke<OperationAck>('remove_link', { request });
  }

  setDefaultAudioSink(request: SetDefaultAudioSinkRequest): Promise<OperationAck> {
    return invoke<OperationAck>('set_default_audio_sink', { request });
  }

  setDefaultAudioSource(request: SetDefaultAudioSourceRequest): Promise<OperationAck> {
    return invoke<OperationAck>('set_default_audio_source', { request });
  }

  setOutputVolume(request: SetOutputVolumeRequest): Promise<OperationAck> {
    return invoke<OperationAck>('set_output_volume', { request });
  }
}
