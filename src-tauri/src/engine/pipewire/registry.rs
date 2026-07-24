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
// Derived from Helvum 0.6.2 src/pipewire_connection/mod.rs and state.rs at commit
// e124603c1d15a8d6b51803068c01fcbb0f5d383a. Modified in 2026 for
// Cordflow: GTK messaging was replaced by an ordered domain state and
// Tauri subscribers, operations are validated, and reconnects use generations.

use std::{cell::RefCell, collections::HashMap, rc::Rc};

use ::pipewire::{
    core::CoreRc,
    device::{Device, DeviceChangeMask, DeviceListener},
    keys,
    link::{Link, LinkChangeMask, LinkListener, LinkState},
    metadata::{Metadata, MetadataListener},
    node::{Node, NodeListener},
    port::{Port, PortChangeMask, PortListener},
    registry::{GlobalObject, Listener as RegistryListener, RegistryRc},
    types::ObjectType,
};
use libspa::{
    param::{ParamInfoFlags, ParamType},
    pod::{deserialize::PodDeserializer, Pod, Value, ValueArray},
    utils::{dict::DictRef, Direction as SpaDirection, Id},
};
use log::{debug, warn};

use super::metering::MeterManager;
use crate::{
    engine::EngineCore,
    model::{GraphDelta, LinkDto, MediaType, NodeDto, NodeKind, PortDirection, PortDto},
};

const DEFAULT_METADATA_NAME: &str = "default";
const ACTIVE_AUDIO_SINK_KEY: &str = "default.audio.sink";
const ACTIVE_AUDIO_SOURCE_KEY: &str = "default.audio.source";

enum RegistryItem {
    Device,
    Node,
    Port,
    Link,
    Metadata,
}

#[derive(Default)]
struct RegistryItems {
    items: HashMap<u32, RegistryItem>,
}

impl RegistryItems {
    fn insert(&mut self, id: u32, item: RegistryItem) {
        self.items.insert(id, item);
    }

    fn contains(&self, id: u32) -> bool {
        self.items.contains_key(&id)
    }

    fn remove(&mut self, id: u32) -> Option<RegistryItem> {
        self.items.remove(&id)
    }
}

