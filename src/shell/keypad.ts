import { cornerInset, layoutFor, type KeyboardBoard } from "./layouts";

export type KeyKind = "text" | "ipv4" | "ipv6" | "number";

export type KeyAction = "char" | "ok" | "cancel" | "mode";

/*
 * Action keys use tokens of two or more letters (MD, SP, BS, OK, ESC), so no
 * typed character, such as a capital X, is mistaken for one.
 */

export type KeyIcon = "" | "backspace" | "enter" | "space";

const TEXT_LOWER = [
  ["a", "b", "c", "d", "e", "f"],
  ["g", "h", "i", "j", "k", "l"],
  ["m", "n", "o", "p", "q", "r"],
  ["s", "t", "u", "v", "w", "x"],
  ["y", "z", ".", "-", "_", "@"],
  ["MD", "SP", "BS", "OK", "ESC"],
];

const TEXT_UPPER = TEXT_LOWER.map((row, index) =>
  index === TEXT_LOWER.length - 1 ? row : row.map((token) => token.toUpperCase()),
);

const TEXT_SYMBOL = [
  ["1", "2", "3", "4", "5", "6"],
  ["7", "8", "9", "0", "/", ":"],
  ["!", "?", "#", "$", "%", "&"],
  ["*", "(", ")", "+", "=", "'"],
  ["~", ",", ";", "<", ">", "?"],
  ["MD", "SP", "BS", "OK", "ESC"],
];

const IPV4 = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "/"],
  ["BS", "OK", "ESC"],
];

const IPV6 = [
  ["1", "2", "3", "a", "b", "c"],
  ["4", "5", "6", "d", "e", "f"],
  ["7", "8", "9", ":", "0", "BS"],
  ["OK", "ESC"],
];

const NUMBER = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["BS", "0", "OK"],
  ["ESC"],
];

const NINE_LOWER = [
  ["a", "b", "c"],
  ["d", "e", "f"],
  ["g", "h", "i"],
  ["j", "k", "l"],
  ["m", "n", "o"],
  ["p", "q", "r", "s"],
  ["t", "u", "v"],
  ["w", "x", "y", "z"],
  [".", "-", "_", "@"],
];

/**
 * Punctuation mode of the nine-key board: all 32 printable ASCII marks.
 * Rows hold punctuation and quotes, brackets, then arithmetic and the rest;
 * paired brackets share a group.
 */
const NINE_MARKS = [
  [".", ",", ":", ";"], ["!", "?", "&"], ["'", "\"", "`"],
  ["(", ")", "[", "]"], ["{", "}", "<", ">"], ["@", "#", "$"],
  ["+", "-", "*", "/"], ["_", "\\", "|", "~"], ["=", "%", "^"],
];

/** Text modes: lowercase, digits, capitals, and punctuation on the nine-key board. */
export const KEY_MODE = { lower: 0, digits: 1, upper: 2, marks: 3 } as const;

/** The mode key steps abc, 123, #+=, ABC on the nine-key board and abc, 123, ABC on the grid. */
const NINE_MODES: readonly number[] = [KEY_MODE.lower, KEY_MODE.digits, KEY_MODE.marks, KEY_MODE.upper];

export function nextKeyMode(mode: number, scr: { w: number; h: number }, machine?: string): number {
  if (layoutFor(scr, machine).keyboard !== "nine") return (mode + 1) % 3;
  const at = NINE_MODES.indexOf(mode);
  return NINE_MODES[(at + 1) % NINE_MODES.length] ?? KEY_MODE.lower;
}

/** The nine-key board's mode key names the mode in use. */
export function nineModeLabel(mode: number): string {
  if (mode === KEY_MODE.digits) return "123";
  if (mode === KEY_MODE.upper) return "ABC";
  if (mode === KEY_MODE.marks) return "#+=";
  return "abc";
}

export function keyRows(kind: KeyKind, mode: number): string[][] {
  if (kind === "ipv4") return IPV4;
  if (kind === "ipv6") return IPV6;
  if (kind === "number") return NUMBER;
  if (mode === 1) return TEXT_SYMBOL;
  if (mode === 2) return TEXT_UPPER;
  return TEXT_LOWER;
}

