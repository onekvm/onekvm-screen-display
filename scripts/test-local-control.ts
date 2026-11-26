import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsxPlugin } from "../../tmp/pocketjs/framework/compiler/jsx-plugin.ts";
const outdir = await mkdtemp(join(tmpdir(), "onekvm-local-control-"));
try {
  const entry = new URL("../tests/local-control.sim.tsx", import.meta.url).pathname;
  const build = await Bun.build({ entrypoints: [entry], plugins: [jsxPlugin("vue-vapor", { entry })], outdir,
    naming: "control.js", target: "bun", format: "esm", conditions: ["browser"] });
  if (!build.success) throw new AggregateError(build.logs, "local control simulation build failed");
  for (const size of ["240x240", "320x172"]) for (const language of ["en", "zh", "zh_tw"]) for (const scene of ["media", "keyboard"]) {
    const proc = Bun.spawn([process.execPath, join(outdir, "control.js"), scene], { stdout: "inherit", stderr: "inherit",
      env: { ...process.env, SCREEN_SIM_SIZE: size, SCREEN_SIM_LANG: language } });
    if (await proc.exited !== 0) throw new Error(`${scene} ${size}/${language} failed`);
  }
} finally { await rm(outdir, { recursive: true, force: true }); }
