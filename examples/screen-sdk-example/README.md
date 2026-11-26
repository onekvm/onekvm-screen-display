# Screen SDK companion example

This optional extension owns two executable screen contributions: a home and a
repeatable counter widget. Both subscribe to host state invalidations and call
the companion's `status` / `increment` methods. The backend serializes counter
updates with a file lock, persists below `ONEKVM_EXTENSION_DATA`, then calls
`org.onekvm.ScreenDisplay.Refresh`. Updating one instance refreshes the others.

Build and install through the [SDK instructions](../../packages/screen-sdk/README.md).
The package starts disabled and runs no resident service. Enable it to expose
its contributions, then select its home or add its counter to a designer layout.
Short press or tap increments; hold exits the interaction through the host.
Disable it to remove its contributions; the host falls back to the saved layout.