export function keyLabel(token: string, mode: number): string {
  if (token === "MD") return mode === 0 ? "123" : mode === 1 ? "ABC" : "abc";
  if (token === "SP") return "";
  if (token === "BS") return "";
  if (token === "OK") return "";
  if (token === "ESC") return "X";
  return token;
}

export function moveFocus(focus: number, step: number, count: number): number {
  if (count <= 0) return 0;
  const next = focus + step;
  if (next < 0) return 0;
  if (next >= count) return count - 1;
  return next;
}

export function backspace(value: string, count: number): string {
  const chars = Array.from(value);
  const drop = Math.max(0, Math.min(chars.length, count));
  return chars.slice(0, chars.length - drop).join("");
}

export function applyToken(value: string, token: string, max: number): { value: string; action: KeyAction } {
  if (token === "OK") return { value, action: "ok" };
  if (token === "ESC") return { value, action: "cancel" };
  if (token === "MD") return { value, action: "mode" };
  if (token === "BS") return { value: backspace(value, 1), action: "char" };
  if (token === "SP") return { value: appendChar(value, " ", max), action: "char" };
  return { value: appendChar(value, token, max), action: "char" };
}

function appendChar(value: string, ch: string, max: number): string {
  if (Array.from(value).length >= max) return value;
  return value + ch;
}

type Cell = { token: string; label: string; chars: string[]; icon: KeyIcon };

function act(token: string, mode: number): Cell {
  if (token === "BS") return { token, label: "", chars: [], icon: "backspace" };
  if (token === "OK") return { token, label: "", chars: [], icon: "enter" };
  if (token === "SP") return { token, label: "", chars: [], icon: "space" };
  return { token, label: keyLabel(token, mode), chars: [], icon: "" };
}

function ch(token: string): Cell {
  return { token, label: token, chars: [token], icon: "" };
}

function grp(chars: readonly string[]): Cell {
  const copy = chars.slice();
  return { token: copy[0] ?? "", label: copy.join(""), chars: copy, icon: "" };
}

function nineLetters(upper: boolean): Cell[][] {
  const groups = [
    NINE_LOWER.slice(0, 3),
    NINE_LOWER.slice(3, 6),
    NINE_LOWER.slice(6, 9),
  ];
  return groups.map((row) =>
    row.map((chars) => grp(upper ? chars.map((item) => item.toUpperCase()) : chars)),
  );
}

function nineRows(kind: KeyKind, mode: number): Cell[][] {
  const modeKey: Cell = { ...act("MD", mode), label: nineModeLabel(mode) };
  const actions = [modeKey, act("SP", mode), act("BS", mode), act("OK", mode), act("ESC", mode)];
  if (kind === "ipv4") {
    return [
      [ch("1"), ch("2"), ch("3")],
      [ch("4"), ch("5"), ch("6")],
      [ch("7"), ch("8"), ch("9")],
      [ch("."), ch("0"), ch("/")],
      [act("BS", mode), act("OK", mode), act("ESC", mode)],
    ];
  }
  if (kind === "number") {
    return [
      [ch("1"), ch("2"), ch("3")],
      [ch("4"), ch("5"), ch("6")],
      [ch("7"), ch("8"), ch("9")],
      [act("BS", mode), ch("0"), act("ESC", mode), act("OK", mode)],
    ];
  }
  if (kind === "ipv6") {
    return [
      [grp(["1", "2", "3"]), grp(["4", "5", "6"]), grp(["7", "8", "9"])],
      [grp(["a", "b", "c"]), grp(["d", "e", "f"]), grp(["0", ":"])],
      [act("BS", mode), act("OK", mode), act("ESC", mode)],
    ];
  }
  if (mode === KEY_MODE.digits) {
    return [
      [ch("1"), ch("2"), ch("3")],
      [ch("4"), ch("5"), ch("6")],
      [ch("7"), ch("8"), ch("9")],
      [modeKey, ch("0"), act("BS", mode), act("OK", mode), act("ESC", mode)],
    ];
  }
  if (mode === KEY_MODE.marks) {
    return [
      NINE_MARKS.slice(0, 3).map(grp),
      NINE_MARKS.slice(3, 6).map(grp),
      NINE_MARKS.slice(6, 9).map(grp),
      actions,
    ];
  }
  return [...nineLetters(mode === KEY_MODE.upper), actions];
}