enum ProxyItem {
    Device {
        proxy: Device,
        _listener: DeviceListener,
    },
    Node {
        proxy: Node,
        _listener: NodeListener,
    },
    Port {
        proxy: Port,
        _listener: PortListener,
    },
    Link {
        _proxy: Link,
        _listener: LinkListener,
    },
    Metadata {
        proxy: Metadata,
        _listener: MetadataListener,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct OutputRouteKey {
    device_id: u32,
    route_device_id: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct OutputVolumeRoute {
    pub(super) device_id: u32,
    pub(super) route_index: i32,
    pub(super) route_device_id: i32,
    pub(super) channel_volumes: Vec<f32>,
    pub(super) channel_map: Vec<Id>,
    pub(super) muted: Option<bool>,
}

impl OutputVolumeRoute {
    fn key(&self) -> OutputRouteKey {
        OutputRouteKey {
            device_id: self.device_id,
            route_device_id: self.route_device_id,
        }
    }
}

#[derive(Default)]
struct VolumeRouteState {
    node_routes: HashMap<u32, OutputRouteKey>,
    routes: HashMap<OutputRouteKey, OutputVolumeRoute>,
}

impl VolumeRouteState {
    fn register_node(&mut self, node_id: u32, key: OutputRouteKey) {
        self.node_routes.insert(node_id, key);
    }

    fn remove_node(&mut self, node_id: u32) {
        self.node_routes.remove(&node_id);
    }

    fn update_route(&mut self, route: OutputVolumeRoute) -> Vec<u32> {
        let key = route.key();
        self.routes.insert(key, route);
        self.node_routes
            .iter()
            .filter_map(|(node_id, node_key)| (*node_key == key).then_some(*node_id))
            .collect()
    }

    fn remove_device(&mut self, device_id: u32) {
        self.routes.retain(|key, _| key.device_id != device_id);
    }

    fn route_for_node(&self, node_id: u32) -> Option<&OutputVolumeRoute> {
        self.node_routes
            .get(&node_id)
            .and_then(|key| self.routes.get(key))
    }
}

struct NodeRegistryContext<'a> {
    proxies: &'a Rc<RefCell<HashMap<u32, ProxyItem>>>,
    items: &'a Rc<RefCell<RegistryItems>>,
    volume_routes: &'a Rc<RefCell<VolumeRouteState>>,
    domain: &'a Rc<RefCell<EngineCore>>,
}

#[derive(Clone)]
pub(super) struct RegistrySession {
    registry: RegistryRc,
    proxies: Rc<RefCell<HashMap<u32, ProxyItem>>>,
    items: Rc<RefCell<RegistryItems>>,
    volume_routes: Rc<RefCell<VolumeRouteState>>,
    domain: Rc<RefCell<EngineCore>>,
}

impl RegistrySession {
    pub(super) fn new(registry: RegistryRc, domain: Rc<RefCell<EngineCore>>) -> Self {
        Self {
            registry,
            proxies: Rc::new(RefCell::new(HashMap::new())),
            items: Rc::new(RefCell::new(RegistryItems::default())),
            volume_routes: Rc::new(RefCell::new(VolumeRouteState::default())),
            domain,
        }
    }

    pub(super) fn destroy_global(&self, id: u32) {
        self.registry.destroy_global(id);
    }

    pub(super) fn set_metadata(&self, key: &str, type_: &str, value: &str) -> Result<(), String> {
        let proxies = self.proxies.borrow();
        let metadata = proxies.values().find_map(|item| match item {
            ProxyItem::Metadata { proxy, .. } => Some(proxy),
            _ => None,
        });
        let Some(metadata) = metadata else {
            return Err("WirePlumber default-device metadata is unavailable".to_owned());
        };
        metadata.set_property(::pipewire::core::PW_ID_CORE, key, Some(type_), Some(value));
        Ok(())
    }

    pub(super) fn set_node_param(
        &self,
        node_id: u32,
        param_type: ParamType,
        pod: &Pod,
    ) -> Result<(), String> {
        let proxies = self.proxies.borrow();
        let Some(ProxyItem::Node { proxy, .. }) = proxies.get(&node_id) else {
            return Err(format!("PipeWire output node {node_id} is unavailable"));
        };
        proxy.set_param(param_type, 0, pod);
        Ok(())
    }

    pub(super) fn output_volume_route(&self, node_id: u32) -> Option<OutputVolumeRoute> {
        self.volume_routes.borrow().route_for_node(node_id).cloned()
    }

    pub(super) fn set_device_param(
        &self,
        device_id: u32,
        param_type: ParamType,
        pod: &Pod,
    ) -> Result<(), String> {
        let proxies = self.proxies.borrow();
        let Some(ProxyItem::Device { proxy, .. }) = proxies.get(&device_id) else {
            return Err(format!("PipeWire output device {device_id} is unavailable"));
        };
        proxy.set_param(param_type, 0, pod);
        Ok(())
    }

    pub(super) fn subscribe(&self, core: &CoreRc, meters: &MeterManager) -> RegistryListener {
        let global_core = core.clone();
        let global_registry = self.registry.clone();
        let global_proxies = self.proxies.clone();
        let global_items = self.items.clone();
        let global_volume_routes = self.volume_routes.clone();
        let global_domain = self.domain.clone();
        let global_meters = meters.clone();
        let remove_proxies = self.proxies.clone();
        let remove_items = self.items.clone();
        let remove_volume_routes = self.volume_routes.clone();
        let remove_domain = self.domain.clone();
        let remove_meters = meters.clone();

        self.registry
            .add_listener_local()
            .global(move |global| match global.type_ {
                ObjectType::Device => handle_device(
                    global,
                    &global_registry,
                    &global_proxies,
                    &global_items,
                    &global_volume_routes,
                    &global_domain,
                ),
                ObjectType::Node => handle_node(
                    global,
                    &global_core,
                    &global_registry,
                    NodeRegistryContext {
                        proxies: &global_proxies,
                        items: &global_items,
                        volume_routes: &global_volume_routes,
                        domain: &global_domain,
                    },
                    &global_meters,
                ),
                ObjectType::Port => handle_port(
                    global,
                    &global_registry,
                    &global_proxies,
                    &global_items,
                    &global_domain,
                ),
                ObjectType::Link => handle_link(
                    global,
                    &global_registry,
                    &global_proxies,
                    &global_items,
                    &global_domain,
                ),
                ObjectType::Metadata => handle_metadata(
                    global,
                    &global_registry,
                    &global_proxies,
                    &global_items,
                    &global_domain,
                ),
                _ => {}
            })
            .global_remove(move |id| {
                remove_proxies.borrow_mut().remove(&id);
                remove_meters.remove_target(id);
                match remove_items.borrow_mut().remove(id) {
                    Some(RegistryItem::Device) => {
                        remove_volume_routes.borrow_mut().remove_device(id);
                    }
                    Some(RegistryItem::Node) => {
                        remove_volume_routes.borrow_mut().remove_node(id);
                        remove_domain
                            .borrow_mut()
                            .apply_delta(GraphDelta::NodeRemoved { id });
                    }
                    Some(RegistryItem::Port) => remove_domain
                        .borrow_mut()
                        .apply_delta(GraphDelta::PortRemoved { id }),
                    Some(RegistryItem::Link) => remove_domain
                        .borrow_mut()
                        .apply_delta(GraphDelta::LinkRemoved { id }),
                    Some(RegistryItem::Metadata) => {
                        let mut domain = remove_domain.borrow_mut();
                        domain.apply_delta(GraphDelta::DefaultAudioSinkChanged { name: None });
                        domain.apply_delta(GraphDelta::DefaultAudioSourceChanged { name: None });
                    }
                    None => debug!("removed untracked PipeWire object {id}"),
                }
            })
            .register()
    }
}

fn get_node_name(props: &DictRef) -> Option<&str> {
    props
        .get(&keys::NODE_DESCRIPTION)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| props.get(&keys::NODE_NICK))
        .filter(|value| !value.trim().is_empty())
        .or_else(|| props.get(&keys::NODE_NAME))
        .filter(|value| !value.trim().is_empty())
        .or_else(|| props.get("application.name"))
        .filter(|value| !value.trim().is_empty())
        .or_else(|| props.get("media.name"))
        .filter(|value| !value.trim().is_empty())
        .or_else(|| props.get("application.process.binary"))
        .filter(|value| !value.trim().is_empty())
        .or_else(|| props.get("object.path"))
        .filter(|value| !value.trim().is_empty())
        .or_else(|| props.get("factory.name"))
        .filter(|value| !value.trim().is_empty())
}

fn get_application_id(props: &DictRef) -> Option<&str> {
    props
        .get("application.id")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| props.get("application.process.binary"))
        .filter(|value| !value.trim().is_empty())
        .or_else(|| props.get("application.name"))
        .filter(|value| !value.trim().is_empty())
}

