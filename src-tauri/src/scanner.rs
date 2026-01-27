use rayon::prelude::*;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Emitter;

const SCAN_PROGRESS_EVENT: &str = "scan_progress";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FsNodeKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsNode {
    pub name: String,
    pub path: String,
    pub kind: FsNodeKind,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<FsNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgressPayload {
    scanned_files: u64,
    scanned_dirs: u64,
    total_bytes: u64,
    current_path: Option<String>,
}

struct ProgressReporter {
    window: tauri::Window,
    scanned_files: AtomicU64,
    scanned_dirs: AtomicU64,
    total_bytes: AtomicU64,
    last_emit: Mutex<Instant>,
}

impl ProgressReporter {
    fn new(window: tauri::Window) -> Self {
        Self {
            window,
            scanned_files: AtomicU64::new(0),
            scanned_dirs: AtomicU64::new(0),
            total_bytes: AtomicU64::new(0),
            last_emit: Mutex::new(Instant::now()),
        }
    }

    fn file_scanned(&self, bytes: u64, current_path: &Path) {
        let next = self.scanned_files.fetch_add(1, Ordering::Relaxed) + 1;
        self.total_bytes.fetch_add(bytes, Ordering::Relaxed);

        // Emit infrequently to keep overhead low when scanning millions of files.
        if next % 512 == 0 {
            self.maybe_emit(Some(current_path));
        }
    }

    fn dir_scanned(&self, current_path: &Path) {
        let next = self.scanned_dirs.fetch_add(1, Ordering::Relaxed) + 1;
        if next % 64 == 0 {
            self.maybe_emit(Some(current_path));
        }
    }

    fn emit_force(&self, current_path: Option<&Path>) {
        self.emit(current_path);
        if let Ok(mut last_emit) = self.last_emit.lock() {
            *last_emit = Instant::now();
        }
    }

    fn maybe_emit(&self, current_path: Option<&Path>) {
        let now = Instant::now();
        let should_emit = self
            .last_emit
            .lock()
            .map(|last| now.duration_since(*last) >= Duration::from_millis(120))
            .unwrap_or(true);

        if should_emit {
            self.emit_force(current_path);
        }
    }

    fn emit(&self, current_path: Option<&Path>) {
        let payload = ScanProgressPayload {
            scanned_files: self.scanned_files.load(Ordering::Relaxed),
            scanned_dirs: self.scanned_dirs.load(Ordering::Relaxed),
            total_bytes: self.total_bytes.load(Ordering::Relaxed),
            current_path: current_path.map(|p| p.to_string_lossy().into_owned()),
        };

        let _ = self.window.emit(SCAN_PROGRESS_EVENT, payload);
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn file_extension_lower(path: &Path) -> Option<String> {
    path.extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .filter(|s| !s.is_empty())
}

fn error_node(path: &Path, kind: FsNodeKind, err: impl ToString) -> FsNode {
    FsNode {
        name: display_name(path),
        path: path.to_string_lossy().into_owned(),
        kind,
        size: 0,
        children: vec![],
        extension: file_extension_lower(path),
        error: Some(err.to_string()),
    }
}

fn scan_path(path: &Path, progress: &ProgressReporter) -> FsNode {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(err) => return error_node(path, FsNodeKind::Other, err),
    };

    let file_type = meta.file_type();
    if file_type.is_symlink() {
        return FsNode {
            name: display_name(path),
            path: path.to_string_lossy().into_owned(),
            kind: FsNodeKind::Symlink,
            size: 0,
            children: vec![],
            extension: file_extension_lower(path),
            error: None,
        };
    }

    if meta.is_file() {
        let size = meta.len();
        progress.file_scanned(size, path);
        return FsNode {
            name: display_name(path),
            path: path.to_string_lossy().into_owned(),
            kind: FsNodeKind::File,
            size,
            children: vec![],
            extension: file_extension_lower(path),
            error: None,
        };
    }

    if meta.is_dir() {
        progress.dir_scanned(path);
        let read_dir = match fs::read_dir(path) {
            Ok(rd) => rd,
            Err(err) => return error_node(path, FsNodeKind::Directory, err),
        };

        let entries: Vec<PathBuf> = read_dir.filter_map(|e| e.ok().map(|e| e.path())).collect();
        let mut children: Vec<FsNode> = entries
            .par_iter()
            .map(|child_path| scan_path(child_path, progress))
            .collect();

        children.sort_by(|a, b| b.size.cmp(&a.size));
        let size = children.iter().map(|c| c.size).sum::<u64>();

        return FsNode {
            name: display_name(path),
            path: path.to_string_lossy().into_owned(),
            kind: FsNodeKind::Directory,
            size,
            children,
            extension: None,
            error: None,
        };
    }

    FsNode {
        name: display_name(path),
        path: path.to_string_lossy().into_owned(),
        kind: FsNodeKind::Other,
        size: 0,
        children: vec![],
        extension: file_extension_lower(path),
        error: None,
    }
}

pub async fn scan_directory(window: tauri::Window, path: String) -> Result<FsNode, String> {
    let root = PathBuf::from(path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", root.to_string_lossy()));
    }

    let window_clone = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ProgressReporter::new(window_clone);
        progress.emit_force(Some(&root));
        let node = scan_path(&root, &progress);
        progress.emit_force(Some(&root));
        Ok::<_, String>(node)
    })
    .await
    .map_err(|err| err.to_string())?
}
