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

use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    convert::TryInto,
    f32::consts::TAU,
    io::Cursor,
    mem,
    rc::Rc,
    time::{Duration, Instant},
};

use ::pipewire::{
    context::ContextRc,
    core::CoreRc,
    keys,
    link::{Link, LinkChangeMask, LinkListener, LinkState},
    main_loop::MainLoopRc,
    metadata::{Metadata, MetadataListener},
    node::{Node, NodeListener},
    port::{Port, PortChangeMask, PortListener},
    registry::{GlobalObject, RegistryRc},
    stream::{StreamFlags, StreamListener, StreamRc, StreamState},
    types::ObjectType,
};
use libspa::{
    param::{ParamInfoFlags, ParamType},
    pod::{
        deserialize::PodDeserializer, serialize::PodSerializer, Object, Pod, Property, Value,
        ValueArray,
    },
    utils::{dict::DictRef, Direction as SpaDirection},
};
use log::{debug, error, info, warn};

use super::{
    items::{RegistryItem, RegistryItems},
    EngineCore, EngineRequest, PipeWireAdapter,
};
use crate::{
    graph_state::{
        ValidatedDefaultAudioSink, ValidatedDefaultAudioSource, ValidatedLink,
        ValidatedOutputVolume,
    },
    model::{
        GraphDelta, GraphStatus, LinkDto, MediaType, NodeDto, NodeKind, OutputLevel, PortDirection,
        PortDto,
    },
};

const DEFAULT_METADATA_NAME: &str = "default";
const ACTIVE_AUDIO_SINK_KEY: &str = "default.audio.sink";
const CONFIGURED_AUDIO_SINK_KEY: &str = "default.configured.audio.sink";
const ACTIVE_AUDIO_SOURCE_KEY: &str = "default.audio.source";
const CONFIGURED_AUDIO_SOURCE_KEY: &str = "default.configured.audio.source";
const JSON_METADATA_TYPE: &str = "Spa:String:JSON";
const OUTPUT_METER_INTERVAL: Duration = Duration::from_millis(32);
const OUTPUT_SPECTRUM_BANDS: usize = 32;
const OUTPUT_SPECTRUM_WINDOW: usize = 2_048;
const OUTPUT_SPECTRUM_MIN_FREQUENCY: f32 = 30.0;
const OUTPUT_SPECTRUM_MAX_FREQUENCY: f32 = 20_000.0;
const OUTPUT_SPECTRUM_RELEASE: f32 = 0.78;
const OUTPUT_SPECTRUM_NOISE_FLOOR: f32 = 0.000_01;

#[derive(Clone, Copy, Default)]
struct ComplexSample {
    real: f32,
    imaginary: f32,
}

struct MeterUserData {
    node_id: u32,
    sender: ::pipewire::channel::Sender<OutputLevel>,
    format: libspa::param::audio::AudioInfoRaw,
    left_samples: [f32; OUTPUT_SPECTRUM_WINDOW],
    right_samples: [f32; OUTPUT_SPECTRUM_WINDOW],
    sample_cursor: usize,
    sample_count: usize,
    last_emit: Instant,
    last_peak: f32,
    last_left_spectrum: [f32; OUTPUT_SPECTRUM_BANDS],
    last_right_spectrum: [f32; OUTPUT_SPECTRUM_BANDS],
}

struct MeterStream {
    _listener: StreamListener<MeterUserData>,
    _stream: StreamRc,
}

