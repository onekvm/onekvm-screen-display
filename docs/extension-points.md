# Screen display extension points

The screen display system plugin provides `screen-display.face`,
`screen-display.widget`, `screen-display.home`, and `screen-display.app`, all version 1. They use the generic extension host
registry. Other plugins contribute in their own `manifest.json`; the screen
plugin never edits their files. Disabling or uninstalling a contributor removes
its entries from the designer and the device catalog. Saved placements retain
their IDs and reappear if the contributor returns.

## Face

A face controls the clock style and the allowed widget placement modes. A
contributor can offer a grid, free positioning, or both. Coordinates are
percentages of the logical screen, with a 0–100 range. Face selection belongs
to the clock component in the designer; it does not lock other widgets into
face-specific slots.

```json
{
  "point": "screen-display.face",
  "id": "night",
  "version": 1,
  "data": {
    "title": "Night",
    "dial": "plain",
    "background": "#05080c",
    "modes": ["grid", "free"],
    "default_mode": "free",
    "grid": { "columns": 4, "rows": 4 }
  }
}
```

The screen consumer validates this data before rendering. Unsupported dial and
color values fall back to safe defaults. Legacy `fixed` declarations are
treated as `free`; new contributions should only declare `grid` and `free`.

## Widget

The initial widget contract is deliberately small and declarative, so a
contributor cannot inject code into the screen shell or the web designer.

```json
{
  "point": "screen-display.widget",
  "id": "temperature",
  "version": 1,
  "data": {
    "title": "Temperature",
    "glyph": "°",
    "accent": "#6ee7ff",
    "placement": ["grid", "free"],
    "grid_size": { "columns": 1, "rows": 1 },
    "preview": "22°"
  },
  "method": "screen_widget_state"
}
```

The optional `method` is called through the extension host, never loaded into
the screen process. Its JSON result is `{ "text": "22°", "accent": "#6ee7ff" }`.
The consumer uses the declared preview on method error and limits text length.
The host reads it once on discovery. When the value changes, the producer calls
`org.onekvm.ScreenDisplay.Refresh()` at `/org/onekvm/ScreenDisplay` on the
system bus, after persisting its new state. This coalesced invalidation makes the
host fetch widget state again; there is no widget polling timer. Service lifecycle
notifications also invalidate previews. Static widgets need no method or notification.

The registration ID is `<contributor-id>/<item-id>`, for example
`weather/temperature`.
Contributed widget previews use the same renderer as built-in components. Text
shown on the current PocketJS shell is limited to 24 characters from `A–Z`,
`a–z`, `0–9`, space, `. : % + - ° / _`; unsupported characters show as `?`.

## Programmable home and widget SDK

The [screen SDK](../packages/screen-sdk/README.md) adds executable
`screen-display.home` and `screen-display.widget` contributions using the App
bundle format, bridge v2 and required feature `screen-surfaces-v1`. A widget
with `data.bundle` runs in its own restricted guest; widgets without a bundle
retain the declarative contract above. Neither injects JS into the Shell or
the browser designer. Contribution local IDs must be unique across all three
executable screen roles within one extension.

`layout_json.home` selects a namespaced home contribution, with optional
`home_settings`. An ordinary `home_widgets` placement can reference an executable
widget and carry independent `settings`; multiple instances are supported, up
to eight executable widgets. Instance-local drawing is clipped/scaled into its
normal layer, preserving alpha and media ordering. Native input ownership follows
the painted order, including cancel-on-drag and the host's reserved navigation.

The typed SDK exposes read-only state, scoped event subscriptions, per-instance
context and a serialized companion-plugin RPC queue. Producers notify `Refresh`
after persisting state; subscriptions coalesce invalidations and never poll
plugin methods while idle. Replaced/removed guests close their RPC channels.
Incomplete registry snapshots after a lifecycle change temporarily block all
contributed executable roles until authorization can be resolved again.

Complete homes keep the system launcher, Settings, App authentication and
recovery in the host. Faulting home revisions fall back to the saved designer
layout; widget faults fall back to their metadata preview. Surface guest JS
turns are bounded to 50 ms and share a 100 ms frame budget; heap, stack and boot
limits match contributed Apps. Capture-only frames reuse existing guest drawing
without changing input ownership or navigation. Hidden guests stop rendering;
foreground App transitions emit visibility loss and pause surface guests.

