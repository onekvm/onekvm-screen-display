import { computed, onScopeDispose } from "vue";
import { getOps, registerTexture } from "@pocketjs/framework/vue-vapor";
import { Image, Text, View } from "@pocketjs/framework/vue-vapor/components";
import { authorizationLayout, authorizationURL, parseQrCode, qrTexture } from "../authorization";
import { device } from "../device";
import { useI18n, type MessageKey } from "../i18n";
import { COLOR, FONT } from "../theme";
import type { Authorization } from "../types";
import type { ActionItem } from "./ActionBar";
import { AppHeader } from "./AppHeader";

/** Complete pending device link, encoded once per change with a four-module quiet zone. */
export function AuthorizationCard(props: { authorization: Authorization; width: number; height: number;
  title: string; icon?: string; busy: boolean; message: MessageKey | "";
  actions: readonly ActionItem[]; selected: number; onAction(index: number): void; onBack(): void }) {
  const t = useI18n();
  let lastURL: string | undefined;
  let cached: ReturnType<typeof parseQrCode> = null;
  const qr = computed(() => {
    const url = authorizationURL(props.authorization.url);
    if (url !== lastURL) {
      lastURL = url;
      device()?.set?.("qrCode", url);
      cached = url ? parseQrCode(device()?.get?.("qrCode") || "") : null;
    }
    return cached;
  });
  const layout = computed(() => {
    const value = authorizationLayout(props.width, props.height, qr.value?.size || 21);
    // The native texture is 128px; reserve a stable text/action area on both panels.
    return { ...value, size: 128, x: value.landscape ? 10 : Math.round((props.width - 128) / 2),
      y: 40 };
  });
  let textureHandle = -1;
  let textureGeneration = 0;
  const texture = computed(() => {
    if (textureHandle >= 0) getOps().freeTexture?.(textureHandle);
    textureHandle = -1;
    const pixels = qr.value ? qrTexture(qr.value) : null;
    if (!pixels) return "";
    textureHandle = getOps().uploadTexture(pixels, 128, 128, 0); // PSM_5650
    if (textureHandle < 0) return "";
    const key = `authorization-qr:${++textureGeneration % 2}`;
    registerTexture(key, textureHandle);
    return key;
  });
  onScopeDispose(() => { if (textureHandle >= 0) getOps().freeTexture?.(textureHandle); });
  const available = computed(() => !!texture.value && layout.value.module >= 2);
  const textX = () => layout.value.landscape && available.value ? layout.value.x + layout.value.size + 12 : 12;
  const textY = () => layout.value.landscape ? 44 : layout.value.y + (available.value ? layout.value.size : 24);
  const userCode = computed(() => /^[A-Za-z0-9-]{1,64}$/.test(props.authorization.code || "") ? props.authorization.code! : "");
  const hostname = computed(() => authorizationURL(props.authorization.url).replace(/^https?:\/\//i, "").split(/[/?#]/)[0] || "");
  return <View class="relative" style={{ width: props.width, height: props.height }}>
    <View class="absolute" style={{ insetL: 0, insetT: 0, width: props.width, height: 40 }}>
      <AppHeader width={props.width} title={props.title} icon={props.icon}
        selected={props.selected === props.actions.length} onBack={props.onBack} />
    </View>
    {available.value ? <View class="absolute" style={{ insetL: layout.value.x, insetT: layout.value.y, width: layout.value.size, height: layout.value.size, bgColor: "#ffffff" }}>
      <Image src={texture.value} class="absolute" style={{ insetL: Math.floor((layout.value.size - 128) / 2), insetT: Math.floor((layout.value.size - 128) / 2), width: 128, height: 128 }} />
    </View> : null}
    <Text class="absolute text-sm font-bold" style={{ insetL: textX(), insetT: textY(), fontSlot: FONT.sm, textColor: props.message ? COLOR.danger : COLOR.white }}>{!layout.value.landscape && userCode.value && !props.message && !props.busy ? t("loginCode", { code: userCode.value }) : t(!layout.value.landscape && (props.message || props.busy) ? props.message || "busy" : available.value ? "scanLogin" : "openWebLogin")}</Text>
    {layout.value.landscape ? <Text class="absolute text-xs" style={{ insetL: textX(), insetT: textY() + 22, fontSlot: FONT.xs, textColor: props.message ? COLOR.danger : COLOR.warning }}>{t(props.message || (props.busy ? "busy" : "awaitingLogin"))}</Text> : null}
    {layout.value.landscape ? <Text class="absolute text-xs" style={{ insetL: textX(), insetT: textY() + 42, fontSlot: FONT.xs, textColor: COLOR.muted }}>{userCode.value ? t("loginCode", { code: userCode.value }) : hostname.value.slice(0, 22)}</Text> : null}
    <Text class="absolute text-xs" style={{ insetL: textX(), insetT: textY() + (layout.value.landscape ? 60 : 18), fontSlot: FONT.xs, textColor: COLOR.muted }}>{t("loginExpiryHint")}</Text>
    <View class="absolute flex flex-row items-center justify-center gap-2" style={{ insetL: layout.value.landscape ? textX() : 12, insetT: props.height - (layout.value.landscape ? 46 : 40), width: props.width - (layout.value.landscape ? textX() : 12) - 12, height: 40 }}>
      {props.actions.map((action, index) => <View key={action.id} class="flex items-center justify-center rounded-xl" focusable={!action.disabled} onPress={() => { if (!action.disabled) props.onAction(index); }}
        style={{ width: Math.floor((props.width - (layout.value.landscape ? textX() : 12) - 20) / props.actions.length), height: 36, bgColor: !action.disabled && index === props.selected ? COLOR.primary : COLOR.panel }}>
        <Text class="text-sm" style={{ fontSlot: FONT.sm, textColor: action.disabled ? COLOR.muted : COLOR.white }}>{action.label}</Text>
      </View>)}
    </View>
  </View>;
}