enum ProxyItem {
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

struct OfflineAdapter;

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

struct LiveAdapter<'a> {
    core: &'a CoreRc,
    registry: &'a RegistryRc,
    proxies: &'a Rc<RefCell<HashMap<u32, ProxyItem>>>,
    meter_targets: &'a Rc<RefCell<HashMap<u32, String>>>,
    meters: &'a Rc<RefCell<HashMap<u32, MeterStream>>>,
    meter_level_sender: &'a ::pipewire::channel::Sender<OutputLevel>,
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
        let proxies = self.proxies.borrow();
        let metadata = proxies.values().find_map(|item| match item {
            ProxyItem::Metadata { proxy, .. } => Some(proxy),
            _ => None,
        });
        let Some(metadata) = metadata else {
            return Err("WirePlumber default-device metadata is unavailable".to_owned());
        };
        let value = serde_json::json!({ "name": sink.node_name }).to_string();
        info!(
            "requesting default audio sink {} ({})",
            sink.node_id, sink.node_name
        );
        metadata.set_property(
            ::pipewire::core::PW_ID_CORE,
            CONFIGURED_AUDIO_SINK_KEY,
            Some(JSON_METADATA_TYPE),
            Some(&value),
        );
        Ok(())
    }

    fn set_default_audio_source(&self, source: ValidatedDefaultAudioSource) -> Result<(), String> {
        let proxies = self.proxies.borrow();
        let metadata = proxies.values().find_map(|item| match item {
            ProxyItem::Metadata { proxy, .. } => Some(proxy),
            _ => None,
        });
        let Some(metadata) = metadata else {
            return Err("WirePlumber default-device metadata is unavailable".to_owned());
        };
        let value = serde_json::json!({ "name": source.node_name }).to_string();
        info!(
            "requesting default audio source {} ({})",
            source.node_id, source.node_name
        );
        metadata.set_property(
            ::pipewire::core::PW_ID_CORE,
            CONFIGURED_AUDIO_SOURCE_KEY,
            Some(JSON_METADATA_TYPE),
            Some(&value),
        );
        Ok(())
    }

    fn set_output_volume(&self, volume: ValidatedOutputVolume) -> Result<(), String> {
        let values = serialize_output_volume(&volume)?;
        let pod = Pod::from_bytes(&values)
            .ok_or_else(|| "Could not serialize PipeWire volume parameters".to_owned())?;
        let proxies = self.proxies.borrow();
        let Some(ProxyItem::Node { proxy, .. }) = proxies.get(&volume.node_id) else {
            return Err(format!(
                "PipeWire output node {} is unavailable",
                volume.node_id
            ));
        };
        info!(
            "requesting output volume update for node {}: volume={:?}, muted={:?}",
            volume.node_id, volume.volume_percent, volume.muted
        );
        proxy.set_param(ParamType::Props, 0, pod);
        Ok(())
    }

    fn set_output_metering(&self, enabled: bool) {
        if !enabled {
            self.meters.borrow_mut().clear();
            return;
        }

        let targets = self.meter_targets.borrow().clone();
        for (node_id, target_object) in targets {
            ensure_output_meter(
                self.core,
                node_id,
                &target_object,
                self.meters,
                self.meter_level_sender,
            );
        }
    }
}

fn ensure_output_meter(
    core: &CoreRc,
    node_id: u32,
    target_object: &str,
    meters: &Rc<RefCell<HashMap<u32, MeterStream>>>,
    meter_level_sender: &::pipewire::channel::Sender<OutputLevel>,
) {
    if meters.borrow().contains_key(&node_id) {
        return;
    }
    match create_output_meter(core, node_id, target_object, meter_level_sender.clone()) {
        Ok(meter) => {
            meters.borrow_mut().insert(node_id, meter);
        }
        Err(error) => warn!("failed to start output meter for node {node_id}: {error}"),
    }
}

