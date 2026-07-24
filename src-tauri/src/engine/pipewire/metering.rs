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
    core::CoreRc,
    keys,
    stream::{StreamFlags, StreamListener, StreamRc, StreamState},
};
use libspa::{
    param::ParamType,
    pod::{serialize::PodSerializer, Object, Pod, Value},
    utils::Direction as SpaDirection,
};
use log::warn;

use crate::model::OutputLevel;

const OUTPUT_METER_INTERVAL: Duration = Duration::from_millis(32);
pub(super) const OUTPUT_SPECTRUM_BANDS: usize = 32;
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

#[derive(Clone)]
pub(super) struct MeterManager {
    targets: Rc<RefCell<HashMap<u32, String>>>,
    streams: Rc<RefCell<HashMap<u32, MeterStream>>>,
    enabled: Rc<Cell<bool>>,
    sender: ::pipewire::channel::Sender<OutputLevel>,
}

impl MeterManager {
    pub(super) fn new(sender: ::pipewire::channel::Sender<OutputLevel>) -> Self {
        Self {
            targets: Rc::new(RefCell::new(HashMap::new())),
            streams: Rc::new(RefCell::new(HashMap::new())),
            enabled: Rc::new(Cell::new(false)),
            sender,
        }
    }

    pub(super) fn set_enabled(&self, core: &CoreRc, enabled: bool) {
        self.enabled.set(enabled);
        if !enabled {
            self.streams.borrow_mut().clear();
            return;
        }
        for (node_id, target_object) in self.targets.borrow().clone() {
            ensure_output_meter(core, node_id, &target_object, &self.streams, &self.sender);
        }
    }

    pub(super) fn register_target(&self, core: &CoreRc, node_id: u32, target_object: &str) {
        self.targets
            .borrow_mut()
            .insert(node_id, target_object.to_owned());
        if self.enabled.get() {
            ensure_output_meter(core, node_id, target_object, &self.streams, &self.sender);
        }
    }

    pub(super) fn remove_target(&self, node_id: u32) {
        self.targets.borrow_mut().remove(&node_id);
        if self.streams.borrow_mut().remove(&node_id).is_some() {
            let _ = self.sender.send(silent_output_level(node_id));
        }
    }

    pub(super) fn clear(&self) {
        self.targets.borrow_mut().clear();
        self.streams.borrow_mut().clear();
        self.enabled.set(false);
    }
}

fn silent_output_level(node_id: u32) -> OutputLevel {
    OutputLevel {
        node_id,
        peak: 0.0,
        spectrum: [0.0; OUTPUT_SPECTRUM_BANDS],
        left_spectrum: [0.0; OUTPUT_SPECTRUM_BANDS],
        right_spectrum: [0.0; OUTPUT_SPECTRUM_BANDS],
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
