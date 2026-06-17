use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
  app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn fetch_teams_native(sport: String, league: String) -> Result<String, String> {
  let url = format!("https://site.api.espn.com/apis/site/v2/sports/{}/{}/teams?limit=1000", sport, league);

  #[cfg(target_os = "windows")]
  let cmd_name = "curl.exe";
  #[cfg(not(target_os = "windows"))]
  let cmd_name = "curl";

  let output = std::process::Command::new(cmd_name)
    .args(["-s", &url])
    .output();

  match output {
    Ok(out) => {
      if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
      } else {
        Err(format!("curl error: {}", String::from_utf8_lossy(&out.stderr)))
      }
    }
    Err(e) => Err(format!("failed to execute curl: {}", e)),
  }
}

#[tauri::command]
fn notify(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
  app
    .notification()
    .builder()
    .title(title)
    .body(body)
    .show()
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_always_on_top(app: tauri::AppHandle, value: bool) -> Result<(), String> {
  if let Some(w) = app.get_webview_window("main") {
    w.set_always_on_top(value).map_err(|e| e.to_string())?;
  }
  Ok(())
}

// Compact mode = no window decorations (frameless). The header has a
// data-tauri-drag-region so the window stays movable while frameless.
#[tauri::command]
fn set_compact(app: tauri::AppHandle, value: bool) -> Result<(), String> {
  if let Some(w) = app.get_webview_window("main") {
    w.set_decorations(!value).map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
fn set_tray_tooltip(app: tauri::AppHandle, text: String) -> Result<(), String> {
  if let Some(tray) = app.tray_by_id("main") {
    tray.set_tooltip(Some(&text)).map_err(|e| e.to_string())?;
  }
  Ok(())
}

fn toggle_main_window(app: &tauri::AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    if w.is_visible().unwrap_or(false) {
      let _ = w.hide();
    } else {
      let _ = w.show();
      let _ = w.set_focus();
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![
      open_url,
      fetch_teams_native,
      notify,
      set_always_on_top,
      set_compact,
      set_tray_tooltip
    ])
    .setup(|app| {
      println!("Tauri setup starting...");

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // ── System tray ──────────────────────────────────────
      let show = MenuItemBuilder::with_id("show", "Show").build(app)?;
      let hide = MenuItemBuilder::with_id("hide", "Hide").build(app)?;
      let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
      let menu = MenuBuilder::new(app).items(&[&show, &hide, &quit]).build()?;

      let _tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Sports Widget")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
          "show" => {
            if let Some(w) = app.get_webview_window("main") {
              let _ = w.show();
              let _ = w.set_focus();
            }
          }
          "hide" => {
            if let Some(w) = app.get_webview_window("main") {
              let _ = w.hide();
            }
          }
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            toggle_main_window(tray.app_handle());
          }
        })
        .build(app)?;

      // Explicitly get the window and make sure it's visible and focused
      if let Some(window) = app.get_webview_window("main") {
        println!("Window found, showing and focusing...");
        window.show().unwrap_or_else(|e| eprintln!("Failed to show: {}", e));
        window.set_focus().unwrap_or_else(|e| eprintln!("Failed to focus: {}", e));
        window.center().unwrap_or_else(|e| eprintln!("Failed to center: {}", e));
      } else {
        eprintln!("ERROR: No 'main' window found!");
      }

      println!("Tauri setup complete.");
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
