const messages = {
  zh: {
    "storage-unmounted": "数据分区未挂载\n无法保存初始化设置",
    "storage-read-only": "数据分区为只读\n请关机后检查存储卡",
    "storage-full": "数据分区空间不足\n请清理空间后重试",
    "storage-io": "存储读写失败\n请关机后检查存储卡",
    "storage-permission": "配置目录无写入权限\n无法保存初始化设置",
    "storage-write": "无法写入配置存储\n请检查存储状态",
    "boot-slot": "启动槽位信息异常\n请检查镜像与启动文件",
    "system-files": "系统文件缺失或无法读取\n请检查镜像完整性",
    "config-invalid": "系统配置文件无法解析\n请检查配置或导出诊断",
    "persistence-skipped": "持久化准备尚未执行\n请重启设备或导出诊断",
    "persistence-failed": "持久化准备失败\n请导出诊断以查看详情",
    "persistence-starting": "正在准备配置存储…\n完成后将自动继续",
    "core-starting": "核心服务正在启动…\n完成后将自动继续",
    "core-failed": "核心服务未能启动\n请导出诊断以查看详情",
    "core-unreachable": "连不上本机核心服务\n请稍后重试或导出诊断",
    "check-timeout": "启动检查未能及时完成\n请重试或导出诊断",
    "status-unavailable": "无法读取系统启动状态\n请重试或导出诊断",
    "api timeout": "本机服务响应超时\n请稍后重试",
    "region": "时间或时区设置失败\n请重试或导出诊断",
    "config-save": "账号设置未能保存\n请检查存储或导出诊断",
  },
  zh_tw: {
    "storage-unmounted": "資料分割區未掛載\n無法儲存初始化設定",
    "storage-read-only": "資料分割區為唯讀\n請關機後檢查儲存卡",
    "storage-full": "資料分割區空間不足\n請清理空間後重試",
    "storage-io": "儲存讀寫失敗\n請關機後檢查儲存卡",
    "storage-permission": "設定目錄無寫入權限\n無法儲存初始化設定",
    "storage-write": "無法寫入設定儲存\n請檢查儲存狀態",
    "boot-slot": "啟動槽位資訊異常\n請檢查映像與啟動檔案",
    "system-files": "系統檔案缺失或無法讀取\n請檢查映像完整性",
    "config-invalid": "系統設定檔無法解析\n請檢查設定或匯出診斷",
    "persistence-skipped": "持久化準備尚未執行\n請重啟裝置或匯出診斷",
    "persistence-failed": "持久化準備失敗\n請匯出診斷以查看詳情",
    "persistence-starting": "正在準備設定儲存…\n完成後將自動繼續",
    "core-starting": "核心服務正在啟動…\n完成後將自動繼續",
    "core-failed": "核心服務未能啟動\n請匯出診斷以查看詳情",
    "core-unreachable": "連不上本機核心服務\n請稍後重試或匯出診斷",
    "check-timeout": "啟動檢查未能及時完成\n請重試或匯出診斷",
    "status-unavailable": "無法讀取系統啟動狀態\n請重試或匯出診斷",
    "api timeout": "本機服務回應逾時\n請稍後重試",
    "region": "時間或時區設定失敗\n請重試或匯出診斷",
    "config-save": "帳號設定未能儲存\n請檢查儲存或匯出診斷",
  },
  en: {
    "storage-unmounted": "Data partition is not mounted.\nSetup cannot be saved.",
    "storage-read-only": "Data partition is read-only.\nPower off and check the card.",
    "storage-full": "Data partition is full.\nFree space and try again.",
    "storage-io": "Storage read/write failed.\nPower off and check the card.",
    "storage-permission": "Configuration is not writable.\nCheck directory permissions.",
    "storage-write": "Cannot write configuration.\nCheck the storage device.",
    "boot-slot": "Boot slot information is invalid.\nCheck the image and boot files.",
    "system-files": "System files are missing or unreadable.\nCheck the system image.",
    "config-invalid": "Configuration file is invalid.\nCheck it or export diagnostics.",
    "persistence-skipped": "Persistent storage setup was skipped.\nRestart or export diagnostics.",
    "persistence-failed": "Persistent storage setup failed.\nExport diagnostics for details.",
    "persistence-starting": "Preparing persistent storage…\nPlease wait.",
    "core-starting": "Core service is starting…\nPlease wait.",
    "core-failed": "Core service failed to start.\nExport diagnostics for details.",
    "core-unreachable": "Cannot reach the local Core service.\nRetry or export diagnostics.",
    "check-timeout": "Startup check did not finish in time.\nRetry or export diagnostics.",
    "status-unavailable": "Cannot read system startup status.\nRetry or export diagnostics.",
    "api timeout": "Local service response timed out.\nPlease try again.",
    "region": "Time or timezone setup failed.\nRetry or export diagnostics.",
    "config-save": "Account settings could not be saved.\nCheck storage or export diagnostics.",
  },
};
export function startupMessage(code: string, lang: string): string {
  const copy = lang === "zh" ? messages.zh : lang === "zh_tw" ? messages.zh_tw : messages.en;
  return copy[code as keyof typeof copy] || "";
}
/** Title, message and buttons of the startup dialog for a startup state and code. */
export function startupDialogCopy(lang: string, state: string, code: string) {
  const c = lang === "zh" ? { title: "设备尚未就绪", starting: "正在启动", checking: "正在检查启动状态…", retry: "重新检查", back: "返回" }
    : lang === "zh_tw" ? { title: "裝置尚未就緒", starting: "正在啟動", checking: "正在檢查啟動狀態…", retry: "重新檢查", back: "返回" }
    : { title: "Device is not ready", starting: "Starting device", checking: "Checking startup status…", retry: "Check again", back: "Back" };
  const waiting = state === "checking" || state === "starting";
  return {
    title: waiting ? c.starting : c.title,
    message: state === "checking" ? c.checking : startupMessage(code, lang),
    retry: c.retry,
    back: c.back,
  };
}
export function setupFailureCode(raw: string): string {
  const lower = raw.toLowerCase();
  if (raw.startsWith("startup:")) return raw.slice(8);
  if (lower.includes("connection refused") || raw === "api unreachable") return "core-unreachable";
  if (raw === "api timeout") return raw;
  if (lower.includes("read-only file system") || lower.includes("os error 30")) return "storage-read-only";
  if (lower.includes("no space left") || lower.includes("disk quota exceeded") || lower.includes("os error 28")) return "storage-full";
  if (lower.includes("input/output error") || lower.includes("os error 5)")) return "storage-io";
  if (lower.includes("apply region and time settings")) return "region";
  if (lower.includes("save authentication settings")) return "config-save";
  return "";
}
