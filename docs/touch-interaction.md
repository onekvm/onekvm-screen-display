# Local screen touch interaction

Settings keeps one owner for brightness adjustment. Tap the brightness row
to enter adjustment; the opening tap and all ordinary list drags leave the
value unchanged. In adjustment, horizontal travel changes the current value
relatively, without jumping to the finger's initial position. Vertical travel
does not adjust or scroll. Tap again, press the encoder, or go Back to leave
adjustment. The encoder still changes brightness in 5% steps while editing.

List drags track their displayed offset. Release settling starts at that
offset, never the pre-drag position; long drags do not rewind to one page.
Cancellation by a slider or system gesture keeps the current position.
Grabbing a cached encoder scroll adopts its last presented offset before
delivering the first touch frame.

The launcher App list also scrolls vertically with touch. Drags follow the
finger and cancel row activation; release uses the same settling rules as
Settings. Its gesture is active only on the launcher page, so Home and the
horizontal Home/launcher pager keep their own gestures. A host-owned swipe
between Home and the launcher cancels the contact that started on a row, so
that row does not open after the slide settles. Touch can interrupt
a cached rotary scroll at its displayed position.

System navigation reserves the leftmost 20 logical pixels for right-swipe
Back and the bottom 20 pixels for upward Home gestures. Home needs two
separate released swipes within two seconds: the first displays the localized
“Swipe again for Home” hint, the second returns to the shell. Back clears the
confirmation. Initialization does not use this Home gesture and must remain
on its current setup page.

Settings and initialization also accept rightward Back swipes across their
content, not just the bezel strip. A released, horizontally dominant swipe
must travel at least 28px; taps, short/leftward drags and vertical scrolling
do not navigate. Keyboard regions and an explicitly armed brightness slider
keep their own horizontal interactions. Back dismisses an open drawer or
confirmation before leaving its parent page.

The shared settings/initialization keyboard stores one selection for touch
and rotary input. Touch highlights a key only while it is pressed; release
or cancellation removes the highlight. Only fresh rotary input shows the
rotary cursor again, starting at the last touched key. Password visibility
is part of the same focus order.

Settings shows a focusable Back list row whenever the encoder is present,
including devices with both touch and rotary input. Pure-touch devices keep
their header/gesture navigation without this extra row. The same capability
drives row counts, scroll bounds, and activation; touch header Back is unchanged.

Settings → Restore offers device restart, factory reset and Recovery mode.
Every action opens a dedicated warning page: wait five seconds, then start a
fresh two-second hold. Cancel is the initial rotary selection; rotate onto
Confirm before holding the encoder. Early holds, taps, dragging out and
release never confirm. The host checks both deadlines too, suppresses the
encoder's Home hold on this page and dispatches only one fixed lifecycle unit.
The destructive bridge writes are private to the built-in Settings guest,
not public D-Bus Set or contributed Apps. Errors can be dismissed and retried.

Settings → App lock optionally configures a 4–8 digit PIN, entered twice.
Changing or disabling an existing PIN requires its current value. PINs use
salted Argon2id hashes in a private 0600 `app-lock.json`; they are independent
of Web passwords. Invalid persisted configuration fails closed. Five failed
attempts impose a 30-second retry delay. No PIN is enabled by default.

Home never requires a PIN. The native host gates the App list entrance,
including touch, rotary and D-Bus requests, and uses the Settings PIN panel
before showing the list. Apps opened from an unlocked list do not ask again;
direct App launches also pass through this entrance gate. Returning Home relocks;
after inactivity the host returns Home
and relocks automatically. The default is 60 seconds; settings offer 15, 30,
60, 120, 300 and 600 seconds. Power cycles and service restarts also relock.
The inactivity deadline is based on actual local input, not video or animation
refreshes. Touch and rotary share a masked numeric keypad that reserves
separate space for the title, feedback and native Home strip.

Regression checks:

```sh
bun run test:input
bun test tests/touch-scroll.test.ts
cargo test --manifest-path host-linux-fb/Cargo.toml touch_navigation
```

Input simulations exercise compiled PocketJS Vue Vapor components, not a DOM
mock. Hardware acceptance also requires real touch input on a Desk panel;
evdev injection only verifies the software input path.

App launcher pages must be created in the reactive JSX tree. Capturing page
nodes or the list/icon mode during Shell setup freezes their inputs: a saved
view change cannot rebuild the launcher, and the list retains its initial
inactive state. The pager is keyed by catalog generation and view, while page
activity and focus remain reactive. Vertical list gestures must work when the
finger starts on a row, and must not open that row after dragging. The input
simulation covers switching modes without restarting the guest, both touch and
rotary navigation, and drags with a resolved row hit.

App PIN is checked at the launcher entrance, before either touch pager shows
even a partial list frame. Rotary navigation and D-Bus page requests use the
same host gate. Unlock returns to the launcher; Apps share that authorization
until Home or the inactivity timeout. Cache warmup uses the raw page setter
and must neither request PIN nor change authorization.

The touchpad sends button state changes even when the joystick is stationary.
A joystick tap sends a complete press/release pair; the left and right buttons
hold until touch release or cancellation. Leaving the App releases any pending
button before its HID worker sleeps. A failed or timed-out report leaves the
USB button state uncertain, so the worker retries a release before further
input, including while the App is inactive. An idle touchpad does not keep
overwriting input from Web or other HID clients.

On the Pro 320×172 landscape panel, the 120px joystick occupies the left
side. Two 68×64px mouse buttons sit side by side on the right, with a speed
slider underneath. The slider has a 44px touch target. Shared layout geometry
drives rendering and gesture hit regions; no controls overlap the left 20px
Back edge, bottom 20px Home edge, or each other. Square panels retain the
stacked layout, and portrait button widths adapt to the available space.
