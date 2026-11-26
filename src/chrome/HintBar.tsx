import { shallowRef } from "vue";
import { Text, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { animate, jump } from "@pocketjs/framework/vue-vapor/animation";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { device, screenSize, setHot } from "./device";
import { COLOR } from "./ui";

const HOME_HINT_EN = "Swipe again for Home";
const HOME_HINT_ZH = "再滑一次返回首页";
const HOME_HINT_ZH_TW = "再滑一次返回首頁";

function homeHint(): string {
  const n = (device()?.get?.("language") || "").trim().toLowerCase().replace(/-/g, "_");
  if (n === "zh" || n === "zh_cn") return HOME_HINT_ZH;
  if (n === "zh_tw") return HOME_HINT_ZH_TW;
  return HOME_HINT_EN;
}
const FADE_MS = 180;

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

export function HintBar() {
  const text = shallowRef(homeHint());
  let bar: NodeMirror | null = null;
  let shown = false;
  let hideFrames = 0;
  let fadeFrames = 0;
  let wake = "";

  const bind = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (bar && node == null) bar = null;
      return;
    }
    bar = node;
    jump(node, "opacity", 0);
  };

  onFrame(() => {
    const nextWake = device()?.get?.("chromeWake") || "0";
    if (nextWake !== wake) {
      wake = nextWake;
      shown = false;
      hideFrames = 0;
      fadeFrames = 0;
      if (bar) jump(bar, "opacity", 0);
    }
    const next = device()?.get?.("hint") || "";
    if (next) {
      if (text.value !== next) text.value = next;
      if (!shown && bar) {
        shown = true;
        jump(bar, "opacity", 0);
        animate(bar, "opacity", 1, { dur: FADE_MS, easing: "out" });
        fadeFrames = 12;
        hideFrames = 0;
        setHot(true);
      }
      if (fadeFrames > 0) {
        fadeFrames -= 1;
        if (fadeFrames === 0) setHot(false);
      }
      return;
    }
    if (shown && hideFrames === 0 && bar) {
      animate(bar, "opacity", 0, { dur: FADE_MS, easing: "in" });
      hideFrames = 12;
      fadeFrames = 0;
      setHot(true);
      return;
    }
    if (hideFrames > 0) {
      hideFrames -= 1;
      if (hideFrames === 0) {
        shown = false;
        if (bar) jump(bar, "opacity", 0);
        setHot(false);
      }
    }
  });

  return (
    <View
      class="absolute flex items-center justify-center px-3 py-2 rounded-xl bg-zinc-800"
      style={{
        width: 208,
        height: 44,
        insetL: Math.round((screenSize().w - 208) / 2),
        insetT: screenSize().h - 60,
      }}
      nodeRef={bind}
    >
      <Text class="text-lg leading-6 text-white" style={{ textColor: COLOR.white }}>
        {text.value}
      </Text>
    </View>
  );
}
