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

export type Unsubscribe = () => void;

export interface GraphBridge {
  subscribe(onEnvelope: (envelope: GraphEnvelope) => void): Promise<Unsubscribe>;
  subscribeOutputLevels(onLevel: (level: OutputLevel) => void): Promise<Unsubscribe>;
  setOutputMetering(enabled: boolean): Promise<void>;
  getGraphSnapshot(): Promise<GraphEnvelope>;
  createLink(request: CreateLinkRequest): Promise<OperationAck>;
  removeLink(request: RemoveLinkRequest): Promise<OperationAck>;
  setDefaultAudioSink(request: SetDefaultAudioSinkRequest): Promise<OperationAck>;
  setDefaultAudioSource(request: SetDefaultAudioSourceRequest): Promise<OperationAck>;
  setOutputVolume(request: SetOutputVolumeRequest): Promise<OperationAck>;
}
