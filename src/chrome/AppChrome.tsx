import { View } from "@pocketjs/framework/vue-vapor/components";
import { HintBar } from "./HintBar";
import { HomePill } from "./HomePill";
import { device } from "./device";

/** Screen-display App Shell: pill + hint, composited on every App. */
export default function AppChrome() {
  return (
    <View class="relative w-full h-full">
      {device()?.get?.("touchOn") === "1" ? <HomePill /> : null}
      <HintBar />
    </View>
  );
}
