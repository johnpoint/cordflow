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
    // `generate_context!` embeds this image as the default window and tray icon.
    // Track it explicitly because a standalone asset edit must invalidate dev builds.
    println!("cargo:rerun-if-changed=icons/icon.png");

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to build Tauri application metadata");
}
