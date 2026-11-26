# Screen host memory ownership

## Service budget

`onekvm-device-screen-display.service` accounts for the renderer and its child
processes in one cgroup. `MemoryHigh=192M` starts reclaim and throttling;
`MemoryMax=256M` is the hard charged-memory limit, including native textures,
fonts and file cache as well as JS heaps. `MemorySwapMax=0` prevents the screen
from consuming the system's swap budget. These are service-wide limits; each
contributed guest's separate 32 MiB JS limit still applies. Built-in guests,
including Shell and Settings, do not set that per-runtime JS limit. Measure
their QuickJS allocations and GC thresholds separately from charged memory.

`OOMPolicy=kill` makes a cgroup OOM terminate the entire screen service group;
`Restart=always` restarts its renderer. Core and the hardware-watchdog daemon
are outside this cgroup. A screen restart reloads the saved layout and resets
transient guest state; it does not restart Core or reboot the device. Repeated
failures remain subject to the unit's start-rate limit.

On cgroup v2, verify the effective limits with `systemctl show
onekvm-device-screen-display.service -p MemoryHigh -p MemoryMax -p MemorySwapMax
-p OOMPolicy`, and inspect `memory.events` below the unit's `ControlGroup`.

## Idle-home budget

Measure the complete process RSS from `/proc/PID/smaps_rollup`; the idle-home
target is 10 MiB after a cold service start and after repeated App visits.
Include mapped executable/library pages, framebuffer mappings and native heaps.
PSS, QuickJS allocation totals and cgroup charges are separate measurements.
Measure the no-video session with its saved layout and complete media library
preserved. Foreground Apps and video sessions have separate working sets.
Native codec libraries can remain resident after a video session ends on musl;
QuickJS GC does not collect GStreamer/GLib registries or unload those libraries.
The platform decoder already releases its pipeline, frame mappings and buffer
pools on destruction. GStreamer's `gst_deinit` is terminal (the library must not
be used again), so it cannot serve as a repeatable idle GC operation. Record
post-video RSS separately from the no-video budget.

The compact allocator gives each QuickJS runtime a disposable pool. Destroying
an App destroys its pool after the runtime and its pinned bytecode are gone.
Native allocations use a coalescing pool; buffers of at least 64 KiB use separate
anonymous mappings so temporary resource loading does not fragment small live
objects. Freeing a pooled allocation discards only full caller-owned payload
pages before returning the block to its allocator. Allocator headers and adjacent
allocations are excluded. Idle collection also releases unused main-stack pages
below the current frame, retaining a 64 KiB cushion and checking the actual stack
mapping.

The Pro build uses its version-checked system OpenH264 backend instead of also
linking an unused bundled codec. Its aborting executable omits native unwind
tables and is optimized for size. After startup and App teardown, clean read-only
pages of the executable are released while their mapping remains pinned; hot
code faults back in on demand. Private dirty code pages are excluded. Other
targets retain the bundled default.

## Page lifetime

The host retains the home Shell while an App runs. Foreground Apps are disposable:
leaving an App drops its guest, UI surface, RPC channel and dynamic font additions.
Settings starts on demand; there is no background prewarm guest or unused parked App.
Its existing loading plate/spinner covers first-open latency.

Shell pages are render callbacks, rather than arrays of already created component
blocks in prop getters. The pager invokes each callback inside its owned dynamic
render scope. Reading page counts must never instantiate a page: those instances
have no rendered owner to dispose when the catalog or selected home changes.
The native pager mounts only its selected/capture page; RGB565 snapshots retain
slide targets after the hidden page scope is disposed. Collect its QuickJS cycles
at page changes and during normal home updates. A disposed list's scroll strip
must not survive its native node generation.

Home widgets bind changing values into a stable render scope. Their key changes
only when the content type changes; text, colors and geometry update existing
nodes. Create only that content type's branches, rather than retaining conditionals
for all other widget kinds. The shared DOM adapter uses prototype methods and
accessors, with receiver-local mutable facades. Destroyed subtrees clear mirror
links and handlers. Framework-wide component proxies retain a mode bit instead
of a disposed component instance.

