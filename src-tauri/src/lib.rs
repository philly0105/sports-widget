use tauri::Manager;

#[tauri::command]
fn open_url(url: String) {
  #[cfg(target_os = "windows")]
  let _ = std::process::Command::new("cmd").args(["/C", "start", &url]).spawn();
  #[cfg(target_os = "macos")]
  let _ = std::process::Command::new("open").arg(&url).spawn();
  #[cfg(target_os = "linux")]
  let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
}

#[tauri::command]
async fn fetch_teams_native(sport: String, league: String) -> Result<String, String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![open_url, fetch_teams_native])
    .setup(|app| {
      println!("Tauri setup starting...");

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

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
