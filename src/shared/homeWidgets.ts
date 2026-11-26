export type HomeWidgetKind = 'text' | 'status' | 'line' | 'rect' | 'progress' | 'media' | 'external'
export type HomeStatusSource = 'eth' | 'hdmi' | 'hid' | 'wifi' | 'live'
export type HomeStatusStyle = 'text' | 'icon' | 'image'

export function homeStatusStyle(placement: { status_style?: unknown; status_active_image?: unknown; status_inactive_image?: unknown }): HomeStatusStyle {
  if (placement.status_style === 'icon' || placement.status_style === 'text' || placement.status_style === 'image') return placement.status_style
  return placement.status_active_image || placement.status_inactive_image ? 'image' : 'text'
}

// Widest panel: NanoKVM Pro Desk, 320 px in landscape.
export const MAX_HOME_WIDGET_WIDTH = 320
export const MAX_HOME_WIDGET_HEIGHT = 120

export function homeWidgetSize(kind: HomeWidgetKind, placement: { width?: number; height?: number }) {
  const defaultWidth = kind === 'media' ? 120 : kind === 'line' || kind === 'rect' ? 104 : kind === 'text' ? 126 : 64
  const defaultHeight = kind === 'media' ? 68 : kind === 'line' ? 2 : kind === 'status' || kind === 'rect' ? 28 : 24
  return {
    width: Math.max(2, Math.min(MAX_HOME_WIDGET_WIDTH, Number.isFinite(placement.width) ? placement.width! : defaultWidth)),
    height: Math.max(1, Math.min(MAX_HOME_WIDGET_HEIGHT, Number.isFinite(placement.height) ? placement.height! : defaultHeight)),
  }
}

export const BUILTIN_HOME_WIDGET_SOURCES = {
  text: 'screen-display/text',
  status: 'screen-display/status',
  line: 'screen-display/line',
  rect: 'screen-display/rect',
  progress: 'screen-display/progress',
  media: 'screen-display/media',
} as const

export interface HomeWidgetStatus {
  active: boolean
  sessionCount: number
  hdmiConnected: boolean
  ethernetConnected: boolean
  hidConnected: boolean
  wifiConnected: boolean
  codec: string
  fps: number
  resolution: string
  hostname: string
  ip: string
  primaryIp: string
  ipv4Addresses: string[]
  uptimeSeconds: number
  machine: string
  version: string
  processor: string
  kernel: string
  cpuPercent: number | null
  memoryUsed: number
  memoryTotal: number
  storageAvailable: number
  storageTotal: number
}

const EMPTY_STATUS: HomeWidgetStatus = {
  active: false,
  sessionCount: 0,
  hdmiConnected: false,
  ethernetConnected: false,
  hidConnected: false,
  wifiConnected: false,
  codec: '',
  fps: 0,
  resolution: '',
  hostname: '',
  ip: '',
  primaryIp: '',
  ipv4Addresses: [],
  uptimeSeconds: 0,
  machine: '',
  version: '',
  processor: '',
  kernel: '',
  cpuPercent: null,
  memoryUsed: 0,
  memoryTotal: 0,
  storageAvailable: 0,
  storageTotal: 0,
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function emptyHomeWidgetStatus(): HomeWidgetStatus {
  return { ...EMPTY_STATUS, ipv4Addresses: [] }
}

export function normalizeHomeWidgetStatus(value: unknown): HomeWidgetStatus {
  const root = object(value)
  const video = object(root.video)
  const network = object(root.network)
  const hid = object(root.hid)
  const system = object(root.system)
  const inputWidth = Math.max(0, Math.round(number(video.input_width)))
  const inputHeight = Math.max(0, Math.round(number(video.input_height)))
  const resolution = inputWidth > 0 && inputHeight > 0
    ? `${inputWidth}x${inputHeight}`
    : number(video.resolution) > 0 ? `${Math.round(number(video.resolution))}P` : ''
  const ip = string(network.ip)
  const ipv4Addresses = [ip, ...(Array.isArray(network.ipv4_addresses) ? network.ipv4_addresses : [])]
    .filter((address): address is string => typeof address === 'string' && address.length > 0)
    .filter((address, index, addresses) => addresses.indexOf(address) === index)
  const active = boolean(video.active)
  const cpuValue = number(system.cpu_percent, Number.NaN)

  return {
    active,
    sessionCount: Math.max(0, Math.floor(number(video.session_count))),
    hdmiConnected: boolean(video.hdmi_connected, active),
    ethernetConnected: boolean(network.ethernet_connected, Boolean(ip)),
    hidConnected: boolean(hid.connected),
    wifiConnected: boolean(network.wifi_connected),
    codec: string(video.codec),
    fps: Math.max(0, Math.round(number(video.actual_fps, number(video.fps)))),
    resolution,
    hostname: string(network.hostname),
    ip,
    primaryIp: ip,
    ipv4Addresses,
    uptimeSeconds: Math.max(0, Math.round(number(root.uptime_seconds))),
    machine: string(root.machine),
    version: string(root.version),
    processor: string(system.processor),
    kernel: string(system.kernel_version),
    cpuPercent: Number.isFinite(cpuValue) ? Math.max(0, Math.min(100, Math.round(cpuValue))) : null,
    memoryUsed: Math.max(0, number(system.memory_used_bytes)),
    memoryTotal: Math.max(0, number(system.memory_total_bytes)),
    storageAvailable: Math.max(0, number(system.storage_available_bytes)),
    storageTotal: Math.max(0, number(system.storage_total_bytes)),
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${Math.floor(bytes / 1024 ** 3)}G`
  if (bytes >= 1024 ** 2) return `${Math.floor(bytes / 1024 ** 2)}M`
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)}K`
  return `${Math.floor(bytes)}B`
}

function formatPercent(part: number, whole: number): string {
  return whole > 0 ? `${Math.floor(part * 100 / whole)}%` : '--'
}

function formatUptime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60)
  if (minutes >= 60)
    return `${Math.floor(minutes / 60)}H${String(minutes % 60).padStart(2, '0')}M`
  return `${minutes}M`
}

