import {
  hierarchy,
  treemap as d3Treemap,
  type HierarchyRectangularNode,
} from "d3-hierarchy";
import * as React from "react";

import type { FsNode } from "../lib/fs";
import { cn } from "../lib/utils";
import { formatBytes } from "../lib/format";

type TreemapProps = {
  data: FsNode;
  onRevealPath?: (path: string) => void;
  className?: string;
  minFileBytes?: number;
};

const DEFAULT_MIN_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB

const PALETTE = [
  "#60A5FA",
  "#34D399",
  "#FBBF24",
  "#F472B6",
  "#A78BFA",
  "#FB7185",
  "#22D3EE",
  "#F97316",
  "#4ADE80",
  "#E879F9",
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function colorForNode(node: FsNode): string {
  const key =
    node.kind === "file" ? node.extension?.toLowerCase() || "<none>" : "<dir>";
  return PALETTE[hashString(key) % PALETTE.length]!;
}

function useElementSize<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({
        width: Math.max(0, Math.floor(width)),
        height: Math.max(0, Math.floor(height)),
      });
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, ...size };
}

export function Treemap({
  data,
  onRevealPath,
  className,
  minFileBytes: minFileBytesProp,
}: TreemapProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const minFileBytes = minFileBytesProp ?? DEFAULT_MIN_FILE_BYTES;
  const [hovered, setHovered] = React.useState<{
    x: number;
    y: number;
    node: FsNode;
    value: number;
  } | null>(null);

  const rects = React.useMemo(() => {
    if (!data || width <= 0 || height <= 0) return [];

    function prune(node: FsNode): FsNode | null {
      if (node.kind === "file") {
        return node.size >= minFileBytes ? node : null;
      }

      if (node.kind !== "directory") return null;
      if (node.size < minFileBytes) return null;

      const children: FsNode[] = [];
      for (const child of node.children ?? []) {
        const next = prune(child);
        if (next) children.push(next);
      }

      if (!children.length) return null;
      return { ...node, children };
    }

    const pruned = prune(data);
    if (!pruned) return [];

    const root = hierarchy<FsNode>(
      pruned,
      (d) => (d.kind === "directory" && d.children?.length ? d.children : undefined),
    )
      .sum((d) => (d.kind === "file" ? d.size : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) as unknown as HierarchyRectangularNode<FsNode>;

    d3Treemap<FsNode>().size([width, height]).paddingInner(1)(root);

    return root
      .leaves()
      .filter((d) => d.data.kind === "file" && (d.value ?? 0) > 0)
      .map((d) => ({
        key: d.data.path,
        x: d.x0,
        y: d.y0,
        w: d.x1 - d.x0,
        h: d.y1 - d.y0,
        node: d.data,
        value: d.value ?? 0,
      }))
      .filter((r) => r.w >= 2 && r.h >= 2);
  }, [data, width, height, minFileBytes]);

  return (
    <div
      ref={ref}
      className={cn(
        "relative h-full w-full overflow-hidden rounded-lg border bg-card",
        className,
      )}
      onMouseLeave={() => setHovered(null)}
    >
      {rects.map((r) => {
        const showLabel = r.w >= 80 && r.h >= 20;
        return (
          <button
            key={r.key}
            type="button"
            className={cn(
              "absolute overflow-hidden rounded-[3px] border border-white/5 text-left text-[11px] leading-tight",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              backgroundColor: colorForNode(r.node),
            }}
            onClick={() => onRevealPath?.(r.node.path)}
            onMouseMove={(e) => {
              const host = (e.currentTarget.parentElement ??
                e.currentTarget) as HTMLElement;
              const bounds = host.getBoundingClientRect();
              setHovered({
                x: e.clientX - bounds.left,
                y: e.clientY - bounds.top,
                node: r.node,
                value: r.value,
              });
            }}
            aria-label={`${r.node.name}, ${formatBytes(r.value)}`}
          >
            {showLabel ? (
              <div className="h-full w-full bg-black/20 p-1">
                <div className="truncate font-medium text-white/90">
                  {r.node.name}
                </div>
                <div className="truncate font-mono text-white/70">
                  {formatBytes(r.value)}
                </div>
              </div>
            ) : null}
          </button>
        );
      })}

      {!rects.length ? (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground">
          No files ≥ {formatBytes(minFileBytes)} in this folder.
        </div>
      ) : null}

      {hovered ? (
        <div
          className="pointer-events-none absolute z-10 max-w-[340px] -translate-y-full rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          style={{
            left: Math.min(width - 8, Math.max(8, hovered.x + 12)),
            top: Math.max(8, hovered.y - 12),
          }}
        >
          <div className="truncate font-medium">{hovered.node.name}</div>
          <div className="mt-0.5 font-mono text-muted-foreground">
            {formatBytes(hovered.value)}
          </div>
          {hovered.node.path ? (
            <div className="mt-1 truncate text-muted-foreground">
              {hovered.node.path}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