fn get_application_name(props: &DictRef) -> Option<&str> {
    props
        .get("application.name")
        .filter(|value| !value.trim().is_empty())
        .or_else(|| props.get("application.process.binary"))
        .filter(|value| !value.trim().is_empty())
}

fn get_node_kind(props: &DictRef) -> Option<NodeKind> {
    let media_class = props.get("media.class");
    let media_category = props.get("media.category");
    (media_class.is_some() || media_category.is_some())
        .then(|| classify_node_kind(media_class.unwrap_or_default(), media_category))
}

fn classify_node_kind(media_class: &str, media_category: Option<&str>) -> NodeKind {
    if media_category.is_some_and(|category| category.contains("Duplex")) {
        NodeKind::Duplex
    } else if media_class.contains("Sink") || media_class.contains("Input") {
        NodeKind::Input
    } else if media_class.contains("Source") || media_class.contains("Output") {
        NodeKind::Output
    } else {
        NodeKind::Unknown
    }
}

fn handle_device(
    global: &GlobalObject<&DictRef>,
    registry: &RegistryRc,
    proxies: &Rc<RefCell<HashMap<u32, ProxyItem>>>,
    items: &Rc<RefCell<RegistryItems>>,
    volume_routes: &Rc<RefCell<VolumeRouteState>>,
    domain: &Rc<RefCell<EngineCore>>,
) {
    let device_id = global.id;
    let proxy: Device = match registry.bind(global) {
        Ok(proxy) => proxy,
        Err(bind_error) => {
            warn!("failed to bind PipeWire device {device_id}: {bind_error}");
            return;
        }
    };
    let info_proxies = proxies.clone();
    let param_routes = volume_routes.clone();
    let param_domain = domain.clone();
    let listener = proxy
        .add_listener_local()
        .info(move |info| handle_device_info(info, &info_proxies))
        .param(move |_, param_type, _, _, param| {
            if param_type == ParamType::Route {
                handle_device_route(device_id, param, &param_routes, &param_domain);
            }
        })
        .register();
    proxy.subscribe_params(&[ParamType::Route]);
    proxy.enum_params(0, Some(ParamType::Route), 0, u32::MAX);
    items.borrow_mut().insert(device_id, RegistryItem::Device);
    proxies.borrow_mut().insert(
        device_id,
        ProxyItem::Device {
            proxy,
            _listener: listener,
        },
    );
}

fn handle_device_info(
    info: &::pipewire::device::DeviceInfoRef,
    proxies: &Rc<RefCell<HashMap<u32, ProxyItem>>>,
) {
    if !info.change_mask().contains(DeviceChangeMask::PARAMS) {
        return;
    }
    let proxies = proxies.borrow();
    let Some(ProxyItem::Device { proxy, .. }) = proxies.get(&info.id()) else {
        return;
    };
    proxy.enum_params(0, Some(ParamType::Route), 0, u32::MAX);
}

fn handle_node(
    global: &GlobalObject<&DictRef>,
    core: &CoreRc,
    registry: &RegistryRc,
    context: NodeRegistryContext<'_>,
    meters: &MeterManager,
) {
    let NodeRegistryContext {
        proxies,
        items,
        volume_routes,
        domain,
    } = context;
    let Some(props) = global.props.as_ref() else {
        warn!("PipeWire node {} has no properties", global.id);
        return;
    };
    let mut node = NodeDto {
        id: global.id,
        name: get_node_name(props).unwrap_or_default().to_owned(),
        media_name: props.get(&keys::MEDIA_NAME).map(str::to_owned),
        application_id: get_application_id(props).map(str::to_owned),
        application_name: get_application_name(props).map(str::to_owned),
        media_class: props.get("media.class").map(str::to_owned),
        object_name: props.get(&keys::NODE_NAME).map(str::to_owned),
        kind: get_node_kind(props).unwrap_or(NodeKind::Unknown),
        volume_percent: None,
        muted: None,
    };
    if let Some(route_key) = output_route_key_from_node_props(props) {
        let route = {
            let mut routes = volume_routes.borrow_mut();
            routes.register_node(global.id, route_key);
            routes.route_for_node(global.id).cloned()
        };
        if let Some(route) = route {
            update_node_volume_from_route(&mut node, &route);
        }
    }
    items.borrow_mut().insert(global.id, RegistryItem::Node);
    domain.borrow_mut().apply_delta(GraphDelta::NodeAdded(node));

    let media_class = props.get("media.class").unwrap_or_default();
    if media_class == "Audio/Sink" || media_class.starts_with("Audio/Sink/") {
        if let Some(target_object) = props.get(&keys::NODE_NAME) {
            meters.register_target(core, global.id, target_object);
        }
    }

    let proxy: Node = match registry.bind(global) {
        Ok(proxy) => proxy,
        Err(bind_error) => {
            warn!("failed to bind PipeWire node {}: {bind_error}", global.id);
            return;
        }
    };
    let info_domain = domain.clone();
    let info_routes = volume_routes.clone();
    let param_domain = domain.clone();
    let param_routes = volume_routes.clone();
    let node_id = global.id;
    let listener = proxy
        .add_listener_local()
        .info(move |info| handle_node_info(info, &info_routes, &info_domain))
        .param(move |_, param_type, _, _, param| {
            if param_type == ParamType::Props {
                handle_node_props(node_id, param, &param_routes, &param_domain);
            }
        })
        .register();
    proxy.subscribe_params(&[ParamType::Props]);
    proxy.enum_params(0, Some(ParamType::Props), 0, u32::MAX);
    proxies.borrow_mut().insert(
        global.id,
        ProxyItem::Node {
            proxy,
            _listener: listener,
        },
    );
}

