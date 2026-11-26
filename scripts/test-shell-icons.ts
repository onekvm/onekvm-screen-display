import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsxPlugin } from "../../tmp/pocketjs/framework/compiler/jsx-plugin";
const outdir = await mkdtemp(join(tmpdir(), "onekvm-shell-icons-"));
try {
  const entry = new URL("../tests/shell-icons.sim.tsx", import.meta.url).pathname;
  const result = await Bun.build({ entrypoints: [entry], plugins: [jsxPlugin("vue-vapor", { entry })], outdir, naming: "test.mjs", target: "bun", format: "esm", conditions: ["browser"] });
  if (!result.success) throw new AggregateError(result.logs, "shell icons build failed");
  const proc = Bun.spawn([process.execPath, join(outdir, "test.mjs")], { stdout: "inherit", stderr: "inherit" });
  if (await proc.exited !== 0) process.exitCode = 1;
} finally { await rm(outdir, { recursive: true, force: true }); }
