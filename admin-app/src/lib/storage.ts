export interface StorageUsage {
  photoCount: number;
  usedBytes: number;
  quotaBytes: number;
  percent: number;
  level: "ok" | "warning" | "critical";
  daysUntilFull: number | null;
}

export function bytesLabel(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
