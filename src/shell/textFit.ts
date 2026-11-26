import { FONT } from "./ui";

/** Pixel sizes of the framework's baked slots 0..6 (7..13 are the bold set). */
const SLOT_PX = [12, 14, 16, 18, 20, 24, 36];

/** Width of `text` in a baked font slot. Hosts without text measurement
 * (simulators) get an estimate. */
export function textWidth(text: string, slot: number): number {
  try {
    const ui = (globalThis as { ui?: { measureText?: (text: string, slot: number) => number } }).ui;
    const width = ui?.measureText?.(text, slot);
    if (typeof width === "number" && Number.isFinite(width) && width >= 0) return width;
  } catch {
    /* estimate below */
  }
  const px = SLOT_PX[slot % 7] ?? 14;
  let width = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) > 127) width += px;
    else if (" il.:-()".includes(ch)) width += px * 0.34;
    else if (ch >= "A" && ch <= "Z") width += px * 0.62;
    else width += px * 0.52;
  }
  return Math.ceil(width);
}

/** `text`, or as much of its start as fits followed by "…", within `width`. */
export function fitEnd(text: string, width: number, slot: number, measure = textWidth): string {
  if (measure(text, slot) <= width) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(chars.slice(0, mid).join("").trimEnd() + "…", slot) <= width) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join("").trimEnd() + "…";
}

/** Settings, the launcher and setup lists inset rows by 20 px on each side. */
export const LIST_INSET = 40;

/** Text that would be cut needs at least this many characters before "…". */
const MIN_KEPT = 3;
/** Text that fits whole may run this far into the 12 px right padding. */
const SLACK = 8;

/** `text` cut to `width`, or "" when fewer than `MIN_KEPT` characters fit. */
function fitSome(text: string, width: number, slot: number, measure: typeof textWidth): string {
  const cut = fitEnd(text, width, slot, measure);
  if (cut === text) return text;
  return Array.from(cut).length - 1 >= MIN_KEPT && measure(cut, slot) <= width ? cut : "";
}

/** Width of tag pills: each is its text plus 8 px, 4 px apart. */
function pillsWidth(tags: readonly string[], measure: typeof textWidth): number {
  return tags.reduce((width, tag, index) => width + measure(tag, FONT.xs) + 8 + (index ? 4 : 0), 0);
}

/** Tag pills that fit `width` like other text; the first one that does not is
 * cut or left out with every tag after it. */
function fitTags(tags: readonly string[], width: number, measure: typeof textWidth): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const room = width - pillsWidth(out, measure) - (out.length ? 4 : 0) - 8;
    const text = measure(tag, FONT.xs) <= room + SLACK ? tag : fitSome(tag, room, FONT.xs, measure);
    if (text) out.push(text);
    if (text !== tag) break;
  }
  return out;
}

/**
 * Title, tag and value text for one row `width` wide: 12 px padding on each
 * side, a 44 px icon and 12 px gaps. Text that fits whole keeps at least 4 px
 * to the card edge; cut text ends in "…" at the padding. The title and tags
 * are cut only when they alone do not fit. The value takes the rest of the
 * row and is left out, like a cut tag, when fewer than three characters fit.
 */
export function rowTexts(
  row: { width: number; icon?: boolean; title: string; value?: string; tags?: readonly string[] },
  measure = textWidth,
): { title: string; value: string; tags: string[] } {
  const inner = row.width - 24 - (row.icon ? 56 : 0);
  const tags = row.tags || [];
  const titleWidth = measure(row.title, FONT.base);
  const label = Math.max(titleWidth, pillsWidth(tags, measure));
  if (row.value) {
    const space = inner - 12;
    if (label + measure(row.value, FONT.sm) <= space + SLACK) return { title: row.title, value: row.value, tags: [...tags] };
    const value = fitSome(row.value, space - label, FONT.sm, measure);
    if (value) return { title: row.title, value, tags: [...tags] };
  }
  return {
    title: titleWidth <= inner + SLACK ? row.title : fitEnd(row.title, inner, FONT.base, measure),
    value: "",
    tags: pillsWidth(tags, measure) <= inner + SLACK ? [...tags] : fitTags(tags, inner, measure),
  };
}
