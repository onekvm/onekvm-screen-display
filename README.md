# OneKVM screen display

Product name: **屏幕显示设置** (`screen-display`). Logical UI is 240×240;
the host scales it to the live `/dev/fb0` panel.

This tree is the **shell** (watch face, app launcher, swipe, load overlay)
plus separately built **apps**. Settings is its own PocketJS bundle; the
host parks the home shell, boots Apps on demand and drops each App on close.
Returning home restores the parked shell.

- `src/shell/` — face, launcher, pager, load overlay
- `src/apps/registry.ts` — launcher metadata only
- `apps/settings/` — independent Settings bundle and guest; its bridge uses
  the same backend exposed by D-Bus `org.onekvm.ScreenDisplay`. In-process
  guests dispatch directly, while external clients keep using D-Bus.
- `host-linux-fb/` — Linux framebuffer PocketJS host (foreground guest plus
  parked home shell). Owns native hint chrome, home-swipe, and the Shell D-Bus API.
- The systemd program with no arguments is only an entry. It `exec`s
  `init` or `main`. `init` is a separate process and bundle: language,
  link address, then the browser account page. The account page shows an
  editable username (default `admin`), password and password confirmation;
  completion sends that username to Core. Empty usernames are rejected.
  Pressing the OneKVM logo five times within three seconds opens the diagnostics
  export confirmation dialog; opening or canceling it never collects logs.
  Only pressing Export starts collection. The built-in initialization guest starts
  the installed `onekvm-diagnostics@boot:<UUID>.service` through its fixed native entry,
  independently of Core. Concurrent requests share the active UUID; a local export
  joining a runtime job adds a boot save without collecting again. New local jobs
  preserve capture and save `/boot/onekvm-diagnostics.zip`;
  progress, completion and retry use the shared setup feedback modal.
  the Web UI's runtime destination keeps its ZIP in the temporary job
  directory for download. Neither destination automatically collects or uploads
  logs. Neither contributed Apps nor public D-Bus `Set` can invoke this entry.
  After dismissing diagnostics (Cancel, or OK after an export), initialization
  opens a separate USB ADB confirmation. Cancel is selected by default; only
  Enable starts the static `onekvm-adb-debug.service`. It works without Core or
  network access, adds ADB to the USB gadget, and briefly reconnects USB.
  Debugging pauses an active Core watchdog; disabling ADB restores the other
  USB functions and resumes that watchdog. The dialog also offers Disable ADB.
  ADB has no TCP listener, never starts at boot and is off after reboot.
  The five-tap handler exists only in the built-in init guest. After initialization,
  Settings → Restore offers separate Export diagnostics and USB ADB debugging
  entries, reusing these confirmation dialogs. Opening Settings, Restore or either
  dialog never collects logs or enables ADB. These fixed native actions are available
  only to initialization and the unlocked built-in Settings App, independently of
  Core; contributed Apps and public D-Bus `Set` cannot invoke them. The screen
  service starts with multi-user.target and remains running when Core is stopped,
  restarted or fails. Core-backed settings still require Core.
  The welcome button cycles languages every 5 seconds with a 680 ms transition.
  When the welcome screen has multiple pages, the active page dot carries the
  automatic page-switch countdown as an outer ring.
  It does not load the
  app catalog, and it ignores `launch`. After it writes
  `setup-complete` and exits, the entry starts again and `exec`s `main`.
- Initialization checks local storage and systemd independently of Core. It distinguishes
  unmounted, read-only, full, unwritable and failing storage; invalid boot-slot or
  configuration data; missing system files; skipped or failed persistence preparation; and Core
  startup or API failures. A shared feedback dialog appears before account entry,
  with Back and Check again for touch/rotary input. Dismissing it preserves the form.
  The service still starts when its settings directory cannot be created, so a
  first-boot storage failure can reach the error screen.
  Checks run on entry, relevant service changes, explicit retry and account submission;
  the native cache keeps system calls out of frame getters. One small temporary write
  verifies storage and is removed after fsync. Checks do not export/upload logs.
  Services with queued start jobs are still starting. Persistent storage preparation
  and Core startup show a waiting spinner, recheck automatically every two seconds
  as an event fallback, and continue when ready. They do not require Check again;
  Back and Check again are reserved for actual errors.
  A check exceeding ten seconds stays actionable; it never guesses that a card is
  physically damaged. TCP/curl setup requests use configured local ports, bypass
  outgoing proxies, preserve transport errors in the journal and show localized reasons.
- The guest bridge exposes `get("controls")` as a JSON array of available
  local input modes (`"touch"`, `"rotary"`). App manifests may declare
  `controls` as acceptable modes; the Shell omits apps that have no matching
  local control. Apps can use the same bridge value to adapt their controls.
- `packaging/` — device plugin like GPIO ATX: systemd unit
  `onekvm-device-screen-display.service` (`WantedBy=onekvm.service`),
  D-Bus policy/activation, and
  `/usr/share/onekvm/system-plugins/screen-display.json`.
