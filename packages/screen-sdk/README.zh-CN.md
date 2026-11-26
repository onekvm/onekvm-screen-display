# OneKVM 屏幕 SDK

[English](README.md)

`@onekvm/screen-sdk` 用于开发可编程主页和支持自绘、交互的首页组件。两者共用
PocketJS Vue Vapor 运行时，使用 TypeScript／TSX 和 SDK 的 View、Text、Image。
这里的样式、组件与资源由 PocketJS 提供；运行环境没有浏览器 DOM、Node.js、fetch
或设备文件访问。外部数据与设备操作通过配套插件完成。

## 开始开发

准备 Bun、OneKVM 使用的 PocketJS 工具链和字体，在屏幕仓库执行：

```sh
bun packages/screen-sdk/cli.ts init /path/to/my-widget --kind=widget
bun packages/screen-sdk/cli.ts check /path/to/my-widget
bun packages/screen-sdk/cli.ts build /path/to/my-widget \
  --pocketjs=/path/to/pocketjs \
  --font-regular=/path/to/regular.otf --font-bold=/path/to/bold.otf
```

完整主页使用 `--kind=home`。将输出的 `contribution.json` 合入配套插件的
`contributions`，并把同目录下的 bundle 安装到清单声明的相对路径；同时在插件
`methods` 中声明实际方法。组件、主页与 App 的本地 ID 在同一插件内应保持唯一。
只安装编译后的资源，不向设备安装 SDK 源码。

完整[计数示例](../../examples/screen-sdk-example)包含插件后端、组件和主页。
在 `onekvm-distro` 通过正常 Make 入口构建 IPK：

```sh
ONEKVM_DEBUG_WORKTREES=onekvm-screen-display make \
  ONEKVM_MACHINE=onekvm-nanokvm-pro SELECTED_KAS=kas/nanokvm-pro-sd.yml build package \
  onekvm-device-screen-display onekvm-extension-screen-sdk-example
```

启用示例插件后，在屏幕设置选择示例主页，或在设计器添加计数组件。主页下拉框
选择“使用设计器布局”即可回到原布局。保存后，通过已登录的“远程屏幕”查看
真实绘制和操作效果；设计器使用组件元数据预览位置，不在浏览器执行第三方代码。
OE 的 `onekvm-screen-ui-native` 同时提供两个 SDK 包。

## 调试

登录设备网页，打开 **屏幕显示 → 开发者**，启用开发者模式，然后选择运行中的
主页、小组件实例或扩展 App。内置设置等系统页面不作为调试目标。

| 功能 | 操作 |
| --- | --- |
| 组件树 | 刷新组件树，点击节点在真实画面高亮，完成后取消高亮 |
| 控制台 | 查看 `console.log/warn/error` 与运行错误；执行全局 JavaScript 表达式 |
| 暂停与逐帧 | 暂停所选实例、运行一帧、继续；其他实例与系统导航继续工作 |
| 真实画面 | 点击连接，通过远程屏幕使用触摸与旋钮 |
| 资源更新 | 原子替换已安装 bundle 后点击“重新加载程序”，重新选择新实例 |

表达式在目标客体的全局作用域运行，不能直接读取模块局部变量；可临时把待查状态
放到 `globalThis`。支持逐帧运行，**尚不支持源码行断点或 Chrome DevTools 协议**。
表达式沿用客体 50 ms 执行预算和 32 MiB JS 内存限制；整个屏幕服务仍受 256 MiB 硬上限保护。

开发者模式默认关闭，不跨服务重启保留。离开开发者标签页会关闭调试，连接中断
60 秒后自动关闭；关闭时取消高亮并恢复暂停实例。远程入口沿用网页登录认证，
不开放额外网络端口。最多保留 256 条／512 KiB 调试消息，单条 64 KiB，浏览器
控制台显示最近 200 条；超限会丢弃旧消息或超长消息。每个实例最多排队 16 条命令。

当前 CLI 提供 `init`、`check`、`build`。下面是代码迭代与 SSH 辅助排查流程：

1. 首次通过配套插件的 IPK 安装并启用主页，在屏幕设置中选择它。
2. 修改 TSX 后重新运行上面的 `check`、`build`；`check` 检查项目配置，`build`
   编译 TSX 并打包资源，不能替代独立的 TypeScript 类型检查。
3. 只改页面时，可以将新 JS、PAK 临时上传到设备 `/tmp`，再在已安装 bundle
   目录中用临时文件加 `mv` 原子替换。目录取自配套插件当前安装版本的 `data.bundle`；
   示例主页是 `/data/onekvm/apps/screen-sdk-example/0.1.0/screen-home`。
   不要原地截断正在使用的 PAK／字节码文件。清单、权限或后端有变化时重新安装插件包。
4. 全部资源替换完成后，在设备执行 `Refresh`，再到已登录网页的“远程屏幕”点击
   连接，验证绘制、触摸和旋钮。这个画面来自真实设备；设计器只预览布局元数据。

```sh
# 在设备上查看日志；console.log / warn / error 也会进入这里。
ssh root@<设备 IP> 'journalctl -fu onekvm-device-screen-display.service'

# 上传并原子替换资源后，通知重新发现页面与插件状态。
ssh root@<设备 IP> 'busctl --system call org.onekvm.ScreenDisplay /org/onekvm/ScreenDisplay org.onekvm.ScreenDisplay Refresh'

# 查询注册、版本故障与设置；重点查看 app_registration_errors 和 app_errors。
ssh root@<设备 IP> 'busctl --json=short call org.onekvm.ScreenDisplay /org/onekvm/ScreenDisplay org.onekvm.ScreenDisplay GetSettings'

# 检查整个屏幕服务的内存使用、上限和重启次数。
ssh root@<设备 IP> 'systemctl show onekvm-device-screen-display.service -p MemoryCurrent -p MemoryPeak -p MemoryHigh -p MemoryMax -p MemorySwapMax -p NRestarts'
```

