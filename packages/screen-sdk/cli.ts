#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sdk = dirname(fileURLToPath(import.meta.url));
const [command, target, ...args] = process.argv.slice(2);
const options = Object.fromEntries(args.map(arg => {
  const at = arg.indexOf("=");
  if (!arg.startsWith("--") || at < 3) throw new Error(`Use --option=value: ${arg}`);
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
const fail = (message: string): never => { throw new Error(message); };
const project = resolve(target || ".");
if (command === "init") {
  const kind = options.kind || "widget";
  if (kind !== "home" && kind !== "widget") fail("--kind must be home or widget");
  const id = options.id || (kind === "home" ? "home" : "status");
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(id)) fail("Invalid contribution id");
  // An existing project is never overwritten, including directories with no screen.json.
  await mkdir(project);
  await mkdir(join(project, "src"));
  await writeFile(join(project, ".gitignore"), "/dist/\n");
  await writeFile(join(project, "screen.json"), JSON.stringify({ id, kind, title: kind === "home" ? "My home" : "My status",
    methods: ["status"], configure: false }, null, 2) + "\n");
  await writeFile(join(project, "src/main.tsx"), `import { computed } from "vue";
import { mount } from "@pocketjs/framework/vue-vapor";
import { View, Text, useScreen, usePluginState, FONT, COLOR } from "@onekvm/screen-sdk";

function Screen() {
  const screen = useScreen();
  const plugin = usePluginState<{ message: string }>("status");
  const address = computed(() => screen.state.value.network.ip || "Offline");
  screen.on("rotary", ({ confirm }) => { if (confirm) void plugin.refresh(); });
  return <View focusable onPress={() => { void plugin.refresh(); }} class="w-full h-full flex flex-col justify-center items-center" style={{ bgColor: COLOR.black }}>
    <Text class="text-base font-bold" style={{ fontSlot: FONT.base, textColor: COLOR.zinc100 }}>{address.value}</Text>
    <Text class="text-xs" style={{ textColor: COLOR.muted }}>{plugin.error.value ? "Unavailable" : plugin.state.value?.message || "Loading"}</Text>
  </View>;
}
mount(Screen);
`);
  await writeFile(join(project, "README.md"), "Build with the OneKVM screen SDK and merge dist/contribution.json into your companion extension's contributions. Implement and declare its status method, then install the extension through onekvm-distro.\n");
  console.log(`Created ${kind}: ${project}`);
} else if (command === "build" || command === "check") {
  const config = await Bun.file(join(project, "screen.json")).json() as Record<string, unknown>;
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(String(config.id)) || !["home", "widget"].includes(String(config.kind))) fail("Invalid screen.json id/kind");
  if (typeof config.title !== "string" || !config.title.trim() || config.title.length > 64) fail("title must contain 1–64 characters");
  if (!Array.isArray(config.methods) || config.methods.some(method => typeof method !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(method))) fail("methods must list the permitted companion plugin methods");
  if (typeof config.configure !== "boolean") fail("configure must be boolean");
  if (!await Bun.file(join(project, "src/main.tsx")).exists()) fail("Missing src/main.tsx");
  if (command === "build") {
    for (const name of ["pocketjs", "font-regular", "font-bold"]) if (!options[name]) fail(`Missing --${name}=path`);
    const outdir = resolve(options.outdir || join(project, "dist"));
    const bundle = `screen-${config.id}`;
    const builder = await Bun.file(resolve(sdk, "../screen-ui/build.ts")).exists()
      ? resolve(sdk, "../screen-ui/build.ts") : resolve(sdk, "../onekvm-screen-ui/build.ts");
    const proc = Bun.spawn([process.execPath, builder, `--source=${join(project, "src")}`,
      `--outdir=${join(outdir, bundle)}`, `--pocketjs=${resolve(options.pocketjs)}`, `--font-regular=${resolve(options["font-regular"])}`,
      `--font-bold=${resolve(options["font-bold"])}`, "--icon=false"], { stdout: "inherit", stderr: "inherit" });
    if (await proc.exited !== 0) fail("Screen build failed");
    await Bun.write(join(outdir, "contribution.json"), JSON.stringify({ point: `screen-display.${config.kind}`, id: config.id, version: 1,
      data: { title: config.title, bundle, runtime: "pocketjs-vue-vapor", bridge_version: 2, required_features: ["screen-surfaces-v1", "rpc", "state-events"],
        permissions: { rpc: [{ methods: config.methods, configure: config.configure }] },
        ...(config.kind === "widget" ? { placement: ["free", "grid"], preview: config.title } : {}) } }, null, 2) + "\n");
    console.log(`Bundle and manifest contribution: ${outdir}`);
  } else console.log("Screen project is valid");
} else {
  console.log("onekvm-screen init <new-directory> --kind=widget|home\nonekvm-screen check <project>\nonekvm-screen build <project> --pocketjs=PATH --font-regular=PATH --font-bold=PATH [--outdir=PATH]");
  if (command && command !== "--help") process.exitCode = 2;
}
