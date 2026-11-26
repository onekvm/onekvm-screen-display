import { device } from './device'
import en, { type Messages } from './locales/en'
import zh from './locales/zh'
import zhTw from './locales/zh_tw'

export type MessageKey = keyof Messages
export type Lang = 'en' | 'zh' | 'zh_tw'

const packs: Record<Lang, Messages> = {
  en,
  zh,
  zh_tw: zhTw,
}

export function normalizeLang(raw: string): Lang {
  const n = raw.trim().toLowerCase().replace(/-/g, '_')
  if (n === 'zh' || n === 'zh_cn') return 'zh'
  if (n === 'zh_tw') return 'zh_tw'
  return 'en'
}

export function readLang(): Lang {
  return normalizeLang(device()?.get?.('language') || '')
}

export function t(key: MessageKey, values: Record<string, string | number> = {}, lang = readLang()): string {
  const template = packs[lang][key] || en[key] || key
  return template.replace(/\{([^{}]+)\}/g, (placeholder, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder
  ))
}
