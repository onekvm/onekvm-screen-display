import type { Messages } from "../i18n";

const zhTw: Messages = {
  noSignal: "無訊號", turnZoom: "旋轉縮放 {zoom}×", pressReset: "按下重設",
  noTouch: "此裝置無觸控螢幕", webMouse: "請在網頁端控制滑鼠", disconnected: "未連線",
  left: "左鍵", right: "右鍵", speed: "速度",
  power: "電源控制", on: "開機", off: "關機", reset: "重啟", back: "返回",
  poweredOn: "已開機", poweredOff: "已關機", hostPower: "受控主機電源", checkAtx: "請檢查 ATX 介面",
  powerLed: "電源燈", hddLed: "HDD 燈", lit: "亮", unlit: "滅", active: "活動", idle: "閒置",
  loginCode: "授權碼 {code}",
  loginExpiryHint: "5 分鐘內掃碼，過期重連",
  preparingLogin: "正在產生登入連結", awaitingLogin: "等待授權", connecting: "正在連線", loginTimedOut: "登入逾時，請重試", loginExpired: "QR 碼已過期，請重試", loginFailed: "登入失敗，請重試", scanLogin: "掃碼綁定", openWebLogin: "請在網頁端登入",
  cancel: "取消", connect: "連線", disconnect: "中斷", connected: "已連線",
  wake: "喚醒", wakeTitle: "網路喚醒", wakeConfigured: "已設定喚醒裝置", saveDevice: "請先在網頁端儲存裝置",
  canWake: "可喚醒", unconfigured: "未設定", networks: "{n} 個網路",
  offline: "離線", online: "線上", ready: "已就緒", notReady: "未就緒",
  running: "執行中", notRunning: "未執行", busy: "處理中", failed: "操作失敗，請重試", holdBack: "長按返回",
};

export default zhTw;
