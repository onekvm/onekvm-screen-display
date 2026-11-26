# OneKVM screen SDK

[简体中文](README.zh-CN.md)

`@onekvm/screen-sdk` builds programmable home screens and independently rendered,
interactive home components for OneKVM's PocketJS Vue Vapor host. These are TSX
components, not browser pages: use the supported View/Text/Image components,
PocketJS styles and packaged fonts/images. There is no DOM, Node.js, fetch or
direct hardware/filesystem access in the guest. Network and device work belongs
to the companion extension.

## Create and build

Install Bun and use the OneKVM-compatible PocketJS toolchain. From this checkout:

```sh
bun packages/screen-sdk/cli.ts init /path/to/my-widget --kind=widget
bun packages/screen-sdk/cli.ts check /path/to/my-widget
bun packages/screen-sdk/cli.ts build /path/to/my-widget \
  --pocketjs=/path/to/pocketjs \
  --font-regular=/path/to/regular.otf --font-bold=/path/to/bold.otf
```

Use `--kind=home` for a complete home screen. Build output includes the bundle
directory and `contribution.json`. Merge that contribution into the companion
extension's manifest, declare its permitted methods, and install the bundle
at the declared relative path. Contribution IDs must be unique across screen
Apps, homes and components belonging to an extension. Build IPKs through
`onekvm-distro`; no SDK or JS source needs to be installed on the device.

The existing `onekvm-screen-ui-native` supplies both SDK packages to OE builds.
The [complete example](../../examples/screen-sdk-example) includes a companion
plugin, a home and a counter component. Build its optional IPK with:

```sh
ONEKVM_DEBUG_WORKTREES=onekvm-screen-display make \
  ONEKVM_MACHINE=onekvm-nanokvm-pro SELECTED_KAS=kas/nanokvm-pro-sd.yml build package \
  onekvm-device-screen-display onekvm-extension-screen-sdk-example
```

Run that command from `onekvm-distro`. Enable the installed example; select its
home in Screen display, or add its counter in the designer. Selecting the designer
layout restores the saved ordinary home. Preview executable content through the
authenticated Remote screen tab after saving; the designer uses component
metadata as its placement preview and does not run third-party JS in the browser.

## Debugging

Sign in to the device Web UI, open **Screen display → Developer**, enable
Developer mode, then select a running home, widget instance or extension app.
Privileged built-in pages are excluded. Refresh the component tree and click a
node to highlight it, inspect console output/errors, and evaluate global-scope
JavaScript. Pause, step one frame and resume affect only the selected guest.
Connect Remote display to operate the physical screen. After atomically replacing
bundle files, click Reload bundles and select the new target.

Evaluation cannot access module-local variables; expose temporary inspection
handles through `globalThis` when needed. Source-line breakpoints and the Chrome
DevTools protocol are not supported. Evaluation retains the guest's 50 ms execution
budget and 32 MiB JS heap limit, within the screen service's 256 MiB hard limit.

Developer mode is off by default and does not survive service restarts. Leaving
the Developer tab disables it; a lost connection expires after 60 seconds. Disabling
clears highlights and resumes paused guests. The endpoint uses existing Web login
authentication, with no additional network port. The transport retains at most
256 messages / 512 KiB, at most 64 KiB per message; old or oversized messages are
discarded. The browser console keeps 200 lines. Each target queues at most 16 commands.

The CLI provides `init`, `check`, and `build`. For code iteration and SSH diagnostics:

1. Install and enable the companion IPK, then select its home in Screen display.
2. After editing TSX, rerun `check` and `build` above. `check` validates project
   configuration; `build` compiles TSX and packages resources. Neither replaces
   a separate TypeScript type check.
3. For page-only changes, upload JS/PAK to the device's `/tmp`, then use temporary
   files and atomic `mv` replacements inside the installed bundle directory.
   Resolve it from the active companion version and `data.bundle`; the example
   home is `/data/onekvm/apps/screen-sdk-example/0.1.0/screen-home`. Never truncate
   a live PAK/bytecode mapping in place. Manifest, permission or backend changes
   require reinstalling the companion package.
4. After replacing all resources, call `Refresh` on the device. In the authenticated
   Remote screen tab, click Connect to verify rendering, touch and rotary input.
   That view shows the actual device; the designer previews layout metadata.

```sh
# Guest console.log / warn / error messages reach this journal.
ssh root@<device-ip> 'journalctl -fu onekvm-device-screen-display.service'

# Reload discovery and invalidate companion state after atomic resource updates.
ssh root@<device-ip> 'busctl --system call org.onekvm.ScreenDisplay /org/onekvm/ScreenDisplay org.onekvm.ScreenDisplay Refresh'

# Inspect registration and runtime errors: app_registration_errors / app_errors.
ssh root@<device-ip> 'busctl --json=short call org.onekvm.ScreenDisplay /org/onekvm/ScreenDisplay org.onekvm.ScreenDisplay GetSettings'

# Inspect service-wide memory usage, limits and restart count.
ssh root@<device-ip> 'systemctl show onekvm-device-screen-display.service -p MemoryCurrent -p MemoryPeak -p MemoryHigh -p MemoryMax -p MemorySwapMax -p NRestarts'
```

