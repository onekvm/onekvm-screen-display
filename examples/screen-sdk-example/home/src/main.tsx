import { computed, shallowRef } from "vue";
import { mount } from "@pocketjs/framework/vue-vapor";
import { View, Text, useScreen, usePluginState, FONT, COLOR } from "@onekvm/screen-sdk";

function Home() {
  const screen = useScreen();
  const counter = usePluginState<{ count: number }>();
  const failed = shallowRef(false);
  const label = computed(() => screen.language.value === "zh_tw" ? "按下或輕點計數" : screen.language.value.startsWith("zh") ? "按下或轻点计数" : "Press or tap to count");
  const address = computed(() => screen.state.value.network.ip || "Offline");
  const count = computed(() => failed.value || counter.error.value ? "!" : String(counter.state.value?.count ?? 0));
  async function increment() {
    try { await screen.plugin.invoke("increment"); failed.value = false; await counter.refresh(); }
    catch { failed.value = true; }
  }
  screen.on("rotary", event => { if (event.confirm) void increment(); });
  return <View focusable class="w-full h-full flex flex-col items-center justify-center" onPress={() => { void increment(); }} style={{ bgColor: COLOR.black }}>
    <Text class="text-xs" style={{ textColor: COLOR.muted }}>{address.value}</Text>
    <Text class="text-2xl font-bold" style={{ textColor: COLOR.primary }}>{count.value}</Text>
    <Text class="text-base" style={{ fontSlot: FONT.base, textColor: COLOR.zinc100 }}>{label.value}</Text>
  </View>;
}
mount(Home);
