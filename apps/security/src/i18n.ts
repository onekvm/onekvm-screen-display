import { shallowRef } from "vue";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { readLang, type Lang } from "../../../packages/screen-ui/src/i18n";

const en = {
  title: "Security", login: "Login protection", api: "API protection", proxy: "Reverse proxy", other: "Other protection", bans: "Blocked addresses",
  enabled: "Enabled", weak: "Block weak logins", failures: "Failed attempts", duration: "Block duration (s)", scope: "Block target", ipv4: "IPv4 prefix", ipv6: "IPv6 prefix",
  paths: "Invalid paths", window: "Window (s)", rate: "Requests / second", burst: "Burst limit", trusted: "Trusted proxies", header: "Client IP header",
  https: "Require HTTPS", origin: "Public origin", headers: "Security headers", frame: "Frame policy", referrer: "Referrer policy", hsts: "HSTS",
  hstsAge: "HSTS max age (s)", subdomains: "HSTS subdomains", disguise: "Server disguise", honeypot: "Honeypot", recovery: "Crash recovery",
  on: "On", off: "Off", ip: "Single IP", subnet: "Subnet", sameorigin: "Same origin", deny: "Deny", empty: "None",
  refresh: "Refresh", busy: "Working…", edit: "Edit", change: "Change", save: "Save", cancel: "Cancel", saved: "Saved", invalid: "Invalid value",
  failed: "Operation failed", timedOut: "Timed out; refresh", unavailable: "Core unavailable", denied: "Permission denied", retry: "Refresh to retry",
  add: "Block address", address: "Address / CIDR", reason: "Reason", unblock: "Unblock", back: "Back", expires: "Expires", never: "Permanent",
  addTitle: "New block", zero: "0 = permanent", listHint: "Comma-separated IP / CIDR", apiNeeded: "Requires API protection", readFailed: "Load failed",
};
type Key = keyof typeof en;
const packs: Record<Lang, Record<Key, string>> = { en, zh: {
  title: "安全", login: "登录保护", api: "API 防护", proxy: "反向代理", other: "其他保护", bans: "封禁地址",
  enabled: "启用", weak: "拦截弱登录组合", failures: "失败次数", duration: "封禁时长（秒）", scope: "封禁范围", ipv4: "IPv4 前缀", ipv6: "IPv6 前缀",
  paths: "无效路径数量", window: "统计窗口（秒）", rate: "每秒请求数", burst: "突发上限", trusted: "可信代理地址", header: "客户端 IP 头",
  https: "要求 HTTPS", origin: "公开访问地址", headers: "安全响应头", frame: "嵌入策略", referrer: "来源策略", hsts: "HSTS",
  hstsAge: "HSTS 时长（秒）", subdomains: "包含子域名", disguise: "服务伪装", honeypot: "蜜罐", recovery: "崩溃恢复",
  on: "开", off: "关", ip: "单个 IP", subnet: "子网", sameorigin: "仅同源", deny: "禁止", empty: "无",
  refresh: "刷新", busy: "处理中…", edit: "编辑", change: "切换", save: "保存", cancel: "取消", saved: "已保存", invalid: "数值或格式无效",
  failed: "操作失败", timedOut: "操作超时，请刷新", unavailable: "核心服务不可用", denied: "没有操作权限", retry: "请刷新后重试",
  add: "封禁地址", address: "地址／网段", reason: "原因", unblock: "解除封禁", back: "返回", expires: "到期", never: "永久",
  addTitle: "新增封禁", zero: "0 表示永久封禁", listHint: "IP 或网段用逗号分隔", apiNeeded: "需同时开启 API 防护", readFailed: "读取失败",
}, zh_tw: {
  title: "安全", login: "登入保護", api: "API 防護", proxy: "反向代理", other: "其他保護", bans: "封鎖位址",
  enabled: "啟用", weak: "攔截弱登入組合", failures: "失敗次數", duration: "封鎖時間（秒）", scope: "封鎖範圍", ipv4: "IPv4 前綴", ipv6: "IPv6 前綴",
  paths: "無效路徑數量", window: "統計區間（秒）", rate: "每秒請求數", burst: "突發上限", trusted: "可信代理位址", header: "用戶端 IP 標頭",
  https: "要求 HTTPS", origin: "公開存取位址", headers: "安全回應標頭", frame: "嵌入策略", referrer: "來源策略", hsts: "HSTS",
  hstsAge: "HSTS 時間（秒）", subdomains: "包含子網域", disguise: "服務偽裝", honeypot: "蜜罐", recovery: "當機復原",
  on: "開", off: "關", ip: "單一 IP", subnet: "子網路", sameorigin: "僅同源", deny: "禁止", empty: "無",
  refresh: "重新整理", busy: "處理中…", edit: "編輯", change: "切換", save: "儲存", cancel: "取消", saved: "已儲存", invalid: "數值或格式無效",
  failed: "操作失敗", timedOut: "操作逾時，請重試", unavailable: "核心服務無法使用", denied: "沒有操作權限", retry: "請重新整理後重試",
  add: "封鎖位址", address: "位址／網段", reason: "原因", unblock: "解除封鎖", back: "返回", expires: "到期", never: "永久",
  addTitle: "新增封鎖", zero: "0 表示永久封鎖", listHint: "IP 或網段以逗號分隔", apiNeeded: "需同時開啟 API 防護", readFailed: "讀取失敗",
} };
export function useStrings() {
  const language = shallowRef(readLang());
  onFrame(() => { language.value = readLang(); });
  return (key: string): string => packs[language.value][key as Key] || key;
}
export function errorMessage(error: string): Key {
  if (/timed?\s*out|timeout|NoReply/i.test(error)) return "timedOut";
  if (/denied|not permitted/i.test(error)) return "denied";
  if (/ServiceUnknown|NameHasNoOwner|UnknownMethod|bus.*connect/i.test(error)) return "unavailable";
  if (/invalid|must|range|prefix|requires|trusted|already|expiration|unsupported.*setting/i.test(error)) return "invalid";
  return "failed";
}
