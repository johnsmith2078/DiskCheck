import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  File,
  Folder,
  FolderOpen,
  Loader2,
  Scan,
  ChevronUp,
} from "lucide-react";
import * as React from "react";

import { Treemap } from "./components/Treemap";
import { VirtualList } from "./components/VirtualList";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import {
  type FsNode,
  type ScanProgressPayload,
  getChildren,
} from "./lib/fs";
import { formatBytes } from "./lib/format";

const TREEMAP_MIN_FILE_SIZE_OPTIONS = [
  { label: "1 MB", bytes: 1 * 1024 * 1024 },
  { label: "5 MB", bytes: 5 * 1024 * 1024 },
  { label: "10 MB", bytes: 10 * 1024 * 1024 },
  { label: "50 MB", bytes: 50 * 1024 * 1024 },
  { label: "100 MB", bytes: 100 * 1024 * 1024 },
  { label: "500 MB", bytes: 500 * 1024 * 1024 },
  { label: "1 GB", bytes: 1024 * 1024 * 1024 },
] as const;

export default function App() {
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [root, setRoot] = React.useState<FsNode | null>(null);
  // Keep a stack of nodes from root -> current focus to avoid O(n) path lookups
  // on every navigation (which becomes very noticeable on large scans).
  const [focusStack, setFocusStack] = React.useState<FsNode[]>([]);
  const [treemapMinFileBytes, setTreemapMinFileBytes] = React.useState<number>(
    TREEMAP_MIN_FILE_SIZE_OPTIONS[2].bytes,
  );

  const [isScanning, setIsScanning] = React.useState(false);
  const [progress, setProgress] = React.useState<ScanProgressPayload | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const unlisten = listen<ScanProgressPayload>("scan_progress", (event) => {
      setProgress(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => undefined);
    };
  }, []);

  const focusNode = React.useMemo(() => {
    if (!root) return null;
    return focusStack[focusStack.length - 1] ?? root;
  }, [root, focusStack]);

  const focusChildren = React.useMemo(() => {
    return getChildren(focusNode);
  }, [focusNode]);

  const canFocusUp = focusStack.length > 1;

  async function pickDirectory() {
    setError(null);
    const result = await open({ directory: true, multiple: false });
    if (typeof result === "string") {
      setSelectedPath(result);
      setRoot(null);
      setFocusStack([]);
      setProgress(null);
    }
  }

  async function startScan() {
    if (!selectedPath) return;

    setError(null);
    setIsScanning(true);
    setRoot(null);
    setFocusStack([]);
    setProgress({ scannedFiles: 0, scannedDirs: 0, totalBytes: 0 });

    try {
      const tree = await invoke<FsNode>("scan_directory", { path: selectedPath });
      setRoot(tree);
      setFocusStack([tree]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsScanning(false);
    }
  }

  async function reveal(path: string) {
    try {
      await invoke("reveal_in_explorer", { path });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function focusUp() {
    setFocusStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  }

  return (
    <div className="h-screen w-screen bg-background text-foreground">
      <div className="flex h-full">
        <aside className="w-[340px] shrink-0 border-r bg-background/70 backdrop-blur">
          <div className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold tracking-tight">
                  DiskCheck
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {selectedPath ?? "Pick a folder/drive to scan"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={pickDirectory}
                  aria-label="Pick directory"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  onClick={startScan}
                  disabled={!selectedPath || isScanning}
                  aria-label="Start scan"
                >
                  {isScanning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Scan className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {isScanning ? (
              <div className="mt-4 rounded-lg border bg-card/40 p-3">
                <div className="text-xs font-medium">Scanning…</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                  <span>files: {progress?.scannedFiles ?? 0}</span>
                  <span>dirs: {progress?.scannedDirs ?? 0}</span>
                  <span>bytes: {formatBytes(progress?.totalBytes ?? 0)}</span>
                </div>
                {progress?.currentPath ? (
                  <div className="mt-2 truncate text-[11px] text-muted-foreground">
                    {progress.currentPath}
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            ) : null}
          </div>

          <div className="px-4 pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-muted-foreground">
                Contents
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={focusUp}
                disabled={!canFocusUp}
              >
                <ChevronUp className="h-4 w-4" />
                Up
              </Button>
            </div>
          </div>

          {focusNode ? (
            focusChildren.length ? (
              <VirtualList
                className="h-[calc(100%-168px)] px-2"
                items={focusChildren}
                itemHeight={52}
                paddingEnd={24}
                getKey={(node) => node.path}
                renderItem={(node) => {
                  const Icon = node.kind === "directory" ? Folder : File;
                  return (
                    <button
                      type="button"
                      className="group flex h-full w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() =>
                        node.kind === "directory"
                          ? setFocusStack((stack) => [...stack, node])
                          : reveal(node.path)
                      }
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate text-sm">{node.name}</div>
                          {node.error ? (
                            <div className="truncate text-[11px] text-destructive">
                              {node.error}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {formatBytes(node.size)}
                      </div>
                    </button>
                  );
                }}
              />
            ) : (
              <div className="h-[calc(100%-168px)] overflow-auto px-2 pb-6">
                <div className="px-3 text-sm text-muted-foreground">
                  Empty folder.
                </div>
              </div>
            )
          ) : (
            <div className="h-[calc(100%-168px)] overflow-auto px-2 pb-6">
              <div className="px-3 text-sm text-muted-foreground">
                No data yet.
              </div>
            </div>
          )}
        </aside>

        <main className="min-w-0 flex-1 p-4">
          {focusNode ? (
            <div className="flex h-full min-h-0 flex-col gap-4">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {focusNode.path}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                    <span>size: {formatBytes(focusNode.size)}</span>
                    <span>items: {focusChildren.length}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground">
                      Treemap ≥
                    </div>
                    <select
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={String(treemapMinFileBytes)}
                      onChange={(e) => setTreemapMinFileBytes(Number(e.target.value))}
                      disabled={isScanning}
                      aria-label="Minimum file size for treemap"
                    >
                      {TREEMAP_MIN_FILE_SIZE_OPTIONS.map((opt) => (
                        <option key={opt.bytes} value={String(opt.bytes)}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => reveal(focusNode.path)}
                    disabled={isScanning}
                  >
                    Reveal
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1">
                <Treemap
                  data={focusNode}
                  onRevealPath={reveal}
                  minFileBytes={treemapMinFileBytes}
                />
              </div>
            </div>
          ) : (
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Disk usage treemap</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Pick a folder, then start a scan to visualize disk usage.
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
