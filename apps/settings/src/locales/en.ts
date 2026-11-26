export type Messages = {
  settings: string
  screen: string
  network: string
  hotspot: string
  hotspotName: string
  wifiBand: string
  wifiChannel: string
  dhcpStart: string
  dhcpEnd: string
  keepPassword: string
  enabled: string
  disabled: string
  automatic: string
  hotspotNameError: string
  hotspotPasswordError: string
  hotspotChannelError: string
  hotspotDhcpError: string
  appView: string
  appList: string
  appVisible: string
  appHidden: string
  moveUp: string
  moveDown: string
  regionTime: string
  about: string
  aboutOneKvm: string
  exportDiagnostics: string
  usbDebug: string
  restore: string
  rebootDevice: string
  factoryReset: string
  recoveryMode: string
  rebootWarning: string
  factoryResetWarning: string
  recoveryWarning: string
  recoveryWait: string
  recoveryHold: string
  recoveryLocked: string
  holdConfirm: string
  recoveryWorking: string
  recoveryFailed: string
  cancel: string
  appLock: string
  enablePin: string
  changePin: string
  disablePin: string
  pinDisabled: string
  lockTimeout: string
  seconds: string
  unlockApps: string
  currentPin: string
  newPin: string
  repeatPin: string
  pinLength: string
  pinWorking: string
  pinWait: string
  pinMismatch: string
  pinError: string
  back: string
  blank: string
  never: string
  s30: string
  m1: string
  m5: string
  custom: string
  wired: string
  wifiOk: string
  wifiDown: string
  wifiConnecting: string
  wifiFailed: string
  wifiCheckPassword: string
  wifiCheckSignal: string
  wifiBusy: string
  wifiPending: string
  wifiApOnly: string
  wifiService: string
  wifiWpa3Only: string
  scanning: string
  noNetworks: string
  scanFailed: string
  nowifi: string
  openNet: string
  password: string
  show: string
  hide: string
  dhcp: string
  staticAddr: string
  slaac: string
  address: string
  gateway: string
  prefix: string
  mask: string
  v4settings: string
  dns: string
  apply: string
  applying: string
  applied: string
  applyFailed: string
  networkSaving: string
  networkSaved: string
  confirm: string
  retry: string
  editNetwork: string
  networkAddressError: string
  networkGatewayError: string
  networkDnsError: string
  networkVlanError: string
  networkTimeout: string
  networkRetry: string
  nfs: string
  brightness: string
  rotate: string
  rotate0: string
  rotate90: string
  rotate180: string
  rotate270: string
  viewMode: string
  viewIcons: string
  viewList: string
  ethernet: string
  wifi: string
  ipAddress: string
  connected: string
  disconnected: string
  unavailable: string
  language: string
  timezone: string
  langEn: string
  langZh: string
  langZhTw: string
  deviceSpecs: string
  osSpecs: string
  deviceStatus: string
  processor: string
  memory: string
  storage: string
  variant: string
  edition: string
  version: string
  uptime: string
  kernel: string
  hdmiInput: string
  hid: string
  online: string
  uptimeDay: string
  uptimeHour: string
  uptimeMinute: string
  tzUTC: string
  tzShanghai: string
  tzHongKong: string
  tzTaipei: string
  tzTokyo: string
  tzSingapore: string
  tzSeoul: string
  tzLondon: string
  tzParis: string
  tzBerlin: string
  tzNewYork: string
  tzChicago: string
  tzDenver: string
  tzLosAngeles: string
  tzSydney: string
}