After `make shell-app`, run `cargo test --manifest-path host-linux-fb/Cargo.toml
catalog_rebuilds_release_page_scopes -- --ignored` to check repeated catalog/home
switches in QuickJS. The test collects garbage and bounds the live object count
after warmup, independently of allocator RSS retention.

## Bundle payloads

- PAK and bytecode payloads use read-only file mappings. Installed/versioned bundle
  files must remain immutable while in use; replace files atomically when updating.
- Source identity is checked with a streaming SHA-256 hash, using a fixed 16 KiB
  buffer. Source is decoded into a String only when compiling or evaluating a
  fallback. It is never retained in the bundle cache.
- Packaged bytecode still requires matching source, resource and bytecode hashes
  and QuickJS ABI metadata. A stale package uses the source/compiler cache; an
  evaluation failure reads the current source. Disk-cache keys include source
  identity and ABI; catalog invalidation prunes superseded entries.
- The in-process LRU holds at most two bundles and 2 MiB of combined PAK/bytecode
  payload. Oversized bundles remain usable but are not retained by the LRU. Active
  users such as Settings' network font builder hold independent Arcs, so eviction
  cannot invalidate their base resources. These limits cover cached payloads,
  not the complete live guest heap or kernel file cache.

QuickJS loads bytecode with `ROM_DATA` and can borrow its backing bytes.
`HostedGuest` pins an independent Arc to every evaluated bytecode blob until its
runtime is destroyed. Evicting/replacing an LRU entry can unmap unused PAK data,
but it cannot unmap code still referenced by an active or parked guest. Garbage
collection may discard resident pages of a pinned immutable bytecode mapping:
its virtual address and inode remain pinned, and subsequent reads fault the same
bytes back in. This also removes startup-only code pages from idle RSS. It does
not discard anonymous allocations or unmap borrowed ROM data.

PocketJS `UiSurface::feed_pak` eagerly loads styles, fonts, images and sprites.
The Shell instead publishes image names for on-demand upload. Its host loader
caches resident handles and releases images no live native node references;
future image bindings resolve the current generation through that loader.
Detached live nodes still pin their images. Existing App bundles keep eager
loading. The surface retains only TILESET blobs for `loadTileTexture`; ordinary
PAK files leave no complete surface-owned copy. Fonts/textures keep the core-owned data they need.
The shared engine implementation lives in
`tmp/pocketjs/engine/crates/pocket-ui-surface/src/surface.rs`; its sources participate
in the screen recipe's compilation signature.

## Frame storage

The physical RGB565 frame used for rotation also backs remote snapshots; there
is no second permanent shadow copy. The two native pager snapshots also supply
Shell transition targets. Reuse these buffers while preserving frame generation,
rotation, stride and damage tracking. Remote clients keep their separately owned
snapshot so encoding never borrows a mutable render buffer.

## Native chrome

The host's shared home pill and hint bar use a native UiSurface with the existing
Chrome PAK fonts. No Chrome QuickJS guest, framework instance or JS/JSC payload is
loaded. The geometry, colors, font slot, 180 ms fade and wake reset follow
`src/chrome/`. That bundle remains the font cooker and reference model for previews
and pixel comparisons. Changes to it must update the native layer in
`host-linux-fb/src/chrome.rs` and pass the reference comparison.

Chrome animation scheduling is independent of the foreground App's `hot` flag.
A new App wake invalidates old fade scheduling, so leaving during a hint cannot
keep the home shell busy.

## Home status icons

Each native status icon uses one `Image` node borrowing a shared texture,
rather than expanding coverage-mask runs into hundreds of Vue `View` components.
`src/shell/statusIconTextures.ts` keys live textures by source and ABGR color;
duplicate placements share one upload. Changing source/color or disposing a
placement releases its reference, and the last reference frees the texture.
Old editor colors do not accumulate in an unbounded cache. Failed uploads are
not cached, and handle zero is valid.

The shared 28×28 coverage mask sits inside a transparent 32×32 power-of-two RGBA
texture (4 KiB per live variant). Drawing the padded envelope at the corresponding
offset preserves centered contain geometry, color alpha and clipping. The live
session-count badge remains a separate overlay. The Web preview still uses mask
rectangles, decoded only when requested; importing badge geometry does not expand
them in the native Shell.

