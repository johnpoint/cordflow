// Copyright 2026 Cordflow contributors
// SPDX-License-Identifier: GPL-3.0-only

mod items;
mod pipewire;

use std::{
    sync::mpsc::{self, SyncSender},
    time::Duration,
};

use crate::{
    graph_state::{
        GraphState, ValidatedDefaultAudioSink, ValidatedDefaultAudioSource, ValidatedLink,
        ValidatedOutputVolume,
    },
    model::{
        CreateLinkRequest, GraphDelta, GraphEnvelope, GraphStatus, OperationAck,
        OperationErrorCode, OperationFailure, OutputLevel, RemoveLinkRequest,
        SetDefaultAudioSinkRequest, SetDefaultAudioSourceRequest, SetOutputVolumeRequest,
    },
};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(2);

type EnvelopeSink = Box<dyn Fn(&GraphEnvelope) -> bool + Send + 'static>;
type OutputLevelSink = Box<dyn Fn(&OutputLevel) -> bool + Send + 'static>;
type Reply<T> = SyncSender<Result<T, OperationFailure>>;

pub enum EngineRequest {
    Subscribe {
        sink: EnvelopeSink,
        reply: Reply<()>,
    },
    SubscribeOutputLevels {
        sink: OutputLevelSink,
        reply: Reply<()>,
    },
    SetOutputMetering {
        enabled: bool,
        reply: Reply<()>,
    },
    Snapshot {
        reply: Reply<GraphEnvelope>,
    },
    CreateLink {
        request: CreateLinkRequest,
        reply: Reply<OperationAck>,
    },
    RemoveLink {
        request: RemoveLinkRequest,
        reply: Reply<OperationAck>,
    },
    SetDefaultAudioSink {
        request: SetDefaultAudioSinkRequest,
        reply: Reply<OperationAck>,
    },
    SetDefaultAudioSource {
        request: SetDefaultAudioSourceRequest,
        reply: Reply<OperationAck>,
    },
    SetOutputVolume {
        request: SetOutputVolumeRequest,
        reply: Reply<OperationAck>,
    },
    Terminate,
}

pub trait PipeWireAdapter {
    fn create_link(&self, link: ValidatedLink) -> Result<(), String>;
    fn remove_link(&self, link_id: u32) -> Result<(), String>;
    fn set_default_audio_sink(&self, sink: ValidatedDefaultAudioSink) -> Result<(), String>;
    fn set_default_audio_source(&self, source: ValidatedDefaultAudioSource) -> Result<(), String>;
    fn set_output_volume(&self, volume: ValidatedOutputVolume) -> Result<(), String>;
    fn set_output_metering(&self, enabled: bool);
}

pub struct EngineCore {
    state: GraphState,
    subscribers: Vec<EnvelopeSink>,
    output_level_subscribers: Vec<OutputLevelSink>,
    output_metering_enabled: bool,
}

impl Default for EngineCore {
    fn default() -> Self {
        Self {
            state: GraphState::new(),
            subscribers: Vec::new(),
            output_level_subscribers: Vec::new(),
            output_metering_enabled: false,
        }
    }
}

