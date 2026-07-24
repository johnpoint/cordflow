// Copyright 2026 Cordflow contributors
// SPDX-License-Identifier: GPL-3.0-only

mod commands;
mod engine;
mod graph_state;
pub mod model;

use engine::PipeWireEngine;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("cordflow=info"),
    )
    .try_init();

    let app = tauri::Builder::default()
        .manage(PipeWireEngine::spawn())
        .invoke_handler(tauri::generate_handler![
            commands::subscribe_graph,
            commands::subscribe_output_levels,
            commands::set_output_metering,
            commands::get_graph_snapshot,
            commands::create_link,
            commands::remove_link,
            commands::set_default_audio_sink,
            commands::set_default_audio_source,
            commands::set_output_volume,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Cordflow");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle.state::<PipeWireEngine>().terminate();
        }
    });
}