const messages: Messages = {
  settings: 'Settings',
  screen: 'Display',
  network: 'Network',
  hotspot: 'Hotspot (AP)',
  hotspotName: 'Name',
  wifiBand: 'Band',
  wifiChannel: 'Channel',
  dhcpStart: 'Pool start',
  dhcpEnd: 'Pool end',
  keepPassword: 'Keep current',
  enabled: 'On',
  disabled: 'Off',
  automatic: 'Auto',
  hotspotNameError: 'Check hotspot name',
  hotspotPasswordError: 'Password: 8–63 characters',
  hotspotChannelError: 'Check band and channel',
  hotspotDhcpError: 'Check DHCP range',
  appView: 'App view',
  appList: 'App list',
  appVisible: 'Visible',
  appHidden: 'Hidden',
  moveUp: 'Move up',
  moveDown: 'Move down',
  regionTime: 'Region and time',
  about: 'About',
  aboutOneKvm: 'About OneKVM',
  exportDiagnostics: 'Export diagnostics',
  usbDebug: 'USB ADB debugging',
  restore: 'Restore',
  rebootDevice: 'Restart device',
  factoryReset: 'Factory reset',
  recoveryMode: 'Recovery mode',
  rebootWarning: 'Restarts this OneKVM. Connections will close.',
  factoryResetWarning: 'Erases all settings and data. Cannot be undone.',
  recoveryWarning: 'Restarts into Recovery. Connections will close.',
  recoveryWait: 'Please wait {n}s',
  recoveryHold: 'Hold for 2s to confirm',
  recoveryLocked: 'Please wait',
  holdConfirm: 'Hold to confirm',
  recoveryWorking: 'Request submitted…',
  recoveryFailed: 'Failed. Cancel and try again.',
  cancel: 'Cancel',
  appLock: 'App lock',
  enablePin: 'Set PIN',
  changePin: 'Change PIN',
  disablePin: 'Disable PIN',
  pinDisabled: 'Off',
  lockTimeout: 'Auto-lock',
  seconds: '{n}s',
  unlockApps: 'Enter PIN to open App list',
  currentPin: 'Current PIN',
  newPin: 'New PIN',
  repeatPin: 'Repeat PIN',
  pinLength: '4–8 digits · X cancels',
  pinWorking: 'Please wait…',
  pinWait: 'Try again in {n}s · X cancels',
  pinMismatch: 'PINs do not match',
  pinError: 'Failed. Check PIN and try again.',
  back: 'Back',
  blank: 'Screen off',
  never: 'Never',
  s30: '30s',
  m1: '1 min',
  m5: '5 min',
  custom: 'Custom',
  wired: 'Ethernet',
  wifiOk: 'Connected',
  wifiDown: 'Offline',
  wifiConnecting: 'Connecting',
  wifiFailed: 'Connection failed',
  wifiCheckPassword: 'Check password and retry',
  wifiCheckSignal: 'Check signal and retry',
  wifiBusy: 'Wi-Fi busy. Retry later',
  wifiPending: 'Confirm network on web',
  wifiApOnly: "Exit hotspot-only on web",
  wifiService: 'Wi-Fi down. Retry later',
  wifiWpa3Only: 'WPA3-only not supported',
  scanning: 'Scanning',
  noNetworks: 'No networks',
  scanFailed: 'Scan failed',
  nowifi: 'No Wi-Fi',
  openNet: 'Open',
  password: 'Password',
  show: 'Show',
  hide: 'Hide',
  dhcp: 'DHCP',
  staticAddr: 'Static',
  slaac: 'SLAAC',
  address: 'Address',
  gateway: 'Gateway',
  prefix: 'Prefix',
  mask: 'Mask',
  v4settings: 'IPv4 settings',
  dns: 'DNS',
  apply: 'Apply',
  applying: 'Applying…',
  applied: 'Applied',
  applyFailed: 'Apply failed',
  networkSaving: 'Saving network settings',
  networkSaved: 'Network settings saved',
  confirm: 'OK',
  retry: 'Retry',
  editNetwork: 'Edit',
  networkAddressError: 'Check IP and prefix',
  networkGatewayError: 'Check gateway',
  networkDnsError: 'Check DNS',
  networkVlanError: 'Check VLAN',
  networkTimeout: 'Apply timed out',
  networkRetry: 'Check settings and retry',
  nfs: "Can't change NFS network",
  brightness: 'Brightness',
  rotate: 'Rotate',
  rotate0: '0°',
  rotate90: '90°',
  rotate180: '180°',
  rotate270: '270°',
  viewMode: 'View',
  viewIcons: 'Icons',
  viewList: 'List',
  ethernet: 'Ethernet',
  wifi: 'Wi-Fi',
  ipAddress: 'IP',
  connected: 'Connected',
  disconnected: 'Offline',
  unavailable: 'N/A',
  language: 'Language',
  timezone: 'Timezone',
  langEn: 'English',
  langZh: '简体中文',
  langZhTw: '繁體中文',
  deviceSpecs: 'Device',
  osSpecs: 'System',
  deviceStatus: 'Status',
  processor: 'CPU',
  memory: 'Memory',
  storage: 'Storage',
  variant: 'Variant',
  edition: 'Edition',
  version: 'Version',
  uptime: 'Uptime',
  kernel: 'Kernel',
  hdmiInput: 'HDMI',
  hid: 'HID',
  online: 'Online',
  uptimeDay: '{n}d',
  uptimeHour: '{n}h',
  uptimeMinute: '{n}m',
  tzUTC: 'UTC',
  tzShanghai: 'Shanghai',
  tzHongKong: 'Hong Kong',
  tzTaipei: 'Taipei',
  tzTokyo: 'Tokyo',
  tzSingapore: 'Singapore',
  tzSeoul: 'Seoul',
  tzLondon: 'London',
  tzParis: 'Paris',
  tzBerlin: 'Berlin',
  tzNewYork: 'New York',
  tzChicago: 'Chicago',
  tzDenver: 'Denver',
  tzLosAngeles: 'Los Angeles',
  tzSydney: 'Sydney',
}

export default messages