After `make shell-app`, run the ignored
`status_icons_share_and_release_native_textures` host test. It boots the compiled
Shell in QuickJS, checks that 32 duplicate placements share one native texture,
repeatedly changes their color, and verifies that removing all placements releases
the upload. Profile JS object counts as well as native texture bytes and raster
time; service RSS also includes media and allocator retention.

## Media library

New MP4 imports send the browser `File` directly to the session-authenticated
`/api/plugins/screen-display/remote/media` Unix route. Core forwards the HTTP body
as a stream; the screen host copies it to a private `.part` file with a fixed
buffer, validates the H.264 container and atomically renames it. Disconnects,
short bodies and validation/write failures remove the partial file. Concurrent
uploads are serialized independently of rendering and settings locks.

Version 3 MP4 assets contain a generated filename, byte count, dimensions and
duration. Settings and D-Bus carry this metadata only. Preview requests support
HTTP byte ranges and share the device's existing session authentication. Local
playback retains MP4 indexes/timestamps and decoder surfaces, reads one compressed
sample at a time and drops it after decoding. Memory depends on the index and
frame dimensions, rather than retaining the entire video. Individual compressed
samples are limited to 8 MiB before the demuxer allocates them.

At startup, legacy version 2 inline MP4s are automatically converted to version 3
file assets before the library loads video samples. Their IDs, names, dimensions,
timing, other metadata and original container bytes remain unchanged. Conversion
decodes base64 in 64 KiB chunks, validates the file without retaining compressed
samples, and publishes a private immutable file named from its SHA-256. Files and
their directory are synced before the complete, validated library metadata is
atomically replaced and synced. Retries and stale editors reuse the same file;
settings saves also convert incoming inline videos. Failed conversions leave the
original metadata available, clean partial files and log a warning. Completed files
from an interrupted metadata save follow the existing orphan grace period.

The loader validates the entire library at startup. Version 1 RGB565 frame
payloads are represented by ranges in the canonical metadata, decoded on first
paint and released when their asset leaves the layout. The library still checks
all frame bytes and durations before accepting a save. Version 2 inline MP4s
remain readable if migration cannot write storage; that fallback retains its
compressed samples. Version 3 videos retain neither an index nor a decoder while
unused. First paint opens the immutable file and creates the player; removing its
placement releases the player, and showing it again reopens it. Assets and their
original files remain available in the library.

Background/library metadata uses an immutable read-only mapping when its saved
bytes exactly match the validated canonical JSON. Writers replace the inode
atomically; active readers retain their old version. Settings responses clone
that metadata and then release the duplicate resident file pages. Capacity, live
allocation sizes and resident pages overlap and must not be added together.

Saving the library removes files that were previously saved and are now deleted.
Uncommitted uploads have a one-day grace period and are reclaimed on a later
library save, preserving the existing Save workflow and open editor drafts.

The media-store regression streams an MP4 larger than 128 MiB without a whole-file
input buffer, checks partial cleanup/range reads, and reads every sample twice to
verify looping and composition timestamps.

## Validation

Run the host unit suite and the `pocket-ui-surface` crate tests. Build Chrome assets
and run the ignored `native_chrome_matches_legacy_pixels` test explicitly: it
compares settled RGB565 pixels against the former JS renderer at 240×240 and
320×172 in English, Simplified Chinese and Traditional Chinese. Unit checks cover
LRU limits/ownership, immutable file replacement, bytecode/source fallback,
streamed TILESET lifetime, cue fades and wake invalidation.

Measure `/proc/PID/smaps_rollup` with the same restart, idle and App sequence before
and after a change. Report RSS/PSS separately from anonymous memory, and distinguish
mapped file pages from heap and systemd cgroup file cache. Check cold home, all Apps,
repeated Settings visits and final home; verify actual touch/rotary, hints, Chinese
SSIDs, wake and rotation on the target framebuffer device. The NanoKVM PCIe OLED uses a
different host; validate its authenticated video without installing this package.