function gridRows(kind: KeyKind, mode: number): Cell[][] {
  return keyRows(kind, mode).map((row) =>
    row.map((token) => {
      if (token === "BS" || token === "OK" || token === "MD" || token === "SP" || token === "ESC") {
        return act(token, mode);
      }
      return ch(token);
    }),
  );
}

export type Cap = {
  token: string;
  label: string;
  chars: string[];
  icon: KeyIcon;
  x: number;
  y: number;
  /** Y relative to the keyboard panel top. Hit tests use `y`. */
  ly: number;
  w: number;
  h: number;
};

/** Field name over the typed text. The keys never cover it. */
export const KEY_HEADER_H = 38;
/** Header text inset from the panel side. */
export const HEADER_X = 16;
export const HEADER_LABEL_H = 14;
export const HEADER_VALUE_H = 20;
/** Gap between header content and the arc of a rounded panel corner. */
export const CORNER_CLEAR = 6;
/** Show/hide button height on a panel with rounded corners. */
const ROUND_BUTTON_H = 26;
/** Header content starts this far below the top edge of a panel with rounded corners. */
const ROUND_TOP = 8;

/**
 * Smallest header on a panel with rounded corners: the label and the typed
 * line below ROUND_TOP, with the show button centred on the typed line.
 */
function roundHeaderH(kind: KeyKind): number {
  const button = kind === "text" ? (ROUND_BUTTON_H - HEADER_VALUE_H) / 2 : 0;
  return ROUND_TOP + HEADER_LABEL_H + HEADER_VALUE_H + button + 2;
}
/** Corner radius of a key. */
export const KEY_RADIUS = 10;

export function layoutKeys(
  kind: KeyKind,
  mode: number,
  scr: { w: number; h: number },
  machine?: string,
): { top: number; previewH: number; board: KeyboardBoard; corner: number; caps: Cap[] } {
  const layout = layoutFor(scr, machine);
  const board = layout.keyboard;
  const grid = board === "nine" ? nineRows(kind, mode) : gridRows(kind, mode);
  const gap = board === "nine" ? 4 : 3;
  // Bottom corner keys keep their rounded outline inside a rounded panel corner.
  const margin = Math.max(4, cornerInset(layout.corner) - Math.ceil(KEY_RADIUS * (1 - Math.SQRT1_2)));
  const rows = grid.length;
  const gaps = Math.max(0, rows - 1) * gap;
  const widest = Math.max(1, ...grid.map((row) => row.length));
  const narrowest = Math.floor((scr.w - margin * 2 - gap * (widest - 1)) / widest);
  // Keys take the panel height below the header, up to 1.5 times their
  // width; the nine-key board keeps its 52 px keys.
  const tallest = board === "nine" ? 52 : Math.max(32, Math.round(narrowest * 1.5));
  const minKey = scr.h < 200 ? 14 : 18;
  const headerMin = layout.corner > 0 ? roundHeaderH(kind) : KEY_HEADER_H;
  const room = scr.h - headerMin - margin - gaps;
  const keyH = Math.max(minKey, Math.min(tallest, Math.floor(room / Math.max(1, rows))));
  const keysH = rows * keyH + gaps + margin;
  let previewH = headerMin;
  // A strip of the page under two headers tall shows only a cut-off row; the header takes it.
  if (scr.h - keysH - previewH < KEY_HEADER_H * 2) previewH = Math.max(headerMin, scr.h - keysH);
  const top = Math.max(0, scr.h - keysH - previewH);
  const caps: Cap[] = [];
  let y = top + previewH;
  for (const row of grid) {
    const n = row.length;
    const keyW = Math.floor((scr.w - margin * 2 - gap * Math.max(0, n - 1)) / Math.max(1, n));
    const rowW = n * keyW + Math.max(0, n - 1) * gap;
    let x = Math.floor((scr.w - rowW) / 2);
    for (const cell of row) {
      caps.push({
        token: cell.token,
        label: cell.label,
        chars: cell.chars,
        icon: cell.icon,
        x,
        y,
        ly: y - top,
        w: keyW,
        h: keyH,
      });
      x += keyW + gap;
    }
    y += keyH + gap;
  }
  return { top, previewH, board, corner: layout.corner, caps };
}