fn handle_node_info(
    info: &::pipewire::node::NodeInfoRef,
    volume_routes: &Rc<RefCell<VolumeRouteState>>,
    domain: &Rc<RefCell<EngineCore>>,
) {
    let id = info.id();
    let Some(props) = info.props() else {
        return;
    };
    let Some(mut node) = domain.borrow().node(id).cloned() else {
        return;
    };
    update_node_from_props(&mut node, props);
    if let Some(route_key) = output_route_key_from_node_props(props) {
        let route = {
            let mut routes = volume_routes.borrow_mut();
            routes.register_node(id, route_key);
            routes.route_for_node(id).cloned()
        };
        if let Some(route) = route {
            update_node_volume_from_route(&mut node, &route);
        }
    }
    domain
        .borrow_mut()
        .apply_delta(GraphDelta::NodeUpdated(node));
}

fn update_node_from_props(node: &mut NodeDto, props: &DictRef) {
    if let Some(name) = get_node_name(props) {
        node.name = name.to_owned();
    }
    if let Some(media_name) = props.get(&keys::MEDIA_NAME) {
        node.media_name = Some(media_name.to_owned());
    }
    if let Some(application_id) = get_application_id(props) {
        node.application_id = Some(application_id.to_owned());
    }
    if let Some(application_name) = get_application_name(props) {
        node.application_name = Some(application_name.to_owned());
    }
    if let Some(media_class) = props.get("media.class") {
        node.media_class = Some(media_class.to_owned());
    }
    if let Some(object_name) = props.get(&keys::NODE_NAME) {
        node.object_name = Some(object_name.to_owned());
    }
    if let Some(kind) = get_node_kind(props) {
        node.kind = kind;
    }
}

fn output_route_key_from_node_props(props: &DictRef) -> Option<OutputRouteKey> {
    let media_class = props.get("media.class")?;
    if media_class != "Audio/Sink" && !media_class.starts_with("Audio/Sink/") {
        return None;
    }
    Some(OutputRouteKey {
        device_id: props.get("device.id")?.parse().ok()?,
        route_device_id: props.get("card.profile.device")?.parse().ok()?,
    })
}

fn handle_device_route(
    device_id: u32,
    param: Option<&Pod>,
    volume_routes: &Rc<RefCell<VolumeRouteState>>,
    domain: &Rc<RefCell<EngineCore>>,
) {
    let route = {
        let routes = volume_routes.borrow();
        parse_output_volume_route(device_id, param, &routes)
    };
    let Some(route) = route else {
        return;
    };
    let node_ids = volume_routes.borrow_mut().update_route(route.clone());
    for node_id in node_ids {
        let Some(mut node) = domain.borrow().node(node_id).cloned() else {
            continue;
        };
        if update_node_volume_from_route(&mut node, &route) {
            domain
                .borrow_mut()
                .apply_delta(GraphDelta::NodeUpdated(node));
        }
    }
}