impl EngineCore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&mut self, sink: EnvelopeSink) {
        let snapshot = self.state.snapshot_envelope();
        if sink(&snapshot) {
            self.subscribers.push(sink);
        }
    }

    pub fn subscribe_output_levels(&mut self, sink: OutputLevelSink) {
        self.output_level_subscribers.push(sink);
    }

    pub fn output_metering_enabled(&self) -> bool {
        self.output_metering_enabled
    }

    pub fn publish_output_level(&mut self, level: OutputLevel) {
        self.output_level_subscribers.retain(|sink| sink(&level));
    }

    pub fn snapshot(&self) -> GraphEnvelope {
        self.state.snapshot_envelope()
    }

    pub fn begin_connected_generation(&mut self) {
        let envelope = self.state.begin_connected_generation();
        self.publish(envelope);
    }

    pub fn set_status(&mut self, status: GraphStatus) {
        if let Some(envelope) = self.state.set_status(status) {
            self.publish(envelope);
        }
    }

    pub fn apply_delta(&mut self, delta: GraphDelta) {
        let envelope = self.state.apply_delta(delta);
        self.publish(envelope);
    }

    pub fn node(&self, id: u32) -> Option<&crate::model::NodeDto> {
        self.state.node(id)
    }

    pub fn port(&self, id: u32) -> Option<&crate::model::PortDto> {
        self.state.port(id)
    }

    pub fn link(&self, id: u32) -> Option<&crate::model::LinkDto> {
        self.state.link(id)
    }

    pub fn handle_request<A: PipeWireAdapter>(
        &mut self,
        request: EngineRequest,
        adapter: &A,
    ) -> bool {
        match request {
            EngineRequest::Subscribe { sink, reply } => {
                self.subscribe(sink);
                let _ = reply.send(Ok(()));
            }
            EngineRequest::SubscribeOutputLevels { sink, reply } => {
                self.subscribe_output_levels(sink);
                let _ = reply.send(Ok(()));
            }
            EngineRequest::SetOutputMetering { enabled, reply } => {
                self.output_metering_enabled = enabled;
                adapter.set_output_metering(enabled);
                let _ = reply.send(Ok(()));
            }
            EngineRequest::Snapshot { reply } => {
                let _ = reply.send(Ok(self.snapshot()));
            }
            EngineRequest::CreateLink { request, reply } => {
                let operation_id = request.operation_id.clone();
                let result = self
                    .state
                    .prepare_create_link(&request)
                    .and_then(|link| {
                        adapter.create_link(link).map_err(|message| {
                            OperationFailure::new(
                                Some(operation_id.clone()),
                                OperationErrorCode::BackendRejected,
                                message,
                            )
                        })
                    })
                    .map(|()| OperationAck {
                        operation_id,
                        generation: self.state.generation(),
                    });
                self.reply_with_failure_event(reply, result);
            }
            EngineRequest::RemoveLink { request, reply } => {
                let operation_id = request.operation_id.clone();
                let result = self
                    .state
                    .prepare_remove_link(&request)
                    .and_then(|link_id| {
                        adapter.remove_link(link_id).map_err(|message| {
                            OperationFailure::new(
                                Some(operation_id.clone()),
                                OperationErrorCode::BackendRejected,
                                message,
                            )
                        })
                    })
                    .map(|()| OperationAck {
                        operation_id,
                        generation: self.state.generation(),
                    });
                self.reply_with_failure_event(reply, result);
            }
            EngineRequest::SetDefaultAudioSink { request, reply } => {
                let operation_id = request.operation_id.clone();
                let result = self
                    .state
                    .prepare_set_default_audio_sink(&request)
                    .and_then(|sink| {
                        adapter.set_default_audio_sink(sink).map_err(|message| {
                            OperationFailure::new(
                                Some(operation_id.clone()),
                                OperationErrorCode::BackendRejected,
                                message,
                            )
                        })
                    })
                    .map(|()| OperationAck {
                        operation_id,
                        generation: self.state.generation(),
                    });
                self.reply_with_failure_event(reply, result);
            }
            EngineRequest::SetDefaultAudioSource { request, reply } => {
                let operation_id = request.operation_id.clone();
                let result = self
                    .state
                    .prepare_set_default_audio_source(&request)
                    .and_then(|source| {
                        adapter.set_default_audio_source(source).map_err(|message| {
                            OperationFailure::new(
                                Some(operation_id.clone()),
                                OperationErrorCode::BackendRejected,
                                message,
                            )
                        })
                    })
                    .map(|()| OperationAck {
                        operation_id,
                        generation: self.state.generation(),
                    });
                self.reply_with_failure_event(reply, result);
            }
            EngineRequest::SetOutputVolume { request, reply } => {
                let operation_id = request.operation_id.clone();
                let result = self
                    .state
                    .prepare_set_output_volume(&request)
                    .and_then(|volume| {
                        adapter.set_output_volume(volume).map_err(|message| {
                            OperationFailure::new(
                                Some(operation_id.clone()),
                                OperationErrorCode::BackendRejected,
                                message,
                            )
                        })
                    })
                    .map(|()| OperationAck {
                        operation_id,
                        generation: self.state.generation(),
                    });
                self.reply_with_failure_event(reply, result);
            }
            EngineRequest::Terminate => return true,
        }

        false
    }

    fn reply_with_failure_event<T>(
        &mut self,
        reply: Reply<T>,
        result: Result<T, OperationFailure>,
    ) {
        if let Err(failure) = &result {
            let envelope = self.state.operation_failure(failure.clone());
            self.publish(envelope);
        }
        let _ = reply.send(result);
    }

    fn publish(&mut self, envelope: GraphEnvelope) {
        self.subscribers.retain(|sink| sink(&envelope));
    }
}

