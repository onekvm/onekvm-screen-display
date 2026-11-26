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

The keyboard keeps a header of at least 38 px (more on panels with rounded
corners, see below) for the field name above the typed text, followed by a
caret. When the text is wider than the field, the
start is replaced by an ellipsis so the end stays in view. Keys sit below the
header and never overlap it. They fill the rest of the panel, up to 1.5 times
their width. The nine-key board keeps keys of at most 52 px. If the keys leave
less than two header heights of the page visible above, the header takes that
space and the keyboard covers the whole panel.

PicoKVM and NanoKVM Go use the nine-key board. A tap types the first letter
of a group. Holding a group shows its letters in a row of 36 px chips on a
dark band above it, inside the panel and clear of rounded corners. The
letter whose chip is under the finger is selected, starting with the one
under the press point; outside the row, the nearest chip is selected. Moving
the finger along the row changes the selection, and release types it, so
every letter can be reached from any point on the key. The mode key names
the mode in use and steps through abc, 123 (digits 0–9 as single keys), #+=
and ABC. The #+= mode holds all 32 printable ASCII marks in nine groups of
three or four, in rows of punctuation and quotes, paired brackets, then
arithmetic and the rest. The grid board keeps abc, symbols and ABC, and its
mode key names the next mode.
Each model layout records the radius of the panel's rounded corners
(NanoKVM Go: 40 px, not yet measured). On such a panel, keys keep their
rounded outline inside the panel corners. The letter row shown while holding
a group also stays clear of the corners. In the header, the field name, the
typed text, the caret and the show/hide button, including the button's own
rounded corners, keep at least 6 px from the corner arcs, measured from the
corner centre. The header content starts 8 px below the top edge, the
show/hide button (48×26 px) is centred on the typed line, and the typed text
ends before it. The text keyboard's header is at least 47 px tall there, and
other keyboards' at least 44 px. On the NanoKVM Go 284×240 panel, letter
groups are 86×43 px, the action row has five 50×43 px keys, and IPv4 keys are
86×34 px.

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