fn create_output_meter(
    core: &CoreRc,
    node_id: u32,
    target_object: &str,
    sender: ::pipewire::channel::Sender<OutputLevel>,
) -> Result<MeterStream, String> {
    let stream_name = format!("cordflow-output-meter-{node_id}");
    let stream = StreamRc::new(
        core.clone(),
        &stream_name,
        ::pipewire::properties::properties! {
            *keys::NODE_NAME => stream_name.clone(),
            *keys::MEDIA_NAME => format!("Cordflow output meter {node_id}"),
            *keys::MEDIA_TYPE => "Audio",
            *keys::MEDIA_CATEGORY => "Capture",
            *keys::MEDIA_ROLE => "Production",
            *keys::STREAM_CAPTURE_SINK => "true",
            "target.object" => target_object.to_owned(),
        },
    )
    .map_err(|error| format!("Could not create PipeWire meter stream: {error}"))?;

    let user_data = MeterUserData {
        node_id,
        sender,
        format: libspa::param::audio::AudioInfoRaw::new(),
        left_samples: [0.0; OUTPUT_SPECTRUM_WINDOW],
        right_samples: [0.0; OUTPUT_SPECTRUM_WINDOW],
        sample_cursor: 0,
        sample_count: 0,
        last_emit: Instant::now() - OUTPUT_METER_INTERVAL,
        last_peak: 0.0,
        last_left_spectrum: [0.0; OUTPUT_SPECTRUM_BANDS],
        last_right_spectrum: [0.0; OUTPUT_SPECTRUM_BANDS],
    };
    let listener = stream
        .add_local_listener_with_user_data(user_data)
        .state_changed(|_, user_data, _, state| {
            if matches!(
                state,
                StreamState::Paused | StreamState::Unconnected | StreamState::Error(_)
            ) && (user_data.last_peak > 0.0
                || user_data
                    .last_left_spectrum
                    .iter()
                    .chain(user_data.last_right_spectrum.iter())
                    .any(|band| *band > 0.0))
            {
                user_data.last_peak = 0.0;
                user_data.last_left_spectrum = [0.0; OUTPUT_SPECTRUM_BANDS];
                user_data.last_right_spectrum = [0.0; OUTPUT_SPECTRUM_BANDS];
                let _ = user_data.sender.send(OutputLevel {
                    node_id: user_data.node_id,
                    peak: 0.0,
                    spectrum: [0.0; OUTPUT_SPECTRUM_BANDS],
                    left_spectrum: [0.0; OUTPUT_SPECTRUM_BANDS],
                    right_spectrum: [0.0; OUTPUT_SPECTRUM_BANDS],
                });
            }
        })
        .param_changed(|_, user_data, id, param| {
            let Some(param) = param else {
                return;
            };
            if id != ParamType::Format.as_raw() {
                return;
            }
            let Ok((media_type, media_subtype)) = libspa::param::format_utils::parse_format(param)
            else {
                return;
            };
            if media_type != libspa::param::format::MediaType::Audio
                || media_subtype != libspa::param::format::MediaSubtype::Raw
            {
                return;
            }
            if let Err(error) = user_data.format.parse(param) {
                warn!(
                    "failed to parse output meter format for node {}: {error:?}",
                    user_data.node_id
                );
            }
        })
        .process(|stream, user_data| {
            let Some(mut buffer) = stream.dequeue_buffer() else {
                return;
            };
            let Some(data) = buffer.datas_mut().first_mut() else {
                return;
            };
            let byte_count = data.chunk().size() as usize;
            let Some(bytes) = data.data() else {
                return;
            };
            let channels = usize::try_from(user_data.format.channels())
                .unwrap_or(1)
                .max(1);
            let frame_size = mem::size_of::<f32>() * channels;
            let mut peak = 0.0_f32;
            for frame in bytes[..byte_count.min(bytes.len())].chunks_exact(frame_size) {
                let (left, right, frame_peak) = decode_stereo_frame(frame);
                peak = peak.max(frame_peak);
                user_data.left_samples[user_data.sample_cursor] = left;
                user_data.right_samples[user_data.sample_cursor] = right;
                user_data.sample_cursor = (user_data.sample_cursor + 1) % OUTPUT_SPECTRUM_WINDOW;
                user_data.sample_count = (user_data.sample_count + 1).min(OUTPUT_SPECTRUM_WINDOW);
            }
            peak = peak.clamp(0.0, 4.0);
            user_data.last_peak = peak;
            if user_data.last_emit.elapsed() < OUTPUT_METER_INTERVAL {
                return;
            }
            user_data.last_emit = Instant::now();
            let sample_rate = user_data.format.rate();
            let (left_spectrum, right_spectrum) =
                if user_data.sample_count == OUTPUT_SPECTRUM_WINDOW && sample_rate > 0 {
                    (
                        calculate_output_spectrum(
                            &user_data.left_samples,
                            user_data.sample_cursor,
                            sample_rate,
                            &user_data.last_left_spectrum,
                        ),
                        calculate_output_spectrum(
                            &user_data.right_samples,
                            user_data.sample_cursor,
                            sample_rate,
                            &user_data.last_right_spectrum,
                        ),
                    )
                } else {
                    ([0.0; OUTPUT_SPECTRUM_BANDS], [0.0; OUTPUT_SPECTRUM_BANDS])
                };
            let spectrum =
                std::array::from_fn(|index| left_spectrum[index].max(right_spectrum[index]));
            user_data.last_left_spectrum = left_spectrum;
            user_data.last_right_spectrum = right_spectrum;
            let _ = user_data.sender.send(OutputLevel {
                node_id: user_data.node_id,
                peak,
                spectrum,
                left_spectrum,
                right_spectrum,
            });
        })
        .register()
        .map_err(|error| format!("Could not listen to PipeWire meter stream: {error}"))?;

    let mut audio_info = libspa::param::audio::AudioInfoRaw::new();
    audio_info.set_format(libspa::param::audio::AudioFormat::F32LE);
    let values = PodSerializer::serialize(
        Cursor::new(Vec::new()),
        &Value::Object(Object {
            type_: libspa::sys::SPA_TYPE_OBJECT_Format,
            id: libspa::sys::SPA_PARAM_EnumFormat,
            properties: audio_info.into(),
        }),
    )
    .map_err(|error| format!("Could not serialize meter format: {error:?}"))?
    .0
    .into_inner();
    let mut params = [Pod::from_bytes(&values)
        .ok_or_else(|| "Could not create PipeWire meter format".to_owned())?];

    stream
        .connect(
            SpaDirection::Input,
            None,
            StreamFlags::AUTOCONNECT | StreamFlags::MAP_BUFFERS | StreamFlags::RT_PROCESS,
            &mut params,
        )
        .map_err(|error| format!("Could not connect PipeWire meter stream: {error}"))?;

    Ok(MeterStream {
        _listener: listener,
        _stream: stream,
    })
}

