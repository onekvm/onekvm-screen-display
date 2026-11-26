# OneKVM screen display

English | [简体中文](README.zh-CN.md)

This project runs the small screen built into OneKVM devices such as NanoKVM
Pro Desk, NanoKVM Go and PicoKVM. The home screen can show the device's address,
connection status and video information at a glance.

## Use the screen

- **Set up the device.** On first boot, the screen guides you through setup and
  shows the address to open in your browser.
- **Open apps on the device.** Use the touch screen or the knob, depending on
  your model. Available apps can change settings, attach a disk image as a
  virtual drive or send keystrokes to the computer you control.
- **Control the small screen from your browser.** Sign in to the OneKVM web
  interface and open **Screen display → Remote display**. You can see what's on
  the device's screen and operate it from there.
- **Change what Home shows.** In **Screen display → Designer**, you can change
  the clock, background and layout. For example, put the device address and
  connection status next to the clock.

## Develop for the screen

| I want to… | Start here |
| --- | --- |
| Build a custom home screen or widget | [Screen SDK](packages/screen-sdk/README.md) and a [working example](examples/screen-sdk-example/) |
| Add an app to the launcher | [Screen extension points](docs/extension-points.md) |
| Change what runs on the device screen | [Home and launcher](src/shell/), [built-in apps](apps/) and the [Linux screen service](host-linux-fb/) |
| Work on the browser controls or designer | [Web interface source](web/display/) and [build and preview instructions](docs/implementation-notes.md#building-and-previewing) |

The device packages are built through `onekvm-distro`. The
[implementation notes](docs/implementation-notes.md) cover setup, networking,
display settings and local previews.

[MIT License](LICENSE)
