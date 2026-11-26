import { computed, shallowRef } from "vue";
import { mount } from "@pocketjs/framework/vue-vapor";
import { View, Text, useScreen, usePluginState, COLOR } from "@onekvm/screen-sdk";

function Counter() {
  const screen = useScreen();
  const counter = usePluginState<{ count: number }>();
  const failed = shallowRef(false);
  const text = computed(() => failed.value || counter.error.value ? "!" : String(counter.state.value?.count ?? 0));
  async function increment() {
    try { await screen.plugin.invoke("increment"); failed.value = false; await counter.refresh(); }
    catch { failed.value = true; }
  }
  screen.on("rotary", event => { if (event.confirm) void increment(); });
  return <View focusable class="w-full h-full flex items-center justify-center" style={{ bgColor: COLOR.panel, radius: 6 }} onPress={() => { void increment(); }}>
    <Text class="text-base font-bold" style={{ textColor: COLOR.primary }}>{text.value}</Text>
  </View>;
}
mount(Counter);