fn parse_output_volume_route(
    device_id: u32,
    param: Option<&Pod>,
    known_routes: &VolumeRouteState,
) -> Option<OutputVolumeRoute> {
    let (_, Value::Object(object)) =
        PodDeserializer::deserialize_any_from(param?.as_bytes()).ok()?
    else {
        return None;
    };
    let mut route_index = None;
    let mut direction = None;
    let mut route_device_id = None;
    let mut route_props = None;
    for property in object.properties {
        match (property.key, property.value) {
            (libspa::sys::SPA_PARAM_ROUTE_index, Value::Int(value)) => {
                route_index = Some(value);
            }
            (libspa::sys::SPA_PARAM_ROUTE_direction, Value::Id(value)) => {
                direction = Some(value);
            }
            (libspa::sys::SPA_PARAM_ROUTE_device, Value::Int(value)) => {
                route_device_id = Some(value);
            }
            (libspa::sys::SPA_PARAM_ROUTE_props, Value::Object(value)) => {
                route_props = Some(value);
            }
            _ => {}
        }
    }
    let route_index = route_index?;
    let route_device_id = route_device_id?;
    let key = OutputRouteKey {
        device_id,
        route_device_id,
    };
    let known_route = known_routes.routes.get(&key);
    match direction {
        Some(direction) if direction != Id(SpaDirection::Output.as_raw()) => return None,
        None if known_route.is_none() => return None,
        _ => {}
    }

    let mut scalar_volume = None;
    let mut channel_volumes = Vec::new();
    let mut channel_map = Vec::new();
    let mut muted = None;
    for property in route_props?.properties {
        match (property.key, property.value) {
            (libspa::sys::SPA_PROP_volume, Value::Float(value)) => {
                scalar_volume = Some(value);
            }
            (
                libspa::sys::SPA_PROP_channelVolumes,
                Value::ValueArray(ValueArray::Float(values)),
            ) => channel_volumes = values,
            (libspa::sys::SPA_PROP_channelMap, Value::ValueArray(ValueArray::Id(values))) => {
                channel_map = values
            }
            (libspa::sys::SPA_PROP_mute, Value::Bool(value)) => muted = Some(value),
            _ => {}
        }
    }
    if channel_volumes.is_empty() {
        if let Some(volume) = scalar_volume {
            channel_volumes.push(volume);
        } else if let Some(route) = known_route {
            channel_volumes.clone_from(&route.channel_volumes);
        }
    }
    if channel_map.is_empty() {
        if let Some(route) = known_route {
            channel_map.clone_from(&route.channel_map);
        }
    }
    if muted.is_none() {
        muted = known_route.and_then(|route| route.muted);
    }
    if channel_volumes.is_empty() && muted.is_none() {
        return None;
    }

    Some(OutputVolumeRoute {
        device_id,
        route_index,
        route_device_id,
        channel_volumes,
        channel_map,
        muted,
    })
}

fn update_node_volume_from_route(node: &mut NodeDto, route: &OutputVolumeRoute) -> bool {
    let volume_percent = volume_percent_from_linear(&route.channel_volumes);
    let mut changed = false;
    if let Some(volume_percent) = volume_percent {
        changed |= node.volume_percent != Some(volume_percent);
        node.volume_percent = Some(volume_percent);
    }
    if let Some(muted) = route.muted {
        changed |= node.muted != Some(muted);
        node.muted = Some(muted);
    }
    changed
}

fn volume_percent_from_linear(volumes: &[f32]) -> Option<u16> {
    if volumes.is_empty() {
        return None;
    }
    let average = volumes.iter().copied().sum::<f32>() / volumes.len() as f32;
    Some((average.max(0.0).cbrt() * 100.0).round() as u16)
}

fn handle_node_props(
    node_id: u32,
    param: Option<&Pod>,
    volume_routes: &Rc<RefCell<VolumeRouteState>>,
    domain: &Rc<RefCell<EngineCore>>,
) {
    if volume_routes.borrow().route_for_node(node_id).is_some() {
        return;
    }
    let Some(param) = param else {
        return;
    };
    let Ok((_, Value::Object(object))) = PodDeserializer::deserialize_any_from(param.as_bytes())
    else {
        return;
    };
    let mut volume_percent = None;
    let mut muted = None;
    for property in object.properties {
        match (property.key, property.value) {
            (
                libspa::sys::SPA_PROP_channelVolumes,
                Value::ValueArray(ValueArray::Float(volumes)),
            ) if !volumes.is_empty() => {
                volume_percent = volume_percent_from_linear(&volumes);
            }
            (libspa::sys::SPA_PROP_mute, Value::Bool(value)) => muted = Some(value),
            _ => {}
        }
    }
    if volume_percent.is_none() && muted.is_none() {
        return;
    }
    let Some(mut node) = domain.borrow().node(node_id).cloned() else {
        return;
    };
    let mut changed = false;
    if let Some(volume_percent) = volume_percent {
        changed |= node.volume_percent != Some(volume_percent);
        node.volume_percent = Some(volume_percent);
    }
    if let Some(muted) = muted {
        changed |= node.muted != Some(muted);
        node.muted = Some(muted);
    }
    if changed {
        domain
            .borrow_mut()
            .apply_delta(GraphDelta::NodeUpdated(node));
    }
}

fn handle_port(
    global: &GlobalObject<&DictRef>,
    registry: &RegistryRc,
    proxies: &Rc<RefCell<HashMap<u32, ProxyItem>>>,
    items: &Rc<RefCell<RegistryItems>>,
    domain: &Rc<RefCell<EngineCore>>,
) {
    let port_id = global.id;
    let proxy: Port = match registry.bind(global) {
        Ok(proxy) => proxy,
        Err(bind_error) => {
            warn!("failed to bind PipeWire port {port_id}: {bind_error}");
            return;
        }
    };
    let info_domain = domain.clone();
    let info_items = items.clone();
    let info_proxies = proxies.clone();
    let param_domain = domain.clone();
    let listener = proxy
        .add_listener_local()
        .info(move |info| handle_port_info(info, &info_domain, &info_items, &info_proxies))
        .param(move |_, param_id, _, _, param| {
            if param_id == ParamType::EnumFormat {
                handle_port_format(port_id, param, &param_domain);
            }
        })
        .register();
    proxies.borrow_mut().insert(
        port_id,
        ProxyItem::Port {
            proxy,
            _listener: listener,
        },
    );
}

