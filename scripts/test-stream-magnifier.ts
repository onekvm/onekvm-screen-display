import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsxPlugin } from "../../tmp/pocketjs/framework/compiler/jsx-plugin.ts";

const outdir = await mkdtemp(join(tmpdir(), "onekvm-stream-magnifier-"));
try {
  const entry = new URL("../tests/stream-magnifier.sim.tsx", import.meta.url).pathname;
  const result = await Bun.build({
    entrypoints: [entry], plugins: [jsxPlugin("vue-vapor", { entry })],
    outdir, naming: "magnifier.js", target: "bun", format: "esm", conditions: ["browser"],
  });
  if (!result.success) throw new AggregateError(result.logs, "magnifier simulation build failed");
  for (const size of ["240x240", "320x172", "172x320"]) {
    const proc = Bun.spawn([process.execPath, join(outdir, "magnifier.js")], {
      stdout: "inherit", stderr: "inherit", env: { ...process.env, SCREEN_SIM_SIZE: size },
    });
    if (await proc.exited !== 0) throw new Error(`magnifier ${size} failed`);
  }
} finally {
  await rm(outdir, { recursive: true, force: true });
}
