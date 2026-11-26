export interface Command { label: string; modifiers: number; keys: number[]; led?: "num_lock" | "caps_lock" | "scroll_lock" }
const key = (label: string, code: number): Command => ({ label, modifiers: 0, keys: [code] });
export const commonKeys: Command[] = [
  key("Esc", 0x29), key("Tab", 0x2b), key("Enter", 0x28), key("Backspace", 0x2a), key("Delete", 0x4c), key("Space", 0x2c),
  key("↑", 0x52), key("↓", 0x51), key("←", 0x50), key("→", 0x4f), key("Home", 0x4a), key("End", 0x4d), key("Page Up", 0x4b), key("Page Down", 0x4e),
  ...Array.from({ length: 12 }, (_, index) => key(`F${index + 1}`, 0x3a + index)), key("Insert", 0x49), key("Print Screen", 0x46),
];
export const shortcuts: Command[] = [
  { label: "Ctrl + Alt + Del", modifiers: 5, keys: [0x4c] },
  { label: "Alt + Tab", modifiers: 4, keys: [0x2b] },
  { label: "Alt + F4", modifiers: 4, keys: [0x3d] },
  { label: "Ctrl + Shift + Esc", modifiers: 3, keys: [0x29] },
  { label: "Win / Super", modifiers: 8, keys: [] },
  { label: "Win + L", modifiers: 8, keys: [0x0f] },
  { label: "Win + R", modifiers: 8, keys: [0x15] },
  { label: "Ctrl + C", modifiers: 1, keys: [0x06] },
  { label: "Ctrl + V", modifiers: 1, keys: [0x19] },
  { label: "Ctrl + A", modifiers: 1, keys: [0x04] },
];
export const lockKeys: Command[] = [
  { ...key("num", 0x53), led: "num_lock" },
  { ...key("caps", 0x39), led: "caps_lock" },
  { ...key("scroll", 0x47), led: "scroll_lock" },
];