#[derive(Clone)]
pub struct PipeWireEngine {
    sender: ::pipewire::channel::Sender<EngineRequest>,
}

impl PipeWireEngine {
    pub fn spawn() -> Self {
        let (sender, receiver) = ::pipewire::channel::channel();
        std::thread::Builder::new()
            .name("cordflow-pipewire".to_owned())
            .spawn(move || pipewire::thread_main(receiver))
            .expect("failed to start PipeWire engine thread");
        Self { sender }
    }

    pub fn subscribe<F>(&self, sink: F) -> Result<(), OperationFailure>
    where
        F: Fn(&GraphEnvelope) -> bool + Send + 'static,
    {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.send(EngineRequest::Subscribe {
            sink: Box::new(sink),
            reply,
        })?;
        Self::receive(receiver, None)
    }

    pub fn snapshot(&self) -> Result<GraphEnvelope, OperationFailure> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.send(EngineRequest::Snapshot { reply })?;
        Self::receive(receiver, None)
    }

    pub fn subscribe_output_levels<F>(&self, sink: F) -> Result<(), OperationFailure>
    where
        F: Fn(&OutputLevel) -> bool + Send + 'static,
    {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.send(EngineRequest::SubscribeOutputLevels {
            sink: Box::new(sink),
            reply,
        })?;
        Self::receive(receiver, None)
    }

    pub fn set_output_metering(&self, enabled: bool) -> Result<(), OperationFailure> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.send(EngineRequest::SetOutputMetering { enabled, reply })?;
        Self::receive(receiver, None)
    }

    pub fn create_link(
        &self,
        request: CreateLinkRequest,
    ) -> Result<OperationAck, OperationFailure> {
        let operation_id = Some(request.operation_id.clone());
        let (reply, receiver) = mpsc::sync_channel(1);
        self.send(EngineRequest::CreateLink { request, reply })?;
        Self::receive(receiver, operation_id)
    }

    pub fn remove_link(
        &self,
        request: RemoveLinkRequest,
    ) -> Result<OperationAck, OperationFailure> {
        let operation_id = Some(request.operation_id.clone());
        let (reply, receiver) = mpsc::sync_channel(1);
        self.send(EngineRequest::RemoveLink { request, reply })?;
        Self::receive(receiver, operation_id)
    }

    pub fn set_default_audio_sink(
        &self,
        request: SetDefaultAudioSinkRequest,
    ) -> Result<OperationAck, OperationFailure> {
        let operation_id = Some(request.operation_id.clone());
        let (reply, receiver) = mpsc::sync_channel(1);
        self.send(EngineRequest::SetDefaultAudioSink { request, reply })?;
        Self::receive(receiver, operation_id)
    }

    pub fn set_default_audio_source(
        &self,
        request: SetDefaultAudioSourceRequest,
    ) -> Result<OperationAck, OperationFailure> {
        let operation_id = Some(request.operation_id.clone());
        let (reply, receiver) = mpsc::sync_channel(1);
        self.send(EngineRequest::SetDefaultAudioSource { request, reply })?;
        Self::receive(receiver, operation_id)
    }

    pub fn set_output_volume(
        &self,
        request: SetOutputVolumeRequest,
    ) -> Result<OperationAck, OperationFailure> {
        let operation_id = Some(request.operation_id.clone());
        let (reply, receiver) = mpsc::sync_channel(1);
        self.send(EngineRequest::SetOutputVolume { request, reply })?;
        Self::receive(receiver, operation_id)
    }

    pub fn terminate(&self) {
        let _ = self.sender.send(EngineRequest::Terminate);
    }

    fn send(&self, request: EngineRequest) -> Result<(), OperationFailure> {
        self.sender.send(request).map_err(|_| {
            OperationFailure::new(
                None,
                OperationErrorCode::BackendUnavailable,
                "PipeWire engine is unavailable",
            )
        })
    }

    fn receive<T>(
        receiver: mpsc::Receiver<Result<T, OperationFailure>>,
        operation_id: Option<String>,
    ) -> Result<T, OperationFailure> {
        receiver.recv_timeout(COMMAND_TIMEOUT).map_err(|error| {
            OperationFailure::new(
                operation_id,
                OperationErrorCode::Timeout,
                format!("PipeWire engine did not respond in time: {error}"),
            )
        })?
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        process::Command,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
        thread,
        time::Instant,
    };

    use super::*;
    use crate::model::{
        ConnectionState, GraphDelta, GraphPayload, GraphSnapshot, LinkDto, MediaType, NodeDto,
        NodeKind, PortDirection, PortDto,
    };

    #[derive(Default)]
    struct MockAdapter {
        created: Arc<Mutex<Vec<ValidatedLink>>>,
        removed: Arc<Mutex<Vec<u32>>>,
        default_sinks: Arc<Mutex<Vec<ValidatedDefaultAudioSink>>>,
        default_sources: Arc<Mutex<Vec<ValidatedDefaultAudioSource>>>,
        output_volumes: Arc<Mutex<Vec<ValidatedOutputVolume>>>,
        reject: bool,
    }

    impl PipeWireAdapter for MockAdapter {
        fn create_link(&self, link: ValidatedLink) -> Result<(), String> {
            if self.reject {
                return Err("mock create rejection".to_owned());
            }
            self.created.lock().unwrap().push(link);
            Ok(())
        }

        fn remove_link(&self, link_id: u32) -> Result<(), String> {
            self.removed.lock().unwrap().push(link_id);
            Ok(())
        }

        fn set_default_audio_sink(&self, sink: ValidatedDefaultAudioSink) -> Result<(), String> {
            if self.reject {
                return Err("mock default sink rejection".to_owned());
            }
            self.default_sinks.lock().unwrap().push(sink);
            Ok(())
        }

        fn set_default_audio_source(
            &self,
            source: ValidatedDefaultAudioSource,
        ) -> Result<(), String> {
            if self.reject {
                return Err("mock default source rejection".to_owned());
            }
            self.default_sources.lock().unwrap().push(source);
            Ok(())
        }

        fn set_output_volume(&self, volume: ValidatedOutputVolume) -> Result<(), String> {
            if self.reject {
                return Err("mock volume rejection".to_owned());
            }
            self.output_volumes.lock().unwrap().push(volume);
            Ok(())
        }

        fn set_output_metering(&self, _enabled: bool) {}
    }

    fn populated_core() -> EngineCore {
        let mut core = EngineCore::new();
        core.begin_connected_generation();
        core.apply_delta(GraphDelta::NodeAdded(NodeDto {
            id: 1,
            name: "Source".into(),
            media_name: None,
            application_id: None,
            application_name: None,
            media_class: Some("Audio/Source".into()),
            object_name: Some("source".into()),
            kind: NodeKind::Output,
            volume_percent: None,
            muted: None,
        }));
        core.apply_delta(GraphDelta::NodeAdded(NodeDto {
            id: 2,
            name: "Sink".into(),
            media_name: None,
            application_id: None,
            application_name: None,
            media_class: Some("Audio/Sink".into()),
            object_name: Some("sink".into()),
            kind: NodeKind::Input,
            volume_percent: Some(65),
            muted: Some(false),
        }));
        core.apply_delta(GraphDelta::PortAdded(PortDto {
            id: 10,
            node_id: 1,
            name: "out".into(),
            channel: None,
            direction: PortDirection::Output,
            media_type: MediaType::Audio,
        }));
        core.apply_delta(GraphDelta::PortAdded(PortDto {
            id: 20,
            node_id: 2,
            name: "in".into(),
            channel: None,
            direction: PortDirection::Input,
            media_type: MediaType::Audio,
        }));
        core
    }

    #[test]
    fn adapter_is_replaceable_for_create_and_remove() {
        let mut core = populated_core();
        let adapter = MockAdapter::default();
        let (reply, response) = mpsc::sync_channel(1);
        let stopped = core.handle_request(
            EngineRequest::CreateLink {
                request: CreateLinkRequest {
                    operation_id: "create".into(),
                    generation: 1,
                    output_port_id: 10,
                    input_port_id: 20,
                },
                reply,
            },
            &adapter,
        );

        assert!(!stopped);
        assert!(response.recv().unwrap().is_ok());
        assert_eq!(adapter.created.lock().unwrap().len(), 1);

        core.apply_delta(GraphDelta::LinkAdded(LinkDto {
            id: 30,
            output_port_id: 10,
            input_port_id: 20,
            active: true,
            media_type: MediaType::Audio,
        }));
        let (reply, response) = mpsc::sync_channel(1);
        core.handle_request(
            EngineRequest::RemoveLink {
                request: RemoveLinkRequest {
                    operation_id: "remove".into(),
                    generation: 1,
                    link_id: 30,
                },
                reply,
            },
            &adapter,
        );
        assert!(response.recv().unwrap().is_ok());
        assert_eq!(&*adapter.removed.lock().unwrap(), &[30]);

        let (reply, response) = mpsc::sync_channel(1);
        core.handle_request(
            EngineRequest::SetDefaultAudioSink {
                request: SetDefaultAudioSinkRequest {
                    operation_id: "set-default".into(),
                    generation: 1,
                    node_id: 2,
                },
                reply,
            },
            &adapter,
        );
        assert!(response.recv().unwrap().is_ok());
        assert_eq!(
            &*adapter.default_sinks.lock().unwrap(),
            &[ValidatedDefaultAudioSink {
                node_id: 2,
                node_name: "sink".into(),
            }]
        );

        let (reply, response) = mpsc::sync_channel(1);
        core.handle_request(
            EngineRequest::SetDefaultAudioSource {
                request: SetDefaultAudioSourceRequest {
                    operation_id: "set-default-source".into(),
                    generation: 1,
                    node_id: 1,
                },
                reply,
            },
            &adapter,
        );
        assert!(response.recv().unwrap().is_ok());
        assert_eq!(
            &*adapter.default_sources.lock().unwrap(),
            &[ValidatedDefaultAudioSource {
                node_id: 1,
                node_name: "source".into(),
            }]
        );

        let (reply, response) = mpsc::sync_channel(1);
        core.handle_request(
            EngineRequest::SetOutputVolume {
                request: SetOutputVolumeRequest {
                    operation_id: "set-volume".into(),
                    generation: 1,
                    node_id: 2,
                    volume_percent: Some(75),
                    muted: None,
                },
                reply,
            },
            &adapter,
        );
        assert!(response.recv().unwrap().is_ok());
        assert_eq!(
            &*adapter.output_volumes.lock().unwrap(),
            &[ValidatedOutputVolume {
                node_id: 2,
                channel_count: 1,
                volume_percent: Some(75),
                muted: None,
            }]
        );
    }

    #[test]
    fn adapter_rejection_is_published_and_returned() {
        let mut core = populated_core();
        let envelopes = Arc::new(Mutex::new(Vec::new()));
        let captured = envelopes.clone();
        core.subscribe(Box::new(move |envelope| {
            captured.lock().unwrap().push(envelope.clone());
            true
        }));
        let adapter = MockAdapter {
            reject: true,
            ..MockAdapter::default()
        };
        let (reply, response) = mpsc::sync_channel(1);
        core.handle_request(
            EngineRequest::CreateLink {
                request: CreateLinkRequest {
                    operation_id: "reject".into(),
                    generation: 1,
                    output_port_id: 10,
                    input_port_id: 20,
                },
                reply,
            },
            &adapter,
        );

        let failure = response.recv().unwrap().unwrap_err();
        assert_eq!(failure.code, OperationErrorCode::BackendRejected);
        assert!(envelopes.lock().unwrap().iter().any(|envelope| matches!(
            envelope.payload,
            crate::model::GraphPayload::OperationFailed(_)
        )));
    }

    #[test]
    fn subscriber_receives_an_immediate_snapshot_then_ordered_updates() {
        let mut core = populated_core();
        let envelopes = Arc::new(Mutex::new(Vec::new()));
        let captured = envelopes.clone();
        core.subscribe(Box::new(move |envelope| {
            captured.lock().unwrap().push(envelope.clone());
            true
        }));
        core.apply_delta(GraphDelta::NodeAdded(NodeDto {
            id: 3,
            name: "Later".into(),
            media_name: None,
            application_id: None,
            application_name: None,
            media_class: None,
            object_name: Some("later".into()),
            kind: NodeKind::Unknown,
            volume_percent: None,
            muted: None,
        }));

        let envelopes = envelopes.lock().unwrap();
        assert_eq!(envelopes.len(), 2);
        assert!(matches!(envelopes[0].payload, GraphPayload::Snapshot(_)));
        assert_eq!(envelopes[0].generation, 1);
        assert_eq!(envelopes[1].sequence, envelopes[0].sequence + 1);
    }

    #[test]
    fn failed_subscribers_are_pruned_after_the_initial_snapshot() {
        let mut core = populated_core();
        let calls = Arc::new(AtomicUsize::new(0));
        let captured = calls.clone();
        core.subscribe(Box::new(move |_| {
            captured.fetch_add(1, Ordering::SeqCst);
            false
        }));
        core.apply_delta(GraphDelta::NodeRemoved { id: 1 });

        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    fn wait_for_snapshot(
        engine: &PipeWireEngine,
        timeout: Duration,
        predicate: impl Fn(u64, &GraphSnapshot) -> bool,
    ) -> (u64, GraphSnapshot) {
        let started = Instant::now();
        loop {
            if let Ok(envelope) = engine.snapshot() {
                if let GraphPayload::Snapshot(snapshot) = envelope.payload {
                    if predicate(envelope.generation, &snapshot) {
                        return (envelope.generation, snapshot);
                    }
                }
            }
            assert!(
                started.elapsed() < timeout,
                "timed out waiting for the expected live PipeWire snapshot"
            );
            thread::sleep(Duration::from_millis(50));
        }
    }

    fn named_port_pair(
        snapshot: &GraphSnapshot,
        output_name: &str,
        input_name: &str,
    ) -> Option<(u32, u32)> {
        let matches_name = |node: &&NodeDto, expected: &str| {
            node.name == expected || node.media_name.as_deref() == Some(expected)
        };
        let output_node = snapshot
            .nodes
            .iter()
            .find(|node| matches_name(node, output_name))?;
        let input_node = snapshot
            .nodes
            .iter()
            .find(|node| matches_name(node, input_name))?;
        let output = snapshot
            .ports
            .iter()
            .find(|port| port.node_id == output_node.id && port.direction == PortDirection::Output)?
            .id;
        let input = snapshot
            .ports
            .iter()
            .find(|port| port.node_id == input_node.id && port.direction == PortDirection::Input)?
            .id;
        Some((output, input))
    }

    fn pw_link_listing() -> String {
        let output = Command::new("pw-link")
            .args(["--links", "--id", "--verbose"])
            .output()
            .expect("failed to execute pw-link for live topology comparison");
        assert!(
            output.status.success(),
            "pw-link could not read the isolated graph"
        );
        String::from_utf8(output.stdout).expect("pw-link returned non-UTF-8 output")
    }

    fn listing_contains_link(listing: &str, link_id: u32) -> bool {
        let prefix = format!("{link_id} ");
        listing
            .lines()
            .any(|line| line.trim_start().starts_with(&prefix) && line.contains("|->"))
    }

    #[test]
    #[ignore = "requires the isolated temporary PipeWire daemon created by scripts/live-pipewire-smoke.sh"]
    fn live_pipewire_create_persist_reopen_remove() {
        let output_name = std::env::var("CORDFLOW_TEST_OUTPUT_NODE")
            .expect("CORDFLOW_TEST_OUTPUT_NODE must name a temporary output node");
        let input_name = std::env::var("CORDFLOW_TEST_INPUT_NODE")
            .expect("CORDFLOW_TEST_INPUT_NODE must name a temporary input node");

        let engine = PipeWireEngine::spawn();
        let (generation, initial) =
            wait_for_snapshot(&engine, Duration::from_secs(5), |_, graph| {
                graph.status.state == ConnectionState::Connected
                    && named_port_pair(graph, &output_name, &input_name).is_some()
            });
        let (output_port_id, input_port_id) =
            named_port_pair(&initial, &output_name, &input_name).unwrap();
        assert!(!initial.links.iter().any(|link| {
            link.output_port_id == output_port_id && link.input_port_id == input_port_id
        }));

        engine
            .create_link(CreateLinkRequest {
                operation_id: "live-create".into(),
                generation,
                output_port_id,
                input_port_id,
            })
            .expect("live create_link command failed");
        let (_, created) = wait_for_snapshot(&engine, Duration::from_secs(5), |_, graph| {
            graph.links.iter().any(|link| {
                link.output_port_id == output_port_id && link.input_port_id == input_port_id
            })
        });
        let link_id = created
            .links
            .iter()
            .find(|link| {
                link.output_port_id == output_port_id && link.input_port_id == input_port_id
            })
            .unwrap()
            .id;
        let listing = pw_link_listing();
        assert!(listing.contains(&output_name));
        assert!(listing.contains(&input_name));
        assert!(listing_contains_link(&listing, link_id));

        engine.terminate();
        drop(engine);
        thread::sleep(Duration::from_millis(300));

        let reopened = PipeWireEngine::spawn();
        let (reopened_generation, persisted) =
            wait_for_snapshot(&reopened, Duration::from_secs(5), |_, graph| {
                graph.links.iter().any(|link| link.id == link_id)
            });
        assert!(persisted.links.iter().any(|link| link.id == link_id));
        assert!(listing_contains_link(&pw_link_listing(), link_id));

        reopened
            .remove_link(RemoveLinkRequest {
                operation_id: "live-remove".into(),
                generation: reopened_generation,
                link_id,
            })
            .expect("live remove_link command failed");
        wait_for_snapshot(&reopened, Duration::from_secs(5), |_, graph| {
            !graph.links.iter().any(|link| link.id == link_id)
        });
        assert!(!listing_contains_link(&pw_link_listing(), link_id));
        reopened.terminate();
    }

    #[test]
    #[ignore = "requires scripts/live-pipewire-smoke.sh to restart an isolated PipeWire daemon"]
    fn live_pipewire_recovers_after_daemon_restart() {
        let ready_file = std::env::var("CORDFLOW_RESTART_READY")
            .expect("CORDFLOW_RESTART_READY must point to the smoke-test marker");
        let engine = PipeWireEngine::spawn();
        let (initial_generation, _) =
            wait_for_snapshot(&engine, Duration::from_secs(5), |generation, graph| {
                generation > 0 && graph.status.state == ConnectionState::Connected
            });
        fs::write(&ready_file, b"ready").expect("failed to signal daemon restart readiness");

        let started = Instant::now();
        let mut observed_unavailable = false;
        loop {
            match engine.snapshot() {
                Ok(envelope) => {
                    if let GraphPayload::Snapshot(snapshot) = envelope.payload {
                        observed_unavailable |= snapshot.status.state != ConnectionState::Connected;
                        if observed_unavailable
                            && envelope.generation > initial_generation
                            && snapshot.status.state == ConnectionState::Connected
                        {
                            break;
                        }
                    }
                }
                Err(_) => observed_unavailable = true,
            }
            assert!(
                started.elapsed() < Duration::from_secs(12),
                "engine did not reconnect with a new generation"
            );
            thread::sleep(Duration::from_millis(50));
        }
        engine.terminate();
    }

    #[test]
    #[ignore = "requires a live PipeWire sink with active audio"]
    fn live_output_meter_publishes_nonzero_levels_and_spectrum() {
        let engine = PipeWireEngine::spawn();
        wait_for_snapshot(&engine, Duration::from_secs(5), |_, graph| {
            graph.status.state == ConnectionState::Connected
                && graph.nodes.iter().any(|node| {
                    node.media_class.as_deref().is_some_and(|class| {
                        class == "Audio/Sink" || class.starts_with("Audio/Sink/")
                    })
                })
        });

        let (sender, receiver) = mpsc::channel();
        engine
            .subscribe_output_levels(move |level| sender.send(*level).is_ok())
            .expect("failed to subscribe to output levels");
        engine
            .set_output_metering(true)
            .expect("failed to enable output metering");

        let started = Instant::now();
        let mut highest_peak = 0.0_f32;
        let mut highest_spectrum_band = 0.0_f32;
        while started.elapsed() < Duration::from_secs(5) {
            if let Ok(level) = receiver.recv_timeout(Duration::from_millis(250)) {
                highest_peak = highest_peak.max(level.peak);
                highest_spectrum_band = level
                    .spectrum
                    .iter()
                    .copied()
                    .fold(highest_spectrum_band, f32::max);
                if highest_peak > 0.001 && highest_spectrum_band > 0.001 {
                    break;
                }
            }
        }
        engine.terminate();
        assert!(
            highest_peak > 0.001,
            "no nonzero output peak arrived while audio was active"
        );
        assert!(
            highest_spectrum_band > 0.001,
            "no nonzero output spectrum arrived while audio was active"
        );
    }
}
