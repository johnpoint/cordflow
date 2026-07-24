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

use super::{
    metering::MeterManager,
    registry::{OutputVolumeRoute, RegistrySession},
};
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
        let route = self.registry.output_volume_route(volume.node_id);
        let values = match &route {
            Some(route) => serialize_output_route(route, &volume)?,
            None => serialize_output_volume(&volume)?,
        };
        let pod = Pod::from_bytes(&values)
            .ok_or_else(|| "Could not serialize PipeWire volume parameters".to_owned())?;
        info!(
            "requesting output volume update for node {} via {}: volume={:?}, muted={:?}",
            volume.node_id,
            if route.is_some() {
                "device route"
            } else {
                "node properties"
            },
            volume.volume_percent,
            volume.muted
        );
        match route {
            Some(route) => self
                .registry
                .set_device_param(route.device_id, ParamType::Route, pod),
            None => self
                .registry
                .set_node_param(volume.node_id, ParamType::Props, pod),
        }
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

fn serialize_output_route(
    route: &OutputVolumeRoute,
    volume: &ValidatedOutputVolume,
) -> Result<Vec<u8>, String> {
    let mut route_properties = Vec::new();
    let channel_volumes = if let Some(percent) = volume.volume_percent {
        let linear = (f32::from(percent) / 100.0).powi(3);
        let channel_count = if route.channel_volumes.is_empty() {
            volume.channel_count
        } else {
            route.channel_volumes.len()
        };
        vec![linear; channel_count]
    } else {
        route.channel_volumes.clone()
    };
    if !channel_volumes.is_empty() {
        route_properties.push(Property::new(
            libspa::sys::SPA_PROP_channelVolumes,
            Value::ValueArray(ValueArray::Float(channel_volumes)),
        ));
    }
    if !route.channel_map.is_empty() {
        route_properties.push(Property::new(
            libspa::sys::SPA_PROP_channelMap,
            Value::ValueArray(ValueArray::Id(route.channel_map.clone())),
        ));
    }
    if let Some(muted) = volume.muted.or(route.muted) {
        route_properties.push(Property::new(
            libspa::sys::SPA_PROP_mute,
            Value::Bool(muted),
        ));
    }

    PodSerializer::serialize(
        Cursor::new(Vec::new()),
        &Value::Object(Object {
            type_: libspa::sys::SPA_TYPE_OBJECT_ParamRoute,
            id: libspa::sys::SPA_PARAM_Route,
            properties: vec![
                Property::new(
                    libspa::sys::SPA_PARAM_ROUTE_index,
                    Value::Int(route.route_index),
                ),
                Property::new(
                    libspa::sys::SPA_PARAM_ROUTE_device,
                    Value::Int(route.route_device_id),
                ),
                Property::new(
                    libspa::sys::SPA_PARAM_ROUTE_props,
                    Value::Object(Object {
                        type_: libspa::sys::SPA_TYPE_OBJECT_Props,
                        id: libspa::sys::SPA_PARAM_Route,
                        properties: route_properties,
                    }),
                ),
                Property::new(libspa::sys::SPA_PARAM_ROUTE_save, Value::Bool(true)),
            ],
        }),
    )
    .map(|(cursor, _)| cursor.into_inner())
    .map_err(|error| format!("Could not serialize PipeWire route parameters: {error:?}"))
}

#[cfg(test)]
mod tests {
    use libspa::{pod::deserialize::PodDeserializer, utils::Id};

    use super::*;

    fn route() -> OutputVolumeRoute {
        OutputVolumeRoute {
            device_id: 163,
            route_index: 1,
            route_device_id: 1,
            channel_volumes: vec![0.324_346, 0.324_346],
            channel_map: vec![Id(3), Id(4)],
            muted: Some(false),
        }
    }

    fn parse_route(bytes: &[u8]) -> Object {
        let (_, Value::Object(object)) = PodDeserializer::deserialize_any_from(bytes).unwrap()
        else {
            panic!("serialized route must be an object");
        };
        object
    }

    #[test]
    fn serializes_device_route_volume_with_persistent_route_properties() {
        let update = ValidatedOutputVolume {
            node_id: 55,
            channel_count: 2,
            volume_percent: Some(76),
            muted: None,
        };
        let bytes = serialize_output_route(&route(), &update).unwrap();
        let object = parse_route(&bytes);

        assert_eq!(object.type_, libspa::sys::SPA_TYPE_OBJECT_ParamRoute);
        assert_eq!(object.id, libspa::sys::SPA_PARAM_Route);
        let mut index = None;
        let mut device = None;
        let mut saved = None;
        let mut props = None;
        for property in object.properties {
            match (property.key, property.value) {
                (libspa::sys::SPA_PARAM_ROUTE_index, Value::Int(value)) => index = Some(value),
                (libspa::sys::SPA_PARAM_ROUTE_device, Value::Int(value)) => device = Some(value),
                (libspa::sys::SPA_PARAM_ROUTE_save, Value::Bool(value)) => saved = Some(value),
                (libspa::sys::SPA_PARAM_ROUTE_props, Value::Object(value)) => props = Some(value),
                _ => {}
            }
        }

        assert_eq!(index, Some(1));
        assert_eq!(device, Some(1));
        assert_eq!(saved, Some(true));
        let props = props.unwrap();
        assert_eq!(props.type_, libspa::sys::SPA_TYPE_OBJECT_Props);
        assert_eq!(props.id, libspa::sys::SPA_PARAM_Route);
        let mut volumes = None;
        let mut channel_map = None;
        let mut muted = None;
        for property in props.properties {
            match (property.key, property.value) {
                (
                    libspa::sys::SPA_PROP_channelVolumes,
                    Value::ValueArray(ValueArray::Float(value)),
                ) => volumes = Some(value),
                (libspa::sys::SPA_PROP_channelMap, Value::ValueArray(ValueArray::Id(value))) => {
                    channel_map = Some(value)
                }
                (libspa::sys::SPA_PROP_mute, Value::Bool(value)) => muted = Some(value),
                _ => {}
            }
        }

        let expected = 0.76_f32.powi(3);
        let volumes = volumes.unwrap();
        assert_eq!(volumes.len(), 2);
        assert!(volumes
            .iter()
            .all(|volume| (volume - expected).abs() < 1e-6));
        assert_eq!(channel_map, Some(vec![Id(3), Id(4)]));
        assert_eq!(muted, Some(false));
    }

    #[test]
    fn mute_only_route_update_keeps_current_hardware_volume() {
        let update = ValidatedOutputVolume {
            node_id: 55,
            channel_count: 2,
            volume_percent: None,
            muted: Some(true),
        };
        let bytes = serialize_output_route(&route(), &update).unwrap();
        let object = parse_route(&bytes);
        let props = object
            .properties
            .into_iter()
            .find_map(|property| match (property.key, property.value) {
                (libspa::sys::SPA_PARAM_ROUTE_props, Value::Object(value)) => Some(value),
                _ => None,
            })
            .unwrap();
        let mut volumes = None;
        let mut muted = None;
        for property in props.properties {
            match (property.key, property.value) {
                (
                    libspa::sys::SPA_PROP_channelVolumes,
                    Value::ValueArray(ValueArray::Float(value)),
                ) => volumes = Some(value),
                (libspa::sys::SPA_PROP_mute, Value::Bool(value)) => muted = Some(value),
                _ => {}
            }
        }

        assert_eq!(volumes, Some(vec![0.324_346, 0.324_346]));
        assert_eq!(muted, Some(true));
    }
}
