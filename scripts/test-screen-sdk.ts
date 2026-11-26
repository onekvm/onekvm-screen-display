import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsxPlugin } from "../../tmp/pocketjs/framework/compiler/jsx-plugin.ts";

const outdir = await mkdtemp(join(tmpdir(), "onekvm-screen-sdk-"));
try {
  const entry = new URL("../tests/screen-sdk.sim.tsx", import.meta.url).pathname;
  const result = await Bun.build({ entrypoints: [entry], plugins: [{
    name: "screen-sdk-source",
    setup(build) {
      build.onResolve({ filter: /^@onekvm\/screen-(sdk|ui)$/ }, args => ({
        path: new URL(`../packages/${args.path.endsWith("sdk") ? "screen-sdk" : "screen-ui"}/src/index.ts`, import.meta.url).pathname,
      }));
    },
  }, jsxPlugin("vue-vapor", { entry })], outdir, naming: "sdk.js", target: "bun", format: "esm", conditions: ["browser"] });
  if (!result.success) throw new AggregateError(result.logs, "screen SDK simulation build failed");
  const child = Bun.spawn([process.execPath, join(outdir, "sdk.js")], { stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error("screen SDK simulation failed");
} finally { await rm(outdir, { recursive: true, force: true }); }
