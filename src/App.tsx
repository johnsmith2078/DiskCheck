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
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import {
  type FsNode,
  type ScanProgressPayload,
  findNodeByPath,
  getChildren,
  parentPath,
} from "./lib/fs";
import { formatBytes } from "./lib/format";

export default function App() {
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [root, setRoot] = React.useState<FsNode | null>(null);
  const [focusPath, setFocusPath] = React.useState<string | null>(null);

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
    if (!focusPath) return root;
    return findNodeByPath(root, focusPath) ?? root;
  }, [root, focusPath]);

  const focusChildren = React.useMemo(() => {
    return getChildren(focusNode);
  }, [focusNode]);

  const parentFocusPath = React.useMemo(() => {
    return focusNode ? parentPath(focusNode.path) : null;
  }, [focusNode]);

  const canFocusUp = React.useMemo(() => {
    if (!root || !parentFocusPath) return false;
    return Boolean(findNodeByPath(root, parentFocusPath));
  }, [root, parentFocusPath]);

  async function pickDirectory() {
    setError(null);
    const result = await open({ directory: true, multiple: false });
    if (typeof result === "string") {
      setSelectedPath(result);
      setRoot(null);
      setFocusPath(null);
      setProgress(null);
    }
  }

  async function startScan() {
    if (!selectedPath) return;

    setError(null);
    setIsScanning(true);
    setRoot(null);
    setFocusPath(null);
    setProgress({ scannedFiles: 0, scannedDirs: 0, totalBytes: 0 });

    try {
      const tree = await invoke<FsNode>("scan_directory", { path: selectedPath });
      setRoot(tree);
      setFocusPath(tree.path);
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
    if (!root || !focusNode || !parentFocusPath) return;
    if (!findNodeByPath(root, parentFocusPath)) return;
    setFocusPath(parentFocusPath);
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

          <div className="h-[calc(100%-168px)] overflow-auto px-2 pb-6">
            {focusNode ? (
              <div className="space-y-1">
                {focusChildren.map((node) => {
                  const Icon = node.kind === "directory" ? Folder : File;
                  return (
                    <button
                      key={node.path}
                      type="button"
                      className="group flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() =>
                        node.kind === "directory"
                          ? setFocusPath(node.path)
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
                })}
              </div>
            ) : (
              <div className="px-3 text-sm text-muted-foreground">
                No data yet.
              </div>
            )}
          </div>
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
                    <span>items: {getChildren(focusNode).length}</span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => reveal(focusNode.path)}
                  disabled={isScanning}
                >
                  Reveal
                </Button>
              </div>

              <div className="min-h-0 flex-1">
                <Treemap data={focusNode} onRevealPath={reveal} />
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
