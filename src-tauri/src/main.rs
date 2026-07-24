// SPDX-License-Identifier: GPL-3.0-only

fn main() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // WebKitGTK can otherwise render an empty gray surface on some GBM/Wayland
        // combinations. Keep native Wayland scaling while using its fallback renderer.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    cordflow_lib::run();
}
