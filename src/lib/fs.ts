export type FsNodeKind = "file" | "directory" | "symlink" | "other";

export type FsNode = {
  name: string;
  path: string;
  kind: FsNodeKind;
  size: number;
  children?: FsNode[];
  extension?: string | null;
  error?: string | null;
};

export type ScanProgressPayload = {
  scannedFiles: number;
  scannedDirs: number;
  totalBytes: number;
  currentPath?: string | null;
};

export function getChildren(node: FsNode | null | undefined): FsNode[] {
  return node?.children ?? [];
}

export function findNodeByPath(root: FsNode, path: string): FsNode | null {
  if (root.path === path) return root;
  for (const child of getChildren(root)) {
    const found = findNodeByPath(child, path);
    if (found) return found;
  }
  return null;
}

export function parentPath(path: string): string | null {
  const normalized = path.replace(/[\\/]+$/, "");
  const idx = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (idx <= 0) return null;

  // Preserve Windows drive roots like `C:\`.
  const parent = normalized.slice(0, idx);
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent;
}

