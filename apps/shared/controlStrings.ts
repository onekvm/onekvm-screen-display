import { shallowRef } from "vue";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { readLang, type Lang } from "../../packages/screen-ui/src/i18n";

const en = {
  mediaTitle: "Virtual media", keyboardTitle: "Keyboard", iso: "CD-ROM", drive: "USB drive", local: "Local images", sources: "Extension paths",
  connected: "Connected", disconnected: "Disconnected", connect: "Connect USB", disconnect: "Disconnect USB", connection: "USB storage",
  mount: "Mount", eject: "Eject", mounted: "Mounted", empty: "Empty", folder: "Folder", unavailable: "Unavailable",
  connectAndMount: "Connect & mount", connectFailed: "USB connection failed; retry", mediaDisconnected: "USB disconnected; retry mount", mediaBusy: "Media busy; try again later",
  refresh: "Refresh", back: "Back", cancel: "Cancel", busy: "Working…", failed: "Failed; refresh to retry", timedOut: "Timed out; refresh", done: "Done",
  noImages: "No images", noSources: "No extension paths", truncated: "More files; use subfolders", parent: "Parent folder",
  text: "Type text", edit: "Edit", send: "Send", clear: "Clear", keys: "Common keys", shortcuts: "Shortcuts", locks: "Lock keys",
  num: "Num Lock", caps: "Caps Lock", scroll: "Scroll Lock", on: "On", off: "Off", unknown: "Unknown", textHint: "Text is sent to the controlled host",
};
type Key = keyof typeof en;
const packs: Record<Lang, Record<Key, string>> = { en, zh: {
  mediaTitle: "虚拟媒体", keyboardTitle: "键盘", iso: "虚拟光驱", drive: "虚拟 U 盘", local: "本地镜像", sources: "扩展路径",
  connected: "已连接", disconnected: "未连接", connect: "连接 USB", disconnect: "断开 USB", connection: "USB 存储",
  mount: "挂载", eject: "弹出", mounted: "已挂载", empty: "空", folder: "文件夹", unavailable: "不可用",
  connectAndMount: "连接并挂载", connectFailed: "USB 连接失败，请重试", mediaDisconnected: "USB 未连接，请重试挂载", mediaBusy: "媒体忙，请稍后重试",
  refresh: "刷新", back: "返回", cancel: "取消", busy: "处理中…", failed: "操作失败，请刷新重试", timedOut: "操作超时，请刷新", done: "已完成",
  noImages: "没有镜像", noSources: "没有扩展路径", truncated: "文件较多，请进入子目录", parent: "上级目录",
  text: "文本输入", edit: "编辑", send: "发送", clear: "清空", keys: "常用按键", shortcuts: "组合键", locks: "锁定键",
  num: "数字锁定", caps: "大写锁定", scroll: "滚动锁定", on: "开", off: "关", unknown: "未知", textHint: "文本将发送到被控机",
}, zh_tw: {
  mediaTitle: "虛擬媒體", keyboardTitle: "鍵盤", iso: "虛擬光碟機", drive: "虛擬隨身碟", local: "本機映像", sources: "擴充路徑",
  connected: "已連線", disconnected: "未連線", connect: "連線 USB", disconnect: "中斷 USB", connection: "USB 儲存",
  mount: "掛載", eject: "退出", mounted: "已掛載", empty: "空", folder: "資料夾", unavailable: "無法使用",
  connectAndMount: "連線並掛載", connectFailed: "USB 連線失敗，請重試", mediaDisconnected: "USB 未連線，請重試掛載", mediaBusy: "媒體忙碌，請稍後重試",
  refresh: "重新整理", back: "返回", cancel: "取消", busy: "處理中…", failed: "操作失敗，請重新整理", timedOut: "操作逾時，請重新整理", done: "已完成",
  noImages: "沒有映像", noSources: "沒有擴充路徑", truncated: "檔案較多，請進入子目錄", parent: "上一層目錄",
  text: "文字輸入", edit: "編輯", send: "傳送", clear: "清空", keys: "常用按鍵", shortcuts: "組合鍵", locks: "鎖定鍵",
  num: "數字鎖定", caps: "大寫鎖定", scroll: "捲動鎖定", on: "開", off: "關", unknown: "未知", textHint: "文字將傳送到受控電腦",
} };
export function useControlStrings() {
  const language = shallowRef(readLang());
  onFrame(() => { language.value = readLang(); });
  return (key: string) => packs[language.value][key as Key] || key;
}