## App

The packaged `security` App uses the private `security` RPC operation with
`get`, `save`, `add-ban` and `remove-ban`. Only its native policy grants this
operation; extension manifests cannot acquire it. Core's root-only
`Management.Security` exposes a security-only snapshot and reuses Web validation,
ban handling and runtime side effects. Account credentials and general service
settings are excluded. Saves contain only the edited field; nested reverse-proxy
leaves merge under the Core configuration lock. Failed writes preserve drafts
and read back actual state before allowing retry. Every write has an explicit
confirmation; Back remains available while requests are pending.

Its shield/check launcher icon is distinct from Settings. Categories, fields and
blocked addresses use one continuous list, with direct touch dragging, rotary
selection/reveal and cached native scrolling, matching Settings. Refresh is the
last row; the header stays fixed and there is no page selector.
Editors offer Edit/Change and Save; header Back discards unsaved changes.
An outgoing list stops submitting cached scrolls as soon as its view changes or
an editor/detail opens. Vue disposes its frame hooks after input dispatch, so
waiting for unmount would let the old list cover the new screen for that turn.

The App reads on entry, manual refresh, Core configuration/owner events and
after commands. Its separate `securityGeneration` ignores generic widget/App
refreshes and service notifications. It never polls while idle; the blocked
address list offers manual refresh for newly triggered or expired bans. Build
with `make security-app`; `bun scripts/test-security.ts` exercises both panel
sizes, all three languages, touch editing, rotary exit, error recovery and idle.

The built-in `services` App shares Core's service catalog with the Web service
manager. It lists system and enabled extension services, opens service details,
and offers start, stop and restart according to each entry's allowed actions.
Protected entries remain view-only. Touch pagination and rotary navigation use
the same actions, and Back stays available during a pending operation.

Its private native RPC operation is `services`, with `method` set to `list`,
`start`, `stop` or `restart`, an object `request` (`{}` or `{"id":"…"}`), and a
unique `requestId`. Responses echo that ID. Only the built-in App's native
policy grants this operation; it is not an extension permission. The native
host calls root-only Core `Management.Services`, wakes the App on completion,
and uses a dedicated `servicesGeneration` for relevant systemd lifecycle,
unit-file, App catalog and Core owner changes. Generic `appStateGeneration`
updates, including widget and other App notifications, do not reload Services.
Repeated systemd properties with the same running value are ignored, including
the listening SSH socket's status notifications on connection acceptance.
No HTTP credentials or shell commands are exposed to the guest.

The built-in `virtual-media` and `keyboard` Apps use private RPC operations of
the same names, with unique `requestId`, `method` and object `request` fields.
Only their respective packaged identities receive these grants; contributed
Apps cannot acquire them through manifest permissions. The host calls root-only
Core `Management.VirtualMedia` / `Management.Keyboard` and wakes the guest when
the correlated response completes. Entry, manual refresh, `appStateGeneration`
changes and successful mutations refresh state; idle guests do not poll.

Virtual media supports `get`, `browse`, `mount`, `eject`, `connect` and
`disconnect`. `get` returns status, local media and enabled extensions' published
virtual-media directories. `browse` takes `extension`, `directory`, relative
`path` and `kind` (`iso` or `drive`); nested entries retain Core-issued media IDs.
Mount reuses the Web handler's fresh catalog, enabled-extension, image-type and
path-containment checks. Late directory replies cannot replace a different
visible folder. Dynamic filename glyphs use the bounded fallback-font cache.
The screen ensures USB storage is connected before each mount, using Core's
idempotent `connect` then `mount` calls. It refreshes after the sequence, without
an intermediate read hiding mount failures. Failed connections stop the sequence;
Back or Cancel while connecting prevents mounting the previous selection.

