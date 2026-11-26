# Shared screen UI

`@onekvm/screen-ui` is the source SDK for PocketJS Vue Vapor Apps. It is
maintained here and compiled into each independent App. Devices do not load
SDK source or depend on another App's files.

| Module | Responsibility / contract |
| --- | --- |
| `theme` | One ABGR palette and baked font-slot map for shell and Apps |
| `useRotary` | Decode new host events into turn, confirm and back callbacks; a hold takes precedence over a click |
| `useActions` | Own selection, wrap detents and route touch/confirm to one indexed action callback |
| `ActionBar` | Render `{id, label}` items, selection and `onAction(index)` |
| `BackButton`, `assets/` | HDMI-style Back gesture, rotary highlight and bundled common images |
| `AppTitle`, `AppHeader` | Right-align icon/title by default; the full header reserves the left side for an always-visible Back button |
| `StatusCard` | Render status, summary, optional muted detail, busy/offline state and localized errors |
| `AuthorizationCard`, `authorization` | Encode an active device link once, draw an integer QR with a four-module quiet zone, and adapt to landscape/square screens |
| `useExtension` | Read RPC state on host invalidations and action completion; optional `validateAction` supplies business rules |
| `ExtensionApp` | Compose the common service layout from config and status-formatting callbacks |
| `i18n`, `locales/` | Shared English, Simplified Chinese and Traditional Chinese messages, with live language changes |
| `device` | Host metadata, screen size and bridge helpers |

Contributors import from `@onekvm/screen-ui` and keep extension identity,
declared methods, business validation and status formatting in their own repo:

```tsx
import { ExtensionApp } from "@onekvm/screen-ui";
import { CONFIG } from "./config";
import { statusLabel, summary } from "./status";

export default function App() {
  return <ExtensionApp config={CONFIG} statusLabel={statusLabel} summary={summary} />;
}
```

Custom screens can use `ActionBar` with `useActions`, or `useRotary` for a
different rotary behavior such as video zoom. Keep backend checks in the
business callback; Back must remain available while an action is busy.
`ExtensionApp` always includes Back in both touch controls and rotary selection,
including the pending-authorization view. Back returns to the App list without
dispatching a backend command or cancelling enrollment. Pending authorization
also explains that links are temporary and can be retried after expiration.

The extension's `screen-app/Makefile` sets `SCREEN_UI` and includes
`$(SCREEN_UI)/screen-app.mk`. `build.ts` creates a temporary project beside
the output directory, supplies this package through `node_modules`, includes
the SDK resource graph for PocketJS's font/style collector, and removes the
temporary project after compilation. It does not change either checkout.
Common images live in this SDK's `assets/` directory. The builder stages them
under the reserved `screen-ui/` resource path and embeds them in each PAK;
Apps neither copy files from the screen host nor load other Apps' resources.
Use the exported `BackButton` (44px wide, configurable header height,
`selected` and `onBack` props), or `AppHeader` for the full service header.
The button cancels taps when dragged and clears rotary highlighting when
selection moves away. HDMI loopback and service Apps use this same component.
Built-in Power composes `AppHeader`, `StatusCard`, `ActionBar` and `useActions`;
ATX LED details use the card's optional `detail` line. Settings uses `AppTitle`
and `BackButton` while retaining its compact header and hierarchical navigation.
An error replaces the optional detail line to keep compact cards within their bounds.

Override `SCREEN_UI`, `POCKETJS`, `FONT_REG`, `FONT_BOLD` and `OUT_DIR` for
standalone builds. OE supplies fixed SDK source via `onekvm-screen-ui-native`.

Optional `src/logo.png` is a square 64×64 RGBA source asset. Use
`icon: "src/logo.png"` in App config for the header. The build also writes
`icon.bin` (ICO1) for the launcher; contributors install it and select
`icon: "icon.bin"` in their manifest. Both surfaces use the same pixels.
The common service layout keeps its status and action rows within 320×172.

Browser-login contributors additionally provide `authorization(state)` with
`idle`, `starting`, `pending`, `connecting`, `expired`, `timed-out` or `failed`. Only
`pending` carries a current URL. Require `qr-code` and `state-events` in the
manifest, and notify the host after URL/state changes. The shared App shows
the QR while pending and removes it on completion, failure or expiration.

Run `bun scripts/test-screen-controls.ts` from the screen-display repo to
exercise real extension Apps, touch/rotary input, and live language changes
at both supported logical sizes. A shared change must rebuild consuming
bundles; there is no runtime shared-library ABI to coordinate.

`useExtension` reads status on entry, on `appStateGeneration` changes and after
an action completes. It keeps an invalidation received during an RPC pending
until that call finishes. There is no periodic status RPC. Producers call the
system-bus `org.onekvm.ScreenDisplay.Refresh()` method after changing their
state; configuration/contribution and service lifecycle events also invalidate
App state. Declare `state-events` in `required_features` when this notification
contract is required. The host counter is local cached metadata, so reading it
from `onFrame` performs no filesystem or bus calls.

Authorization QR modules are rasterized once per link into a 128×128 RGB565
texture. The App renders one image, uses integer modules and a white quiet zone,
and frees the texture when the authorization view is retired. This keeps QR
updates inside the same bounded guest turn as other service pages.

`AppConfig.actionEnabled(state, action)` supplies the provider state machine.
The common App disables unavailable/busy commands, skips them during rotary
selection, and checks availability again before RPC dispatch. Back is always
local and available. NetBird/Tailscale enforce a 300-second QR window in their
controllers using one-shot timerfd events; view entry never renews it.

导航沿用 HDMI 环回：左上角 back.png 箭头与右滑回 App 列表；长按旋钮回主屏。
`actionLabel` 可按业务状态返回本地化文案键，例如未完成授权时的 `cancel`。

Screen Apps require an image `icon`; `glyph` fields and letter fallbacks
are not supported. SDK builds require a 64×64 `src/logo.png` and package the
generated `icon.bin`. Missing or malformed artwork rejects App registration.
