import type { Authorization } from "./types";

export interface QrCode { size: number; runs: [number, number, number][] }

export function authorizationURL(value: unknown): string {
  // QuickJS has no browser URL class. Keep the complete device link, including
  // query parameters, while rejecting credentials, whitespace and other schemes.
  if (typeof value !== "string" || value.length > 1024 || /[\s\x00-\x1f\x7f]/.test(value)) return "";
  return /^https?:\/\/[^/?#@]+(?:[/?#].*)?$/i.test(value) ? value : "";
}

export function parseQrCode(raw: string): QrCode | null {
  try {
    const qr = JSON.parse(raw) as QrCode;
    if (!Number.isInteger(qr.size) || qr.size < 21 || qr.size > 177 || !Array.isArray(qr.runs)) return null;
    if (!qr.runs.every(run => Array.isArray(run) && run.length === 3 && run.every(Number.isInteger)
      && run[0] >= 0 && run[1] >= 0 && run[1] < qr.size && run[2] > 0 && run[0] + run[2] <= qr.size)) return null;
    return qr;
  } catch { return null; }
}

export function authorizationLayout(width: number, height: number, modules: number) {
  const landscape = width > height;
  const available = landscape ? Math.min(height - 20, Math.floor(width * 0.49)) : Math.min(width - 24, height - 100);
  const module = Math.floor(available / (modules + 8));
  const size = module * (modules + 8);
  return { landscape, module, size, x: landscape ? 10 : Math.round((width - size) / 2), y: landscape ? Math.round((height - size) / 2) : 30 };
}

export function authorizationMessage(auth: Authorization) {
  switch (auth.state) {
    case "starting": return "preparingLogin";
    case "pending": return "awaitingLogin";
    case "connecting": return "connecting";
    case "expired": return "loginExpired";
    case "timed-out": return "loginTimedOut";
    case "failed": return "loginFailed";
    default: return "disconnected";
  }
}

/** One power-of-two RGB565 texture, with integer modules and a quiet zone.
 * Rendering hundreds of reactive View nodes exceeds small-device frame budgets. */
export function qrTexture(qr: QrCode, side = 128): Uint8Array | null {
  const module = Math.floor(side / (qr.size + 8));
  if (module < 2) return null;
  const pixels = new Uint8Array(side * side * 2).fill(255);
  const origin = Math.floor((side - qr.size * module) / 2);
  for (const [x, y, width] of qr.runs) {
    for (let dy = 0; dy < module; dy++) {
      const start = ((origin + y * module + dy) * side + origin + x * module) * 2;
      pixels.fill(0, start, start + width * module * 2);
    }
  }
  return pixels;
}
