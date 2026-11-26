import { shallowRef } from "vue";
import type { HomeLayout } from "./homeLayout";

function metadata(layout: HomeLayout): string {
  const { widgets: _, ...appearance } = layout;
  return JSON.stringify(appearance);
}

// Keep the collection and its component instances stable during status polls.
// A CPU/IP/status update replaces only that widget's small render scope.
export function createHomeState(initial: HomeLayout) {
  const home = shallowRef(initial);
  const widgets = shallowRef(initial.widgets.map(widget => shallowRef(widget)));
  let appearance = metadata(initial);
  function update(next: HomeLayout) {
    const nextAppearance = metadata(next);
    const current = home.value;
    if (appearance !== nextAppearance || current.widgets.length !== next.widgets.length
      || current.widgets.some((widget, i) => widget.id !== next.widgets[i].id)) {
      appearance = nextAppearance;
      home.value = next;
      widgets.value = next.widgets.map(widget => shallowRef(widget));
      return;
    }
    for (let i = 0; i < next.widgets.length; i += 1) {
      if (JSON.stringify(current.widgets[i]) === JSON.stringify(next.widgets[i])) continue;
      current.widgets[i] = next.widgets[i];
      widgets.value[i].value = next.widgets[i];
    }
  }
  return { home, widgets, update };
}
