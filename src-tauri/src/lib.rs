mod scanner;

#[tauri::command]
async fn scan_directory(window: tauri::Window, path: String) -> Result<scanner::FsNode, String> {
    scanner::scan_directory(window, path).await
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    use std::{path::PathBuf, process::Command};

    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(format!(
            "Path does not exist: {}",
            target.to_string_lossy()
        ));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg("/select,")
            .arg(&target)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&target)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = target.parent().unwrap_or(&target);
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![scan_directory, reveal_in_explorer])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
