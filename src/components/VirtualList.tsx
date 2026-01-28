import * as React from "react";

import { cn } from "../lib/utils";

type VirtualListProps<T> = {
  items: readonly T[];
  itemHeight: number;
  overscan?: number;
  paddingStart?: number;
  paddingEnd?: number;
  className?: string;
  getKey?: (item: T, index: number) => React.Key;
  renderItem: (item: T, index: number) => React.ReactNode;
};

export function VirtualList<T>({
  items,
  itemHeight,
  overscan = 6,
  paddingStart = 0,
  paddingEnd = 0,
  className,
  getKey,
  renderItem,
}: VirtualListProps<T>) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const [scrollTop, setScrollTop] = React.useState(0);

  React.useLayoutEffect(() => {
    if (!hostRef.current) return;
    const el = hostRef.current;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewportHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = React.useCallback(() => {
    if (!hostRef.current) return;
    setScrollTop(hostRef.current.scrollTop);
  }, []);

  const totalHeight = paddingStart + items.length * itemHeight + paddingEnd;

  // Clamp into the "items" region so optional padding doesn't skew indices.
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  const clampedScrollTop = Math.min(scrollTop, maxScrollTop);
  const scrollTopInItems = Math.max(0, clampedScrollTop - paddingStart);

  const startIndex = Math.max(
    0,
    Math.floor(scrollTopInItems / itemHeight) - overscan,
  );
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTopInItems + viewportHeight) / itemHeight) + overscan,
  );

  return (
    <div
      ref={hostRef}
      className={cn("relative overflow-auto", className)}
      onScroll={onScroll}
    >
      <div className="relative w-full" style={{ height: totalHeight }}>
        {items.slice(startIndex, endIndex).map((item, i) => {
          const index = startIndex + i;
          const top = paddingStart + index * itemHeight;
          return (
            <div
              key={getKey ? getKey(item, index) : index}
              className="absolute left-0 right-0"
              style={{ top, height: itemHeight }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