可在事件回调或插件调用前后使用 `console.log`，并用 `try/catch` 记录 Promise
失败。不要在每一帧持续打印。更新后的资源会生成新版本标识，故障页面可重新运行；
正常资源更新无需重启 Core 或屏幕服务。整个屏幕服务从 192 MiB 开始回收内存，
256 MiB 为硬上限，不使用 swap；超限后只重启屏幕服务，未保存的客体状态会丢失。

## 状态、事件和插件调用

在组件 setup 中使用：

```tsx
const screen = useScreen();
const sensor = usePluginState<{ temperature: number }>("status");

const stop = screen.on("network", network => {
  console.log(network.ip);
});
screen.on("rotary", ({ step, confirm }) => {
  if (confirm) void refresh();
});

async function refresh() {
  try {
    await screen.plugin.invoke("refresh", { sensor: "rack" });
    await sensor.refresh();
  } catch (error) {
    // 在组件内呈现错误和重试入口。
  }
}
```

`screen.state`、`screen.context` 和 `screen.language` 是只读 computed ref。
`context` 包含实例 ID、主页／组件角色、局部尺寸、可见性、旋钮焦点与实例配置。
设备状态只开放网络、视频、HID、资源使用情况及基本型号／版本／运行时间，不含账号
和配置密钥。组件实例的 JS 状态和 RPC 通道相互独立。

| 事件 | 载荷 |
| --- | --- |
| `state` | 完整设备状态 |
| `network`、`video`、`hid`、`resources` | 发生变化的对应状态组 |
| `language` | 宿主语言，例如 `en`、`zh`、`zh_tw` |
| `config` | 当前实例的新配置 |
| `visibility`、`focus` | 布尔值 |
| `rotary` | `{step, confirm}`，旋转格数与短按 |
| `plugin-state` | `{generation}`，插件状态失效通知 |

`on()` 返回取消订阅函数，组件作用域销毁时也会自动清理。初始状态直接从 ref
读取，事件报告后续变化。`usePluginState(method, request)` 首次读取后，只在插件
通知、重新显示或手动 `refresh()` 时调用方法，返回只读 `state`、`busy`、`error`。
读取过程中收到的更新会合并，并在当前读取结束后补读；空闲时不轮询插件。

插件后端先保存状态，再调用：

```sh
busctl --system call org.onekvm.ScreenDisplay /org/onekvm/ScreenDisplay \
  org.onekvm.ScreenDisplay Refresh
```

这里提供可合并的**状态失效通知**，不保证逐条传送中间状态；需要记录每个业务事件
时，应由插件保存事件记录，再通过方法读取。通知也可能来自其他插件，因此状态方法
应只读取数据、不产生业务操作。

`screen.plugin.invoke<T>(method, json)` 返回 Promise；目标插件由宿主身份绑定，
调用方无需传插件 ID。`configure(settings)` 按插件 schema 保存部分配置。贡献项需
声明允许的方法与配置权限，例如：

```json
"permissions": {"rpc": [{"methods": ["status", "refresh"], "configure": true}]}
```

同一实例内的调用自动排队，回复必须匹配准确的请求 ID。权限拒绝、后端失败和超时
通过 Promise rejection 返回；请求最多 4096 个 UTF-8 字节。退出或销毁客体会取消
结果收集、丢弃迟到回复，但不会撤销后端已接受的写操作。

触摸目标使用 `<View focusable onPress={handler}>`。`onPress` 在松开时触发；拖出目标会取消点击。

## 布局与运行约定

- 完整主页使用 `screen-display.home`，组件使用 `screen-display.widget`，均为版本 1；
  可执行贡献声明 `bundle`、`runtime: pocketjs-vue-vapor`、`bridge_version: 2` 与
  `required_features: ["screen-surfaces-v1"]`。SDK 工具会自动生成。
- `layout_json.home` 选择主页，`home_settings` 提供主页实例配置。组件继续使用
  `home_widgets` 的位置、尺寸、图层，并可保存独立 `settings`；配置中不要保存密钥。
- 同一个组件可以放置多个实例，实例 ID 不同；一页最多运行八个可编程组件。
  绘制使用局部 `(0,0)` 坐标，宿主负责缩放、裁剪和透明叠加。
- Pro Desk 上旋转选择组件、短按进入交互、长按退出组件交互；继续旋转越过组件进入
  App 列表。完整主页接收旋转和短按，长按打开系统 App 列表。触摸坐标由宿主转换。
  App 导航和认证继续由系统处理，SDK 提供 `openApp(id)` 与 `openLauncher()`。
- `requestFrame(ms)` 安排一次延后绘制，范围 16–60000 毫秒；`animate(true)` 请求
  连续绘制，动画结束调用 `animate(false)`。状态通知和输入会自动唤醒屏幕。
- 后台与息屏时停止绘制。每个客体有 32 MiB JS 堆、1 MiB 栈、三秒启动限制；每次
  脚本执行最多 50 ms，同一帧的组件共享 100 ms 预算。故障版本暂停运行，更新代码或
  重启屏幕服务后可重试；主页失效时显示原设计器布局。
- 图片与字体随 bundle 打包。后端动态文字需要额外字形时，在 `src/glyphs.txt`
  中列出字符，由构建器加入字体图集。

公共类型见 [src/client.ts](src/client.ts)，SDK、扩展点、桥接协议分别版本化。