fn decode_stereo_frame(frame: &[u8]) -> (f32, f32, f32) {
    let mut left = 0.0_f32;
    let mut right = None;
    let mut peak = 0.0_f32;
    for (channel, sample) in frame.chunks_exact(mem::size_of::<f32>()).enumerate() {
        let value = f32::from_le_bytes(sample.try_into().expect("four-byte sample"));
        peak = peak.max(value.abs());
        if channel == 0 {
            left = value;
        } else if channel == 1 {
            right = Some(value);
        }
    }
    (left, right.unwrap_or(left), peak)
}

fn calculate_output_spectrum(
    samples: &[f32; OUTPUT_SPECTRUM_WINDOW],
    sample_cursor: usize,
    sample_rate: u32,
    previous: &[f32; OUTPUT_SPECTRUM_BANDS],
) -> [f32; OUTPUT_SPECTRUM_BANDS] {
    let mut fft = [ComplexSample::default(); OUTPUT_SPECTRUM_WINDOW];
    let mut window_sum = 0.0_f32;
    for (index, value) in fft.iter_mut().enumerate() {
        let window = 0.5 - 0.5 * (TAU * index as f32 / (OUTPUT_SPECTRUM_WINDOW - 1) as f32).cos();
        let sample_index = (sample_cursor + index) % OUTPUT_SPECTRUM_WINDOW;
        value.real = samples[sample_index] * window;
        window_sum += window;
    }

    let mut reversed = 0_usize;
    for index in 1..OUTPUT_SPECTRUM_WINDOW {
        let mut bit = OUTPUT_SPECTRUM_WINDOW >> 1;
        while reversed & bit != 0 {
            reversed ^= bit;
            bit >>= 1;
        }
        reversed ^= bit;
        if index < reversed {
            fft.swap(index, reversed);
        }
    }

    let mut length = 2_usize;
    while length <= OUTPUT_SPECTRUM_WINDOW {
        let angle = -TAU / length as f32;
        let step = ComplexSample {
            real: angle.cos(),
            imaginary: angle.sin(),
        };
        for offset in (0..OUTPUT_SPECTRUM_WINDOW).step_by(length) {
            let mut twiddle = ComplexSample {
                real: 1.0,
                imaginary: 0.0,
            };
            for index in 0..length / 2 {
                let even = fft[offset + index];
                let odd = fft[offset + index + length / 2];
                let rotated = ComplexSample {
                    real: odd.real * twiddle.real - odd.imaginary * twiddle.imaginary,
                    imaginary: odd.real * twiddle.imaginary + odd.imaginary * twiddle.real,
                };
                fft[offset + index] = ComplexSample {
                    real: even.real + rotated.real,
                    imaginary: even.imaginary + rotated.imaginary,
                };
                fft[offset + index + length / 2] = ComplexSample {
                    real: even.real - rotated.real,
                    imaginary: even.imaginary - rotated.imaginary,
                };
                twiddle = ComplexSample {
                    real: twiddle.real * step.real - twiddle.imaginary * step.imaginary,
                    imaginary: twiddle.real * step.imaginary + twiddle.imaginary * step.real,
                };
            }
        }
        length <<= 1;
    }

    let highest_frequency = (sample_rate as f32 / 2.0).min(OUTPUT_SPECTRUM_MAX_FREQUENCY);
    if highest_frequency <= OUTPUT_SPECTRUM_MIN_FREQUENCY {
        return [0.0; OUTPUT_SPECTRUM_BANDS];
    }
    let frequency_span = (highest_frequency / OUTPUT_SPECTRUM_MIN_FREQUENCY).ln();
    let amplitude_scale = 2.0 / window_sum.max(1.0);
    let mut spectrum = [0.0_f32; OUTPUT_SPECTRUM_BANDS];
    for (index, value) in fft
        .iter()
        .enumerate()
        .take(OUTPUT_SPECTRUM_WINDOW / 2 + 1)
        .skip(1)
    {
        let frequency = index as f32 * sample_rate as f32 / OUTPUT_SPECTRUM_WINDOW as f32;
        if !(OUTPUT_SPECTRUM_MIN_FREQUENCY..=highest_frequency).contains(&frequency) {
            continue;
        }
        let position = (frequency / OUTPUT_SPECTRUM_MIN_FREQUENCY).ln() / frequency_span;
        let band =
            ((position * OUTPUT_SPECTRUM_BANDS as f32) as usize).min(OUTPUT_SPECTRUM_BANDS - 1);
        let amplitude = (value
            .real
            .mul_add(value.real, value.imaginary * value.imaginary))
        .sqrt()
            * amplitude_scale;
        spectrum[band] = spectrum[band].max(amplitude);
    }

    for (band, prior) in spectrum.iter_mut().zip(previous) {
        if *band < OUTPUT_SPECTRUM_NOISE_FLOOR {
            *band = 0.0;
        }
        *band = band.max(prior * OUTPUT_SPECTRUM_RELEASE).clamp(0.0, 4.0);
    }
    spectrum
}

