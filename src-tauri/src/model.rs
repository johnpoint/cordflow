// Copyright 2026 Cordflow contributors
// SPDX-License-Identifier: GPL-3.0-only

use serde::{Deserialize, Serialize};
use ts_rs::{Config, TS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum NodeKind {
    Input,
    Output,
    Duplex,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum PortDirection {
    Input,
    Output,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum MediaType {
    Audio,
    Video,
    Midi,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum ConnectionState {
    Connecting,
    Connected,
    Disconnected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GraphStatus {
    pub state: ConnectionState,
    pub detail: Option<String>,
}

impl GraphStatus {
    pub fn connecting(detail: impl Into<String>) -> Self {
        Self {
            state: ConnectionState::Connecting,
            detail: Some(detail.into()),
        }
    }

    pub fn connected() -> Self {
        Self {
            state: ConnectionState::Connected,
            detail: None,
        }
    }

    pub fn disconnected(detail: impl Into<String>) -> Self {
        Self {
            state: ConnectionState::Disconnected,
            detail: Some(detail.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct NodeDto {
    pub id: u32,
    pub name: String,
    pub media_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub application_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub application_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub media_class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub object_name: Option<String>,
    pub kind: NodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub volume_percent: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub muted: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PortDto {
    pub id: u32,
    pub node_id: u32,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub channel: Option<String>,
    pub direction: PortDirection,
    pub media_type: MediaType,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct LinkDto {
    pub id: u32,
    pub output_port_id: u32,
    pub input_port_id: u32,
    pub active: bool,
    pub media_type: MediaType,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GraphSnapshot {
    pub nodes: Vec<NodeDto>,
    pub ports: Vec<PortDto>,
    pub links: Vec<LinkDto>,
    pub default_audio_sink_name: Option<String>,
    pub default_audio_source_name: Option<String>,
    pub status: GraphStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
#[ts(tag = "type", content = "data", rename_all = "camelCase")]
pub enum GraphDelta {
    NodeAdded(NodeDto),
    NodeUpdated(NodeDto),
    NodeRemoved { id: u32 },
    PortAdded(PortDto),
    PortUpdated(PortDto),
    PortRemoved { id: u32 },
    LinkAdded(LinkDto),
    LinkUpdated(LinkDto),
    LinkRemoved { id: u32 },
    DefaultAudioSinkChanged { name: Option<String> },
    DefaultAudioSourceChanged { name: Option<String> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum OperationErrorCode {
    StaleGeneration,
    ObjectNotFound,
    DirectionMismatch,
    MediaTypeMismatch,
    LinkAlreadyExists,
    InvalidDefaultTarget,
    InvalidVolume,
    DuplicateOperation,
    BackendUnavailable,
    BackendRejected,
    Timeout,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct OperationFailure {
    pub operation_id: Option<String>,
    pub code: OperationErrorCode,
    pub message: String,
}

impl OperationFailure {
    pub fn new(
        operation_id: Option<String>,
        code: OperationErrorCode,
        message: impl Into<String>,
    ) -> Self {
        Self {
            operation_id,
            code,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
#[ts(tag = "type", content = "data", rename_all = "camelCase")]
pub enum GraphPayload {
    Snapshot(GraphSnapshot),
    Delta(GraphDelta),
    Status(GraphStatus),
    OperationFailed(OperationFailure),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GraphEnvelope {
    #[ts(type = "number")]
    pub generation: u64,
    #[ts(type = "number")]
    pub sequence: u64,
    pub payload: GraphPayload,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct OutputLevel {
    pub node_id: u32,
    pub peak: f32,
    #[ts(type = "number[]")]
    pub spectrum: [f32; 32],
    #[ts(type = "number[]")]
    pub left_spectrum: [f32; 32],
    #[ts(type = "number[]")]
    pub right_spectrum: [f32; 32],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CreateLinkRequest {
    pub operation_id: String,
    #[ts(type = "number")]
    pub generation: u64,
    pub output_port_id: u32,
    pub input_port_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RemoveLinkRequest {
    pub operation_id: String,
    #[ts(type = "number")]
    pub generation: u64,
    pub link_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SetDefaultAudioSinkRequest {
    pub operation_id: String,
    #[ts(type = "number")]
    pub generation: u64,
    pub node_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SetDefaultAudioSourceRequest {
    pub operation_id: String,
    #[ts(type = "number")]
    pub generation: u64,
    pub node_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SetOutputVolumeRequest {
    pub operation_id: String,
    #[ts(type = "number")]
    pub generation: u64,
    pub node_id: u32,
    pub volume_percent: Option<u16>,
    pub muted: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct OperationAck {
    pub operation_id: String,
    #[ts(type = "number")]
    pub generation: u64,
}

pub fn typescript_contract() -> String {
    let config = Config::default();
    let declarations = [
        NodeKind::decl(&config),
        PortDirection::decl(&config),
        MediaType::decl(&config),
        ConnectionState::decl(&config),
        GraphStatus::decl(&config),
        NodeDto::decl(&config),
        PortDto::decl(&config),
        LinkDto::decl(&config),
        GraphSnapshot::decl(&config),
        GraphDelta::decl(&config),
        OperationErrorCode::decl(&config),
        OperationFailure::decl(&config),
        GraphPayload::decl(&config),
        GraphEnvelope::decl(&config),
        OutputLevel::decl(&config),
        CreateLinkRequest::decl(&config),
        RemoveLinkRequest::decl(&config),
        SetDefaultAudioSinkRequest::decl(&config),
        SetDefaultAudioSourceRequest::decl(&config),
        SetOutputVolumeRequest::decl(&config),
        OperationAck::decl(&config),
    ]
    .into_iter()
    .map(|declaration| format!("export {declaration}"))
    .collect::<Vec<_>>()
    .join("\n\n");

    format!(
        "// This file is generated from src-tauri/src/model.rs via ts-rs.\n\
         // Do not edit it by hand.\n\n{declarations}\n"
    )
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use super::typescript_contract;

    #[test]
    fn typescript_contract_is_current() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/generated/graph.ts");
        let committed = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
        let expected = typescript_contract();

        assert_eq!(
            committed.replace("\r\n", "\n"),
            expected,
            "generated TypeScript contract drifted; run pnpm types:generate"
        );
    }
}