export function expandHomeWidgetTemplate(template: string, status: HomeWidgetStatus, now = new Date()): string {
  if (!template.includes('{')) return template
  const memoryFree = Math.max(0, status.memoryTotal - status.memoryUsed)
  const storageUsed = Math.max(0, status.storageTotal - status.storageAvailable)
  const cpu = status.cpuPercent
  const values: Record<string, string> = {
    ip: status.ip || '--',
    primary_ip: status.primaryIp || '--',
    hostname: status.hostname || '--',
    codec: status.codec ? status.codec.toUpperCase() : 'AUTO',
    fps: String(status.fps),
    resolution: status.resolution || 'AUTO',
    stream: status.active ? 'STREAM ACTIVE' : 'KVM READY',
    session_count: String(status.sessionCount),
    uptime: formatUptime(status.uptimeSeconds),
    machine: status.machine || '--',
    version: status.version || '--',
    processor: status.processor || '--',
    kernel: status.kernel || '--',
    cpu_used: cpu === null ? '--' : `${cpu}%`,
    cpu_free: cpu === null ? '--' : `${100 - cpu}%`,
    cpu_available: cpu === null ? '--' : `${100 - cpu}%`,
    cpu_percent: cpu === null ? '--' : `${cpu}%`,
    cpu_value: cpu === null ? '--' : String(cpu),
    video: `${status.resolution || (status.hdmiConnected ? 'HDMI CONNECTED' : 'NO SIGNAL')}${status.active && status.fps > 0 ? `  ${status.fps} FPS` : ''}`,
    date: `${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][now.getDay()]} ${now.getDate()}`,
    mem_used: status.memoryTotal > 0 ? formatBytes(status.memoryUsed) : '--',
    mem_free: status.memoryTotal > 0 ? formatBytes(memoryFree) : '--',
    mem_available: status.memoryTotal > 0 ? formatBytes(memoryFree) : '--',
    mem_percent: formatPercent(status.memoryUsed, status.memoryTotal),
    disk_used: status.storageTotal > 0 ? formatBytes(storageUsed) : '--',
    disk_free: status.storageTotal > 0 ? formatBytes(status.storageAvailable) : '--',
    disk_available: status.storageTotal > 0 ? formatBytes(status.storageAvailable) : '--',
    disk_percent: formatPercent(storageUsed, status.storageTotal),
  }
  return template.replace(/\{([a-z_]+)\}/g, (token, name: string) => values[name] ?? token)
}

export function homeMetricPercent(metric: string | undefined, status: HomeWidgetStatus): number {
  if (metric === 'memory') return status.memoryTotal > 0 ? Math.min(100, status.memoryUsed / status.memoryTotal * 100) : 0
  if (metric === 'storage') return status.storageTotal > 0 ? Math.min(100, (status.storageTotal - status.storageAvailable) / status.storageTotal * 100) : 0
  return status.cpuPercent ?? 0
}

export function homeStatusActive(source: HomeStatusSource, status: HomeWidgetStatus): boolean {
  if (source === 'eth') return status.ethernetConnected
  if (source === 'hdmi') return status.hdmiConnected
  if (source === 'hid') return status.hidConnected
  if (source === 'wifi') return status.wifiConnected
  return status.sessionCount > 0
}

export function builtinHomeWidgetKind(source: string): Exclude<HomeWidgetKind, 'external'> | undefined {
  for (const [kind, id] of Object.entries(BUILTIN_HOME_WIDGET_SOURCES)) {
    if (id === source) return kind as Exclude<HomeWidgetKind, 'external'>
  }
  return undefined
}
