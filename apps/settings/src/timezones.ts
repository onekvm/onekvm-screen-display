import { t, type Lang, type MessageKey } from './i18n'
import { TIMEZONE_IDS } from './timezone-ids'

const TZ_KEYS: Record<(typeof TIMEZONE_IDS)[number], MessageKey> = {
  UTC: 'tzUTC',
  'Asia/Shanghai': 'tzShanghai',
  'Asia/Hong_Kong': 'tzHongKong',
  'Asia/Taipei': 'tzTaipei',
  'Asia/Tokyo': 'tzTokyo',
  'Asia/Singapore': 'tzSingapore',
  'Asia/Seoul': 'tzSeoul',
  'Europe/London': 'tzLondon',
  'Europe/Paris': 'tzParis',
  'Europe/Berlin': 'tzBerlin',
  'America/New_York': 'tzNewYork',
  'America/Chicago': 'tzChicago',
  'America/Denver': 'tzDenver',
  'America/Los_Angeles': 'tzLosAngeles',
  'Australia/Sydney': 'tzSydney',
}

export const TIMEZONES: { id: string; key: MessageKey }[] = TIMEZONE_IDS.map((id) => ({
  id,
  key: TZ_KEYS[id],
}))

export function timezoneLabel(id: string, lang?: Lang): string {
  const found = TIMEZONES.find((zone) => zone.id === id)
  return found ? t(found.key, {}, lang) : id
}
