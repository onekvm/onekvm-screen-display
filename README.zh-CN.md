# OneKVM 屏幕显示

[English](README.md) | 简体中文

这个项目负责 NanoKVM Pro Desk、NanoKVM Go 和 PicoKVM 等 OneKVM 设备自带的小屏幕。
瞄一眼主屏，就能看到设备地址、连接状态和视频信息。

## 怎么用

- **设置设备。** 第一次开机时，按小屏幕上的提示完成设置。屏幕会显示可在浏览器中打开的设备地址。
- **在设备上打开应用。** 根据机型，用触摸屏或旋钮操作。可用的应用可以调整设置、把镜像当成光盘或 U 盘接到被控电脑，也可以发送按键。
- **在浏览器里操作小屏幕。** 登录 OneKVM 网页，打开 **屏幕显示 → 远程操作**，就能看到并操作设备的小屏幕。
- **换个主屏布局。** 在 **屏幕显示 → 设计器** 中，可以更换时钟、背景和布局。例如，把设备地址和连接状态放在时钟旁边。

## 开发入口

| 想做什么 | 从这里开始 |
| --- | --- |
| 做一个自己的主屏或小组件 | [屏幕 SDK](packages/screen-sdk/README.zh-CN.md)和[完整示例](examples/screen-sdk-example/) |
| 在启动器里添加应用 | [屏幕扩展接口](docs/extension-points.md) |
| 修改设备屏幕上的功能 | [主屏与启动器](src/shell/)、[内置应用](apps/)和 [Linux 屏幕服务](host-linux-fb/) |
| 修改网页操作或设计器 | [网页源码](web/display/)和[构建与预览说明](docs/implementation-notes.md#building-and-previewing) |

设备软件包通过 `onekvm-distro` 构建。[实现说明](docs/implementation-notes.md)记录了初始化、网络、显示设置和本地预览的细节。

[MIT 许可证](LICENSE)
