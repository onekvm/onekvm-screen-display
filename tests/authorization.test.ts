import { expect, test } from "bun:test";
import { authorization as netbird } from "../../onekvm-extension-netbird/screen-app/src/status";
import { authorization as tailscale, statusLabel as tailscaleStatus } from "../../onekvm-extension-tailscale/screen-app/src/status";
import { authorizationLayout, authorizationURL, parseQrCode, qrTexture } from "../packages/screen-ui/src/authorization";
import { actionEnabled as netbirdAction } from "../../onekvm-extension-netbird/screen-app/src/status";
import { actionEnabled as tailscaleAction } from "../../onekvm-extension-tailscale/screen-app/src/status";

for (const [provider, enabled, connected] of [["NetBird", netbirdAction, { daemonStatus: "Connected" }], ["Tailscale", tailscaleAction, { backendState: "Running" }]] as const) {
  test(`${provider} enables commands according to the enrollment state machine`, () => {
    const connect = { method: "connect", title: "Connect" }, disconnect = { method: "disconnect", title: "Disconnect" };
    expect(enabled({}, connect)).toBe(false);
    expect(enabled({}, disconnect)).toBe(false);
    for (const authState of ["idle", "expired", "timed-out", "failed"]) {
      expect(enabled({ online: true, authState }, connect)).toBe(true);
      expect(enabled({ online: true, authState }, disconnect)).toBe(false);
    }
    for (const authState of ["starting", "pending", "connecting"]) {
      expect(enabled({ online: true, authState }, connect)).toBe(false);
      expect(enabled({ online: true, authState }, disconnect)).toBe(true);
    }
    expect(enabled({ online: true, ...connected }, connect)).toBe(false);
    expect(enabled({ online: true, ...connected }, disconnect)).toBe(true);
  });
}

for (const [provider, authorize, connected] of [
  ["NetBird", netbird, { daemonStatus: "Connected" }],
  ["Tailscale", tailscale, { loggedIn: true }],
] as const) {
  test(`${provider} displays only the active authorization link and retires it on completion/failure`, () => {
    const url = "https://login.example/activate?user_code=ABCD-EFGH&redirect=%2Fdevice";
    expect(authorize({ authState: "pending", authURL: url })).toEqual({ state: "pending", url });
    expect(authorize({ ...connected, authState: "pending", authURL: url })).toEqual({ state: "idle" });
    for (const phase of ["starting", "connecting", "failed", "expired", "timed-out"] as const)
      expect(authorize({ authState: phase, authURL: url })).toEqual({ state: phase });
    expect(authorize({ authState: "idle", authURL: url })).toEqual({ state: "idle" });
    expect(authorize({ authState: "pending", authURL: "" })).toEqual({ state: "idle" });
  });
}

test("QR URLs preserve the device code and reject unusable schemes, credentials and control characters", () => {
  const url = "https://self-hosted.example:8443/verify?code=ab%2Fcd&next=%2Fdevice#login";
  expect(authorizationURL(url)).toBe(url);
  for (const invalid of [null, "", "javascript:alert(1)", "https://user:secret@example.com", "https://login.example\n/verify", "https://", "https://" + "x".repeat(1024)])
    expect(authorizationURL(invalid)).toBe("");
});

test("NetBird retains the manual code when a provider returns a verification URL without it", () => {
  expect(netbird({ authState: "pending", authURL: "https://login.example/activate", authCode: "WXYZ-1234" }))
    .toEqual({ state: "pending", url: "https://login.example/activate", code: "WXYZ-1234" });
});

test("QR layout keeps integer modules and a complete quiet zone on Pro and square panels", () => {
  for (const [width, height] of [[320, 172], [240, 240]]) for (const modules of [21, 29, 33, 37, 41, 45, 49]) {
    const layout = authorizationLayout(width, height, modules);
    expect(Number.isInteger(layout.module)).toBe(true);
    expect(layout.module).toBeGreaterThanOrEqual(2);
    expect(layout.x).toBeGreaterThanOrEqual(0);
    expect(layout.y).toBeGreaterThanOrEqual(0);
    expect(layout.x + layout.size).toBeLessThanOrEqual(width);
    expect(layout.y + layout.size).toBeLessThanOrEqual(height);
    expect(layout.size).toBe((modules + 8) * layout.module);
  }
});

test("malformed QR data cannot place modules outside the image", () => {
  expect(parseQrCode('{"size":21,"runs":[[0,0,7],[8,4,2]]}')).not.toBeNull();
  for (const raw of ["", "null", '{"size":20,"runs":[]}', '{"size":21,"runs":[[20,0,2]]}', '{"size":21,"runs":[[0,-1,3]]}', '{"size":21,"runs":[[0,0,1.5]]}'])
    expect(parseQrCode(raw)).toBeNull();
});

// Retained identity/IP addresses do not prove the tunnel is running.
test("Tailscale reports a stopped tunnel as disconnected", () => {
  const t = ((key: string) => key) as any;
  expect(tailscaleStatus({ backendState: "Stopped", loggedIn: true }, t)).toBe("disconnected");
  expect(tailscaleStatus({ backendState: "Running", loggedIn: true }, t)).toBe("connected");
});

test("QR uses a bounded native texture with integer modules and white quiet edges", () => {
  const pixels = qrTexture({size:21,runs:[[0,0,7],[0,1,1]]})!;
  expect(pixels.length).toBe(128*128*2);
  expect([...pixels.subarray(0,128*2)].every(n => n===255)).toBe(true);
  expect([...pixels.subarray(-128*2)].every(n => n===255)).toBe(true);
  expect(qrTexture({size:69,runs:[]})).toBeNull();
});
