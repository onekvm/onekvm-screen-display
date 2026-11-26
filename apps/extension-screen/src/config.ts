export const CONFIG = {
  extension: "screen-display",
  title: "Power control",
  icon: "src/power.png",
  statusMethod: "status",
  actions: [{ method: "on", title: "On" }, { method: "off", title: "Off" }, { method: "reset", title: "Reset" }],
  kind: "power",
} as const;
