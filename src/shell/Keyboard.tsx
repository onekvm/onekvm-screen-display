import { shallowRef } from "vue";
import { Image, Text, View } from "@pocketjs/framework/vue-vapor/components";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { caretX, HEADER_LABEL_H, HEADER_VALUE_H, hitCap, keyboardMark, keyHeader, layoutKeys, maskSecret, KEY_RADIUS, pickAt, pickBand, pickChips, releaseKey, tailFit, type KeyKind } from "./keypad";
import { device, screenSize } from "./device";
import { COLOR, FONT } from "./ui";

const KEY_BG = 0xff2a2a2a;
const LABEL_H = HEADER_LABEL_H;
const VALUE_H = HEADER_VALUE_H;

function measureBase(text: string): number {
  const ui = (globalThis as { ui?: { measureText?: (text: string, slot: number) => number } }).ui;
  const width = ui?.measureText?.(text, FONT.base);
  return typeof width === "number" && width > 0 ? width : Array.from(text).length * 10;
}

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

  /** Field name, typed line and show button, clear of rounded panel corners. */
  const header = () => keyHeader(board(), screenSize(), !!props.label, props.secret);
  const eye = () => header().button;
  const band = () => {
    const cap = board().caps[hot.value];
    return cap ? pickBand(pickChips(cap, board(), screenSize()), board(), screenSize()) : { x: 0, y: 0, w: 0, h: 0 };
  };
  const head = () => header();
  const headX = () => header().x;
  const headRight = () => header().right;
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
    const text = maskSecret(value, !hide, Date.now(), peekUntil);
    return tailFit(text, screenSize().w - headX() - headRight(), measureBase);
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
        pick.value = pickAt(cap, board(), screenSize(), c.x);
      }
    },
    onMove(c) {
      if (!props.open || !held || !picking.value) return;
      const caps = board().caps;
      const cap = caps[hot.value];
      if (!cap || cap.chars.length <= 1) return;
      pick.value = pickAt(cap, board(), screenSize(), c.x);
    },
    onUp(c) {
      if (!props.open) {
        clearHold();
        return;
      }
      // A held group types the chip under the finger, even over the show button.
      if (props.secret && !picking.value) {
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
      const cap = caps[index];
      const which = wasPicking && cap ? pickAt(cap, board(), screenSize(), c.x) : pick.value;
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
                radius: KEY_RADIUS,
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
            radius: KEY_RADIUS,
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
                radius: KEY_RADIUS,
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
                insetL: headX(),
                insetT: head().label,
                insetR: headRight(),
                height: LABEL_H,
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
              insetL: headX(),
              insetT: head().value,
              insetR: headRight(),
              height: VALUE_H,
              fontSlot: FONT.base,
              textColor: COLOR.zinc100,
            }}
          >
            {shown()}
          </Text>
          <View
            class="absolute"
            style={{
              insetL: caretX(header(), screenSize(), measureBase(shown())),
              insetT: head().value + 1,
              width: 2,
              height: VALUE_H - 2,
              bgColor: COLOR.primary,
              hitPass: 1,
            }}
          />
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
            radius: KEY_RADIUS,
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
      {props.open && `${hot.value}:${picking.value ? 1 : 0}` && picking.value && hot.value >= 0 && (board().caps[hot.value]?.chars.length ?? 0) > 1 ? (
        <View
          class="absolute"
          style={{
            insetL: band().x,
            insetT: band().y,
            width: band().w,
            height: band().h,
            radius: 12,
            bgColor: COLOR.zinc950,
            hitPass: 1,
          }}
        />
      ) : null}
      {props.open && `${hot.value}:${picking.value ? 1 : 0}:${pick.value}` && picking.value && hot.value >= 0 && (board().caps[hot.value]?.chars.length ?? 0) > 1
        ? board().caps[hot.value].chars.map((ch, index) => {
            const chip = pickChips(board().caps[hot.value], board(), screenSize())[index];
            return (
              <View
                class="absolute flex items-center justify-center"
                style={{
                  insetL: chip.x,
                  insetT: chip.y,
                  width: chip.size,
                  height: chip.size,
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
