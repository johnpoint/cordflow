const COMMANDS: &[&str] = &[
    "subscribe_graph",
    "subscribe_output_levels",
    "set_output_metering",
    "get_graph_snapshot",
    "create_link",
    "remove_link",
    "set_default_audio_sink",
    "set_default_audio_source",
    "set_output_volume",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to build Tauri application metadata");
}
