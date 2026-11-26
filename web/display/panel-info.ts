import { parsePanel, type PageHost, type PanelInfo } from './types'

type PanelResult = { status: 'ready'; panel: PanelInfo; source: 'settings' | 'legacy' } | { status: 'unavailable' }

function panelFromJSON(raw: unknown): PanelInfo | null {
  if (typeof raw !== 'string') return null
  try {
    const value = JSON.parse(raw)
    if (!value || !Number.isFinite(value.width) || value.width <= 0
      || !Number.isFinite(value.height) || value.height <= 0)
      return null
    return parsePanel(raw)
  } catch {
    return null
  }
}

export async function readPanelInfo(host: PageHost): Promise<PanelResult> {
  const panel = panelFromJSON(host.extension.value.settings.panel_json)
  if (panel) return { status: 'ready', panel, source: 'settings' }

  const info = await host.invoke<{ ok?: boolean; error?: string }>('info')
  if (info?.ok === false && info.error === 'no framebuffer')
    return { status: 'unavailable' }

  const legacyPanel = info?.ok === true ? panelFromJSON(JSON.stringify(info)) : null
  if (!legacyPanel) throw new Error('Invalid screen information')
  return { status: 'ready', panel: legacyPanel, source: 'legacy' }
}