#[cfg(test)]
mod spectrum_tests {
    use super::{
        calculate_output_spectrum, decode_stereo_frame, OUTPUT_SPECTRUM_BANDS,
        OUTPUT_SPECTRUM_WINDOW,
    };

    #[test]
    fn meter_keeps_left_and_right_samples_separate() {
        let stereo_frame = [0.25_f32, -0.75_f32]
            .into_iter()
            .flat_map(f32::to_le_bytes)
            .collect::<Vec<_>>();
        let mono_frame = 0.4_f32.to_le_bytes();

        assert_eq!(decode_stereo_frame(&stereo_frame), (0.25, -0.75, 0.75));
        assert_eq!(decode_stereo_frame(&mono_frame), (0.4, 0.4, 0.4));
    }

    #[test]
    fn fft_places_a_sine_wave_in_its_log_frequency_band() {
        const SAMPLE_RATE: u32 = 48_000;
        const FREQUENCY: f32 = 1_000.0;
        let mut samples = [0.0_f32; OUTPUT_SPECTRUM_WINDOW];
        for (index, sample) in samples.iter_mut().enumerate() {
            *sample =
                (std::f32::consts::TAU * FREQUENCY * index as f32 / SAMPLE_RATE as f32).sin() * 0.5;
        }

        let spectrum =
            calculate_output_spectrum(&samples, 0, SAMPLE_RATE, &[0.0; OUTPUT_SPECTRUM_BANDS]);
        let strongest_band = spectrum
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| left.total_cmp(right))
            .map(|(index, _)| index)
            .expect("spectrum should contain bands");

