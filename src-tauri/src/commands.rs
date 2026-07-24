// Copyright 2026 Cordflow contributors
// SPDX-License-Identifier: GPL-3.0-only

use tauri::{ipc::Channel, State};

use crate::{
    engine::PipeWireEngine,
    model::{
        CreateLinkRequest, GraphEnvelope, OperationAck, OperationErrorCode, OperationFailure,
        OutputLevel, RemoveLinkRequest, SetDefaultAudioSinkRequest, SetDefaultAudioSourceRequest,
        SetOutputVolumeRequest,
    },
};

async fn run_engine_call<T: Send + 'static>(
    operation_id: Option<String>,
    call: impl FnOnce() -> Result<T, OperationFailure> + Send + 'static,
) -> Result<T, OperationFailure> {
    tauri::async_runtime::spawn_blocking(call)
        .await
        .map_err(|error| {
            OperationFailure::new(
                operation_id,
                OperationErrorCode::BackendUnavailable,
                format!("PipeWire command task failed: {error}"),
            )
        })?
}

#[tauri::command]
pub async fn subscribe_graph(
    channel: Channel<GraphEnvelope>,
    engine: State<'_, PipeWireEngine>,
) -> Result<(), OperationFailure> {
    let engine = engine.inner().clone();
    run_engine_call(None, move || {
        engine.subscribe(move |envelope| channel.send(envelope.clone()).is_ok())
    })
    .await
}

#[tauri::command]
pub async fn subscribe_output_levels(
    channel: Channel<OutputLevel>,
    engine: State<'_, PipeWireEngine>,
) -> Result<(), OperationFailure> {
    let engine = engine.inner().clone();
    run_engine_call(None, move || {
        engine.subscribe_output_levels(move |level| channel.send(*level).is_ok())
    })
    .await
}

#[tauri::command]
pub async fn set_output_metering(
    enabled: bool,
    engine: State<'_, PipeWireEngine>,
) -> Result<(), OperationFailure> {
    let engine = engine.inner().clone();
    run_engine_call(None, move || engine.set_output_metering(enabled)).await
}

#[tauri::command]
pub async fn get_graph_snapshot(
    engine: State<'_, PipeWireEngine>,
) -> Result<GraphEnvelope, OperationFailure> {
    let engine = engine.inner().clone();
    run_engine_call(None, move || engine.snapshot()).await
}

#[tauri::command]
pub async fn create_link(
    request: CreateLinkRequest,
    engine: State<'_, PipeWireEngine>,
) -> Result<OperationAck, OperationFailure> {
    let operation_id = Some(request.operation_id.clone());
    let engine = engine.inner().clone();
    run_engine_call(operation_id, move || engine.create_link(request)).await
}

#[tauri::command]
pub async fn remove_link(
    request: RemoveLinkRequest,
    engine: State<'_, PipeWireEngine>,
) -> Result<OperationAck, OperationFailure> {
    let operation_id = Some(request.operation_id.clone());
    let engine = engine.inner().clone();
    run_engine_call(operation_id, move || engine.remove_link(request)).await
}

#[tauri::command]
pub async fn set_default_audio_sink(
    request: SetDefaultAudioSinkRequest,
    engine: State<'_, PipeWireEngine>,
) -> Result<OperationAck, OperationFailure> {
    let operation_id = Some(request.operation_id.clone());
    let engine = engine.inner().clone();
    run_engine_call(operation_id, move || engine.set_default_audio_sink(request)).await
}

#[tauri::command]
pub async fn set_default_audio_source(
    request: SetDefaultAudioSourceRequest,
    engine: State<'_, PipeWireEngine>,
) -> Result<OperationAck, OperationFailure> {
    let operation_id = Some(request.operation_id.clone());
    let engine = engine.inner().clone();
    run_engine_call(operation_id, move || {
        engine.set_default_audio_source(request)
    })
    .await
}

#[tauri::command]
pub async fn set_output_volume(
    request: SetOutputVolumeRequest,
    engine: State<'_, PipeWireEngine>,
) -> Result<OperationAck, OperationFailure> {
    let operation_id = Some(request.operation_id.clone());
    let engine = engine.inner().clone();
    run_engine_call(operation_id, move || engine.set_output_volume(request)).await
}
