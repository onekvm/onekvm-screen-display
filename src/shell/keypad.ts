import { layoutFor, type KeyboardBoard } from "./layouts";

export type KeyKind = "text" | "ipv4" | "ipv6" | "number";

export type KeyAction = "char" | "ok" | "cancel" | "mode";

export type KeyIcon = "" | "backspace" | "enter" | "space";

const TEXT_LOWER = [
  ["a", "b", "c", "d", "e", "f"],
  ["g", "h", "i", "j", "k", "l"],
  ["m", "n", "o", "p", "q", "r"],
  ["s", "t", "u", "v", "w", "x"],
  ["y", "z", ".", "-", "_", "@"],
  ["MD", "SP", "BS", "OK", "X"],
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
  ["MD", "SP", "BS", "OK", "X"],
];

const IPV4 = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "/"],
  ["BS", "OK", "X"],
];

const IPV6 = [
  ["1", "2", "3", "a", "b", "c"],
  ["4", "5", "6", "d", "e", "f"],
  ["7", "8", "9", ":", "0", "BS"],
  ["OK", "X"],
];

const NUMBER = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["BS", "0", "OK"],
  ["X"],
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
  if (token === "X") return "X";
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
  if (token === "X") return { value, action: "cancel" };
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
  const actions = [act("MD", mode), act("SP", mode), act("BS", mode), act("OK", mode), act("X", mode)];
  if (kind === "ipv4") {
    return [
      [ch("1"), ch("2"), ch("3")],
      [ch("4"), ch("5"), ch("6")],
      [ch("7"), ch("8"), ch("9")],
      [ch("."), ch("0"), ch("/")],
      [act("BS", mode), act("OK", mode), act("X", mode)],
    ];
  }
  if (kind === "number") {
    return [
      [ch("1"), ch("2"), ch("3")],
      [ch("4"), ch("5"), ch("6")],
      [ch("7"), ch("8"), ch("9")],
      [act("BS", mode), ch("0"), act("X", mode), act("OK", mode)],
    ];
  }
  if (kind === "ipv6") {
    return [
      [grp(["1", "2", "3"]), grp(["4", "5", "6"]), grp(["7", "8", "9"])],
      [grp(["a", "b", "c"]), grp(["d", "e", "f"]), grp(["0", ":"])],
      [act("BS", mode), act("OK", mode), act("X", mode)],
    ];
  }
  if (mode === 1) {
    return [
      [ch("1"), ch("2"), ch("3")],
      [ch("4"), ch("5"), ch("6")],
      [ch("7"), ch("8"), ch("9")],
      [act("MD", mode), ch("0"), act("BS", mode), act("OK", mode), act("X", mode)],
    ];
  }
  return [...nineLetters(mode === 2), actions];
}

function gridRows(kind: KeyKind, mode: number): Cell[][] {
  return keyRows(kind, mode).map((row) =>
    row.map((token) => {
      if (token === "BS" || token === "OK" || token === "MD" || token === "SP" || token === "X") {
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

export function layoutKeys(
  kind: KeyKind,
  mode: number,
  scr: { w: number; h: number },
  machine?: string,
): { top: number; previewH: number; board: KeyboardBoard; caps: Cap[] } {
  const board = layoutFor(scr, machine).keyboard;
  const grid = board === "nine" ? nineRows(kind, mode) : gridRows(kind, mode);
  const gap = board === "nine" ? 4 : 3;
  const margin = 4;
  // Pro is 320×172 and has no touch, so the keys can be short. The typed
  // text stays in a band above them instead of sliding under the first row.
  const compact = scr.h < 200;
  const previewH = compact ? 40 : board === "nine" ? 28 : 22;
  let keyH = board === "nine" ? 52 : scr.h >= 300 ? 32 : compact ? 16 : 24;
  const rows = grid.length;
  const gaps = Math.max(0, rows - 1) * gap;
  const room = scr.h - 4 - previewH - margin - gaps;
  const minKey = compact ? 14 : 18;
  if (rows * keyH > room) keyH = Math.max(minKey, Math.floor(room / Math.max(1, rows)));
  const boardH = previewH + rows * keyH + gaps + margin;
  const top = Math.max(0, scr.h - boardH);
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
  return { top, previewH, board, caps };
}

/** Long-press slide: dx is the finger travel since the press, step is one character. */
export function slidePick(dx: number, count: number, step: number): number {
  if (count <= 1) return 0;
  const size = step > 0 ? step : 1;
  let index = Math.round(dx / size);
  if (index < 1) return 0;
  if (index >= count) return count - 1;
  return index;
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
