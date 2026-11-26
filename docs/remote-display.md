# Remote device screen

The Screen display Web page opens on Remote display. It shows the actual
framebuffer in logical screen orientation. Touch, drag, rotary steps, presses,
and holds use the same input paths as the physical screen, including its PIN
and system-action confirmation screens. Designer and Settings remain separate
tabs; reading the remote screen does not change its saved layout or wake it.

The remote view uses a continuous H.264 Annex-B stream, decoded with WebCodecs.
Capture uses a memory copy of the last frame presented to fbdev, including
transitions and rotation. It never repeatedly reads the uncached fbdev mapping
on idle touch ticks. Unchanged frames skip conversion and encoding, and viewers
receive a lightweight heartbeat instead.
Pro packages use OE's OpenH264 2.6.0 library with AArch64 NEON assembly; the
Rust crate's source build lacks ARM assembly. This remains CPU encoding with
SIMD acceleration. It does not consume or reconfigure the HDMI hardware
encoder. The system codec ABI is checked and a load/version error is reported
instead of silently selecting the slower scalar build.
The session-only `remote` Unix route proxies
`/api/plugins/screen-display/remote/h264` to
`/run/onekvm/extensions/screen-display/sockets/remote.sock`. System plugin
registrations publish routes through the same extension catalog as other plugins.
There is no extra network listener and every request uses the Core login session.

OpenH264 encodes only changed logical framebuffer images, at up to 30 FPS, with
one bounded encoder thread per viewer (at most two viewers). Each viewer starts
at an IDR. Slow clients use the newest raw frame; encoded reference frames are
never discarded. The browser reconnects if its decode queue grows. Hidden tabs
close the stream and release capture; reading does not wake the backlight or
force the guest into its hot loop. The source is the physical screen's rendered
frames, so its actual update rate remains the upper bound.

HTTP chunks contain independent length-delimited OKSF v1 packets. The 24-byte
big-endian header holds magic `OKSF`, payload length u32, timestamp in microseconds
u64, logical width and height u16, flags (bit 0 IDR, bit 1 blanked), version 1,
and two reserved zero bytes. A zero-length payload is an idle heartbeat. Video
payloads contain one complete Annex-B access unit, including SPS/PPS on IDR.

For diagnostics, the system plugin retains two generic D-Bus method mappings: `status` to
`RemoteFrame` and `input` to `RemoteInput`. Each takes one JSON string and
returns one JSON string. Existing settings methods remain compatible.

`status` takes `{ "sequence": 0 }` and returns `ready`, `width`, `height`,
`sequence`, `format: "rgb565le"`, base64 `pixels`, physical `controls`, and
`blanked`. Unchanged frames omit pixel data. Snapshots are captured by the
framebuffer owner only on demand. The Web page serializes polls, stops polling
when hidden or closed, and never changes the screen's blanking timer merely
by viewing it.

`input` accepts `action: "rotate"` with -12 to 12 `steps`, `"press"`, `"hold"`,
or `"gesture"`. A gesture contains 1 to 64 ordered `{ "t": 0, "x": 0, "y": 0 }`
points in logical pixels and `duration_ms` from 32 to 3000. The screen service
plays the complete gesture and always releases it without requiring another
network message. Overlapping gestures and out-of-bounds coordinates fail;
physical touch interrupts a remote gesture.

Rotary actions are queued separately and consumed in order, one per guest
frame. A Hold followed quickly by a Step therefore cannot be merged into a
single input and discard the Step. The bounded queue rejects more than 32
pending actions; physical rotary input takes priority.

New installations default to Device overview, inspired by the NanoKVM Pro
status screen: connection badges, time, IP, hostname, video resolution/FPS and
CPU load. Clock style choices also include Flip clock, Digital, Classic and
Minimal. Explicit saved selections survive upgrades. Flip motion runs only
when the minute changes and returns to the regular idle refresh schedule.

The overview is an editable preset of ordinary text, status, rectangle and
progress widgets, plus a small movable clock. `src/shared/dashboard.ts` defines
the default geometry for both the native shell and the designer. Legacy overview
layouts materialize these widgets once; `dashboard_layout: true` preserves
subsequent edits, hiding and deletions. `dashboard_clock` stores the overview
clock separately from other clock styles. Overview widgets retain their edits
when another face is selected and are rendered only on the overview.
The designer outlines the selected widget, including the clock. Widgets with
editable width and height expose a lower-right resize handle; dragging updates
the inspector and is saved with the layout. Free placement retains the opposite
corner, while grid placement retains the cell center. Resize coordinates account
for both preview zoom and widget scale. Shared size defaults keep the inspector,
preview, and native layout consistent; text alignment uses the same horizontal
left, center, and right anchors on both renderers.
Only visible widget values participate in the native layout signature; uptime
or unused metrics do not recreate the page. Clock seconds update the classic
dial only. Overview and digital/flip clocks update when their visible time
changes. Connection status retains the normal two-second refresh cadence;
CPU text and progress share a five-second sample to avoid repainting the whole
overview for minor fluctuations in load.
Each widget owns its own reactive render scope. Status polling preserves the
widget collection and unchanged component instances, updating only the widgets
whose displayed values changed. Static labels skip live template expansion.
Static home layouts also retain a private RGB565 raster target. DrawList damage
tracking repaints only changed regions, replaying painter order over the home
background. Transition output cannot overwrite this cache. Animated media and
image underlays retain their full compositing path.

The default overview uses borderless port icons, including Wi-Fi, with a
live-session icon and numeric corner badge. On the 320×172 Pro panel, 28×28
port icons and the live icon form one group with 6 px between their square
canvases. The clock uses 16 px text in a 54×22 box aligned to the right panel
inset; content cards start at y=50. The 240×240
preset retains two header rows with square 24×24 icons. The badge follows Core’s actual
video session count rather than encoder activity: zero keeps a muted icon with no badge, 1–99 show the count, and larger
counts show `99+`. Text components can still use `{session_count}`.
Customized saved overviews keep their placements; Restore default applies the updated preset and can be undone.

远程操作页默认处于「未连接」。只有点击连接才申请 H.264 viewer；断开或离开页签会释放 viewer，重新进入仍需手动连接。用户主动连接后，隐藏浏览器标签会暂停串流，返回时恢复；网络异常沿用重试，手动断开会取消重试。