        assert!((16..=18).contains(&strongest_band));
        assert!(spectrum[strongest_band] > 0.35);
    }

    #[test]
    fn fft_does_not_invent_signal_for_silence() {
        let spectrum = calculate_output_spectrum(
            &[0.0; OUTPUT_SPECTRUM_WINDOW],
            0,
            48_000,
            &[0.0; OUTPUT_SPECTRUM_BANDS],
        );

        assert!(spectrum.iter().all(|band| *band == 0.0));
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

pub fn thread_main(mut request_receiver: ::pipewire::channel::Receiver<EngineRequest>) {
    let mainloop = match MainLoopRc::new(None) {
        Ok(mainloop) => mainloop,
        Err(error) => {
            error!("failed to create PipeWire main loop: {error}");
            return;
        }
    };
    let context = match ContextRc::new(&mainloop, None) {
        Ok(context) => context,
        Err(error) => {
            error!("failed to create PipeWire context: {error}");
            return;
        }
    };
    let domain = Rc::new(RefCell::new(EngineCore::new()));
    let stopped = Rc::new(Cell::new(false));
    let (meter_level_sender, meter_level_receiver) = ::pipewire::channel::channel();
    let meter_level_domain = domain.clone();
    let _attached_meter_level_receiver =
        meter_level_receiver.attach(mainloop.loop_(), move |level| {
            meter_level_domain.borrow_mut().publish_output_level(level);
        });

    while !stopped.get() {
        let core = match context.connect_rc(None) {
            Ok(core) => core,
            Err(connect_error) => {
                domain
                    .borrow_mut()
                    .set_status(GraphStatus::connecting(format!(
                        "PipeWire unavailable: {connect_error}"
                    )));
                request_receiver =
                    run_retry_cycle(&mainloop, request_receiver, domain.clone(), stopped.clone());
                continue;
            }
        };

        domain.borrow_mut().begin_connected_generation();
        let registry = match core.get_registry_rc() {
            Ok(registry) => registry,
            Err(registry_error) => {
                domain
                    .borrow_mut()
                    .set_status(GraphStatus::disconnected(format!(
                        "Failed to access PipeWire registry: {registry_error}"
                    )));
                continue;
            }
        };

        let proxies: Rc<RefCell<HashMap<u32, ProxyItem>>> = Rc::new(RefCell::new(HashMap::new()));
        let items = Rc::new(RefCell::new(RegistryItems::default()));
        let meter_targets = Rc::new(RefCell::new(HashMap::new()));
        let meters = Rc::new(RefCell::new(HashMap::new()));

        let request_loop = mainloop.clone();
        let request_stopped = stopped.clone();
        let request_domain = domain.clone();
        let request_core = core.clone();
        let request_registry = registry.clone();
        let request_proxies = proxies.clone();
        let request_meter_targets = meter_targets.clone();
        let request_meters = meters.clone();
        let request_meter_level_sender = meter_level_sender.clone();
        let attached_receiver = request_receiver.attach(mainloop.loop_(), move |request| {
            let adapter = LiveAdapter {
                core: &request_core,
                registry: &request_registry,
                proxies: &request_proxies,
                meter_targets: &request_meter_targets,
                meters: &request_meters,
                meter_level_sender: &request_meter_level_sender,
            };
            if request_domain
                .borrow_mut()
                .handle_request(request, &adapter)
            {
                request_stopped.set(true);
                request_loop.quit();
            }
        });

        let error_domain = domain.clone();
        let error_loop = mainloop.clone();
        let _core_listener = core
            .add_listener_local()
            .error(move |id, _sequence, result, message| {
                if id != ::pipewire::core::PW_ID_CORE {
                    return;
                }

                if result == -libc::EPIPE {
                    error_domain
                        .borrow_mut()
                        .set_status(GraphStatus::disconnected(message));
                    error_loop.quit();
                } else {
                    error!("PipeWire core error {result}: {message}");
                }
            })
            .register();

        let global_domain = domain.clone();
        let global_registry = registry.clone();
        let global_core = core.clone();
        let global_proxies = proxies.clone();
        let global_items = items.clone();
        let global_meter_targets = meter_targets.clone();
        let global_meters = meters.clone();
        let global_meter_level_sender = meter_level_sender.clone();
        let remove_domain = domain.clone();
        let remove_proxies = proxies.clone();
        let remove_items = items.clone();
        let remove_meter_targets = meter_targets.clone();
        let remove_meters = meters.clone();
        let _registry_listener = registry
            .add_listener_local()
            .global(move |global| match global.type_ {
                ObjectType::Node => handle_node(
                    global,
                    &global_core,
                    &global_registry,
                    &global_proxies,
                    &global_items,
                    &global_meter_targets,
                    &global_meters,
                    &global_meter_level_sender,
                    &global_domain,
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
                remove_meter_targets.borrow_mut().remove(&id);
                if remove_meters.borrow_mut().remove(&id).is_some() {
                    remove_domain
                        .borrow_mut()
                        .publish_output_level(OutputLevel {
                            node_id: id,
                            peak: 0.0,
                            spectrum: [0.0; OUTPUT_SPECTRUM_BANDS],
                            left_spectrum: [0.0; OUTPUT_SPECTRUM_BANDS],
                            right_spectrum: [0.0; OUTPUT_SPECTRUM_BANDS],
                        });
                }
                match remove_items.borrow_mut().remove(id) {
                    Some(RegistryItem::Node) => remove_domain
                        .borrow_mut()
                        .apply_delta(GraphDelta::NodeRemoved { id }),
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
            .register();

        mainloop.run();
        request_receiver = attached_receiver.deattach();
    }
}

fn run_retry_cycle(
    mainloop: &MainLoopRc,
    request_receiver: ::pipewire::channel::Receiver<EngineRequest>,
    domain: Rc<RefCell<EngineCore>>,
    stopped: Rc<Cell<bool>>,
) -> ::pipewire::channel::Receiver<EngineRequest> {
    let retry_loop = mainloop.clone();
    let timer = mainloop.loop_().add_timer(move |_| retry_loop.quit());
    if let Err(error) = timer
        .update_timer(Some(Duration::from_millis(500)), None)
        .into_result()
    {
        warn!("failed to arm PipeWire reconnect timer: {error}");
    }

    let request_loop = mainloop.clone();
    let request_stopped = stopped.clone();
    let attached_receiver = request_receiver.attach(mainloop.loop_(), move |request| {
        if domain.borrow_mut().handle_request(request, &OfflineAdapter) {
            request_stopped.set(true);
            request_loop.quit();
        }
    });
    mainloop.run();
    attached_receiver.deattach()
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

#[allow(clippy::too_many_arguments)]
fn handle_node(
    global: &GlobalObject<&DictRef>,
    core: &CoreRc,
    registry: &RegistryRc,
    proxies: &Rc<RefCell<HashMap<u32, ProxyItem>>>,
    items: &Rc<RefCell<RegistryItems>>,
    meter_targets: &Rc<RefCell<HashMap<u32, String>>>,
    meters: &Rc<RefCell<HashMap<u32, MeterStream>>>,
    meter_level_sender: &::pipewire::channel::Sender<OutputLevel>,
    domain: &Rc<RefCell<EngineCore>>,
) {
    let Some(props) = global.props.as_ref() else {
        warn!("PipeWire node {} has no properties", global.id);
        return;
    };
    let node = NodeDto {
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
    items.borrow_mut().insert(global.id, RegistryItem::Node);
    domain.borrow_mut().apply_delta(GraphDelta::NodeAdded(node));

    let media_class = props.get("media.class").unwrap_or_default();
    if media_class == "Audio/Sink" || media_class.starts_with("Audio/Sink/") {
        if let Some(target_object) = props.get(&keys::NODE_NAME) {
            meter_targets
                .borrow_mut()
                .insert(global.id, target_object.to_owned());
            if domain.borrow().output_metering_enabled() {
                ensure_output_meter(core, global.id, target_object, meters, meter_level_sender);
            }
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
    let param_domain = domain.clone();
    let node_id = global.id;
    let listener = proxy
        .add_listener_local()
        .info(move |info| handle_node_info(info, &info_domain))
        .param(move |_, param_type, _, _, param| {
            if param_type == ParamType::Props {
                handle_node_props(node_id, param, &param_domain);
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

fn handle_node_info(info: &::pipewire::node::NodeInfoRef, domain: &Rc<RefCell<EngineCore>>) {
    let id = info.id();
    let Some(props) = info.props() else {
        return;
    };
    let Some(mut node) = domain.borrow().node(id).cloned() else {
        return;
    };
    update_node_from_props(&mut node, props);
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

fn handle_node_props(node_id: u32, param: Option<&Pod>, domain: &Rc<RefCell<EngineCore>>) {
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
                let average = volumes.iter().copied().sum::<f32>() / volumes.len() as f32;
                volume_percent = Some((average.max(0.0).cbrt() * 100.0).round() as u16);
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
    use super::*;

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
}