Keyboard supports `get` (LED state), `press` (`modifiers`, up to six `keys`) and
`text` (1–256 characters). Text uses Core's configured layout and Caps Lock
handling; discrete strokes and failed text reports always attempt release.
The screen offers explicit text sending, common keys, shortcuts and lock keys.
`bun scripts/test-local-control.ts` covers both panel sizes and three languages,
including extension subdirectories, pending reads, cancel, retry and HID release
contracts (the latter also have Core unit tests).

An App is a separate PocketJS bundle launched from the screen App launcher. It
is registered through the generic extension host instead of a fixed
`apps/<id>` directory:

```json
{
  "contributions": [{
    "point": "screen-display.app",
    "id": "main",
    "version": 1,
    "data": {
      "title": "WireGuard",
      "icon": "icon.bin",
      "bundle": "screen-app",
      "controls": ["touch", "rotary"],
      "runtime": "pocketjs-vue-vapor",
      "bridge_version": 2,
      "permissions": {"rpc": [{"methods": ["status"], "configure": true}]},
      "order": 40
    }
  }]
}
```

`bundle` is a safe relative directory inside the contributing extension
package. It must contain `main.vue-vapor.js` and `main.vue-vapor.pak`; an
optional `main.vue-vapor.jsc` is used only with matching source/resource/ABI metadata. The resolved launcher ID is
namespaced as `<extension-id>/<local-id>` (for example `wireguard/main`), so
two extensions cannot collide. The package root is supplied by the extension
host and is never taken from an absolute manifest path.

`icon` may select a shared launcher image: `settings.png`, `stream.png`,
`stick.png`, `power.png`, or `hdmi.png`. Text substitutes such as `glyph` are prohibited. To use package-owned artwork, set `icon` to a safe relative
ICO1 path inside `bundle`, such as `icon.bin`. Its canonical path must remain
inside that bundle. ICO1 contains the magic `ICO1`, little-endian u16 width and
height, RGB565 little-endian pixels, then one alpha byte per pixel. Dimensions
must be powers of two, at most 256×256; 64×64 is recommended. Missing or invalid artwork rejects App registration with an actionable error. The host publishes a namespaced texture keyed by the
image contents, preserving unchanged textures and releasing removed ones when
the catalog refreshes. Both icon and list launchers use it. `icon.bin` beside
the bundle is also used for the native loading plate.

### Resources and compatibility

Every App packages its own title glyphs: include all `title` and `i18n` characters in the fonts inside its PAK. The host merges those glyphs
into the Shell and Settings atlases at catalog refresh, scaling a different
font slot to the launcher's metrics when needed. It rebuilds from the base PAK
on removal, so fonts do not accumulate. No contributor repository is scanned
while building the host. Bundle icons are also exposed as validated ICO1 data
in `app_icons_json` for the Web designer; browser previews use the same pixels.

Keep editable App modules in the contributing repository, for example under
`screen-app/src/`, and generate the runtime bundle into an ignored directory.
Use [`@onekvm/screen-ui`](../packages/screen-ui/README.md) for shared theme,
components, touch/rotary selection and confirmation, RPC state and translations.
Common service screens only need an `ExtensionApp` with configuration and
status-formatting callbacks; custom screens can compose the smaller primitives.
OneKVM extension recipes can inherit `onekvm-screen-app` to compile TSX and
font resources using `pocketjs-native`; their installation rules receive the
generated bundle directory. See
[`onekvm-distro/docs/screen-app-build.md`](../../onekvm-distro/docs/screen-app-build.md).
Do not include source files in the installed bundle or track generated JS/PAK
files in the source repository.

`runtime` defaults to `pocketjs-vue-vapor`; `bridge_version` defaults to 1 and
currently supports 1 and 2. Optional `required_features` may contain `rpc`,
`configure`, `icons`, `launcher-fonts`, `state-events`, and `qr-code`. Unknown required versions/features
reject registration with an entry in `app_registration_errors` in GetSettings.
`catalog_errors` reports failed discovery; `app_errors` reports guest faults.

Source, PAK, bytecode, bytecode ABI and SHA-256 metadata sidecar contents participate in bundle
identity, including same-size replacements. A running guest is retired when
its contributor disappears, its lifecycle generation changes, or its bundle
revision changes. Returning to the launcher and reopening starts the new guest.
Packaged bytecode is used only with a matching `main.vue-vapor.jsc.abi`; the
host's `compile` command writes this sidecar. Otherwise source is compiled into
an ABI-specific cache. Removing contributions evicts their memory and disk
caches, icon textures, and merged glyphs, while layout preferences retain IDs.