Log event callbacks and companion-call results, and catch Promise rejections.
Avoid continuous per-frame logging. Updated resources receive a new revision so
a failed page can run again; normal resource updates require no Core or screen
service restart. The entire screen service starts reclaim at 192 MiB, has a
256 MiB hard limit and cannot use swap. Exceeding that budget restarts the screen
service and discards unsaved guest state.

## Read state, subscribe and call the companion

Call composables during component setup:

```tsx
const screen = useScreen();
const status = usePluginState<{ temperature: number }>("status");

const unsubscribe = screen.on("network", network => {
  console.log(network.ip);
});
screen.on("rotary", ({ step, confirm }) => {
  if (confirm) void refresh();
});

async function refresh() {
  try {
    await screen.plugin.invoke("refresh", { sensor: "rack" });
    await status.refresh();
  } catch (error) {
    // Present a retryable state in your component.
  }
}
```

`screen.state`, `screen.context` and `screen.language` are readonly computed
refs. `context` provides local width/height, instance ID, role, visibility,
rotary focus and per-instance `settings`. Every instance has a separate JS
runtime and RPC channel. Reactive state can drive any supported drawing or touch
handler. State contains only the documented read-only device snapshot; account
and configuration secrets are excluded.

| Event | Payload |
| --- | --- |
| `state` | Entire device snapshot |
| `network`, `video`, `hid`, `resources` | Changed group of the snapshot |
| `language` | `en`, `zh`, `zh_tw`, or the host's language value |
| `config` | This instance's new settings object |
| `visibility`, `focus` | Boolean |
| `rotary` | `{step, confirm}` |
| `plugin-state` | `{generation}` invalidation notification |

`on()` returns an unsubscribe function and also removes the subscription when
the component's Vue scope ends. Initial state is available through refs;
events report subsequent changes. `usePluginState(method, request)` performs an
initial read, then reads on plugin invalidation, visibility restoration or an
explicit `refresh()`. It provides readonly `state`, `busy` and `error` refs.
Invalidations during a pending read are retained, with repeated invalidations
coalesced. Idle instances never poll plugin methods.

The producer persists its state, then notifies the screen host:

```sh
busctl --system call org.onekvm.ScreenDisplay /org/onekvm/ScreenDisplay \
  org.onekvm.ScreenDisplay Refresh
```

This is a coalesced **state invalidation**, not a lossless message stream.
Callbacks receive current state; they must not depend on receiving every
intermediate device or plugin transition. The notification can cover other
plugins too, so status methods should be inexpensive and free of mutations.

`plugin.invoke<T>(method, json)` calls only the companion extension, inferred
from the host-bound identity. `plugin.configure(settings)` submits partial
extension settings through its schema validation. Both return Promises.
Declare permitted methods and configuration access in the contribution:

```json
"permissions": {"rpc": [{"methods": ["status", "refresh"], "configure": true}]}
```

The SDK serializes requests in one per-guest queue and matches exact request
IDs. Rejected permissions, backend failures and timeouts reject the Promise.
Payloads are limited to 4096 UTF-8 bytes. Closing a native guest cancels collection
and discards late replies; it does not undo a backend write already accepted.
Never use screen-local settings for secrets.

Use `<View focusable onPress={handler}>` for touch targets. `onPress` fires on release; dragging outside cancels the press.

## Layout, input and lifetime

Register a home at `screen-display.home`, or an executable component at
`screen-display.widget`, version 1, with `data.bundle`, runtime
`pocketjs-vue-vapor`, bridge version 2 and required feature `screen-surfaces-v1`.
Existing declarative face/widget contributions remain compatible. SDK tools emit
these fields automatically.

Saved `layout_json.home` selects the complete home. `home_settings` supplies its
instance settings. Widget placements retain normal geometry/layer order and
can add a `settings` object. Multiple instances of the same widget are allowed;
use different placement IDs. Up to eight executable widgets run on one home.
Local widget coordinates start at `(0,0)` and match `context.width/height`;
the host scales, clips and composites them in painter order, including alpha.

On Pro Desk, rotate to select a component, press to interact, and hold to leave
that interaction. Continue past the components to enter the system App list.
A programmable home receives turn/press; hold opens the system App list. Touch
gestures use local coordinates. System navigation and App authentication stay
with the host; `screen.openApp(id)` and `screen.openLauncher()` use those checks.

`screen.requestFrame(ms)` schedules one later frame, 16–60000 ms.
`screen.animate(true)` requests continuous frames; call `animate(false)` when
the animation ends. State notifications and input already wake the host, so
ordinary status components need neither API. Background/blanked guests stop
rendering. Guests inherit a 32 MiB JS heap, 1 MiB stack and three-second boot
limit; surface JS turns have a 50 ms limit and a shared 100 ms frame budget.
Faulting revisions are disabled until replaced or the screen service restarts.
A failed/missing home falls back to the saved designer layout.

Package images and source-literal glyphs in the bundle. For text coming from
the backend, list extra expected characters in `src/glyphs.txt`; the builder
includes them in the font atlas. Font coverage remains a build-time contract.

Public TypeScript contracts are in [src/client.ts](src/client.ts). The SDK's
version is independent of the native bridge and extension point versions.
