import { View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { animate, jump } from "@pocketjs/framework/vue-vapor/animation";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import type { VNodeChild } from "vue";
import { appListAuthorized, device, requestShellPage, takePageSlide } from "./device";
import { animationFrames, PAGE_SLIDE_MS } from "./motion";


const COMMIT = 28;
const FLICK = 380;

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

function setHot(on: boolean) {
  device()?.set?.("hot", on ? "1" : "0");
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function PageContent(props: { index: number; renderPage: (index: number) => VNodeChild }) {
  return <>{props.renderPage(props.index)}</>;
}

export function ShellPager(props: {
  page: number;
  width: number;
  height: number;
  count: number;
  onPage: (page: number) => void;
  renderPage: (index: number) => VNodeChild;
  hostPager?: boolean;
  capture?: boolean;
}) {
  let strip: NodeMirror | null = null;
  let positionedStripId = -1;
  let current = props.page;
  let dragging = false;
  let snapFrames = 0;
  let wasCapture = false;

  const face = () => (props.width >= 64 ? props.width : 240);
  const last = () => Math.max(0, (props.count || 1) - 1);
  const minX = () => -last() * face();
  const host = () => !!props.hostPager;

  const bindStrip = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (strip && node == null) strip = null;
      return;
    }
    strip = node;
    // Vapor may deliver the same nodeRef again when the page prop changes.
    // Re-applying the target position here cancels the tween that was just
    // started for that update, so only initialise a genuinely new strip.
    if (positionedStripId === node.id) return;
    positionedStripId = node.id;
    jump(node, "translateX", -current * face());
  };

  const slideTo = (page: number) => {
    if (!strip) return;
    snapFrames = animationFrames(PAGE_SLIDE_MS);
    setHot(true);
    animate(strip, "translateX", -page * face(), { dur: PAGE_SLIDE_MS, easing: "out" });
  };

  const go = (next: number, animated = true) => {
    const page = clamp(next, 0, last());
    if (!requestShellPage(page)) return;
    current = page;
    props.onPage(page);
    // Native page caching distinguishes home from the launcher, not each
    // launcher subpage. Preserve that contract for page 2 and beyond.
    if (animated) slideTo(page);
    else if (strip) jump(strip, "translateX", -page * face());
  };

  createGesture({
    axis: "x",
    onPanStart() {
      if (host()) return;
      if (current === 0 && !appListAuthorized()) {
        requestShellPage(1);
        return;
      }
      dragging = true;
      setHot(true);
    },
    onPanMove(c) {
      if (host() || !dragging || !strip) return;
      jump(strip, "translateX", clamp(-current * face() + c.dx, minX(), 0));
    },
    onPanEnd(c) {
      if (host() || !dragging) return;
      dragging = false;
      let next = current;
      if (c.dx < -COMMIT || c.vx < -FLICK) next = current + 1;
      else if (c.dx > COMMIT || c.vx > FLICK) next = current - 1;
      else {
        const slide = current * face() - c.dx;
        next = Math.round(slide / face());
      }
      go(next);
    },
    onCancel() {
      if (host()) return;
      dragging = false;
      slideTo(current);
    },
  });

  onFrame(() => {
    // Cache preparation is rendering only. Never turn it into navigation or
    // let an in-flight guest tween overwrite a captured page.
    if (props.capture || wasCapture) {
      current = clamp(props.page, 0, last());
      dragging = false;
      snapFrames = 0;
      setHot(false);
      if (strip) jump(strip, "translateX", -current * face());
      wasCapture = !!props.capture;
      return;
    }
    if (current > last()) go(last(), false);
    if (snapFrames > 0) {
      snapFrames -= 1;
      if (dragging || snapFrames > 0) setHot(true);
      else setHot(false);
    }
    const slide = takePageSlide();
    if (slide === "cached") {
      dragging = false;
      snapFrames = 0;
      setHot(false);
      current = clamp(props.page, 0, last());
      if (strip) jump(strip, "translateX", -current * face());
      return;
    }
    if (dragging) return;
    if (props.page === current) return;
    current = clamp(props.page, 0, last());
    if (!strip) return;
    if (slide || !host()) {
      slideTo(current);
    } else {
      jump(strip, "translateX", -current * face());
    }
  });

  const count = Math.max(1, props.count);
  const pageW = face();
  const pageH = props.height >= 64 ? props.height : 240;
  return (
    <View class="relative w-full h-full overflow-hidden">
      <View nodeRef={bindStrip} style={{ width: pageW * count, height: pageH }}>
        {Array.from({ length: count }, (_, index) => (
          <View
            class="absolute"
            style={{ width: pageW, height: pageH, insetL: index * pageW, insetT: 0 }}
          >
            {props.hostPager && props.page !== index
              ? null
              : <PageContent index={index} renderPage={props.renderPage} />}
          </View>
        ))}
      </View>
    </View>
  );
}