### App bridge and session ownership

Apps send asynchronous extension calls through `onekvm.set("appRequest", JSON)`
and read `onekvm.get("appResponse")`. Bridge v2 calls include an App-generated
string `requestId` (1–64 bytes):

```json
{"requestId":"1","extension":"wireguard","method":"status","request":{}}
```

To save partial settings:

```json
{"requestId":"2","extension":"wireguard","operation":"configure","request":{"service_enabled":true}}
```

The host binds the channel to the contributor identity and the guest session.
`permissions.rpc` declares permitted methods and whether configuration is
allowed. An omitted `extension` in a grant means the contributor itself. A
cross-plugin grant requires both an explicit target and the contributing
manifest's `opkg-admin` permission; ordinary Apps cannot claim another owner
through their request or contribution data. Configuration still passes through
extension-host schema validation and a settings-only envelope.

Replies echo `requestId` and include `id`, `busy`, and, when complete, `ok` with
`response` or `error`. Correlate the exact requestId; do not accept merely a
larger host `id`. Calls must be serialized; rejected busy/invalid/unauthorized
requests receive explicit errors. Legacy callers without requestId retain the
session-local `id` envelope.

Each guest has its own response and busy state. Exiting or failing to boot a
guest closes its channel, terminates collection, and discards late results.
The screen-side CLI call has a 20-second deadline and bounded stdout/stderr;
event-triggered widget reads have per-call and total budgets. Cancelling a
collector does not undo a write already accepted by the backend. A successful
configure returns `{"saved":true}`; read status to confirm actual operation.
Apps have navigation/input/read-only screen metadata access; arbitrary system
setters remain private to the appropriate packaged system Apps.

The `qr-code` feature provides guest-local QR encoding: set `qrCode` to the
complete payload (up to 1024 UTF-8 bytes), then get `qrCode` for JSON
`{"size": 33, "runs": [[x, y, width], ...]}`. Empty or oversized payloads clear
the result. The cache belongs to that guest session and performs no I/O.
Draw integer-sized black modules on white, retaining four white modules on
every edge. `@onekvm/screen-ui` uses this for pending device authorization;
contributors expose only active links and notify `Refresh` when they change,
expire or complete. Encoding happens when the link changes, never each frame.

### Discovery and faults

The host watches the parent of the generic contribution generation token with
inotify, including its first creation and atomic replacement. It also watches
bundle/drop-in directories recursively, handles directory recreation and queue
overflow, and receives service lifecycle notifications. Explicit D-Bus `Refresh`
uses an eventfd to wake the worker. There is no periodic discovery fallback.
Registry queries run off the frame path. Failed
queries preserve the last successful catalog and an error, instead of creating
an empty catalog; if a known registry change cannot be resolved, contributed
Apps are temporarily unavailable until fresh authorization is established.
An unrelated successful catalog refresh does not restart existing guests.

Contributed guests have a 32 MiB QuickJS allocation limit, a 1 MiB stack
limit, a 3-second boot budget and a 250 ms frame budget. A guest runtime error
returns to the Shell and records diagnostics, without restarting the screen
service. Three failures within 30 seconds temporarily block that revision for
30 seconds; a new revision can be launched immediately.

The package transaction and removal contract is in
[`onekvm-extension-host/docs/extension-lifecycle.md`](../../onekvm-extension-host/docs/extension-lifecycle.md).

## Built-in home components