- `web/display/` — Vue settings page and designer. It reads the service's
  `panel_json` settings, with an `info` fallback for older extensions. Controls
  appear only after screen information has loaded; missing screens and failed
  requests have separate messages. The home designer provides repeatable text,
  live status, line, rectangle, and video / animation components. Components
  support free or grid placement, per-item visibility, and a custom image or
  solid background; face style is configured on the clock component. Apps stay
  on the launcher page.

Third-party screen Apps use the `screen-display.app` extension point. Their
manifest contribution points `data.bundle` at a PocketJS bundle directory
inside the installed extension package; the launcher exposes the resolved ID
as `<extension-id>/<local-id>`. Built-in Apps continue to use the packaged
`dist/apps/<id>` compatibility layout.

Programmable home screens and interactive, independently rendered widgets use
the [screen SDK](packages/screen-sdk/README.md) ([中文](packages/screen-sdk/README.zh-CN.md)).
It provides typed event subscriptions, companion-plugin RPC and state reads,
isolated guests, local widget coordinates and build/scaffolding tools. Sign in
and open Screen display → Developer for per-instance component inspection,
console/evaluation, pause and frame stepping on the real device. The
optional `screen-sdk-example` extension demonstrates both contribution types.

Built-in Stream, Touchpad and Power control use
`apps/shared/i18n.ts` for English, Simplified Chinese and Traditional Chinese.
They follow the host's `language` bridge value while running; unsupported
languages use English. Backend errors use localized messages on the screen.
PocketJS collects the imported language literals into each bundle's font atlas.
The five contributed Apps keep their identity, action declarations, business
validation and status formatting in their repositories' `screen-app/src/`.
They share `packages/screen-ui` (`@onekvm/screen-ui`) for the service layout,
status cards, action bars, theme/font slots, touch/rotary controls, event-driven RPC state
and common translations. The shell and built-in Apps use the same theme;
Power, Stream and Touchpad also use the shared rotary handling. See the
[SDK component map and usage](packages/screen-ui/README.md).
`python3 scripts/build-extension-apps.py` builds all five Apps for local
preview (optional positional IDs select individual extensions). Outputs go to
each repository's ignored `screen-app/dist/`. `onekvm-distro` supplies fixed
SDK source and the native PocketJS toolchain when building extension IPKs.
Generated JS and PAK files are installed as runtime payloads, not tracked in Git.
The host keeps at most two recently used bundle payloads within 2 MiB, maps
PAK/bytecode read-only and reads source into a string only for compilation or
evaluation fallback. Settings has no speculative guest; pill/hint chrome uses
native UI nodes. See [memory ownership and validation](docs/memory.md).
Run `bun scripts/test-screen-controls.ts` for rendered language, touch and
rotary checks at 240×240 and 320×172.

Settings → App view switches between list and icon launchers. Selecting an App
opens Show/Hide and Move up/down actions; hidden Apps stay in the management
list so they can be shown again. These changes share the Web designer's saved
App order and visibility. About OneKVM shows device and system specifications
with the label above the value; connection status stays on one line.

Stream's touch magnifier hides after five seconds without local input. Touching
the screen or using the rotary control reveals it; the reveal touch does not
change zoom. Held contacts and drags keep it visible. Its full horizontal and
vertical travel maps to the full crop range, so 2×/4× views can reach every edge
and corner. Run `bun scripts/test-stream-magnifier.ts` for the timed interaction
and crop-range checks in square, landscape and portrait layouts.

The Web page defaults to remote operation of the real device screen. It supports
touch gestures and rotary controls; the designer remains a separate tab. New
home screens use Device overview, with Flip clock, Digital, Classic and Minimal
styles available in the designer. See [remote-display.md](docs/remote-display.md)
for input, snapshot, idle and upgrade behaviour.

Select a clock in the designer to choose 12-hour or 24-hour time. The default
is 12-hour time with AM/PM to the left of the time. Device overview uses the
same font size for AM/PM and the time. All clock styles and the native display
share this setting (`layout_json.clock_format`: `12h` or `24h`); saved layouts
without the field use 12-hour time. Clock size and placement are independent.

NanoKVM Pro Desk uses the layout in `src/shared/default-layouts/nanokvm-pro-desk.json`
for new installations and Restore default: the blue Apurv Das / Unsplash background,
translucent cards, live status icons and a 1.5× clock. Saved custom layouts remain
in use after upgrades. The same model preset is supplied to the designer by the
screen service; other models retain their existing defaults.

The physical network editors commit all edited fields together through Core's
privileged local management D-Bus API. They wait for network application to
finish and confirm it before reporting success; protected HTTP routes do not
accept unauthenticated loopback edits after initialization. Settings shows
pending, success and retryable failure states in a separate modal shared with
initialization. Applying blocks background input; success stays open until
confirmed, and failure offers Edit and Retry with a short localized reason.
Full backend diagnostics remain in the host log.
NFS-root sessions continue to reject network edits.