fn handle_port_info(
    info: &::pipewire::port::PortInfoRef,
    domain: &Rc<RefCell<EngineCore>>,
    items: &Rc<RefCell<RegistryItems>>,
    proxies: &Rc<RefCell<HashMap<u32, ProxyItem>>>,
) {
    let id = info.id();
    if items.borrow().contains(id) {
        if info.change_mask().contains(PortChangeMask::PARAMS) {
            request_port_formats(id, info, proxies);
        }
        return;
    }

    let Some(props) = info.props() else {
        warn!("PipeWire port {id} has no properties");
        return;
    };
    let Some(node_id) = props.get("node.id").and_then(|value| value.parse().ok()) else {
        warn!("PipeWire port {id} has no valid node.id");
        return;
    };
    let direction = if info.direction() == SpaDirection::Output {
        PortDirection::Output
    } else {
        PortDirection::Input
    };
    let port = PortDto {
        id,
        node_id,
        name: props.get("port.name").unwrap_or_default().to_owned(),
        channel: props.get("audio.channel").map(str::to_owned),
        direction,
        media_type: MediaType::Unknown,
    };
    items.borrow_mut().insert(id, RegistryItem::Port);
    domain.borrow_mut().apply_delta(GraphDelta::PortAdded(port));
    request_port_formats(id, info, proxies);
}

fn request_port_formats(
    id: u32,
    info: &::pipewire::port::PortInfoRef,
    proxies: &Rc<RefCell<HashMap<u32, ProxyItem>>>,
) {
    let proxies = proxies.borrow();
    let Some(ProxyItem::Port { proxy, .. }) = proxies.get(&id) else {
        return;
    };
    if info.params().iter().any(|param| {
        param.id() == ParamType::EnumFormat && param.flags().contains(ParamInfoFlags::READ)
    }) {
        proxy.enum_params(0, Some(ParamType::EnumFormat), 0, u32::MAX);
    }
}

fn handle_port_format(
    port_id: u32,
    param: Option<&libspa::pod::Pod>,
    domain: &Rc<RefCell<EngineCore>>,
) {
    let Some(mut port) = domain.borrow().port(port_id).cloned() else {
        return;
    };
    let media_type = classify_format(param);
    if port.media_type == media_type {
        return;
    }
    port.media_type = media_type;
    domain
        .borrow_mut()
        .apply_delta(GraphDelta::PortUpdated(port));
}

fn handle_link(
    global: &GlobalObject<&DictRef>,
    registry: &RegistryRc,
    proxies: &Rc<RefCell<HashMap<u32, ProxyItem>>>,
    items: &Rc<RefCell<RegistryItems>>,
    domain: &Rc<RefCell<EngineCore>>,
) {
    let proxy: Link = match registry.bind(global) {
        Ok(proxy) => proxy,
        Err(bind_error) => {
            warn!("failed to bind PipeWire link {}: {bind_error}", global.id);
            return;
        }
    };
    let info_domain = domain.clone();
    let info_items = items.clone();
    let listener = proxy
        .add_listener_local()
        .info(move |info| handle_link_info(info, &info_domain, &info_items))
        .register();
    proxies.borrow_mut().insert(
        global.id,
        ProxyItem::Link {
            _proxy: proxy,
            _listener: listener,
        },
    );
}

fn handle_link_info(
    info: &::pipewire::link::LinkInfoRef,
    domain: &Rc<RefCell<EngineCore>>,
    items: &Rc<RefCell<RegistryItems>>,
) {
    let id = info.id();
    if items.borrow().contains(id) {
        let Some(mut link) = domain.borrow().link(id).cloned() else {
            return;
        };
        let mut changed = false;
        if info.change_mask().contains(LinkChangeMask::STATE) {
            link.active = matches!(info.state(), LinkState::Active);
            changed = true;
        }
        if info.change_mask().contains(LinkChangeMask::FORMAT) {
            link.media_type = classify_format(info.format());
            changed = true;
        }
        if changed {
            domain
                .borrow_mut()
                .apply_delta(GraphDelta::LinkUpdated(link));
        }
        return;
    }

    let link = LinkDto {
        id,
        output_port_id: info.output_port_id(),
        input_port_id: info.input_port_id(),
        active: matches!(info.state(), LinkState::Active),
        media_type: classify_format(info.format()),
    };
    items.borrow_mut().insert(id, RegistryItem::Link);
    domain.borrow_mut().apply_delta(GraphDelta::LinkAdded(link));
}