The screen plugin provides repeatable text, status, line, rectangle, and media
components. They are layout instances rather than apps or extension
contributions. Text and rectangle content supports the same live variables as
the NanoKVM OLED editor: `{ip}`, `{hostname}`, `{codec}`, `{fps}`,
`{resolution}`, `{stream}`, `{uptime}`, `{cpu_percent}`, `{mem_percent}` and
`{disk_percent}`. Status instances can follow ETH, HDMI, HID, Wi-Fi, or live
viewing state. Each instance owns its placement, size, colors, and fill or
background options. Media instances accept GIF, animated WebP, MP4/H.264, or
raw Annex-B H.264. MP4 files are stored as compressed source data with their
original dimensions; the framebuffer host demuxes them and sends compressed
samples through a device-neutral decoder backend. NanoKVM Pro selects its hardware
VDEC when the backend advertises it; devices without a VDEC use OpenH264. The home
decoder and remote-screen encoder share the ABI-checked codec loader; Pro uses
the OE system library with AArch64 NEON assembly for both. The decoder owns one
reusable native frame buffer and lends it to the compositor. VDEC output is
selected by the generic capability table (`RGB565`, `NV12`, `NV21`, then
`YUV420P`); only pixels sampled by the widget are converted to RGB565 when the
native frame is YUV. Compressed samples and decoded frames are not cloned per
presentation. Scheduling follows source timestamps, playback speed, loop
boundaries and completion, and seeks to a recent keyframe when rendering falls
behind.

## Saved layout

The Shell keeps its navigation page and rotary selection separate from native
cache preparation. The host exposes a temporary read-only `shellCapturePage`
while painting home/launcher snapshots; it never changes `shellPage` to warm
the cache. Catalog refreshes preserve the selected App ID and icon subpage,
clamping them when an App disappears. Icon rotary paging captures the settled
guest target once and uses the host's cached horizontal compositor. New turns
interrupt from the visible pixels; icon highlights settle immediately. Touch
swipes retain direct guest dragging, and a rotary turn cancels any remaining
touch tween before applying its selection.

The screen plugin owns `layout_json`:

```json
{
  "face": "weather/night",
  "mode": "grid",
  "background": "#05080c",
  "clock": { "x": 50, "y": 50, "scale": 1 },
  "clock_enabled": true,
  "layer_order": ["clock", "weather/temperature", "home-text-1"],
  "home_widgets": [
    { "id": "weather/temperature", "column": 1, "row": 3, "scale": 1 },
    {
      "id": "home-text-1",
      "widget": "screen-display/text",
      "kind": "text",
      "text": "IP {ip}",
      "accent": "#f4f0e6",
      "show_background": false,
      "width": 126,
      "height": 24,
      "hidden": false,
      "column": 0,
      "row": 3,
      "scale": 1
    }
  ],
  "apps": [],
  "apps_hidden": [],
  "app_view": "list"
}
```

New installations use the list App view. An explicit saved `icons` or `list`
selection is preserved by upgrades and by both settings interfaces.

For free mode a placement has normalized `x` and `y` (0–100); for grid mode it
has zero-based `column` and `row`. `hidden: true` removes the instance from the
canvas and device while retaining it in the designer's component list. The
screen plugin clamps positions, skips grid collisions and checks widget
compatibility. Legacy fixed layouts migrate to free coordinates on read. The
clock can be moved independently in either placement mode. The clock position
and scale apply to its text and dial together. Clock
and home widget scales accept 0.5–1.5; omitted values default to 1. Registered
screen apps remain on the app launcher and are never treated as home widgets.
The built-in text, status, line, rectangle, and media widgets are stored directly in
`home_widgets`; contributed widgets continue to use `screen-display.widget`
and may provide live state.

`background` is a solid `#rrggbb` home-face override. It defaults to black;
app pages keep their own backgrounds.

Media frame data is stored separately in the `media_assets` library.
New placements reference a reusable asset with `media_asset`; old placements
fall back to their instance `id`. Removing a component or restoring the page
retains library assets. Unused assets can be deleted explicitly in the library;
assets referenced by a component, status image, or background cannot be deleted.
The library and layout are applied together by the page's Save button.

Status components optionally reference static library images with
`status_active_image` and `status_inactive_image`. Each state independently falls
back to its existing text/color rendering when no image is selected. The host
uses the same ETH/HDMI/HID/Wi-Fi/live status as the shell and fits the selected
image inside the component bounds. Background settings have their own button;
`background_asset` remembers the library selection, and `background_image`
contains the selected image's RGB565 frame for existing background renderers.

