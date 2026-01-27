export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
  const base = 1024;
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(base)),
  );
  const value = bytes / Math.pow(base, i);
  const decimals = value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

