import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsxPlugin } from "../../tmp/pocketjs/framework/compiler/jsx-plugin.ts";

const outdir = await mkdtemp(join(tmpdir(), "onekvm-screen-controls-"));
try {
  const entry = new URL("../tests/screen-controls.sim.tsx", import.meta.url).pathname;
  const result = await Bun.build({
    entrypoints: [entry], plugins: [{
      name: "screen-ui-source",
      setup(build) {
        build.onResolve({ filter: /^@onekvm\/screen-ui$/ }, () => ({
          path: new URL("../packages/screen-ui/src/index.ts", import.meta.url).pathname,
        }));
      },
    }, jsxPlugin("vue-vapor", { entry })],
    outdir, naming: "controls.js", target: "bun", format: "esm", conditions: ["browser"],
  });
  if (!result.success) throw new AggregateError(result.logs, "screen controls build failed");
  for (const width of ["240", "320"]) for (const language of ["en", "zh", "zh_tw"]) for (const scene of ["power", "power-rotary", "plugin", "stream", "stick", "tailscale", "netbird", "zerotier", "easytier", "wake-on-lan", "pill"]) {
    const proc = Bun.spawn([process.execPath, join(outdir, "controls.js"), scene, language], { stdout: "inherit", stderr: "inherit", env: { ...process.env, SCREEN_SIM_WIDTH: width } });
    if (await proc.exited !== 0) throw new Error(`${scene} controls failed`);
  }
} finally {
  await rm(outdir, { recursive: true, force: true });
}