fn handle_metadata(
    global: &GlobalObject<&DictRef>,
    registry: &RegistryRc,
    proxies: &Rc<RefCell<HashMap<u32, ProxyItem>>>,
    items: &Rc<RefCell<RegistryItems>>,
    domain: &Rc<RefCell<EngineCore>>,
) {
    let is_default = global
        .props
        .as_ref()
        .and_then(|props| props.get("metadata.name"))
        == Some(DEFAULT_METADATA_NAME);
    if !is_default {
        return;
    }

    let proxy: Metadata = match registry.bind(global) {
        Ok(proxy) => proxy,
        Err(bind_error) => {
            warn!(
                "failed to bind PipeWire default metadata {}: {bind_error}",
                global.id
            );
            return;
        }
    };
    let metadata_domain = domain.clone();
    let listener = proxy
        .add_listener_local()
        .property(move |subject, key, _type, value| {
            if subject != ::pipewire::core::PW_ID_CORE {
                return 0;
            }
            match key {
                Some(ACTIVE_AUDIO_SINK_KEY) => {
                    metadata_domain
                        .borrow_mut()
                        .apply_delta(GraphDelta::DefaultAudioSinkChanged {
                            name: parse_default_node_name(value),
                        });
                }
                Some(ACTIVE_AUDIO_SOURCE_KEY) => {
                    metadata_domain.borrow_mut().apply_delta(
                        GraphDelta::DefaultAudioSourceChanged {
                            name: parse_default_node_name(value),
                        },
                    );
                }
                None => {
                    let mut domain = metadata_domain.borrow_mut();
                    domain.apply_delta(GraphDelta::DefaultAudioSinkChanged { name: None });
                    domain.apply_delta(GraphDelta::DefaultAudioSourceChanged { name: None });
                }
                _ => {}
            }
            0
        })
        .register();
    items.borrow_mut().insert(global.id, RegistryItem::Metadata);
    proxies.borrow_mut().insert(
        global.id,
        ProxyItem::Metadata {
            proxy,
            _listener: listener,
        },
    );
}

