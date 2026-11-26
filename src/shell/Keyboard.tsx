import { shallowRef } from "vue";
import { Image, Text, View } from "@pocketjs/framework/vue-vapor/components";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { hitCap, keyboardMark, layoutKeys, maskSecret, releaseKey, slidePick, type KeyKind } from "./keypad";
import { device, screenSize } from "./device";
import { COLOR, FONT } from "./ui";

const KEY_BG = 0xff2a2a2a;

export default function Keyboard(props: {
  open: boolean;
  kind: KeyKind;
  mode: number;
  value: string;
  secret: boolean;
  /** Field name drawn above the typed text. */
  label?: string;
  /** Password is shown in full while this is set. */
  revealed?: boolean;
  revealLabel?: string;
  assets: { backspace: string; enter: string; space: string };
  focus: number;
  rotaryFocus: boolean;
  onFocus: (index: number) => void;
  onToken: (token: string) => void;
  onReveal?: () => void;
}) {
  const hot = shallowRef(-1);
  const picking = shallowRef(false);
  const pick = shallowRef(0);
  let held = false;

  let cachedKey = "";
  let cached = layoutKeys(props.kind, props.mode, screenSize());
  const board = () => {
    const scr = screenSize();
    const key = `${props.kind}:${props.mode}:${scr.w}x${scr.h}`;
    if (key !== cachedKey) {
      cachedKey = key;
      cached = layoutKeys(props.kind, props.mode, scr);
    }
    return cached;
  };
  const knob = () => device()?.get?.("knobOn") === "1";
  const compact = () => screenSize().h < 200;
  const mark = () => keyboardMark(hot.value, props.focus, knob() && props.rotaryFocus);
  const peekGen = shallowRef(0);
  let peekUntil = 0;
  let seenLen = 0;

  const eye = () => {
    const scr = screenSize();
    const lay = board();
    const w = compact() ? 40 : 48;
    const h = Math.max(16, lay.previewH - (compact() ? 18 : 8));
    return { x: scr.w - 6 - w, y: lay.top + (compact() ? 18 : 4), w, h };
  };
  const eyeOn = () => props.secret && knob() && props.rotaryFocus && props.focus >= board().caps.length;

  onFrame(() => {
    if (!props.open) {
      seenLen = 0;
      peekUntil = 0;
      return;
    }
    const live = props.secret && !props.revealed && Date.now() < peekUntil;
    const next = live ? 1 : 0;
    if (peekGen.value !== next) peekGen.value = next;
  });

  const shown = () => {
    const value = props.value || "";
    const chars = Array.from(value);
    const hide = props.secret && !props.revealed;
    if (hide && chars.length > seenLen) peekUntil = Date.now() + 700;
    if (!props.open) {
      seenLen = 0;
      peekUntil = 0;
    } else {
      seenLen = chars.length;
    }
    void peekGen.value;
    return maskSecret(value, !hide, Date.now(), peekUntil);
  };

  const clearHold = () => {
    held = false;
    picking.value = false;
    pick.value = 0;
    hot.value = -1;
  };

  const focusKey = (index: number) => {
    hot.value = index;
    // Keep the rotary anchor, but let the parent hide its cursor after touch.
    props.onFocus(index);
  };

  const reveal = () => {
    props.onFocus(board().caps.length);
    props.onReveal?.();
  };

  createGesture({
    longPressSeconds: 0.28,
    tapSlop: 18,
    region: {
      rect: () => {
        if (!props.open) return null;
        const scr = screenSize();
        const lay = board();
        return { x: 0, y: lay.top, w: scr.w, h: Math.max(1, scr.h - lay.top) };
      },
    },
    onDown(c) {
      if (!props.open) return;
      held = false;
      picking.value = false;
      focusKey(hitCap(board().caps, c.x, c.y));
    },
    onLongPress(c) {
      if (!props.open) return;
      const caps = board().caps;
      const index = hitCap(caps, c.x, c.y);
      focusKey(index);
      if (index < 0) return;
      held = true;
      const cap = caps[index];
      if (cap && cap.chars.length > 1) {
        picking.value = true;
        pick.value = 0;
      }
    },
    onMove(c) {
      if (!props.open || !held || !picking.value) return;
      const caps = board().caps;
      const cap = caps[hot.value];
      if (!cap || cap.chars.length <= 1) return;
      const step = Math.max(18, Math.floor(cap.w / cap.chars.length));
      pick.value = slidePick(c.x - c.startX, cap.chars.length, step);
    },
    onUp(c) {
      if (!props.open) {
        clearHold();
        return;
      }
      if (props.secret) {
        const box = eye();
        if (c.x >= box.x && c.x < box.x + box.w && c.y >= box.y && c.y < box.y + box.h) {
          clearHold();
          reveal();
          return;
        }
      }
      const caps = board().caps;
      const index = hot.value;
      const wasPicking = picking.value;
      const which = pick.value;
      clearHold();
      props.onFocus(index);
      const token = releaseKey(caps, index, c.x, c.y, wasPicking, which);
      if (token) props.onToken(token);
    },
    onCancel() {
      clearHold();
      props.onFocus(-1);
    },
  });

  return (
    <View
      class="absolute"
      style={{
        insetL: 0,
        insetT: props.open ? board().top : 0,
        width: screenSize().w,
        height: props.open ? Math.max(1, screenSize().h - board().top) : 0,
        bgColor: COLOR.zinc950,
        hitPass: props.open ? 0 : 1,
      }}
    >
      {props.open && `${props.kind}:${props.mode}`
        ? board().caps.map((cap) => (
            <View
              class="absolute"
              style={{
                insetL: cap.x,
                insetT: cap.ly,
                width: cap.w,
                height: cap.h,
                bgColor: KEY_BG,
                radius: 10,
                hitPass: 1,
              }}
            />
          ))
        : null}
      {props.open && `${props.kind}:${props.mode}:${hot.value}:${props.focus}:${knob() ? 1 : 0}:${mark()}` && mark() >= 0 && board().caps[mark()] ? (
        <View
          class="absolute"
          style={{
            insetL: board().caps[mark()].x,
            insetT: board().caps[mark()].ly,
            width: board().caps[mark()].w,
            height: board().caps[mark()].h,
            bgColor: COLOR.primary,
            radius: 10,
            hitPass: 1,
          }}
        />
      ) : null}
      {props.open && `${props.kind}:${props.mode}`
        ? board().caps.map((cap) => (
            <View
              class="absolute flex items-center justify-center"
              style={{
                insetL: cap.x,
                insetT: cap.ly,
                width: cap.w,
                height: cap.h,
                radius: 10,
              }}
            >
              {cap.icon === "backspace" ? (
                <Image class={compact() ? "w-4 h-4" : "w-6 h-6"} src={props.assets.backspace} />
              ) : cap.icon === "enter" ? (
                <Image class={compact() ? "w-4 h-4" : "w-6 h-6"} src={props.assets.enter} />
              ) : cap.icon === "space" ? (
                <Image class={compact() ? "w-8 h-4" : "w-10 h-5"} src={props.assets.space} />
              ) : (
                <Text
                  class={compact() ? "text-xs" : "text-base"}
                  style={{ fontSlot: compact() ? FONT.xs : FONT.base, textColor: COLOR.white }}
                >
                  {cap.label}
                </Text>
              )}
            </View>
          ))
        : null}
      {props.open ? (
        <View
          class="absolute"
          style={{
            insetL: 0,
            insetT: 0,
            width: screenSize().w,
            height: board().previewH,
            bgColor: COLOR.zinc950,
          }}
        >
          {props.label ? (
            <Text
              class="absolute text-xs"
              style={{
                insetL: 8,
                insetT: board().previewH >= 36 ? 2 : 4,
                insetR: props.secret ? eye().w + 10 : 8,
                height: 14,
                fontSlot: FONT.xs,
                textColor: COLOR.zinc400,
              }}
            >
              {props.label}
            </Text>
          ) : null}
          <Text
            class="absolute text-base"
            style={{
              insetL: 8,
              insetT: props.label && board().previewH >= 36 ? 16 : Math.max(0, Math.round((board().previewH - 20) / 2)),
              insetR: props.secret ? eye().w + 10 : 8,
              height: 20,
              fontSlot: FONT.base,
              textColor: COLOR.zinc100,
            }}
          >
            {shown()}
          </Text>
          {props.secret ? (
            <View
              class="absolute flex items-center justify-center rounded"
              style={{
                insetL: eye().x,
                insetT: eye().y - board().top,
                width: eye().w,
                height: eye().h,
                radius: 8,
                bgColor: eyeOn() || props.revealed ? COLOR.primary : KEY_BG,
              }}
              onPress={reveal}
            >
              <Text class="text-xs" style={{ fontSlot: FONT.xs, textColor: COLOR.white }}>
                {props.revealLabel || ""}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {props.open && `${picking.value ? 1 : 0}:${hot.value}:${pick.value}` && picking.value && hot.value >= 0 && (board().caps[hot.value]?.chars.length ?? 0) > 1 ? (
        <View
          class="absolute flex items-center justify-center"
          style={{
            insetL: board().caps[hot.value].x,
            insetT: board().caps[hot.value].ly,
            width: board().caps[hot.value].w,
            height: board().caps[hot.value].h,
            bgColor: COLOR.primary,
            radius: 10,
            hitPass: 1,
          }}
        >
          <Text
            class={compact() ? "text-xs" : "text-base"}
            style={{ fontSlot: compact() ? FONT.xs : FONT.base, textColor: COLOR.white }}
          >
            {board().caps[hot.value].chars[pick.value] || board().caps[hot.value].label}
          </Text>
        </View>
      ) : null}
      {props.open && `${hot.value}:${picking.value ? 1 : 0}:${pick.value}` && picking.value && hot.value >= 0 && (board().caps[hot.value]?.chars.length ?? 0) > 1
        ? board().caps[hot.value].chars.map((ch, index) => {
            const cap = board().caps[hot.value];
            const chip = 36;
            const gap = 4;
            const count = cap.chars.length;
            const width = count * chip + (count - 1) * gap;
            let x = Math.round(cap.x + cap.w / 2 - width / 2);
            const scrW = screenSize().w;
            if (x < 2) x = 2;
            if (x + width > scrW - 2) x = Math.max(2, scrW - 2 - width);
            return (
              <View
                class="absolute flex items-center justify-center"
                style={{
                  insetL: x + index * (chip + gap),
                  insetT: Math.max(0, cap.ly - chip - 4),
                  width: chip,
                  height: chip,
                  radius: 8,
                  bgColor: index === pick.value ? COLOR.primary : KEY_BG,
                  hitPass: 1,
                }}
              >
                <Text class="text-base" style={{ fontSlot: FONT.base, textColor: COLOR.white }}>
                  {ch}
                </Text>
              </View>
            );
          })
        : null}
    </View>
  );
}