MP4 videos keep their compressed source data and native width and height;
`contain`, `cover`, or `fill` is applied only when compositing into a widget
box. There is no media file size or duration quota. GIF/WebP retain source
frame timing down to 16 ms, and raw H.264 is sampled at 60 FPS. New MP4 uploads use
the session-authenticated `remote/media` streaming route and persist in the screen
plugin's `media/` directory. Version 3 assets reference a generated filename and
record `size_bytes`, dimensions and `duration_ms`; settings carry no video payload.
The Web preview uses HTTP byte ranges, while local playback reads compressed
samples from disk on demand. Legacy inline assets remain supported. See
[memory ownership](memory.md#media-library) for bounds and cleanup.

`layer_order` lists the clock and widget instance IDs from back to front.
Omitting it preserves the original order: clock, then `home_widgets`. Unknown
and duplicate IDs are ignored; new widgets are appended in front. The designer
lists the front layer first; moving a row up brings its content forward, and
moving it down sends it backward. Placement order stays unchanged, including
grid cells and native media slots. Selecting a component only raises its outline
and resize handle, so the preview keeps the device's actual overlap order.

Media and status images follow that same layer order. Each visible instance
emits a native compositor surface in the shell
DrawList. The host uses its transformed bounds and clip to paint the frame
between the surrounding text and card operations. MP4 decoding retains the
reference-picture and B-frame reorder buffers between samples; intermediate
decoder flushes can exhaust those buffers and freeze playback. Repeated decoder
errors are logged once until decoding recovers or the clip restarts.

The Web preview chooses frames by elapsed time on `requestAnimationFrame`,
so delayed callbacks skip ahead rather than accumulating drift. Static library
thumbnails do not animate. The framebuffer host schedules active media every
16 ms; this is a composition target, and physical panel throughput is governed
by its driver and bus. Widget sizes are edited in the inspector so the canvas
remains a position preview.

The built-in clock is an ordinary removable home widget. It owns the tick dial,
second indicator, and its scalable digit images.
The face selects the dial style, while the clock widget places and sizes both
the dial and time. The Web designer uses the same images for its preview.

Home layouts support up to 32 placements. Text placements may choose `font_size`
(12, 14, 16 or 24), `text_align` (`left`, `center`, `right`) and `radius`.
`screen-display/progress` is a reusable progress widget; its `metric` selects
`cpu`, `memory` or `storage`, with `accent` for the fill and `background` for
its track. These options are saved in `layout_json` and rendered by both the
native shell and the web designer. Empty text stays empty, including on filled
rectangles used as card backgrounds.

## Core synchronization

The presenter subscribes to `org.onekvm.Core1.Status` before reading its startup
snapshot. `StateChanged` replaces the cached state, `FPSChanged` updates FPS,
and `ConfigChanged()` invalidates configuration after a successful Core save
(HTTP, CLI and D-Bus share the same config manager). Configuration values never
appear in that signal. The screen reads language on startup, Core owner changes,
and configuration notifications; render-time getters only read caches. Timezone
file changes use inotify. Losing the Core owner clears stale state; reacquiring
it reads a new snapshot. Only transport failures use reconnect backoff.

`make app` builds JS/PAK and precompiles all bundled Apps together. The compiler
writes `.jsc.meta` SHA-256 identities for JS, PAK and bytecode plus the runtime
ABI. Packaging rejects missing or stale metadata. At runtime, legacy/mismatched
bytecode falls back to compiling the current JS, preventing old style IDs from
being combined with a new resource table.

The OE recipe regenerates every installed bundle's bytecode and both sidecars
with the just-built target executable under build-host QEMU and its recipe
sysroot. This leaves the shared source dist untouched and uses the exact same
QuickJS build as the shipped host. Native `make app` output can be 64-bit even
when packaging for PicoKVM's 32-bit musl runtime; internally consistent hashes
alone do not establish target compatibility. The installed tree is checked
against `SITEINFO_BITS`/`SITEINFO_ENDIANNESS` as well as all four metadata fields.
NanoKVM Pro and Go receive bytecode generated by their own target host too.

## Home status and variables

The shell publishes a one-shot `shellFrameAfter` delay in milliseconds, with
zero cancelling it. This timer is independent of Apps' and compositor views'
`frameAfter` requests, and is consumed only while the shell is active. Returning
to a cached home requests a fresh guest frame; offscreen cache captures do not
cancel the visible home's timer. The host's maintenance wake no longer invokes
the shell just because a wall-clock second or minute changed.

Only a visible ticks clock requests the next second; other visible clocks
request the next minute boundary. A hidden clock or launcher requests neither.
Visible `{ip}` text with multiple addresses keeps its ten-second rotation;
pending CPU samples and `{date}` text retain their sample and local-midnight
deadlines even without a clock. Media and programmable surfaces keep their
existing compositor deadlines. Input, animation and native status wakes remain
independent of these timers.

`homeGen` combines catalog and home-data revisions. Status/resource signals,
catalog/settings changes and file notifications invalidate it. The guest only
rebuilds home data on a revision change or a visible data deadline, not by
reading and serializing the complete layout each second. Explicit shell GC
runs when changing/discarding pages; QuickJS's allocation-pressure GC remains
enabled between page changes. No elapsed-time GC is performed for idle frames.

Status placements accept `show_border: false` independently of their background
and active fill. `status_style` selects `text`, `icon` or `image`; icons follow
the selected Ethernet, HDMI, USB HID, Wi-Fi or live-session source and use its
active/inactive color. Icons reuse the launcher’s Lucide artwork as shared
28×28 antialiased alpha masks. They remain centered and scale uniformly inside
rectangular placements; Web and native render the same mask and coverage.
`python3 scripts/gen_status_icons.py` regenerates masks from the existing PNG
assets after Lucide generation. Image mode selects `status_active_image` or
`status_inactive_image` from the shared media library. Older placements with
image references retain image mode; other older placements retain text mode.
Switching modes preserves the configured images for later reuse. A live-session
icon automatically carries a top-right count badge for positive session counts
(1–99, then `99+`); zero hides the badge. Text and image modes keep their existing
behaviour. Badge geometry is shared by the Web preview and native renderer, and
count changes update the icon even when the configured text contains no variable.

`{session_count}` expands Core's `video.session_count`: active video sessions
across supported protocols, excluding login sessions and local screen viewers.
The live status source is active while this count is greater than zero. The
Variables tab lists every built-in template variable, its meaning and current
value, with click-to-copy names. Unknown tokens remain unchanged.

Designer undo/redo retains up to 100 steps, including geometry, layer order,
visibility, properties, background and media-library references. A pointer drag
is one step; consecutive typing is grouped until idle or the next control.
Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y operate within the designer while text
inputs keep native editing shortcuts. Saving layout changes retains history when the media library is unchanged.
Saving library changes or reloading different saved data resets history, since
removed media files may have been reclaimed. Undo and redo remain drafts
until Save. Media payloads are immutable shared references in history, avoiding
copies of large image or video data. Live device status does not enter history.

### 设计器多选与背景

图层列表复选框、Ctrl/⌘ 点选与 Shift 连选共用一份选择状态；自由布局支持整组拖动、六向对齐和按实际尺寸计算的水平／垂直等距。层级调整保留组内顺序，仅改 `layer_order`，不改变 `home_widgets` 的原始媒体槽索引。组合操作接入撤销／重做。

背景色和组件背景接受 `#RRGGBB`、`#RRGGBBAA`；`transparent` 规范为 `#00000000`。原生颜色转换为 ABGR，保留 alpha 以显示下层素材。物理屏幕最终仍为 RGB565。

静态背景从素材库原图编辑显示区域，`background_crop: {x,y,zoom}` 中 x/y 是可裁切范围内的百分比，zoom 为 1–4。网页将显示区域按面板分辨率烘焙进 `background_image`；原始素材保持不变，重新打开可继续编辑。历史无素材 ID 的背景首次调整时会转为素材。

`src/shared/default-background.json` 保存当前选定的蓝色抽象背景（Apurv Das / Unsplash）。新安装无既有布局时使用此预设，恢复默认也使用该图及浅绿色状态图标；已有布局和主动移除背景的选择不因升级而重置。
