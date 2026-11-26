import DisplayPage from './DisplayPage.vue'
import pageStyles from './display.css?inline'
import devtoolsStyles from './devtools.css?inline'

declare global {
  interface Window {
    OneKVMPluginUI?: {
      v1: {
        icons: Record<string, unknown>
        register: (
          id: string,
          definition: { apiVersion: 1; component: unknown; styles?: string[] },
        ) => void
      }
    }
  }
}

window.OneKVMPluginUI!.v1.register('screen-display', {
  apiVersion: 1,
  component: DisplayPage,
  styles: [pageStyles, devtoolsStyles],
})
