// Copyright 2026 Cordflow contributors
// SPDX-License-Identifier: GPL-3.0-only

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Runtime,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ICON_ID: &str = "cordflow-tray";
const SHOW_MENU_ID: &str = "tray-show";
const HIDE_MENU_ID: &str = "tray-hide";
const QUIT_MENU_ID: &str = "tray-quit";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrayAction {
    Show,
    Hide,
    Quit,
    Ignore,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TrayLabels {
    show: &'static str,
    hide: &'static str,
    quit: &'static str,
}

pub fn install(app: &mut App) -> tauri::Result<()> {
    let labels = tray_labels(system_locale().as_deref());
    let show = MenuItem::with_id(app, SHOW_MENU_ID, labels.show, true, None::<&str>)?;
    let hide = MenuItem::with_id(app, HIDE_MENU_ID, labels.hide, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, labels.quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .menu(&menu)
        .tooltip("Cordflow")
        // Linux AppIndicator owns the left click and opens the menu. On platforms
        // that emit tray click events, a left click restores the main window.
        .show_menu_on_left_click(cfg!(target_os = "linux"))
        .on_menu_event(|app_handle, event| {
            handle_action(app_handle, tray_action(event.id().as_ref()));
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

pub fn hide_on_close<R: Runtime>(
    app_handle: &AppHandle<R>,
    label: &str,
    event: &tauri::WindowEvent,
) {
    if label != MAIN_WINDOW_LABEL {
        return;
    }

    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        hide_main_window(app_handle);
    }
}

fn handle_action<R: Runtime>(app_handle: &AppHandle<R>, action: TrayAction) {
    match action {
        TrayAction::Show => show_main_window(app_handle),
        TrayAction::Hide => hide_main_window(app_handle),
        TrayAction::Quit => app_handle.exit(0),
        TrayAction::Ignore => {}
    }
}

fn show_main_window<R: Runtime>(app_handle: &AppHandle<R>) {
    let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) else {
        log::warn!("system tray could not find the main window");
        return;
    };

    if let Err(error) = window.show() {
        log::warn!("system tray failed to show the main window: {error}");
        return;
    }
    if let Err(error) = window.unminimize() {
        log::warn!("system tray failed to restore the main window: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::warn!("system tray failed to focus the main window: {error}");
    }
}

fn hide_main_window<R: Runtime>(app_handle: &AppHandle<R>) {
    let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) else {
        log::warn!("system tray could not find the main window");
        return;
    };

    if let Err(error) = window.hide() {
        log::warn!("system tray failed to hide the main window: {error}");
    }
}

fn tray_action(menu_id: &str) -> TrayAction {
    match menu_id {
        SHOW_MENU_ID => TrayAction::Show,
        HIDE_MENU_ID => TrayAction::Hide,
        QUIT_MENU_ID => TrayAction::Quit,
        _ => TrayAction::Ignore,
    }
}

fn tray_labels(locale: Option<&str>) -> TrayLabels {
    if locale.is_some_and(is_chinese_locale) {
        TrayLabels {
            show: "显示 Cordflow",
            hide: "隐藏",
            quit: "退出",
        }
    } else {
        TrayLabels {
            show: "Show Cordflow",
            hide: "Hide",
            quit: "Quit",
        }
    }
}

fn is_chinese_locale(locale: &str) -> bool {
    locale
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-")
        .starts_with("zh")
}

fn system_locale() -> Option<String> {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|name| {
            std::env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_only_owned_menu_ids_to_actions() {
        assert_eq!(tray_action(SHOW_MENU_ID), TrayAction::Show);
        assert_eq!(tray_action(HIDE_MENU_ID), TrayAction::Hide);
        assert_eq!(tray_action(QUIT_MENU_ID), TrayAction::Quit);
        assert_eq!(tray_action("unrelated-window-menu"), TrayAction::Ignore);
    }

    #[test]
    fn selects_chinese_labels_for_common_locale_formats() {
        for locale in ["zh_CN.UTF-8", "zh-CN", "ZH_TW"] {
            assert_eq!(tray_labels(Some(locale)).show, "显示 Cordflow");
        }
    }

    #[test]
    fn defaults_to_english_labels() {
        assert_eq!(tray_labels(None).quit, "Quit");
        assert_eq!(tray_labels(Some("en_US.UTF-8")).hide, "Hide");
        assert_eq!(tray_labels(Some("C.UTF-8")).show, "Show Cordflow");
    }
}
