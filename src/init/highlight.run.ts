import { jsxPlugin } from "../../../tmp/pocketjs/framework/compiler/jsx-plugin.ts";

const outdir = process.argv[2];
if (!outdir) throw new Error("outdir");
const result = await Bun.build({
  entrypoints: [new URL("./highlight.sim.tsx", import.meta.url).pathname],
  plugins: [jsxPlugin("vue-vapor")],
  outdir,
  naming: "highlight.sim.js",
  format: "esm",
  target: "bun",
  conditions: ["browser"],
  packages: "external",
});
if (!result.success) {
  for (const log of result.logs) console.error(log.message);
  process.exit(1);
}
console.log("bundled");
