export type ClockFormat = '12h' | '24h'

export function normalizeClockFormat(value: unknown): ClockFormat {
  return value === '24h' ? '24h' : '12h'
}

export function formatClockTime(hours: number, minutes: number, format: ClockFormat = '12h') {
  const hour = format === '12h' ? hours % 12 || 12 : hours
  return {
    hh: String(hour).padStart(2, '0'),
    mm: String(minutes).padStart(2, '0'),
    period: format === '12h' ? (hours < 12 ? 'AM' : 'PM') : '',
  }
}