/**
 * Letters of a held group, in a row above the key. The row stays inside the
 * panel and, on a panel with rounded corners, clear of them.
 */
export function pickChips(
  cap: Pick<Cap, "x" | "ly" | "w" | "chars">,
  lay: { top: number; corner: number },
  scr: { w: number; h: number },
): { x: number; y: number; size: number }[] {
  const size = 36;
  const gap = 4;
  const count = cap.chars.length;
  const width = count * size + (count - 1) * gap;
  const inset = Math.max(2, cornerInset(lay.corner));
  let x = Math.round(cap.x + cap.w / 2 - width / 2);
  if (x < inset) x = inset;
  if (x + width > scr.w - inset) x = Math.max(inset, scr.w - inset - width);
  const minY = lay.corner > 0 ? inset - lay.top : 0;
  const y = Math.max(minY, cap.ly - size - 4);
  return cap.chars.map((_, index) => ({ x: x + index * (size + gap), y, size }));
}

/**
 * Dark band behind the chip row, so the chips stand apart from the keys under
 * them. It keeps inside the panel; y is relative to the keyboard panel top.
 */
export function pickBand(
  chips: readonly { x: number; y: number; size: number }[],
  lay: { top: number },
  scr: { w: number },
): { x: number; y: number; w: number; h: number } {
  const pad = 4;
  const first = chips[0];
  const last = chips[chips.length - 1];
  if (!first || !last) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.max(0, first.x - pad);
  const right = Math.min(scr.w, last.x + last.size + pad);
  const y = Math.max(-lay.top, first.y - pad);
  return { x, y, w: right - x, h: first.y + first.size + pad - y };
}

/** Chip under panel x, or the nearest chip when x is outside the row. */
export function chipAt(chips: readonly { x: number; size: number }[], x: number): number {
  let best = 0;
  let bestGap = Infinity;
  chips.forEach((chip, index) => {
    const gap = x < chip.x ? chip.x - x : x >= chip.x + chip.size ? x - (chip.x + chip.size - 1) : 0;
    if (gap < bestGap) {
      best = index;
      bestGap = gap;
    }
  });
  return best;
}

/**
 * Character of a held group chosen by the finger at panel x: the one whose
 * chip is under the finger. It does not depend on where the press started.
 */
export function pickAt(
  cap: Pick<Cap, "x" | "ly" | "w" | "chars">,
  lay: { top: number; corner: number },
  scr: { w: number; h: number },
  x: number,
): number {
  return chipAt(pickChips(cap, lay, scr), x);
}

/**
 * Secret text. The last character stays visible until `peekUntil`, then every
 * character is a dot. `revealed` shows the whole value.
 */
export function maskSecret(value: string, revealed: boolean, now: number, peekUntil: number): string {
  if (revealed) return value;
  const chars = Array.from(value);
  if (chars.length === 0) return "";
  if (now < peekUntil) return "*".repeat(chars.length - 1) + chars[chars.length - 1];
  return "*".repeat(chars.length);
}

/**
 * Smallest x, from the left panel edge, for a box whose top-left corner sits
 * at panel y, keeping that corner CORNER_CLEAR inside a rounded panel corner.
 */
function cornerClearX(corner: number, y: number): number {
  if (corner <= 0 || y >= corner) return 0;
  const room = corner - CORNER_CLEAR;
  const dy = corner - y;
  if (dy >= room) return corner;
  return Math.ceil(corner - Math.sqrt(room * room - dy * dy));
}

export type KeyHeader = {
  /** Left x of the label and the typed text. */
  x: number;
  /** Inset of the label and the typed text from the right panel edge. */
  right: number;
  /** Tops of the label and the typed line, relative to the keyboard panel. */
  label: number;
  value: number;
  /** Show/hide button in panel coordinates. */
  button: { x: number; y: number; w: number; h: number };
};

/**
 * Header of the keyboard: field name, typed text and, for a secret, the
 * show/hide button. On a panel with rounded corners every part, the button's
 * own rounded corners included, stays CORNER_CLEAR inside the corner arcs and
 * the button is centred on the typed line.
 */
