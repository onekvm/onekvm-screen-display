import type { Messages } from "../i18n";

const zh: Messages = {
  noSignal: "无信号", turnZoom: "旋转缩放 {zoom}×", pressReset: "按下复位",
  noTouch: "此设备无触摸屏", webMouse: "请在网页端控制鼠标", disconnected: "未连接",
  left: "左键", right: "右键", speed: "速度",
  power: "电源控制", on: "开机", off: "关机", reset: "重启", back: "返回",
  poweredOn: "已开机", poweredOff: "已关机", hostPower: "受控主机电源", checkPower: "请检查电源控制",
  powerLed: "电源灯", hddLed: "HDD 灯", lit: "亮", unlit: "灭", active: "活动", idle: "空闲",
  loginCode: "授权码 {code}",
  loginExpiryHint: "5 分钟内扫码，过期重连",
  preparingLogin: "正在生成登录链接", awaitingLogin: "等待授权", connecting: "正在连接", loginTimedOut: "登录超时，请重试", loginExpired: "二维码已过期，请重试", loginFailed: "登录失败，请重试", scanLogin: "扫码绑定", openWebLogin: "请在网页端登录",
  cancel: "取消", connect: "连接", disconnect: "断开", connected: "已连接",
  wake: "唤醒", wakeTitle: "网络唤醒", wakeConfigured: "已配置唤醒设备", saveDevice: "请先在网页端保存设备",
  canWake: "可唤醒", unconfigured: "未配置", networks: "{n} 个网络",
  offline: "离线", online: "在线", ready: "已就绪", notReady: "未就绪",
  running: "运行中", notRunning: "未运行", busy: "处理中", failed: "操作失败，请重试", holdBack: "长按返回",
};

export default zh;
