// This file is generated from src-tauri/src/model.rs via ts-rs.
// Do not edit it by hand.

export type NodeKind = "input" | "output" | "duplex" | "unknown";

export type PortDirection = "input" | "output";

export type MediaType = "audio" | "video" | "midi" | "unknown";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export type GraphStatus = { state: ConnectionState, detail: string | null, };

export type NodeDto = { id: number, name: string, mediaName: string | null, applicationId?: string, applicationName?: string, mediaClass?: string, objectName?: string, kind: NodeKind, volumePercent?: number, muted?: boolean, };

export type PortDto = { id: number, nodeId: number, name: string, channel?: string, direction: PortDirection, mediaType: MediaType, };

export type LinkDto = { id: number, outputPortId: number, inputPortId: number, active: boolean, mediaType: MediaType, };

export type GraphSnapshot = { nodes: Array<NodeDto>, ports: Array<PortDto>, links: Array<LinkDto>, defaultAudioSinkName: string | null, defaultAudioSourceName: string | null, status: GraphStatus, };

export type GraphDelta = { "type": "nodeAdded", "data": NodeDto } | { "type": "nodeUpdated", "data": NodeDto } | { "type": "nodeRemoved", "data": { id: number, } } | { "type": "portAdded", "data": PortDto } | { "type": "portUpdated", "data": PortDto } | { "type": "portRemoved", "data": { id: number, } } | { "type": "linkAdded", "data": LinkDto } | { "type": "linkUpdated", "data": LinkDto } | { "type": "linkRemoved", "data": { id: number, } } | { "type": "defaultAudioSinkChanged", "data": { name: string | null, } } | { "type": "defaultAudioSourceChanged", "data": { name: string | null, } };

export type OperationErrorCode = "staleGeneration" | "objectNotFound" | "directionMismatch" | "mediaTypeMismatch" | "linkAlreadyExists" | "invalidDefaultTarget" | "invalidVolume" | "duplicateOperation" | "backendUnavailable" | "backendRejected" | "timeout";

export type OperationFailure = { operationId: string | null, code: OperationErrorCode, message: string, };

export type GraphPayload = { "type": "snapshot", "data": GraphSnapshot } | { "type": "delta", "data": GraphDelta } | { "type": "status", "data": GraphStatus } | { "type": "operationFailed", "data": OperationFailure };

export type GraphEnvelope = { generation: number, sequence: number, payload: GraphPayload, };

export type OutputLevel = { nodeId: number, peak: number, spectrum: number[], leftSpectrum: number[], rightSpectrum: number[], };

export type CreateLinkRequest = { operationId: string, generation: number, outputPortId: number, inputPortId: number, };

export type RemoveLinkRequest = { operationId: string, generation: number, linkId: number, };

export type SetDefaultAudioSinkRequest = { operationId: string, generation: number, nodeId: number, };

export type SetDefaultAudioSourceRequest = { operationId: string, generation: number, nodeId: number, };

export type SetOutputVolumeRequest = { operationId: string, generation: number, nodeId: number, volumePercent: number | null, muted: boolean | null, };

export type OperationAck = { operationId: string, generation: number, };
