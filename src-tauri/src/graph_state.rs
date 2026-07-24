// Copyright 2026 Cordflow contributors
// SPDX-License-Identifier: GPL-3.0-only

use std::collections::{BTreeMap, HashSet};

use crate::model::{
    ConnectionState, CreateLinkRequest, GraphDelta, GraphEnvelope, GraphPayload, GraphSnapshot,
    GraphStatus, LinkDto, MediaType, NodeDto, OperationErrorCode, OperationFailure, PortDirection,
    PortDto, RemoveLinkRequest, SetDefaultAudioSinkRequest, SetDefaultAudioSourceRequest,
    SetOutputVolumeRequest,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ValidatedLink {
    pub output_node_id: u32,
    pub output_port_id: u32,
    pub input_node_id: u32,
    pub input_port_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedDefaultAudioSink {
    pub node_id: u32,
    pub node_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedDefaultAudioSource {
    pub node_id: u32,
    pub node_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedOutputVolume {
    pub node_id: u32,
    pub channel_count: usize,
    pub volume_percent: Option<u16>,
    pub muted: Option<bool>,
}

#[derive(Debug)]
pub struct GraphState {
    generation: u64,
    sequence: u64,
    status: GraphStatus,
    nodes: BTreeMap<u32, NodeDto>,
    ports: BTreeMap<u32, PortDto>,
    links: BTreeMap<u32, LinkDto>,
    default_audio_sink_name: Option<String>,
    default_audio_source_name: Option<String>,
    operations: HashSet<String>,
}

impl Default for GraphState {
    fn default() -> Self {
        Self {
            generation: 0,
            sequence: 0,
            status: GraphStatus::connecting("Waiting for PipeWire"),
            nodes: BTreeMap::new(),
            ports: BTreeMap::new(),
            links: BTreeMap::new(),
            default_audio_sink_name: None,
            default_audio_source_name: None,
            operations: HashSet::new(),
        }
    }
}

impl GraphState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    #[cfg(test)]
    pub fn status(&self) -> &GraphStatus {
        &self.status
    }

    pub fn snapshot(&self) -> GraphSnapshot {
        GraphSnapshot {
            nodes: self.nodes.values().cloned().collect(),
            ports: self.ports.values().cloned().collect(),
            links: self.links.values().cloned().collect(),
            default_audio_sink_name: self.default_audio_sink_name.clone(),
            default_audio_source_name: self.default_audio_source_name.clone(),
            status: self.status.clone(),
        }
    }

    pub fn snapshot_envelope(&self) -> GraphEnvelope {
        GraphEnvelope {
            generation: self.generation,
            sequence: self.sequence,
            payload: GraphPayload::Snapshot(self.snapshot()),
        }
    }

    pub fn begin_connected_generation(&mut self) -> GraphEnvelope {
        self.generation = self.generation.saturating_add(1);
        self.sequence = 0;
        self.status = GraphStatus::connected();
        self.nodes.clear();
        self.ports.clear();
        self.links.clear();
        self.default_audio_sink_name = None;
        self.default_audio_source_name = None;
        self.operations.clear();
        self.snapshot_envelope()
    }

    pub fn set_status(&mut self, status: GraphStatus) -> Option<GraphEnvelope> {
        if self.status == status {
            return None;
        }

        self.status = status.clone();
        Some(self.next_envelope(GraphPayload::Status(status)))
    }

    pub fn apply_delta(&mut self, delta: GraphDelta) -> GraphEnvelope {
        match &delta {
            GraphDelta::NodeAdded(node) | GraphDelta::NodeUpdated(node) => {
                self.nodes.insert(node.id, node.clone());
            }
            GraphDelta::NodeRemoved { id } => self.remove_node(*id),
            GraphDelta::PortAdded(port) | GraphDelta::PortUpdated(port) => {
                self.ports.insert(port.id, port.clone());
            }
            GraphDelta::PortRemoved { id } => self.remove_port(*id),
            GraphDelta::LinkAdded(link) | GraphDelta::LinkUpdated(link) => {
                self.links.insert(link.id, link.clone());
            }
            GraphDelta::LinkRemoved { id } => {
                self.links.remove(id);
            }
            GraphDelta::DefaultAudioSinkChanged { name } => {
                self.default_audio_sink_name = name.clone();
            }
            GraphDelta::DefaultAudioSourceChanged { name } => {
                self.default_audio_source_name = name.clone();
            }
        }

        self.next_envelope(GraphPayload::Delta(delta))
    }

    pub fn operation_failure(&mut self, failure: OperationFailure) -> GraphEnvelope {
        self.next_envelope(GraphPayload::OperationFailed(failure))
    }

    pub fn node(&self, id: u32) -> Option<&NodeDto> {
        self.nodes.get(&id)
    }

    pub fn port(&self, id: u32) -> Option<&PortDto> {
        self.ports.get(&id)
    }

    pub fn link(&self, id: u32) -> Option<&LinkDto> {
        self.links.get(&id)
    }

    pub fn prepare_create_link(
        &mut self,
        request: &CreateLinkRequest,
    ) -> Result<ValidatedLink, OperationFailure> {
        self.reserve_operation(&request.operation_id)?;
        self.check_generation(request.generation, &request.operation_id)?;

        let output = self.ports.get(&request.output_port_id).ok_or_else(|| {
            OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::ObjectNotFound,
                format!("Output port {} no longer exists", request.output_port_id),
            )
        })?;
        let input = self.ports.get(&request.input_port_id).ok_or_else(|| {
            OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::ObjectNotFound,
                format!("Input port {} no longer exists", request.input_port_id),
            )
        })?;

        if output.direction != PortDirection::Output || input.direction != PortDirection::Input {
            return Err(OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::DirectionMismatch,
                "A link must connect an output port to an input port",
            ));
        }

        if output.media_type != MediaType::Unknown
            && input.media_type != MediaType::Unknown
            && output.media_type != input.media_type
        {
            return Err(OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::MediaTypeMismatch,
                "The selected ports advertise different media types",
            ));
        }

        if self
            .links
            .values()
            .any(|link| link.output_port_id == output.id && link.input_port_id == input.id)
        {
            return Err(OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::LinkAlreadyExists,
                "The selected ports are already connected",
            ));
        }

        Ok(ValidatedLink {
            output_node_id: output.node_id,
            output_port_id: output.id,
            input_node_id: input.node_id,
            input_port_id: input.id,
        })
    }

    pub fn prepare_remove_link(
        &mut self,
        request: &RemoveLinkRequest,
    ) -> Result<u32, OperationFailure> {
        self.reserve_operation(&request.operation_id)?;
        self.check_generation(request.generation, &request.operation_id)?;

        self.links
            .get(&request.link_id)
            .map(|link| link.id)
            .ok_or_else(|| {
                OperationFailure::new(
                    Some(request.operation_id.clone()),
                    OperationErrorCode::ObjectNotFound,
                    format!("Link {} no longer exists", request.link_id),
                )
            })
    }

    pub fn prepare_set_default_audio_sink(
        &mut self,
        request: &SetDefaultAudioSinkRequest,
    ) -> Result<ValidatedDefaultAudioSink, OperationFailure> {
        self.reserve_operation(&request.operation_id)?;
        self.check_generation(request.generation, &request.operation_id)?;

        let node = self.nodes.get(&request.node_id).ok_or_else(|| {
            OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::ObjectNotFound,
                format!("Audio sink node {} no longer exists", request.node_id),
            )
        })?;
        let is_audio_sink = self.ports.values().any(|port| {
            port.node_id == node.id
                && port.direction == PortDirection::Input
                && port.media_type == MediaType::Audio
        });
        let Some(node_name) = node
            .object_name
            .as_deref()
            .filter(|name| !name.trim().is_empty())
        else {
            return Err(OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::InvalidDefaultTarget,
                "The selected node has no stable PipeWire node.name",
            ));
        };
        if !is_audio_sink {
            return Err(OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::InvalidDefaultTarget,
                "The selected node has no compatible audio input port",
            ));
        }

        Ok(ValidatedDefaultAudioSink {
            node_id: node.id,
            node_name: node_name.to_owned(),
        })
    }

    pub fn prepare_set_default_audio_source(
        &mut self,
        request: &SetDefaultAudioSourceRequest,
    ) -> Result<ValidatedDefaultAudioSource, OperationFailure> {
        self.reserve_operation(&request.operation_id)?;
        self.check_generation(request.generation, &request.operation_id)?;

        let node = self.nodes.get(&request.node_id).ok_or_else(|| {
            OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::ObjectNotFound,
                format!("Audio source node {} no longer exists", request.node_id),
            )
        })?;
        let is_audio_source = node
            .media_class
            .as_deref()
            .is_some_and(|class| class == "Audio/Source" || class.starts_with("Audio/Source/"))
            && self.ports.values().any(|port| {
                port.node_id == node.id
                    && port.direction == PortDirection::Output
                    && port.media_type == MediaType::Audio
            });
        let Some(node_name) = node
            .object_name
            .as_deref()
            .filter(|name| !name.trim().is_empty())
        else {
            return Err(OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::InvalidDefaultTarget,
                "The selected node has no stable PipeWire node.name",
            ));
        };
        if !is_audio_source {
            return Err(OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::InvalidDefaultTarget,
                "The selected node is not a PipeWire audio source",
            ));
        }

        Ok(ValidatedDefaultAudioSource {
            node_id: node.id,
            node_name: node_name.to_owned(),
        })
    }

    pub fn prepare_set_output_volume(
        &mut self,
        request: &SetOutputVolumeRequest,
    ) -> Result<ValidatedOutputVolume, OperationFailure> {
        self.reserve_operation(&request.operation_id)?;
        self.check_generation(request.generation, &request.operation_id)?;

        let node = self.nodes.get(&request.node_id).ok_or_else(|| {
            OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::ObjectNotFound,
                format!("Audio sink node {} no longer exists", request.node_id),
            )
        })?;
        let is_audio_sink = node
            .media_class
            .as_deref()
            .is_some_and(|class| class == "Audio/Sink" || class.starts_with("Audio/Sink/"));
        let is_application_output = node.media_class.as_deref().is_some_and(|class| {
            class == "Stream/Output/Audio" || class.starts_with("Stream/Output/Audio/")
        });
        let port_direction = if is_audio_sink {
            PortDirection::Input
        } else {
            PortDirection::Output
        };
        let channel_count = self
            .ports
            .values()
            .filter(|port| {
                port.node_id == node.id
                    && port.direction == port_direction
                    && port.media_type == MediaType::Audio
            })
            .count();
        if (!is_audio_sink && !is_application_output) || channel_count == 0 {
            return Err(OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::InvalidDefaultTarget,
                "The selected node is not a controllable PipeWire audio output",
            ));
        }
        if request.volume_percent.is_none() && request.muted.is_none() {
            return Err(OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::InvalidVolume,
                "A volume or mute change is required",
            ));
        }
        if request.volume_percent.is_some_and(|volume| volume > 150) {
            return Err(OperationFailure::new(
                Some(request.operation_id.clone()),
                OperationErrorCode::InvalidVolume,
                "Output volume must be between 0 and 150 percent",
            ));
        }

        Ok(ValidatedOutputVolume {
            node_id: node.id,
            channel_count,
            volume_percent: request.volume_percent,
            muted: request.muted,
        })
    }

    fn reserve_operation(&mut self, operation_id: &str) -> Result<(), OperationFailure> {
        if operation_id.trim().is_empty() {
            return Err(OperationFailure::new(
                None,
                OperationErrorCode::DuplicateOperation,
                "Operation ID must not be empty",
            ));
        }

        if !self.operations.insert(operation_id.to_owned()) {
            return Err(OperationFailure::new(
                Some(operation_id.to_owned()),
                OperationErrorCode::DuplicateOperation,
                "This operation has already been handled",
            ));
        }

        Ok(())
    }

    fn check_generation(
        &self,
        generation: u64,
        operation_id: &str,
    ) -> Result<(), OperationFailure> {
        if generation != self.generation {
            return Err(OperationFailure::new(
                Some(operation_id.to_owned()),
                OperationErrorCode::StaleGeneration,
                format!(
                    "Graph generation {generation} is stale; current generation is {}",
                    self.generation
                ),
            ));
        }

        if self.status.state != ConnectionState::Connected {
            return Err(OperationFailure::new(
                Some(operation_id.to_owned()),
                OperationErrorCode::BackendUnavailable,
                "PipeWire is not connected",
            ));
        }

        Ok(())
    }

    fn next_envelope(&mut self, payload: GraphPayload) -> GraphEnvelope {
        self.sequence = self.sequence.saturating_add(1);
        GraphEnvelope {
            generation: self.generation,
            sequence: self.sequence,
            payload,
        }
    }

    fn remove_node(&mut self, node_id: u32) {
        self.nodes.remove(&node_id);
        let port_ids: HashSet<u32> = self
            .ports
            .values()
            .filter(|port| port.node_id == node_id)
            .map(|port| port.id)
            .collect();
        self.ports.retain(|id, _| !port_ids.contains(id));
        self.links.retain(|_, link| {
            !port_ids.contains(&link.output_port_id) && !port_ids.contains(&link.input_port_id)
        });
    }

    fn remove_port(&mut self, port_id: u32) {
        self.ports.remove(&port_id);
        self.links
            .retain(|_, link| link.output_port_id != port_id && link.input_port_id != port_id);
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;
    use crate::model::{NodeKind, OperationErrorCode};

    fn node(id: u32) -> NodeDto {
        NodeDto {
            id,
            name: format!("Node {id}"),
            media_name: None,
            application_id: None,
            application_name: None,
            media_class: None,
            object_name: Some(format!("node-{id}")),
            kind: NodeKind::Duplex,
            volume_percent: None,
            muted: None,
        }
    }

    fn port(id: u32, node_id: u32, direction: PortDirection, media_type: MediaType) -> PortDto {
        PortDto {
            id,
            node_id,
            name: format!("Port {id}"),
            channel: None,
            direction,
            media_type,
        }
    }

    fn link(id: u32, output_port_id: u32, input_port_id: u32) -> LinkDto {
        LinkDto {
            id,
            output_port_id,
            input_port_id,
            active: true,
            media_type: MediaType::Audio,
        }
    }

    fn connected_state() -> GraphState {
        let mut state = GraphState::new();
        state.begin_connected_generation();
        state.apply_delta(GraphDelta::NodeAdded(node(1)));
        state.apply_delta(GraphDelta::NodeAdded(node(2)));
        state.apply_delta(GraphDelta::PortAdded(port(
            10,
            1,
            PortDirection::Output,
            MediaType::Audio,
        )));
        state.apply_delta(GraphDelta::PortAdded(port(
            20,
            2,
            PortDirection::Input,
            MediaType::Audio,
        )));
        state
    }

    #[test]
    fn generation_resets_graph_and_sequence() {
        let mut state = connected_state();
        assert_eq!(state.snapshot().nodes.len(), 2);

        let envelope = state.begin_connected_generation();

        assert_eq!(envelope.generation, 2);
        assert_eq!(envelope.sequence, 0);
        assert!(state.snapshot().nodes.is_empty());
        assert_eq!(state.status().state, ConnectionState::Connected);
    }

    #[test]
    fn delta_sequences_are_strictly_increasing() {
        let mut state = GraphState::new();
        let initial = state.begin_connected_generation();
        let first = state.apply_delta(GraphDelta::NodeAdded(node(1)));
        let second = state.apply_delta(GraphDelta::NodeUpdated(node(1)));

        assert_eq!(
            (initial.sequence, first.sequence, second.sequence),
            (0, 1, 2)
        );
    }

    #[test]
    fn removing_a_node_cascades_ports_and_links() {
        let mut state = connected_state();
        state.apply_delta(GraphDelta::LinkAdded(link(30, 10, 20)));

        state.apply_delta(GraphDelta::NodeRemoved { id: 1 });

        assert!(state.node(1).is_none());
        assert!(state.port(10).is_none());
        assert!(state.link(30).is_none());
        assert!(state.port(20).is_some());
    }

    #[test]
    fn validates_direction_and_media_type() {
        let mut state = connected_state();
        let reversed = CreateLinkRequest {
            operation_id: "reversed".into(),
            generation: 1,
            output_port_id: 20,
            input_port_id: 10,
        };
        assert_eq!(
            state.prepare_create_link(&reversed).unwrap_err().code,
            OperationErrorCode::DirectionMismatch
        );

        state.apply_delta(GraphDelta::PortUpdated(port(
            20,
            2,
            PortDirection::Input,
            MediaType::Video,
        )));
        let mismatched = CreateLinkRequest {
            operation_id: "mismatch".into(),
            generation: 1,
            output_port_id: 10,
            input_port_id: 20,
        };
        assert_eq!(
            state.prepare_create_link(&mismatched).unwrap_err().code,
            OperationErrorCode::MediaTypeMismatch
        );
    }

    #[test]
    fn unknown_media_type_is_left_to_pipewire() {
        let mut state = connected_state();
        state.apply_delta(GraphDelta::PortUpdated(port(
            20,
            2,
            PortDirection::Input,
            MediaType::Unknown,
        )));
        let request = CreateLinkRequest {
            operation_id: "unknown-compatible".into(),
            generation: 1,
            output_port_id: 10,
            input_port_id: 20,
        };

        assert!(state.prepare_create_link(&request).is_ok());
    }

    #[test]
    fn rejects_existing_links_and_duplicate_operations() {
        let mut state = connected_state();
        state.apply_delta(GraphDelta::LinkAdded(link(30, 10, 20)));
        let request = CreateLinkRequest {
            operation_id: "create-one".into(),
            generation: 1,
            output_port_id: 10,
            input_port_id: 20,
        };

        assert_eq!(
            state.prepare_create_link(&request).unwrap_err().code,
            OperationErrorCode::LinkAlreadyExists
        );
        assert_eq!(
            state.prepare_create_link(&request).unwrap_err().code,
            OperationErrorCode::DuplicateOperation
        );
    }

    #[test]
    fn stale_generation_and_missing_remove_are_mapped() {
        let mut state = connected_state();
        let stale = RemoveLinkRequest {
            operation_id: "stale".into(),
            generation: 0,
            link_id: 99,
        };
        assert_eq!(
            state.prepare_remove_link(&stale).unwrap_err().code,
            OperationErrorCode::StaleGeneration
        );

        let missing = RemoveLinkRequest {
            operation_id: "missing".into(),
            generation: 1,
            link_id: 99,
        };
        assert_eq!(
            state.prepare_remove_link(&missing).unwrap_err().code,
            OperationErrorCode::ObjectNotFound
        );
    }

    #[test]
    fn validates_and_tracks_the_default_audio_sink() {
        let mut state = connected_state();
        let request = SetDefaultAudioSinkRequest {
            operation_id: "default-sink".into(),
            generation: 1,
            node_id: 2,
        };

        assert_eq!(
            state.prepare_set_default_audio_sink(&request).unwrap(),
            ValidatedDefaultAudioSink {
                node_id: 2,
                node_name: "node-2".into(),
            }
        );
        state.apply_delta(GraphDelta::DefaultAudioSinkChanged {
            name: Some("node-2".into()),
        });
        assert_eq!(
            state.snapshot().default_audio_sink_name.as_deref(),
            Some("node-2")
        );
    }

    #[test]
    fn rejects_a_node_without_an_audio_input_as_the_default_sink() {
        let mut state = connected_state();
        let request = SetDefaultAudioSinkRequest {
            operation_id: "source-as-default".into(),
            generation: 1,
            node_id: 1,
        };

        assert_eq!(
            state
                .prepare_set_default_audio_sink(&request)
                .unwrap_err()
                .code,
            OperationErrorCode::InvalidDefaultTarget
        );
    }

    #[test]
    fn validates_and_tracks_the_default_audio_source() {
        let mut state = connected_state();
        let mut source = state.node(1).unwrap().clone();
        source.media_class = Some("Audio/Source".into());
        state.apply_delta(GraphDelta::NodeUpdated(source));
        let request = SetDefaultAudioSourceRequest {
            operation_id: "default-source".into(),
            generation: 1,
            node_id: 1,
        };

        assert_eq!(
            state.prepare_set_default_audio_source(&request).unwrap(),
            ValidatedDefaultAudioSource {
                node_id: 1,
                node_name: "node-1".into(),
            }
        );
        state.apply_delta(GraphDelta::DefaultAudioSourceChanged {
            name: Some("node-1".into()),
        });
        assert_eq!(
            state.snapshot().default_audio_source_name.as_deref(),
            Some("node-1")
        );
    }

    #[test]
    fn rejects_an_application_stream_as_the_default_audio_source() {
        let mut state = connected_state();
        let request = SetDefaultAudioSourceRequest {
            operation_id: "stream-as-default".into(),
            generation: 1,
            node_id: 1,
        };

        assert_eq!(
            state
                .prepare_set_default_audio_source(&request)
                .unwrap_err()
                .code,
            OperationErrorCode::InvalidDefaultTarget
        );
    }

    #[test]
    fn validates_output_volume_updates() {
        let mut state = connected_state();
        let mut sink = state.node(2).unwrap().clone();
        sink.media_class = Some("Audio/Sink".into());
        state.apply_delta(GraphDelta::NodeUpdated(sink));
        let request = SetOutputVolumeRequest {
            operation_id: "volume".into(),
            generation: 1,
            node_id: 2,
            volume_percent: Some(85),
            muted: Some(false),
        };

        assert_eq!(
            state.prepare_set_output_volume(&request).unwrap(),
            ValidatedOutputVolume {
                node_id: 2,
                channel_count: 1,
                volume_percent: Some(85),
                muted: Some(false),
            }
        );
    }

    #[test]
    fn validates_application_stream_volume_updates() {
        let mut state = connected_state();
        let mut application = state.node(1).unwrap().clone();
        application.media_class = Some("Stream/Output/Audio".into());
        application.application_id = Some("org.mozilla.firefox".into());
        state.apply_delta(GraphDelta::NodeUpdated(application));
        let request = SetOutputVolumeRequest {
            operation_id: "application-volume".into(),
            generation: 1,
            node_id: 1,
            volume_percent: Some(35),
            muted: Some(true),
        };

        assert_eq!(
            state.prepare_set_output_volume(&request).unwrap(),
            ValidatedOutputVolume {
                node_id: 1,
                channel_count: 1,
                volume_percent: Some(35),
                muted: Some(true),
            }
        );
    }

    #[test]
    fn rejects_out_of_range_output_volume() {
        let mut state = connected_state();
        let mut sink = state.node(2).unwrap().clone();
        sink.media_class = Some("Audio/Sink".into());
        state.apply_delta(GraphDelta::NodeUpdated(sink));
        let request = SetOutputVolumeRequest {
            operation_id: "too-loud".into(),
            generation: 1,
            node_id: 2,
            volume_percent: Some(151),
            muted: None,
        };

        assert_eq!(
            state.prepare_set_output_volume(&request).unwrap_err().code,
            OperationErrorCode::InvalidVolume
        );
    }

    #[test]
    fn disappearing_create_endpoint_is_mapped_to_object_not_found() {
        let mut state = connected_state();
        state.apply_delta(GraphDelta::PortRemoved { id: 20 });
        let request = CreateLinkRequest {
            operation_id: "endpoint-disappeared".into(),
            generation: 1,
            output_port_id: 10,
            input_port_id: 20,
        };

        assert_eq!(
            state.prepare_create_link(&request).unwrap_err().code,
            OperationErrorCode::ObjectNotFound
        );
    }

    #[test]
    fn disconnected_state_rejects_operations_as_backend_unavailable() {
        let mut state = connected_state();
        state.set_status(GraphStatus::disconnected("daemon stopped"));
        let request = CreateLinkRequest {
            operation_id: "while-offline".into(),
            generation: 1,
            output_port_id: 10,
            input_port_id: 20,
        };

        assert_eq!(
            state.prepare_create_link(&request).unwrap_err().code,
            OperationErrorCode::BackendUnavailable
        );
    }

    #[test]
    fn reconnect_clears_operation_ids_for_the_new_generation() {
        let mut state = connected_state();
        let request = CreateLinkRequest {
            operation_id: "reusable-after-reconnect".into(),
            generation: 1,
            output_port_id: 10,
            input_port_id: 20,
        };
        assert!(state.prepare_create_link(&request).is_ok());

        state.begin_connected_generation();
        state.apply_delta(GraphDelta::NodeAdded(node(1)));
        state.apply_delta(GraphDelta::NodeAdded(node(2)));
        state.apply_delta(GraphDelta::PortAdded(port(
            10,
            1,
            PortDirection::Output,
            MediaType::Audio,
        )));
        state.apply_delta(GraphDelta::PortAdded(port(
            20,
            2,
            PortDirection::Input,
            MediaType::Audio,
        )));
        let retried = CreateLinkRequest {
            generation: 2,
            ..request
        };

        assert!(state.prepare_create_link(&retried).is_ok());
    }
}
