import type { ArchiveEntryKind } from "./types";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+$/, "");
}

export function basename(value: string): string {
  const normalized = normalizePath(value);
  if (!normalized) return value;
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

export function dirname(value: string): string {
  const normalized = normalizePath(value);
  const segments = normalized.split("/").filter(Boolean);
  return segments.slice(0, -1).join("/");
}

export function pathSegments(value: string): string[] {
  const normalized = normalizePath(value);
  return normalized ? normalized.split("/").filter(Boolean) : [];
}

export function humanizeKind(kind: ArchiveEntryKind): string {
  switch (kind) {
    case "dir":
      return "Folder";
    case "symlink":
      return "Link";
    case "other":
      return "Other";
    default:
      return "File";
  }
}

export function isArchivePath(path: string): boolean {
  return /\.(zip|7z|rar|tar|tgz|tbz|tbz2|txz|tar\.gz|tar\.bz2|tar\.xz|gz|bz2|xz)$/i.test(path);
}
