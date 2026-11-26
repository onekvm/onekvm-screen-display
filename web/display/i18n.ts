import en, { type Messages } from './locales/en'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'

export type MessageKey = keyof Messages

const packs: Record<string, Messages> = {
  en,
  'zh-cn': zhCN,
  zh: zhCN,
  'zh-tw': zhTW,
}

export function detectLocale() {
  const lang = typeof document === 'undefined' ? '' : document.documentElement.lang
  const normalized = String(lang || '').toLowerCase().replace(/_/g, '-')
  if (packs[normalized])
    return normalized
  const base = normalized.split('-')[0]
  if (base === 'zh')
    return normalized.includes('tw') || normalized.includes('hk') ? 'zh-tw' : 'zh-cn'
  return 'en'
}

export function translate(locale: string, key: MessageKey, values: Record<string, string | number> = {}) {
  const pack = packs[locale] || packs[locale.split('-')[0]] || en
  const template = pack[key] || en[key] || key
  return template.replace(/\{([^{}]+)\}/g, (placeholder, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder
  ))
}
