/** Build against one supplied SDK without writing dependencies into a checkout. */
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = new Map(process.argv.slice(2).map(arg => {
  const split = arg.indexOf("=");
  if (split < 0) throw new Error(`Expected --option=value, got ${arg}`);
  return [arg.slice(2, split), arg.slice(split + 1)];
}));
function required(name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`Missing --${name}`);
  return resolve(value);
}
const source = required("source");
const outdir = required("outdir");
const compiler = join(required("pocketjs"), "tools/build.ts");
const regular = required("font-regular");
const bold = required("font-bold");
const sdk = dirname(fileURLToPath(import.meta.url));
const withIcon = args.get("icon") !== "false";
const surfaceSdk = await Bun.file(resolve(sdk, "../screen-sdk/package.json")).exists()
  ? resolve(sdk, "../screen-sdk") : resolve(sdk, "../onekvm-screen-sdk");
for (const file of [join(source, "main.tsx"), ...(withIcon ? [join(source, "logo.png")] : []), compiler, regular, bold]) {
  if (!await Bun.file(file).exists()) throw new Error(`Missing build input: ${file}`);
}
await mkdir(dirname(outdir), { recursive: true });
const project = await mkdtemp(join(dirname(outdir), ".screen-app-"));
try {
  await cp(source, join(project, "src"), { recursive: true });
  await cp(join(sdk, "assets"), join(project, "screen-ui"), { recursive: true });
  await mkdir(join(project, "node_modules/@onekvm"), { recursive: true });
  await mkdir(join(project, "sdk"));
  await cp(sdk, join(project, "sdk/screen-ui"), { recursive: true });
  await symlink(join(project, "sdk/screen-ui"), join(project, "node_modules/@onekvm/screen-ui"), "dir");
  const hasSurfaceSdk = await Bun.file(join(surfaceSdk, "package.json")).exists();
  if (hasSurfaceSdk) {
    await cp(surfaceSdk, join(project, "sdk/screen-sdk"), { recursive: true });
    await symlink(join(project, "sdk/screen-sdk"), join(project, "node_modules/@onekvm/screen-sdk"), "dir");
  }
  // PocketJS 0.11 scans relative imports for fonts/styles in pass 1. Name the
  // SDK resource root explicitly so bare package imports in App code retain
  // all shared classes and localized glyphs. Bun deduplicates it in pass 2.
  await writeFile(join(project, "main.tsx"), 'import "./sdk/screen-ui/src/index";\n'
    + (hasSurfaceSdk ? 'import "./sdk/screen-sdk/src/index";\n' : '') + 'import "./src/main";\n');
  const extra = await Bun.file(join(source, "glyphs.txt")).exists() ? await Bun.file(join(source, "glyphs.txt")).text() : "";
  const child = Bun.spawn([process.execPath, compiler, join(project, "main.tsx"),
    "--framework=vue-vapor", "--no-config", `--project-root=${project}`,
    `--outdir=${outdir}`, `--font-regular=${regular}`, `--font-bold=${bold}`, ...(extra ? [`--extra-chars=${extra}`] : [])],
    { cwd: project, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`PocketJS build failed (${code})`);
  if (!withIcon) { /* Home/widget bundles have no launcher icon. */ }
  else {
  // The same square source image supplies the header and the launcher's ICO1.
  const icon = Bun.file(join(source, "logo.png"));
  const { decodePng } = await import(pathToFileURL(join(required("pocketjs"), "framework/compiler/pak.ts")).href);
  const { width, height, rgba } = decodePng(new Uint8Array(await icon.arrayBuffer()));
  if (width !== 64 || height !== 64) throw new Error("Screen logo.png must be 64×64");
  const output = new Uint8Array(8 + width * height * 3);
  output.set([73, 67, 79, 49, 64, 0, 64, 0]);
  const pixels = new DataView(output.buffer);
  for (let n = 0; n < width * height; n++) {
    pixels.setUint16(8 + n * 2, ((rgba[n * 4] >> 3) << 11) | ((rgba[n * 4 + 1] >> 2) << 5) | (rgba[n * 4 + 2] >> 3), true);
    output[8 + width * height * 2 + n] = rgba[n * 4 + 3];
  }
  await Bun.write(join(outdir, "icon.bin"), output);
  }
} finally {
  await rm(project, { recursive: true, force: true });
}