Home, initialization and Settings share Core’s IPv4 address selector. It prefers
the active client interface and the kernel’s usable dynamic IPv4 address over a
static fallback on the same link. With no default route, a dynamic LAN address
still takes priority; when DHCP is unavailable, the fallback remains visible.
Selection reads kernel state without sending probe packets or changing networking.

Settings treats the managed AP as a separate hotspot, including when it is off.
Its editor reads Core's AP status and edits SSID, password, supported band/channel,
IPv4 subnet and DHCP range through the privileged local hotspot API. An empty
password draft keeps the existing password. The station interface continues to
open the network scanner; hotspot changes never enter that connection flow.
AP status is cached and refreshed on entry, after edits and on service/configuration
events, without idle polling. Draft edits survive background status updates.
The settings and initialization Wi-Fi lists display the device radio's hardware
maximum from Core's cached `radio_generation`, matching the Web badge. A nearby
hotspot's advertised standard never substitutes for an unknown hardware maximum.

Network names can contain characters absent from the build-time UI text. The
Settings and initialization hosts map `dist/fallback-font.bin` read-only and add
only the current scan, station and hotspot name glyphs to their small atlases.
The font follows `FONT_REG`, includes its OFL license, and is prepared by
`make fallback-font` (also part of `make assets`). Updating scan results replaces
the extra character set rather than retaining every previously seen SSID.

To update the Web page, run `pnpm install --frozen-lockfile`, `pnpm check:web`,
and `pnpm build:web`. The build updates `packaging/onekvm/display-page.js`,
which the OE recipe installs with the screen service.

```sh
make app    # shell + settings bundles → dist/ and dist/apps/settings/
make host   # rustc → host-linux-fb/target/release/onekvm-screen-display
```

屏幕按需刷新与空闲等待的约束见 [power-management.md](docs/power-management.md)。

内置“服务”App 与网页共用服务目录和权限，支持触摸／旋钮查看状态及启动、停止、
重启；Core 与系统插件仅查看。打开、手动刷新、服务事件和操作结束时读取状态，
空闲不轮询。服务目录与安全 App 共用连续长列表、行高、选中样式和宿主滚动合成，
支持触摸直接拖动、旋钮跨整个列表及详情返回后恢复选择；刷新位于列表末尾。
独立构建入口为 `make services-app`；交互回归运行
`bun scripts/test-services.ts`，覆盖 320×172、240×240 及三种界面语言。

内置“安全”App 提供登录保护、API 防护、反向代理、服务伪装、蜜罐、崩溃恢复及
地址封禁管理。触摸与旋钮共用编辑、确认和返回路径；仅提交改动字段，保存失败保留
草稿。编辑页仅提供编辑／切换和保存，页头返回丢弃未保存的修改。离开的列表立即停止
提交滚动过渡，避免旧列表覆盖新编辑页。通过 root-only Core 管理接口复用网页校验，客体无法读取账号或修改通用配置。
进入、手动刷新、Core 配置事件及操作后读取，空闲不轮询；封禁列表可手动刷新。
构建为 `make security-app`，回归为 `bun scripts/test-security.ts`。

内置“虚拟媒体”App 支持虚拟光驱、USB 磁盘及 USB 连接控制；与网页共用 Core
媒体接口，除本地镜像外，也能发现启用扩展发布的额外路径，逐层浏览子目录并挂载。
镜像详情提供明确的挂载／弹出与取消操作；USB 存储未连接时，一次操作先连接再挂载，
连接失败不会继续挂载，连接期间返回／取消也不会挂载原镜像。扩展离线、目录变化和路径越界继续由 Core
校验，屏幕不直接访问文件系统。动态文件名沿用按需补字。

内置“键盘”App 提供文本编辑与发送、常用按键、快捷组合键及锁定键状态；复用屏幕
软键盘和 Core 的布局／Caps Lock 处理，发送失败保留文本。每次按键均尝试发送释放报告。
两者支持触摸／旋钮、连续列表和英／简中／繁中；进入、刷新、相关事件和操作后读状态，
空闲不轮询。构建为 `make virtual-media-app keyboard-app`，交互回归运行
`bun scripts/test-local-control.ts`。

机型的 `screen_display.rotation_offset` 定义面板安装后的正向，
`screen_display.rotations` 定义允许的相对角度。本地与网页设置共用此限制；
未声明时仍允许四个方向。Pro Desk 的基准为 270°，只允许相对 0°、180°。
bridge 与 D-Bus 的 `rotate` 使用相对角度，`rotations` bridge key 和
`panel_json.rotations` 分别供本地与网页读取选项。持久化 `rotate` 文件及机型的
旧 `screen_display.rotate` 默认值保留物理角度，已有 270° 正向设置无需迁移；
绘制与触摸转换始终使用物理角度，`panel_json` 的尺寸为当前逻辑尺寸。