fn parse_default_node_name(value: Option<&str>) -> Option<String> {
    value
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .and_then(|value| {
            value
                .get("name")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .filter(|name| !name.trim().is_empty())
}

fn classify_format(param: Option<&libspa::pod::Pod>) -> MediaType {
    let Some((media_type, media_subtype)) =
        param.and_then(|pod| libspa::param::format_utils::parse_format(pod).ok())
    else {
        return MediaType::Unknown;
    };
    let media = format!("{media_type:?}").to_ascii_lowercase();
    let subtype = format!("{media_subtype:?}").to_ascii_lowercase();
    classify_media_type(&media, &subtype)
}

fn classify_media_type(media: &str, subtype: &str) -> MediaType {
    if media.contains("midi")
        || subtype.contains("midi")
        || (media.contains("application") && subtype.contains("control"))
    {
        MediaType::Midi
    } else if media.contains("audio") {
        MediaType::Audio
    } else if media.contains("video") {
        MediaType::Video
    } else {
        MediaType::Unknown
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use libspa::pod::{serialize::PodSerializer, Object, Property};

    use super::*;

    fn serialize_route(
        direction: Option<SpaDirection>,
        channel_volumes: Vec<f32>,
        muted: bool,
    ) -> Vec<u8> {
        let mut properties = vec![Property::new(
            libspa::sys::SPA_PARAM_ROUTE_index,
            Value::Int(1),
        )];
        if let Some(direction) = direction {
            properties.push(Property::new(
                libspa::sys::SPA_PARAM_ROUTE_direction,
                Value::Id(Id(direction.as_raw())),
            ));
        }
        properties.extend([
            Property::new(libspa::sys::SPA_PARAM_ROUTE_device, Value::Int(1)),
            Property::new(
                libspa::sys::SPA_PARAM_ROUTE_props,
                Value::Object(Object {
                    type_: libspa::sys::SPA_TYPE_OBJECT_Props,
                    id: libspa::sys::SPA_PARAM_Route,
                    properties: vec![
                        Property::new(
                            libspa::sys::SPA_PROP_channelVolumes,
                            Value::ValueArray(ValueArray::Float(channel_volumes)),
                        ),
                        Property::new(
                            libspa::sys::SPA_PROP_channelMap,
                            Value::ValueArray(ValueArray::Id(vec![Id(3), Id(4)])),
                        ),
                        Property::new(libspa::sys::SPA_PROP_mute, Value::Bool(muted)),
                    ],
                }),
            ),
            Property::new(libspa::sys::SPA_PARAM_ROUTE_save, Value::Bool(true)),
        ]);
        PodSerializer::serialize(
            Cursor::new(Vec::new()),
            &Value::Object(Object {
                type_: libspa::sys::SPA_TYPE_OBJECT_ParamRoute,
                id: libspa::sys::SPA_PARAM_Route,
                properties,
            }),
        )
        .unwrap()
        .0
        .into_inner()
    }

    fn output_node(volume_percent: u16) -> NodeDto {
        NodeDto {
            id: 55,
            name: "Nothing Ear (open)".into(),
            media_name: Some("Nothing Ear (open)".into()),
            application_id: None,
            application_name: None,
            media_class: Some("Audio/Sink".into()),
            object_name: Some("bluez_output.headset".into()),
            kind: NodeKind::Input,
            volume_percent: Some(volume_percent),
            muted: Some(false),
        }
    }

    #[test]
    fn sparse_node_info_does_not_erase_registry_metadata() {
        let mut node = NodeDto {
            id: 65,
            name: "Spotify".into(),
            media_name: Some("Spotify".into()),
            application_id: Some("spotify".into()),
            application_name: Some("Spotify".into()),
            media_class: Some("Stream/Output/Audio".into()),
            object_name: Some("stream.spotify".into()),
            kind: NodeKind::Output,
            volume_percent: None,
            muted: None,
        };
        let sparse = libspa::static_dict! {
            "object.serial" => "65"
        };

        update_node_from_props(&mut node, &sparse);

        assert_eq!(node.name, "Spotify");
        assert_eq!(node.media_name.as_deref(), Some("Spotify"));
        assert_eq!(node.media_class.as_deref(), Some("Stream/Output/Audio"));
        assert_eq!(node.object_name.as_deref(), Some("stream.spotify"));
        assert_eq!(node.kind, NodeKind::Output);
    }

    #[test]
    fn node_name_uses_readable_application_fallbacks() {
        let props = libspa::static_dict! {
            "application.name" => "Spotify",
            "object.path" => "technical.object.path"
        };

        assert_eq!(get_node_name(&props), Some("Spotify"));
    }

    #[test]
    fn application_identity_prefers_stable_desktop_id_then_binary() {
        let desktop_id = libspa::static_dict! {
            "application.id" => "com.spotify.Client",
            "application.name" => "Spotify",
            "application.process.binary" => "spotify"
        };
        let binary_fallback = libspa::static_dict! {
            "application.name" => "Firefox",
            "application.process.binary" => "firefox"
        };

        assert_eq!(get_application_id(&desktop_id), Some("com.spotify.Client"));
        assert_eq!(get_application_name(&desktop_id), Some("Spotify"));
        assert_eq!(get_application_id(&binary_fallback), Some("firefox"));
        assert_eq!(get_application_name(&binary_fallback), Some("Firefox"));
    }

    #[test]
    fn classifies_node_lanes_from_pipewire_metadata() {
        assert_eq!(
            classify_node_kind("Stream/Output/Audio", None),
            NodeKind::Output
        );
        assert_eq!(classify_node_kind("Audio/Sink", None), NodeKind::Input);
        assert_eq!(
            classify_node_kind("Audio/Sink", Some("Duplex")),
            NodeKind::Duplex
        );
        assert_eq!(classify_node_kind("Other", None), NodeKind::Unknown);
    }

    #[test]
    fn classifies_audio_video_midi_and_unknown_formats() {
        assert_eq!(classify_media_type("audio", "raw"), MediaType::Audio);
        assert_eq!(classify_media_type("video", "raw"), MediaType::Video);
        assert_eq!(
            classify_media_type("application", "control"),
            MediaType::Midi
        );
        assert_eq!(classify_media_type("audio", "midi"), MediaType::Midi);
        assert_eq!(
            classify_media_type("application", "unknown"),
            MediaType::Unknown
        );
    }

    #[test]
    fn parses_wireplumber_default_node_metadata() {
        assert_eq!(
            parse_default_node_name(Some(r#"{"name":"alsa_output.pci"}"#)).as_deref(),
            Some("alsa_output.pci")
        );
        assert_eq!(parse_default_node_name(Some("not-json")), None);
        assert_eq!(parse_default_node_name(None), None);
    }

    #[test]
    fn associates_device_backed_audio_sinks_with_routes() {
        let props = libspa::static_dict! {
            "media.class" => "Audio/Sink",
            "device.id" => "163",
            "card.profile.device" => "1"
        };
        let stream_props = libspa::static_dict! {
            "media.class" => "Stream/Output/Audio",
            "device.id" => "163",
            "card.profile.device" => "1"
        };

        assert_eq!(
            output_route_key_from_node_props(&props),
            Some(OutputRouteKey {
                device_id: 163,
                route_device_id: 1,
            })
        );
        assert_eq!(output_route_key_from_node_props(&stream_props), None);
    }

    #[test]
    fn parses_output_route_volume_and_rejects_input_routes() {
        let bytes = serialize_route(
            Some(SpaDirection::Output),
            vec![0.324_346, 0.324_346],
            false,
        );
        let mut routes = VolumeRouteState::default();
        let route = parse_output_volume_route(163, Pod::from_bytes(&bytes), &routes).unwrap();

        assert_eq!(route.device_id, 163);
        assert_eq!(route.route_index, 1);
        assert_eq!(route.route_device_id, 1);
        assert_eq!(route.channel_map, vec![Id(3), Id(4)]);
        assert_eq!(route.muted, Some(false));
        assert_eq!(volume_percent_from_linear(&route.channel_volumes), Some(69));

        routes.update_route(route);
        let sparse = serialize_route(None, vec![0.389_017, 0.389_017], false);
        let sparse = parse_output_volume_route(163, Pod::from_bytes(&sparse), &routes).unwrap();
        assert_eq!(
            volume_percent_from_linear(&sparse.channel_volumes),
            Some(73)
        );

        let input = serialize_route(Some(SpaDirection::Input), vec![1.0], false);
        assert_eq!(
            parse_output_volume_route(163, Pod::from_bytes(&input), &routes),
            None
        );
    }

    #[test]
    fn device_route_volume_overrides_stale_node_props() {
        let route = OutputVolumeRoute {
            device_id: 163,
            route_index: 1,
            route_device_id: 1,
            channel_volumes: vec![0.324_346, 0.324_346],
            channel_map: vec![Id(3), Id(4)],
            muted: Some(true),
        };
        let key = route.key();
        let mut routes = VolumeRouteState::default();
        routes.register_node(55, key);
        assert_eq!(routes.update_route(route.clone()), vec![55]);

        let mut node = output_node(76);
        assert!(update_node_volume_from_route(&mut node, &route));
        assert_eq!(node.volume_percent, Some(69));
        assert_eq!(node.muted, Some(true));
        assert_eq!(routes.route_for_node(55), Some(&route));

        routes.remove_device(163);
        assert_eq!(routes.route_for_node(55), None);
    }
}
