import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsxPlugin } from "../../tmp/pocketjs/framework/compiler/jsx-plugin.ts";

const outdir = await mkdtemp(join(tmpdir(), "onekvm-security-"));
try {
  const entry = new URL("../tests/security.sim.tsx", import.meta.url).pathname;
  const result = await Bun.build({
    entrypoints: [entry], plugins: [jsxPlugin("vue-vapor", { entry })],
    outdir, naming: "security.js", target: "bun", format: "esm", conditions: ["browser"],
  });
  if (!result.success) throw new AggregateError(result.logs, "security simulation build failed");
  for (const size of ["240x240", "320x172"]) for (const language of ["en", "zh", "zh_tw"]) {
    const proc = Bun.spawn([process.execPath, join(outdir, "security.js")], {
      stdout: "inherit", stderr: "inherit", env: { ...process.env, SCREEN_SIM_SIZE: size, SCREEN_SIM_LANG: language },
    });
    if (await proc.exited !== 0) throw new Error(`security ${size}/${language} failed`);
  }
} finally { await rm(outdir, { recursive: true, force: true }); }
