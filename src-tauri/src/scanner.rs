use serde::Serialize;
use std::{
    fs,
    fs::ReadDir,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Emitter;

const SCAN_PROGRESS_EVENT: &str = "scan_progress";
// NOTE: Returning every file node for large folders can crash the WebView IPC
// serialization. We keep directory nodes intact for navigation, but prune file
// nodes defensively while still calculating accurate directory sizes.
const DEFAULT_MIN_FILE_BYTES: u64 = 1 * 1024 * 1024; // 1 MiB
const DEFAULT_MAX_FILES_PER_DIR: usize = 1_000;
const DEFAULT_MAX_TOTAL_FILE_NODES: usize = 10_000;

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

#[derive(Debug, Clone, Copy)]
struct ScanOptions {
    min_file_bytes: u64,
    max_files_per_dir: usize,
    max_total_file_nodes: usize,
}

#[derive(Debug, Default)]
struct ScanStats {
    skipped_entries: u64,
    hidden_file_nodes: u64,
    hit_file_limit: bool,
}

#[derive(Debug)]
struct DirFrame {
    path: PathBuf,
    name: String,
    iter: ReadDir,
    // Total size of this directory (includes filtered-out children).
    size: u64,
    // Non-file children are kept so directory navigation remains complete.
    other_children: Vec<FsNode>,
    // File children are pruned for IPC safety.
    file_children: Vec<FsNode>,
    hidden_file_nodes: u64,
}

fn maybe_keep_file_child(files: &mut Vec<FsNode>, child: FsNode, max_files_per_dir: usize) -> u64 {
    if max_files_per_dir == 0 {
        return 1;
    }

    files.push(child);

    // Keep only the largest files to reduce IPC payload. We avoid sorting on every insert.
    if files.len() >= max_files_per_dir.saturating_mul(2) {
        files.sort_by(|a, b| b.size.cmp(&a.size));
        let removed = files.len().saturating_sub(max_files_per_dir);
        files.truncate(max_files_per_dir);
        return removed as u64;
    }

    0
}

fn scan_pruned_tree(root: &Path, progress: &ProgressReporter, opts: ScanOptions) -> Result<FsNode, String> {
    let meta = fs::symlink_metadata(root).map_err(|e| {
        format!(
            "Failed to read metadata for {}: {}",
            root.to_string_lossy(),
            e
        )
    })?;

    let file_type = meta.file_type();
    if file_type.is_symlink() {
        // Do not follow symlinks (prevents cycles and surprising traversal).
        return Ok(FsNode {
            name: display_name(root),
            path: root.to_string_lossy().into_owned(),
            kind: FsNodeKind::Symlink,
            size: 0,
            children: vec![],
            extension: file_extension_lower(root),
            error: None,
        });
    }

    if meta.is_file() {
        let size = meta.len();
        progress.file_scanned(size, root);
        return Ok(FsNode {
            name: display_name(root),
            path: root.to_string_lossy().into_owned(),
            kind: FsNodeKind::File,
            size,
            children: vec![],
            extension: file_extension_lower(root),
            error: None,
        });
    }

    if !meta.is_dir() {
        return Ok(FsNode {
            name: display_name(root),
            path: root.to_string_lossy().into_owned(),
            kind: FsNodeKind::Other,
            size: 0,
            children: vec![],
            extension: file_extension_lower(root),
            error: None,
        });
    }

    let read_dir = fs::read_dir(root).map_err(|e| {
        format!(
            "Failed to read directory {}: {}",
            root.to_string_lossy(),
            e
        )
    })?;

    // Explicit stack to avoid recursion/stack overflows on very deep trees.
    let mut stack: Vec<DirFrame> = vec![DirFrame {
        path: root.to_path_buf(),
        name: display_name(root),
        iter: read_dir,
        size: 0,
        other_children: vec![],
        file_children: vec![],
        hidden_file_nodes: 0,
    }];

    let mut stats = ScanStats::default();
    let mut returned_file_nodes: usize = 0;

    progress.dir_scanned(root);

    loop {
        let next_entry = match stack.last_mut() {
            Some(frame) => frame.iter.next(),
            None => break,
        };

        match next_entry {
            Some(Ok(entry)) => {
                let child_path = entry.path();

                let meta = match fs::symlink_metadata(&child_path) {
                    Ok(m) => m,
                    Err(err) => {
                        stats.skipped_entries = stats.skipped_entries.saturating_add(1);
                        if let Some(frame) = stack.last_mut() {
                            frame.other_children.push(error_node(
                                &child_path,
                                FsNodeKind::Other,
                                format!("Failed to read metadata: {}", err),
                            ));
                        }
                        continue;
                    }
                };

                let file_type = meta.file_type();
                if file_type.is_symlink() {
                    if let Some(frame) = stack.last_mut() {
                        frame.other_children.push(FsNode {
                            name: display_name(&child_path),
                            path: child_path.to_string_lossy().into_owned(),
                            kind: FsNodeKind::Symlink,
                            size: 0,
                            children: vec![],
                            extension: file_extension_lower(&child_path),
                            error: None,
                        });
                    }
                    continue;
                }

                if meta.is_file() {
                    let size = meta.len();
                    progress.file_scanned(size, &child_path);

                    if let Some(frame) = stack.last_mut() {
                        frame.size = frame.size.saturating_add(size);
                    }

                    if size >= opts.min_file_bytes && returned_file_nodes < opts.max_total_file_nodes {
                        returned_file_nodes += 1;
                        if let Some(frame) = stack.last_mut() {
                            let hidden = maybe_keep_file_child(
                                &mut frame.file_children,
                                FsNode {
                                    name: display_name(&child_path),
                                    path: child_path.to_string_lossy().into_owned(),
                                    kind: FsNodeKind::File,
                                    size,
                                    children: vec![],
                                    extension: file_extension_lower(&child_path),
                                    error: None,
                                },
                                opts.max_files_per_dir,
                            );
                            frame.hidden_file_nodes =
                                frame.hidden_file_nodes.saturating_add(hidden);
                            stats.hidden_file_nodes =
                                stats.hidden_file_nodes.saturating_add(hidden);
                        }
                    } else if size >= opts.min_file_bytes {
                        stats.hit_file_limit = true;
                        stats.hidden_file_nodes = stats.hidden_file_nodes.saturating_add(1);
                        if let Some(frame) = stack.last_mut() {
                            frame.hidden_file_nodes = frame.hidden_file_nodes.saturating_add(1);
                        }
                    }

                    continue;
                }

                if meta.is_dir() {
                    progress.dir_scanned(&child_path);

                    match fs::read_dir(&child_path) {
                        Ok(rd) => {
                            let name = display_name(&child_path);
                            stack.push(DirFrame {
                                path: child_path,
                                name,
                                iter: rd,
                                size: 0,
                                other_children: vec![],
                                file_children: vec![],
                                hidden_file_nodes: 0,
                            });
                        }
                        Err(err) => {
                            stats.skipped_entries = stats.skipped_entries.saturating_add(1);
                            if let Some(frame) = stack.last_mut() {
                                frame.other_children.push(error_node(
                                    &child_path,
                                    FsNodeKind::Directory,
                                    format!("Failed to read directory: {}", err),
                                ));
                            }
                        }
                    }
                    continue;
                }

                if let Some(frame) = stack.last_mut() {
                    frame.other_children.push(FsNode {
                        name: display_name(&child_path),
                        path: child_path.to_string_lossy().into_owned(),
                        kind: FsNodeKind::Other,
                        size: 0,
                        children: vec![],
                        extension: file_extension_lower(&child_path),
                        error: None,
                    });
                }
            }
            Some(Err(_)) => {
                // Error reading a single entry; skip and continue.
                stats.skipped_entries = stats.skipped_entries.saturating_add(1);
            }
            None => {
                // Completed this directory; finalize node and attach to parent.
                let completed = match stack.pop() {
                    Some(f) => f,
                    None => break,
                };

                let mut hidden_file_nodes = completed.hidden_file_nodes;
                let mut file_children = completed.file_children;
                file_children.sort_by(|a, b| b.size.cmp(&a.size));
                if file_children.len() > opts.max_files_per_dir {
                    let removed = file_children.len() - opts.max_files_per_dir;
                    hidden_file_nodes = hidden_file_nodes.saturating_add(removed as u64);
                    stats.hidden_file_nodes = stats.hidden_file_nodes.saturating_add(removed as u64);
                    file_children.truncate(opts.max_files_per_dir);
                }

                let mut children = completed.other_children;
                children.extend(file_children);
                children.sort_by(|a, b| b.size.cmp(&a.size));

                let mut node = FsNode {
                    name: completed.name,
                    path: completed.path.to_string_lossy().into_owned(),
                    kind: FsNodeKind::Directory,
                    size: completed.size,
                    children,
                    extension: None,
                    error: (hidden_file_nodes > 0).then(|| {
                        format!(
                            "Hidden {} file entries in this folder for stability.",
                            hidden_file_nodes
                        )
                    }),
                };

                if let Some(parent) = stack.last_mut() {
                    parent.size = parent.size.saturating_add(node.size);
                    parent.other_children.push(node);
                } else {
                    // Root completed.
                    let mut notices: Vec<String> = vec![];
                    if stats.hidden_file_nodes > 0 {
                        notices.push(format!(
                            "Hidden {} file entries for stability.",
                            stats.hidden_file_nodes
                        ));
                    }
                    if stats.hit_file_limit {
                        notices.push(format!(
                            "File results were capped at {} entries across the scan.",
                            opts.max_total_file_nodes
                        ));
                    }
                    if stats.skipped_entries > 0 {
                        notices.push(format!(
                            "{} entries could not be read completely.",
                            stats.skipped_entries
                        ));
                    }
                    if !notices.is_empty() {
                        node.error = Some(notices.join(" "));
                    }
                    return Ok(node);
                }
            }
        }
    }

    Err("Scan aborted unexpectedly.".to_string())
}

pub async fn scan_directory(
    window: tauri::Window,
    path: String,
    min_node_bytes: Option<u64>,
) -> Result<FsNode, String> {
    let root = PathBuf::from(path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", root.to_string_lossy()));
    }

    let window_clone = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let progress = ProgressReporter::new(window_clone);
        progress.emit_force(Some(&root));
        let opts = ScanOptions {
            min_file_bytes: min_node_bytes.unwrap_or(DEFAULT_MIN_FILE_BYTES),
            max_files_per_dir: DEFAULT_MAX_FILES_PER_DIR,
            max_total_file_nodes: DEFAULT_MAX_TOTAL_FILE_NODES,
        };
        let node = scan_pruned_tree(&root, &progress, opts)?;
        progress.emit_force(Some(&root));
        Ok::<_, String>(node)
    })
    .await
    .map_err(|err| err.to_string())?
}
