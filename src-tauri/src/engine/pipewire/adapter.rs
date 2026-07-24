// Copyright 2021 Tom A. Wagner <tom.a.wagner@protonmail.com>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License version 3 as published by
// the Free Software Foundation.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: GPL-3.0-only
//
// Derived from Helvum 0.6.2 src/pipewire_connection/mod.rs at commit
// e124603c1d15a8d6b51803068c01fcbb0f5d383a. Modified in 2026 for
// Cordflow: GTK messaging was replaced by an ordered domain state and
// Tauri subscribers, operations are validated, and reconnects use generations.

use std::io::Cursor;

use ::pipewire::{core::CoreRc, link::Link};
use libspa::{
    param::ParamType,
    pod::{serialize::PodSerializer, Object, Pod, Property, Value, ValueArray},
};
use log::info;

use super::{metering::MeterManager, registry::RegistrySession};
use crate::{
    engine::PipeWireAdapter,
    graph_state::{
        ValidatedDefaultAudioSink, ValidatedDefaultAudioSource, ValidatedLink,
        ValidatedOutputVolume,
    },
};

const CONFIGURED_AUDIO_SINK_KEY: &str = "default.configured.audio.sink";
const CONFIGURED_AUDIO_SOURCE_KEY: &str = "default.configured.audio.source";
const JSON_METADATA_TYPE: &str = "Spa:String:JSON";

pub(super) struct OfflineAdapter;

impl PipeWireAdapter for OfflineAdapter {
    fn create_link(&self, _link: ValidatedLink) -> Result<(), String> {
        Err("PipeWire is not connected".to_owned())
    }

    fn remove_link(&self, _link_id: u32) -> Result<(), String> {
        Err("PipeWire is not connected".to_owned())
    }

    fn set_default_audio_sink(&self, _sink: ValidatedDefaultAudioSink) -> Result<(), String> {
        Err("PipeWire is not connected".to_owned())
    }

    fn set_default_audio_source(&self, _source: ValidatedDefaultAudioSource) -> Result<(), String> {
        Err("PipeWire is not connected".to_owned())
    }

    fn set_output_volume(&self, _volume: ValidatedOutputVolume) -> Result<(), String> {
        Err("PipeWire is not connected".to_owned())
    }

    fn set_output_metering(&self, _enabled: bool) {}
}

pub(super) struct LiveAdapter<'a> {
    core: &'a CoreRc,
    registry: &'a RegistrySession,
    meters: &'a MeterManager,
}

impl<'a> LiveAdapter<'a> {
    pub(super) fn new(
        core: &'a CoreRc,
        registry: &'a RegistrySession,
        meters: &'a MeterManager,
    ) -> Self {
        Self {
            core,
            registry,
            meters,
        }
    }
}

impl PipeWireAdapter for LiveAdapter<'_> {
    fn create_link(&self, link: ValidatedLink) -> Result<(), String> {
        info!(
            "requesting link {}:{} -> {}:{}",
            link.output_node_id, link.output_port_id, link.input_node_id, link.input_port_id
        );
        self.core
            .create_object::<Link>(
                "link-factory",
                &::pipewire::properties::properties! {
                    "link.output.node" => link.output_node_id.to_string(),
                    "link.output.port" => link.output_port_id.to_string(),
                    "link.input.node" => link.input_node_id.to_string(),
                    "link.input.port" => link.input_port_id.to_string(),
                    "object.linger" => "1"
                },
            )
            .map(|_| ())
            .map_err(|error| format!("PipeWire rejected link creation: {error}"))
    }

    fn remove_link(&self, link_id: u32) -> Result<(), String> {
        info!("requesting removal of link {link_id}");
        self.registry.destroy_global(link_id);
        Ok(())
    }

    fn set_default_audio_sink(&self, sink: ValidatedDefaultAudioSink) -> Result<(), String> {
        let value = serde_json::json!({ "name": sink.node_name }).to_string();
        info!(
            "requesting default audio sink {} ({})",
            sink.node_id, sink.node_name
        );
        self.registry
            .set_metadata(CONFIGURED_AUDIO_SINK_KEY, JSON_METADATA_TYPE, &value)
    }

    fn set_default_audio_source(&self, source: ValidatedDefaultAudioSource) -> Result<(), String> {
        let value = serde_json::json!({ "name": source.node_name }).to_string();
        info!(
            "requesting default audio source {} ({})",
            source.node_id, source.node_name
        );
        self.registry
            .set_metadata(CONFIGURED_AUDIO_SOURCE_KEY, JSON_METADATA_TYPE, &value)
    }

    fn set_output_volume(&self, volume: ValidatedOutputVolume) -> Result<(), String> {
        let values = serialize_output_volume(&volume)?;
        let pod = Pod::from_bytes(&values)
            .ok_or_else(|| "Could not serialize PipeWire volume parameters".to_owned())?;
        info!(
            "requesting output volume update for node {}: volume={:?}, muted={:?}",
            volume.node_id, volume.volume_percent, volume.muted
        );
        self.registry
            .set_node_param(volume.node_id, ParamType::Props, pod)
    }

    fn set_output_metering(&self, enabled: bool) {
        self.meters.set_enabled(self.core, enabled);
    }
}

fn serialize_output_volume(volume: &ValidatedOutputVolume) -> Result<Vec<u8>, String> {
    let mut properties = Vec::new();
    if let Some(percent) = volume.volume_percent {
        let linear = (f32::from(percent) / 100.0).powi(3);
        properties.push(Property::new(
            libspa::sys::SPA_PROP_channelVolumes,
            Value::ValueArray(ValueArray::Float(vec![linear; volume.channel_count])),
        ));
    }
    if let Some(muted) = volume.muted {
        properties.push(Property::new(
            libspa::sys::SPA_PROP_mute,
            Value::Bool(muted),
        ));
    }
    PodSerializer::serialize(
        Cursor::new(Vec::new()),
        &Value::Object(Object {
            type_: libspa::sys::SPA_TYPE_OBJECT_Props,
            id: libspa::sys::SPA_PARAM_Props,
            properties,
        }),
    )
    .map(|(cursor, _)| cursor.into_inner())
    .map_err(|error| format!("Could not serialize PipeWire volume parameters: {error:?}"))
}
