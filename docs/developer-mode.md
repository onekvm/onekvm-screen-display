# Screen developer mode

Sign in to the device Web UI and open **Screen display → Developer**. Enable
Developer mode, select a running contributed home, widget instance or App, and
connect Remote display when you need the real framebuffer and input controls.
See the [SDK debugging guide](../packages/screen-sdk/README.md#debugging) for iteration.

The panel supports component trees, native node highlighting, console and error
output, global JavaScript evaluation, pause/resume and one-frame stepping. It does
not implement source breakpoints or the Chrome DevTools protocol. Built-in init,
Settings and other privileged system guests are excluded from the target list.
Vapor text leaves select their enclosing native Text layout for highlighting.

## Transport and lifecycle

- Core's existing session-authenticated `/api/plugins/screen-display/remote`
  Unix proxy serves `GET /devtools?after=<cursor>` and `POST /devtools`.
  The root-only `remote.sock` remains the only screen HTTP listener; no TCP port
  or shared PocketJS file mailbox is enabled.
- POST actions: `enable`, `disable`, `reload`, or `command` with a target ID and
  a PocketJS command. Supported commands are `getTree`, `inspect`, `pause`,
  `resume`, single-frame `step`, `eval` and `devStats`. Reload invalidates the
  contribution catalog; changed bundle revisions create new guest targets.
- Each live contributed runtime registers a monotonically increasing opaque
  target ID, contribution ID, instance ID and role. Destroyed or superseded
  target IDs reject commands. Identical widget contributions remain independent.
- Mode is volatile and off at service start. Successful status polls renew a
  60-second lease. Disable or lease expiry clears pending commands and messages,
  then queues resume and clear-highlight commands for every remaining guest.
  Leaving the panel requests disable, including when Enable is still pending.
- HTTP threads only enqueue commands and snapshot events. The renderer owns all
  guest execution. It polls active and parked guests before the blank-screen
  wait, so idle, hidden and paused guests can resume. Each debug turn is limited
  to 50 ms; a polling round shares a 100 ms budget. Debug polling preserves the
  previous touch contacts rather than inventing a release.
- The injected PocketJS transport is installed before bundle evaluation, so
  enabling debugging does not require restarting the guest. While disabled,
  it drops output and accepts only host-generated resume/highlight cleanup.
  Framework console mirroring and tree bookkeeping remain installed.

## Bounds

| Resource | Limit |
| --- | --- |
| Live targets | 16 |
| Queued commands per target | 16 |
| HTTP request | 8 KiB |
| Evaluation source | 4096 UTF-8 bytes |
| Individual event | 64 KiB |
| Shared event ring | 256 messages and 512 KiB |
| Browser console | 200 lines, 2048 characters each |
| Browser tree | 2000 rows, depth 64 |
| Guest JS heap | 32 MiB |
| Screen service cgroup | 192 MiB high / 256 MiB maximum / no swap |

Status snapshots include the event cursor and cumulative dropped-message count.
Old or oversized events are dropped; debug output never appends an unbounded
mailbox file. Evaluation uses the contributed guest's bridge and permissions.
Module-local values must be deliberately exposed through `globalThis` to inspect
them. Frame stepping advances a render frame, not a source line.

## Validation

```sh
pnpm check:web
bun test tests/debug-tree.test.ts tests/screen-devtools.test.ts
ASDF_RUST_VERSION=1.97.1 cargo test --manifest-path host-linux-fb/Cargo.toml devtools::tests
# Requires generated examples/screen-sdk-example/dist/home JS and PAK:
ASDF_RUST_VERSION=1.97.1 cargo test --manifest-path host-linux-fb/Cargo.toml \
  sdk_bundle_supports_tree_eval_pause_step_and_timeout -- --ignored
```

Device acceptance must verify session authentication, two same-contribution
widget targets, tree/highlight pixels, console/eval and exception timeout,
pause/one-frame/resume, atomic resource reload and stale target rejection,
parked-home commands, 60-second lost-connection recovery, panel-unmount cleanup,
held-touch behavior and unchanged Core/watchdog/boot identities. Validate the
existing service memory limits and restore any temporary layout/source fixtures.
