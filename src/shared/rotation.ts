export type Rotation = 0 | 90 | 180 | 270;
const ALL_ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/** Older screen hosts expose no restriction. Invalid profiles retain that default. */
export function parseRotations(raw: unknown): Rotation[] {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    const angles = ALL_ROTATIONS.filter(deg => Array.isArray(value) && value.includes(deg));
    return angles.length ? angles : [...ALL_ROTATIONS];
  } catch {
    return [...ALL_ROTATIONS];
  }
}