export function keyHeader(
  lay: { top: number; previewH: number; corner?: number },
  scr: { w: number; h: number },
  labelled: boolean,
  secret: boolean,
): KeyHeader {
  const h = lay.previewH;
  const r = lay.corner ?? 0;
  const bw = scr.h < 200 ? 40 : 48;
  if (r <= 0) {
    const y = Math.max(0, Math.round((h - HEADER_LABEL_H - HEADER_VALUE_H) / 2));
    const label = labelled ? y : 0;
    const value = labelled ? y + HEADER_LABEL_H : Math.round((h - HEADER_VALUE_H) / 2);
    const button = { x: scr.w - 14 - bw, y: lay.top + 6, w: bw, h: Math.max(16, h - 10) };
    return { x: HEADER_X, right: secret ? scr.w - button.x + 8 : HEADER_X, label, value, button };
  }
  const overhang = (ROUND_BUTTON_H - HEADER_VALUE_H) / 2;
  const block = (labelled ? HEADER_LABEL_H : overhang) + HEADER_VALUE_H + overhang;
  const top = Math.max(ROUND_TOP, Math.round((h - block) / 2));
  const label = labelled ? top : 0;
  const value = labelled ? top + HEADER_LABEL_H : top + overhang;
  const x = Math.max(
    HEADER_X,
    labelled ? cornerClearX(r, lay.top + label) : 0,
    cornerClearX(r, lay.top + value),
  );
  // The button's top-right rounded corner keeps CORNER_CLEAR from the arc.
  const by = lay.top + value - overhang;
  const radius = 8;
  let bx = scr.w - 14 - bw;
  const cy = by + radius;
  if (cy < r) {
    const room = r - CORNER_CLEAR - radius;
    const dy = r - cy;
    const dx = dy < room ? Math.sqrt(room * room - dy * dy) : 0;
    bx = Math.min(bx, Math.floor(scr.w - r + dx - bw + radius));
  }
  const button = { x: bx, y: by, w: bw, h: ROUND_BUTTON_H };
  // The caret sits after the text; two more pixels keep it off the right arc.
  return { x, right: secret ? scr.w - bx + 8 : x + 2, label, value, button };
}

/** Show/hide button for a secret, at the right of the header, clear of rounded corners. */
export function revealBox(
  lay: { top: number; previewH: number; corner?: number },
  scr: { w: number; h: number },
  labelled = true,
) {
  return keyHeader(lay, scr, labelled, true).button;
}

/** Caret x after typed text of the given width. */
export function caretX(head: KeyHeader, scr: { w: number }, textWidth: number): number {
  return Math.min(scr.w - head.right, head.x + textWidth + 1);
}

/** Keep the end of the typed text, where the next character goes, in view. */
export function tailFit(text: string, width: number, measure: (text: string) => number): string {
  if (measure(text) <= width) return text;
  const chars = Array.from(text);
  let lo = 1;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (measure("…" + chars.slice(mid).join("")) <= width) hi = mid;
    else lo = mid + 1;
  }
  return "…" + chars.slice(lo).join("");
}

export function hitCap(caps: readonly Cap[], x: number, y: number): number {
  return caps.findIndex((key) => x >= key.x && x < key.x + key.w && y >= key.y && y < key.y + key.h);
}

/**
 * Character to commit when the finger lifts. A short slide still counts: the
 * press highlight is already showing, and the system tap dies after 8px.
 * A long-press slide uses `which`. Lift far from the key commits nothing.
 */
export function releaseKey(
  caps: readonly { x: number; y: number; w: number; h: number; token: string; chars: readonly string[] }[],
  index: number,
  x: number,
  y: number,
  picking: boolean,
  which: number,
  slop = 20,
): string | null {
  if (index < 0 || index >= caps.length) return null;
  const cap = caps[index];
  if (!cap) return null;
  if (picking && cap.chars.length > 1) {
    const at = Math.max(0, Math.min(cap.chars.length - 1, which));
    return cap.chars[at] || cap.token;
  }
  if (x < cap.x - slop || x >= cap.x + cap.w + slop || y < cap.y - slop || y >= cap.y + cap.h + slop) return null;
  return cap.token;
}

/** Touch draws only the key under the finger. The knob focus stays hidden until the knob is on. */
export function keyboardMark(hot: number, focus: number, knobOn: boolean): number {
  if (hot >= 0) return hot;
  if (knobOn && focus >= 0) return focus;
  return -1;
}
