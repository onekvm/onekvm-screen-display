// Compile the real PocketJS Vue Vapor components before exercising input.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { jsxPlugin } from "../../tmp/pocketjs/framework/compiler/jsx-plugin";

const output = mkdtempSync(join(tmpdir(), "onekvm-screen-input-"));
for (const file of ["apps/settings/src/highlight.sim.tsx", "src/init/highlight.sim.tsx", "src/shell/highlight.sim.tsx", "apps/stick/src/input.sim.tsx"]) {
  const entry = resolve(import.meta.dir, "..", file);
  const result = await Bun.build({
    entrypoints: [entry], outdir: output, naming: "input-test.mjs",
    target: "bun", format: "esm", conditions: ["browser"],
    define: { document: "globalThis.__pocketDocument", "process.env.NODE_ENV": '"production"' },
    plugins: [jsxPlugin("vue-vapor", { entry })],
  });
  if (!result.success) throw new AggregateError(result.logs, `Unable to compile ${file}`);
  const stick = file.startsWith("apps/stick/");
  for (const touch of stick ? ["240", "320"] : file.startsWith("apps/settings/") || file.startsWith("src/shell/") ? ["0", "1"] : ["0"]) {
    const proc = Bun.spawn([process.execPath, join(output, "input-test.mjs")], {
      stdout: "inherit", stderr: "inherit", env: { ...process.env, SETTINGS_SIM_TOUCH: touch, STICK_SIM_WIDTH: stick ? touch : "320" },
    });
    if (await proc.exited !== 0) process.exit(1);
  }
}
