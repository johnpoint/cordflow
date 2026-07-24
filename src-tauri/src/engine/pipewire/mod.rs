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

mod adapter;
mod metering;
mod registry;

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    time::Duration,
};

use ::pipewire::{context::ContextRc, main_loop::MainLoopRc};
use log::{error, warn};

use self::{
    adapter::{LiveAdapter, OfflineAdapter},
    metering::MeterManager,
    registry::RegistrySession,
};
use super::{EngineCore, EngineRequest};
use crate::model::GraphStatus;

pub(super) fn thread_main(mut request_receiver: ::pipewire::channel::Receiver<EngineRequest>) {
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
        let registry_session = RegistrySession::new(registry, domain.clone());
        let meter_manager = MeterManager::new(meter_level_sender.clone());
        meter_manager.set_enabled(&core, domain.borrow().output_metering_enabled());

        let request_loop = mainloop.clone();
        let request_stopped = stopped.clone();
        let request_domain = domain.clone();
        let request_core = core.clone();
        let request_registry = registry_session.clone();
        let request_meters = meter_manager.clone();
        let attached_receiver = request_receiver.attach(mainloop.loop_(), move |request| {
            let adapter = LiveAdapter::new(&request_core, &request_registry, &request_meters);
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

        let _registry_listener = registry_session.subscribe(&core, &meter_manager);
        mainloop.run();
        meter_manager.clear();
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
