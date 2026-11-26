export type Kind = "iso" | "drive";
export interface Media { id: string; name: string; kind: Kind; size: number; mounted?: boolean; external?: boolean }
export interface Source { extension: string; directory: string; name: string; available: boolean }
export interface Entry { name: string; path: string; directory: boolean; media?: Media }
export interface Snapshot { status: { connected?: boolean; iso_mounted?: string; drive_mounted?: string }; media: Media[]; sources: Source[] }
export function parseSnapshot(value: unknown): Snapshot {
  const raw = value as Partial<Snapshot>;
  if (!raw || !raw.status || !Array.isArray(raw.media) || !Array.isArray(raw.sources)) throw new Error("invalid media state");
  return { status: raw.status, media: raw.media.filter(media => media && typeof media.id === "string" && typeof media.name === "string" && ["iso", "drive"].includes(media.kind)),
    sources: raw.sources.filter(source => source && typeof source.extension === "string" && typeof source.directory === "string" && typeof source.name === "string") };
}
export function sizeLabel(size: number) { return size >= 1073741824 ? `${(size / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(size / 1048576))} MB`; }
export function parseDirectory(value: unknown): { entries: Entry[]; truncated: boolean } {
  const raw = value as { entries?: Entry[]; truncated?: boolean };
  if (!raw || !Array.isArray(raw.entries)) throw new Error("invalid directory");
  return { entries: raw.entries.filter(entry => entry && typeof entry.name === "string" && typeof entry.path === "string" &&
    (entry.directory === true || entry.media && typeof entry.media.id === "string" && typeof entry.media.name === "string")), truncated: raw.truncated === true };
}
