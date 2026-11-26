import { shallowRef } from "vue";
import { Image, Text, View, type NodeMirror } from "@pocketjs/framework/vue-vapor/components";
import { animate, jump } from "@pocketjs/framework/vue-vapor/animation";
import { createGesture } from "@pocketjs/framework/vue-vapor/gesture";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { OptionDrawer } from "../../apps/settings/src/Options";
import { device, requestScrollTransition, screenSize, setHot } from "../shell/device";
import { WifiSetupFace, parseWifiSetup, type WifiSetup } from "../shell/WifiSetupFace";
import Keyboard from "../shell/Keyboard";
import { FeedbackModal } from "../shell/FeedbackModal";
import { StartupDialog, useStartupHealth } from "./StartupDialog";
import { AdbDialog, useAdbDebug } from "./AdbDialog";
import { DiagnosticsDialog, DiagnosticsTapSequence, type DiagnosticsState } from "./DiagnosticsDialog";
import { drawerRow, knobRow, ListRow } from "../shell/ListRow";
import { applyToken, backspace, layoutKeys, moveFocus, type KeyKind } from "../shell/keypad";
import { COLOR, FONT } from "../shell/ui";
import { DRAWER_EXIT_MS } from "../shell/motion";
import {
  type NetAp,
  LIST_TOP,
  ROW_H,
  ROW_PITCH,
  BUTTON_LANGS,
  applyAllowed,
  authAllowed,
  buttonLangAt,
  authBody,
  commitValue,
  copy,
  decide,
  drawerOptions,
  explain,
  fieldLabel,
  listHeight,
  modeOptions,
  netBody,
  nextStep,
  normalizeLang,
  pageRows,
  panScroll,
  parseScan,
  prevStep,
  resolveLinks,
  revealScroll,
  STEPS,
  titleOf,
  tzFilterChrome,
  tzFilterOptions,
  welcomeContentWidth,
  welcomeFaceIndex,
  welcomeFaceProgress,
  welcomeKnobFace,
  welcomeHintLines,
  welcomeLayout,
  wifiBody,
  type Action,
  type Commit,
  type NetLink,
  type PageState,
  type Step,
} from "./flow";

function readLang(): string {
  return normalizeLang(device()?.get?.("language") || "en");
}

function LinkCard(props: { name: string; kind: string; ip: string; rowIndex: number; onPress: () => void }) {
  const line = props.ip ? `${props.kind}  ${props.ip}` : props.kind;
  return (
    <View
      class={
        props.rowIndex === knobRow.value
          ? "w-full flex flex-col justify-center px-3 rounded-xl bg-blue-500"
          : "w-full flex flex-col justify-center px-3 rounded-xl bg-zinc-800 active:bg-blue-500"
      }
      style={{ height: ROW_H }}
      focusable
      onPress={() => props.onPress()}
    >
      <Text
        class="text-base text-white"
        style={{ fontSlot: FONT.base, textColor: COLOR.white }}
      >
        {props.name}
      </Text>
      <Text
        class="text-sm text-zinc-400"
        style={{ fontSlot: FONT.sm, textColor: props.rowIndex === knobRow.value ? COLOR.white : COLOR.zinc400 }}
      >
        {line}
      </Text>
    </View>
  );
}

function SetupList(props: PageState & {
  focus: number; width: number; viewH: number; scroll: number;
  motion: boolean; interactive: boolean;
  onActivate: (index: number) => void; onScroll: (offset: number) => void;
}) {
  let sheet: NodeMirror | null = null;
  let shown = -1;
  let shownFocus = -1;
  const bindSheet = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (sheet && node == null) sheet = null;
      return;
    }
    if (sheet === node) return;
    sheet = node;
    shown = props.scroll;
    shownFocus = props.focus;
    jump(node, "translateY", -shown);
  };
  onFrame(() => {
    if (!sheet) return;
    const next = props.scroll;
    const selected = props.focus;
    if (next === shown && selected === shownFocus) return;
    const previous = shown;
    const selectionChanged = selected !== shownFocus;
    shown = next;
    shownFocus = selected;
    // Commit the real tree immediately, including coalesced multi-detents.
    // Touch pans stay direct; rotary motion and highlight fades use the same
    // complete-list compositor as Settings and the launcher.
    jump(sheet, "translateY", -next);
    if (props.motion && selectionChanged && sheet.parent) {
      requestScrollTransition(next >= previous ? 1 : -1, Math.abs(next - previous), {
        y: LIST_TOP + (props.step === "timezone" ? ROW_PITCH : 0),
        height: props.viewH,
      }, {
        node: sheet.id, parent: sheet.parent.id, offset: next,
        height: Math.max(props.viewH, rows().length * ROW_PITCH),
      });
    }
  });

  const rows = () => pageRows(props);
  createGesture({
    axis: "y",
    panSlop: 14,
    region: {
      rect: () => props.interactive ? {
        x: 0, y: LIST_TOP + (props.step === "timezone" ? ROW_PITCH : 0),
        w: props.width, h: props.viewH,
      } : null,
    },
    onDown() {
      const raw = device()?.get?.("appScrollPosition") || "";
      const [node, offset] = raw.split(":").map(Number);
      // The real tree already holds the rotary target; adopt the displayed
      // offset before direct touch manipulation so a mid-slide grab cannot
      // jump to that target. Ignore stale positions from a replaced sheet.
      if (sheet?.id === node && Number.isFinite(offset) && offset >= 0) {
        props.onScroll(panScroll(offset, 0, rows().length, props.viewH));
      }
    },
    onPanMove(c) {
      props.onScroll(panScroll(props.scroll, c.fdy, rows().length, props.viewH));
    },
  });
  // The row map reuses DOM when its length changes, so blank rows stayed
  // under the network cards. Replacing the sheet when the visible rows change
  // drops the previous step.
  const listKey = () =>
    rows()
      .map((row) => `${row.id}\t${row.label}\t${row.value || ""}\t${row.detail || ""}\t${(row.tags || []).join(",")}`)
      .join("\n");
  return (
    <View
      key={listKey()}
      nodeRef={bindSheet}
      class="absolute"
      style={{
        insetL: 0,
        insetT: 0,
        width: props.width,
        height: Math.max(props.viewH, rows().length * ROW_PITCH),
      }}
    >
      {rows().map((row, index) => (
        <View
          key={row.id}
          class="absolute"
          style={{
            insetL: 8,
            insetT: index * ROW_PITCH,
            width: Math.max(40, props.width - 16),
            height: ROW_H,
          }}
        >
          {row.id.startsWith("link:") ? (
            <LinkCard
              name={row.label}
              kind={row.value || ""}
              ip={row.detail || ""}
              rowIndex={index}
              onPress={() => props.onActivate(index)}
            />
          ) : (
            <ListRow
              title={row.label}
              value={row.value}
              tags={row.tags}
              icon={row.icon}
              rowIndex={index}
              onPress={() => props.onActivate(index)}
            />
          )}
        </View>
      ))}
    </View>
  );
}

function Spinner(props: { width: number; height: number; label: string }) {
  return <FeedbackModal width={props.width} height={props.height} title={props.label} busy />;
}

function Alert(props: { width: number; height: number; message: string; action: string; onClose: () => void }) {
  return (
    <FeedbackModal
      width={props.width}
      height={props.height}
      message={props.message}
      primary={{ label: props.action, onPress: props.onClose }}
      onBackdrop={props.onClose}
      warning
    />
  );
}

function isMirror(node: unknown): node is NodeMirror {
  return !!node && typeof (node as NodeMirror).id === "number";
}

const BUTTON_FADE_MS = 680;
const BUTTON_RISE = 8;
const FACE_SLIDE_MS = 280;

function Welcome(props: { width: number; height: number; ip: string; lang: string; onNext: () => void; onLogoPress: () => void }) {
  const setup = shallowRef<WifiSetup | null>(parseWifiSetup(device()?.get?.("wifiSetup") || ""));
  const page = shallowRef(0);
  const pages = () => (setup.value ? 2 : 1);
  const boxW = () => welcomeContentWidth(props.width, pages());
  const lay = () =>
    welcomeLayout(
      { w: boxW(), h: props.height },
      props.ip !== "",
      props.width > props.height ? "split" : "stack",
    );
  const lines = () => welcomeHintLines(props.lang, props.ip, boxW());
  const hint = () => lay().hint;
  const slotA = shallowRef(copy(BUTTON_LANGS[0]).onDevice);
  const slotB = shallowRef(copy(BUTTON_LANGS[1]).onDevice);
  let nodeA: NodeMirror | null = null;
  let nodeB: NodeMirror | null = null;
  let buttonStart = 0;
  let shown = 0;
  let front = 0;
  let moveUntil = 0;
  let face0: NodeMirror | null = null;
  let face1: NodeMirror | null = null;
  let ringNode: NodeMirror | null = null;
  let faceStart = 0;
  let faceOrigin = 0;
  let shownFace = 0;
  let facePoll = 0;
  let knobSeen = "";
  const bindFace0 = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (face0 && node == null) face0 = null;
      return;
    }
    face0 = node;
    if (shownFace !== 0) jump(node, "translateX", -boxW());
  };
  const bindFace1 = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (face1 && node == null) face1 = null;
      return;
    }
    face1 = node;
    if (shownFace !== 1) jump(node, "translateX", boxW());
  };
  const slideFaces = (next: number, dir: 1 | -1) => {
    if (next === shownFace) return;
    const incoming = next === 0 ? face0 : face1;
    const outgoing = shownFace === 0 ? face0 : face1;
    const width = boxW();
    if (incoming && outgoing && incoming !== outgoing) {
      jump(incoming, "translateX", dir * width);
      jump(outgoing, "translateX", 0);
      animate(incoming, "translateX", 0, { dur: FACE_SLIDE_MS, easing: "out" });
      animate(outgoing, "translateX", -dir * width, { dur: FACE_SLIDE_MS, easing: "out" });
      setHot(true);
    }
    shownFace = next;
    page.value = next;
  };
  const bindRing = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (ringNode && node == null) ringNode = null;
      return;
    }
    ringNode = node;
  };
  const bindA = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (nodeA && node == null) nodeA = null;
      return;
    }
    nodeA = node;
  };
  const bindB = (node: NodeMirror | null) => {
    if (!isMirror(node)) {
      if (nodeB && node == null) nodeB = null;
      return;
    }
    if (nodeB === node) return;
    nodeB = node;
    jump(node, "opacity", 0);
    jump(node, "translateY", BUTTON_RISE);
  };
  const clipW = () => Math.max(96, Math.min(140, boxW() - 80));
  onFrame(() => {
    const now = Date.now();
    if (facePoll++ % 8 === 0) {
      const nextSetup = parseWifiSetup(device()?.get?.("wifiSetup") || "");
      const had = !!setup.value;
      if (JSON.stringify(setup.value) !== JSON.stringify(nextSetup)) {
        setup.value = nextSetup;
        if (!had && nextSetup) {
          faceStart = now;
          faceOrigin = 0;
          shownFace = 0;
          page.value = 0;
          if (face0) jump(face0, "translateX", 0);
        }
        if (had && !nextSetup) {
          faceStart = now;
          faceOrigin = 0;
          shownFace = 0;
          page.value = 0;
          if (face0) jump(face0, "translateX", 0);
        }
      }
    }
    if (!faceStart) faceStart = now;
    const count = setup.value ? 2 : 1;
    const seq = device()?.get?.("knobSeq") || "0";
    if (seq !== knobSeen) {
      const first = knobSeen === "";
      knobSeen = seq;
      const delta = Number(device()?.get?.("knob") || "0");
      if (!first && delta && count > 1) {
        const dir: 1 | -1 = delta > 0 ? 1 : -1;
        const turned = welcomeKnobFace(shownFace, delta, count);
        faceOrigin = turned;
        faceStart = now;
        slideFaces(turned, dir);
      }
    }
    const nextFace = welcomeFaceIndex(faceOrigin, now - faceStart, count);
    if (nextFace !== shownFace) slideFaces(nextFace, 1);
    if (ringNode) {
      const left = 1 - welcomeFaceProgress(now - faceStart);
      jump(ringNode, "arcSweep", count > 1 ? Math.max(0, left * 360) : 360);
    }
    if (!buttonStart) buttonStart = now;
    const index = BUTTON_LANGS.indexOf(buttonLangAt(now - buttonStart));
    if (index < 0) return;
    const hidden = () => (front === 0 ? nodeB : nodeA);
    if (moveUntil && now >= moveUntil) {
      const upcoming = copy(BUTTON_LANGS[(shown + 1) % BUTTON_LANGS.length] || "zh").onDevice;
      if (front === 0) {
        if (slotB.value !== upcoming) slotB.value = upcoming;
      } else if (slotA.value !== upcoming) slotA.value = upcoming;
      moveUntil = 0;
    }
    if (!moveUntil) {
      const parked = hidden();
      if (parked) {
        jump(parked, "opacity", 0);
        jump(parked, "translateY", BUTTON_RISE);
      }
    }
    if (index !== shown && nodeA && nodeB && !moveUntil) {
      const outgoing = front === 0 ? nodeA : nodeB;
      const incoming = front === 0 ? nodeB : nodeA;
      const nextLabel = copy(BUTTON_LANGS[index] || "zh").onDevice;
      if (front === 0) {
        if (slotB.value !== nextLabel) slotB.value = nextLabel;
      } else if (slotA.value !== nextLabel) slotA.value = nextLabel;
      jump(incoming, "opacity", 0);
      jump(incoming, "translateY", BUTTON_RISE);
      animate(outgoing, "opacity", 0, { dur: BUTTON_FADE_MS, easing: "in-out" });
      animate(outgoing, "translateY", -BUTTON_RISE, { dur: BUTTON_FADE_MS, easing: "in-out" });
      animate(incoming, "opacity", 1, { dur: BUTTON_FADE_MS, easing: "in-out" });
      animate(incoming, "translateY", 0, { dur: BUTTON_FADE_MS, easing: "in-out" });
      shown = index;
      front = front === 0 ? 1 : 0;
      moveUntil = now + BUTTON_FADE_MS;
    }
  });
  const railTop = Math.max(8, Math.round((props.height - 44) / 2));
  const ap = () => setup.value;
  return (
    <View class="absolute overflow-hidden" style={{ insetL: 0, insetT: 0, width: props.width, height: props.height }}>
      <View
        key={setup.value ? "with-ap" : "solo"}
        class="absolute overflow-hidden"
        style={{
          insetL: 0,
          insetT: 0,
          width: boxW(),
          height: props.height,
        }}
      >
      <View
        nodeRef={bindFace0}
        class="absolute overflow-hidden"
        style={{ insetL: 0, insetT: 0, width: boxW(), height: props.height }}
      >
      <Image
        class="absolute"
        src="logo.png"
        focusable
        onPress={props.onLogoPress}
        style={{
          insetL: lay().logo.x,
          insetT: lay().logo.y,
          width: lay().logo.w,
          height: lay().logo.h,
        }}
      />
      {hint() && props.ip ? (
        <View
          class="absolute"
          style={{ insetL: hint()!.x, insetT: hint()!.y, width: hint()!.w, height: hint()!.h }}
        >
          {lines().map((line, index) => (
            <View
              class={
                hint()!.align === "start"
                  ? "absolute flex items-center justify-start"
                  : "absolute flex items-center justify-center"
              }
              style={{
                insetL: 0,
                insetT: index * hint()!.line,
                width: hint()!.w,
                height: hint()!.line,
              }}
            >
              <View
                class={
                  hint()!.align === "start"
                    ? "flex flex-row items-center justify-start gap-1"
                    : "flex flex-row items-center justify-center gap-1"
                }
              >
                <Image src="globe.png" style={{ width: 18, height: 18 }} />
                <Text class="text-sm" style={{ fontSlot: FONT.sm, textColor: COLOR.zinc100 }}>
                  {line}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      <View
        class="absolute flex flex-row items-center justify-center gap-2 bg-blue-500 active:bg-blue-300"
        style={{
          insetL: lay().next.x,
          insetT: lay().next.y,
          width: lay().next.w,
          height: lay().next.h,
          radius: lay().next.h / 2,
        }}
        focusable
        onPress={() => props.onNext()}
      >
        <View class="relative overflow-hidden" style={{ width: clipW(), height: 22 }}>
          <View
            nodeRef={bindA}
            class="absolute flex items-center justify-center"
            style={{ insetL: 0, insetT: 0, width: clipW(), height: 22 }}
          >
            <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
              {slotA.value}
            </Text>
          </View>
          <View
            nodeRef={bindB}
            class="absolute flex items-center justify-center"
            style={{ insetL: 0, insetT: 0, width: clipW(), height: 22 }}
          >
            <Text class="text-sm text-white" style={{ fontSlot: FONT.sm, textColor: COLOR.white }}>
              {slotB.value}
            </Text>
          </View>
        </View>
        <Image class="w-7 h-7" src="forward.png" />
      </View>
      </View>
      {setup.value ? (
      <View
        nodeRef={bindFace1}
        class="absolute overflow-hidden"
        style={{ insetL: 0, insetT: 0, width: boxW(), height: props.height }}
      >
        <WifiSetupFace setup={ap()!} lang={props.lang} width={boxW()} height={props.height} />
      </View>
      ) : null}
      </View>
      {setup.value ? (
      <View class="absolute" style={{ insetL: props.width - 28, insetT: 0, width: 28, height: props.height }}>
        <View
          class="absolute"
          style={{
            insetL: 5,
            insetT: railTop + page.value * 26,
            width: 18,
            height: 18,
            bgColor: 0xff5b5252,
            arcSweep: 360,
            arcWidth: 2,
          }}
        />
        <View
          nodeRef={bindRing}
          class="absolute"
          style={{
            insetL: 5,
            insetT: railTop + page.value * 26,
            width: 18,
            height: 18,
            bgColor: COLOR.primary,
            arcStart: 0,
            arcSweep: 360,
            arcWidth: 3,
          }}
        />
        <View
          class="absolute"
          style={{
            insetL: 11,
            insetT: railTop + 6,
            width: 6,
            height: 6,
            radius: 3,
            bgColor: page.value === 0 ? COLOR.primary : 0xff5b5252,
          }}
        />
        <View
          class="absolute"
          style={{
            insetL: 11,
            insetT: railTop + 32,
            width: 6,
            height: 6,
            radius: 3,
            bgColor: page.value === 1 ? COLOR.primary : 0xff5b5252,
          }}
        />
      </View>
      ) : null}
    </View>
  );
}

export default function Init() {
  const startup = useStartupHealth();
  const adb = useAdbDebug();
  const step = shallowRef<Step>("welcome");
  const lang = shallowRef(readLang());
  const tzFilter = shallowRef("all");
  const focus = shallowRef(0);
  const advanced = shallowRef(false);
  const wifiPage = shallowRef(false);
  const v4page = shallowRef(false);
  const v4 = shallowRef<"dhcp" | "static">("dhcp");
  const v6 = shallowRef<"slaac" | "static">("slaac");
  const wifiOn = shallowRef(false);
  const links = shallowRef<NetLink[]>([]);
  const nic = shallowRef("eth0");
  const aps = shallowRef<NetAp[]>([]);
  const username = shallowRef("admin");
  const pass1 = shallowRef("");
  const pass2 = shallowRef("");
  const v4addr = shallowRef("");
  const v4gw = shallowRef("");
  const dns = shallowRef("");
  const v6addr = shallowRef("");
  const v6pre = shallowRef("64");
  const v6gw = shallowRef("");
  const vlan = shallowRef("");
  const busy = shallowRef(false);
  const linking = shallowRef(false);
  let linkBody = "";
  let linkSawBusy = false;
  const error = shallowRef("");
  const diagnostics = shallowRef<DiagnosticsState | "">("");
  const diagnosticsError = shallowRef("");
  const diagnosticsFocus = shallowRef(1);
  const diagnosticsTaps = new DiagnosticsTapSequence();
  let diagnosticsPollAt = 0;
  const closeDiagnostics = () => {
    if (diagnostics.value !== "queued" && diagnostics.value !== "running") {
      diagnostics.value = "";
      adb.open();
    }
  };
  const startDiagnostics = () => {
    diagnostics.value = "queued";
    diagnosticsError.value = "";
    diagnosticsPollAt = Date.now() + 250;
    device()?.set?.("diagnosticsStart", "1");
    setHot(true);
  };
  const pressLogo = () => {
    if (!diagnostics.value && !adb.visible.value && diagnosticsTaps.press(Date.now())) {
      diagnostics.value = "confirm";
      diagnosticsFocus.value = 1;
      setHot(true);
    }
  };
  const nfsOn = shallowRef(false);
  const ip = shallowRef("");
  const iface = shallowRef("eth0");
  const wifiSsid = shallowRef("");
  const wifiIp = shallowRef("");
  const wifiGeneration = shallowRef("");
  const scrW = shallowRef(screenSize().w);
  const scrH = shallowRef(screenSize().h);
  const kb = shallowRef<KeyKind | "">("");
  const kbMode = shallowRef(0);
  const kbValue = shallowRef("");
  const kbSecret = shallowRef(false);
  const kbReveal = shallowRef(false);
  const kbFocus = shallowRef(0);
  const kbRotaryFocus = shallowRef(true);
  const kbMax = shallowRef(32);
  const kbTarget = shallowRef("");
  const listScroll = shallowRef(0);
  const drawer = shallowRef<"" | "v4" | "v6" | "tz">("");
  const drawerShown = shallowRef<"v4" | "v6" | "tz">("v4");
  const drawerCursor = shallowRef(-1);
  let pendingMode: { which: "v4" | "v6" | "tz"; id: string } | null = null;
  let pendingUntil = 0;
  let knobSeq = "";
  let sawNetwork = false;
  let scanRaw = "";
  let linksSig = "";
  let scrollStep = "";
  let scrollFocus = -1;
  let pageStep = "";
  let pageDepth = 0;
  let networkRefreshAt = 0;
  let networkShown = false;
  let dismissedHost = "";
  let spinAt = 0;
  let networkApplying = false;
  let scrollKb = false;

  const state = (): PageState => ({
    step: step.value,
    lang: lang.value,
    tzFilter: tzFilter.value,
    advanced: advanced.value,
    wifiPage: wifiPage.value,
    v4page: v4page.value,
    v4: v4.value,
    v6: v6.value,
    wifi: wifiOn.value,
    links: links.value,
    iface: iface.value,
    ip: ip.value,
    wifiSsid: wifiSsid.value,
    wifiIp: wifiIp.value,
    wifiGeneration: wifiGeneration.value,
    aps: aps.value,
    username: username.value,
    pass1: pass1.value,
    pass2: pass2.value,
    v4addr: v4addr.value,
    v4gw: v4gw.value,
    dns: dns.value,
    v6addr: v6addr.value,
    v6prefix: v6pre.value,
    v6gw: v6gw.value,
    vlan: vlan.value,
    busy: busy.value,
  });

  const closeKb = () => {
    kb.value = "";
  };

  const dismissError = () => {
    dismissedHost = device()?.get?.("setupError") || error.value;
    error.value = "";
  };

  const beginWait = () => {
    if (spinAt === 0) spinAt = Date.now();
    busy.value = true;
    setHot(true);
  };

  const endWait = () => {
    spinAt = 0;
    busy.value = false;
    setHot(false);
  };

  const startWifi = (ssid: string, password: string) => {
    linkBody = wifiBody(ssid, password);
    linkSawBusy = false;
    linking.value = true;
    error.value = "";
    beginWait();
    device()?.set?.("wifiConnect", linkBody);
  };

  const openKb = (action: Extract<Action, { type: "keyboard" }>) => {
    drawer.value = "";
    kb.value = action.kind;
    kbTarget.value = action.target;
    kbSecret.value = action.secret;
    kbReveal.value = false;
    kbMax.value = action.max;
    kbValue.value = action.initial;
    kbMode.value = 0;
    kbFocus.value = 0;
    kbRotaryFocus.value = true;
  };

  const assignField = (key: string, value: string) => {
    if (key === "username") username.value = value;
    else if (key === "pass1") pass1.value = value;
    else if (key === "pass2") pass2.value = value;
    else if (key === "v4addr") v4addr.value = value;
    else if (key === "v4gw") v4gw.value = value;
    else if (key === "dns") dns.value = value;
    else if (key === "v6addr") v6addr.value = value;
    else if (key === "v6pre") v6pre.value = value;
    else if (key === "v6gw") v6gw.value = value;
    else if (key === "vlan") vlan.value = value;
  };

  const submitAuth = (password: string) => {
    if (busy.value) return;
    if (startup.status.value.code) { startup.show(); return; }
    beginWait();
    device()?.set?.(
      "authSetup",
      authBody(username.value, password, lang.value),
    );
  };

  const applyCommit = (target: string, value: string) => {
    if (target === "pass1") pass1.value = value;
    if (target === "pass2") pass2.value = value;
    const result: Commit = commitValue(target, value, pass1.value, v4addr.value);
    if (result.type === "error") {
      error.value = result.code;
      return;
    }
    error.value = "";
    if (result.type === "blank") {
      device()?.set?.("blankSeconds", String(result.seconds));
      step.value = "network";
      focus.value = 0;
      return;
    }
    if (result.type === "ask-pass") {
      openKb({
        type: "keyboard",
        kind: "text",
        target: `wifi:${result.ssid}`,
        secret: true,
        max: 64,
        initial: "",
      });
      return;
    }
    if (result.type === "wifi") {
      startWifi(result.ssid, result.password);
      return;
    }
    assignField(result.key, result.value);
  };

  const resetList = () => {
    focus.value = 0;
    listScroll.value = 0;
    scrollFocus = -1;
  };

  const pickMode = (id: string) => {
    const which = drawer.value;
    if (which !== "v4" && which !== "v6" && which !== "tz") return;
    pendingMode = { which, id };
    pendingUntil = Date.now() + DRAWER_EXIT_MS;
    drawer.value = "";
  };

  const openDrawer = (which: "v4" | "v6" | "tz") => {
    closeKb();
    const current = which === "tz" ? tzFilter.value : which === "v4" ? v4.value : v6.value;
    const index = drawerOptions(which, lang.value).findIndex((item) => item.id === current);
    drawerCursor.value = device()?.get?.("knobOn") === "1" ? Math.max(0, index) : -1;
    drawerShown.value = which;
    drawer.value = which;
  };

  const run = (action: Action) => {
    if (action.type === "language") {
      lang.value = action.id;
      device()?.set?.("language", action.id);
      step.value = "blank";
      focus.value = 0;
      error.value = "";
      return;
    }
    if (action.type === "timezone") {
      device()?.set?.("timezone", "UTC");
      step.value = "blank";
      focus.value = 0;
      error.value = "";
      return;
    }
    if (action.type === "blank") {
      device()?.set?.("blankSeconds", String(action.seconds));
      step.value = "network";
      focus.value = 0;
      error.value = "";
      return;
    }
    if (action.type === "keyboard") {
      openKb(action);
      return;
    }
    if (action.type === "config") {
      nic.value = action.name || nic.value || "eth0";
      advanced.value = true;
      wifiPage.value = false;
      v4page.value = false;
      drawer.value = "";
      closeKb();
      resetList();
      return;
    }
    if (action.type === "close-config") {
      advanced.value = false;
      v4page.value = false;
      drawer.value = "";
      closeKb();
      resetList();
      return;
    }
    if (action.type === "wifi-open") {
      nic.value = action.name || nic.value || "eth0";
      wifiPage.value = true;
      advanced.value = false;
      v4page.value = false;
      drawer.value = "";
      closeKb();
      resetList();
      return;
    }
    if (action.type === "close-wifi") {
      wifiPage.value = false;
      drawer.value = "";
      closeKb();
      resetList();
      return;
    }
    if (action.type === "v4-settings") {
      v4page.value = true;
      drawer.value = "";
      closeKb();
      resetList();
      return;
    }
    if (action.type === "close-v4") {
      v4page.value = false;
      drawer.value = "";
      closeKb();
      resetList();
      return;
    }
    if (action.type === "drawer") {
      openDrawer(action.which);
      return;
    }
    if (action.type === "wifi") {
      if (busy.value) return;
      startWifi(action.ssid, action.password);
      return;
    }
    if (action.type === "apply") {
      if (busy.value) return;
      const nfs = nfsOn.value || device()?.get?.("nfs") === "1";
      if (!applyAllowed(nfs)) {
        error.value = "nfs";
        return;
      }
      beginWait();
      networkApplying = true;
      device()?.set?.(
        "netApply",
        netBody({
          parent: nic.value || "eth0",
          vlan: vlan.value,
          v4: v4.value,
          v4addr: v4addr.value,
          v4gw: v4gw.value,
          v6: v6.value,
          v6addr: v6addr.value,
          v6prefix: v6pre.value,
          v6gw: v6gw.value,
          dns: dns.value,
        }),
      );
      error.value = "";
      return;
    }
    if (action.type === "next") {
      if (step.value === "network") {
        advanced.value = false;
        wifiPage.value = false;
        v4page.value = false;
      }
      step.value = nextStep(step.value);
      focus.value = 0;
      error.value = "";
      return;
    }
    if (action.type === "back") {
      const prev = prevStep(step.value);
      if (!prev) return;
      if (step.value === "timezone") tzFilter.value = "all";
      if (step.value === "network") {
        advanced.value = false;
        wifiPage.value = false;
        v4page.value = false;
      }
      step.value = prev;
      focus.value = 0;
      error.value = "";
      return;
    }
    if (action.type === "auth") {
      const gate = authAllowed(username.value, pass1.value, pass2.value);
      if (gate !== "ok") {
        error.value = gate;
        return;
      }
      submitAuth(pass1.value);
    }
  };

  const activateIndex = (index: number) => {
    const rows = pageRows(state());
    const row = rows[index];
    if (!row) return;
    focus.value = index;
    run(decide(state(), row.id));
  };

  const pressToken = (token: string) => {
    if (!kb.value) return;
    const applied = applyToken(kbValue.value, token, kbMax.value);
    if (applied.action === "mode") {
      if (kb.value === "text") {
        kbMode.value = (kbMode.value + 1) % 3;
        kbFocus.value = 0;
      }
      return;
    }
    if (applied.action === "cancel") {
      closeKb();
      return;
    }
    if (applied.action === "char") {
      kbValue.value = applied.value;
      return;
    }
    const value = applied.value;
    const target = kbTarget.value;
    closeKb();
    applyCommit(target, value);
  };

  const goBack = () => {
    if (busy.value) return;
    if (error.value) { dismissError(); return; }
    if (drawer.value) { drawer.value = ""; return; }
    if (kb.value) { closeKb(); return; }
    pendingMode = null;
    if (step.value === "network" && (v4page.value || wifiPage.value || advanced.value)) {
      if (v4page.value) v4page.value = false;
      else if (wifiPage.value) wifiPage.value = false;
      else advanced.value = false;
      resetList();
      return;
    }
    const prev = prevStep(step.value);
    if (!prev) return;
    if (step.value === "timezone") tzFilter.value = "all";
    step.value = prev;
    resetList();
  };

  const applyKnob = () => {
    const delta = Number(device()?.get?.("knob") || "0");
    const click = device()?.get?.("knobClick") === "1";
    const holds = Number(device()?.get?.("knobHoldN") || "0");
    if (!delta && !click && holds <= 0) return;
    if (adb.visible.value) {
      if (adb.busy()) return;
      if (holds > 0) { adb.close(); return; }
      if (delta && adb.state.value !== "off") adb.focus.value = moveFocus(adb.focus.value, delta, 2);
      if (click) { if (adb.state.value !== "off" && adb.focus.value === 0) adb.secondary(); else adb.primary(); }
      return;
    }
    if (startup.visible.value && !diagnostics.value) {
      if (startup.waiting()) return;
      if (holds > 0) { startup.close(); return; }
      if (delta) startup.focus.value = moveFocus(startup.focus.value, delta, 2);
      if (click) { if (startup.focus.value === 0) startup.close(); else startup.retry(); }
      return;
    }
    if (diagnostics.value) {
      if (diagnostics.value === "queued" || diagnostics.value === "running") return;
      if (holds > 0) { closeDiagnostics(); return; }
      if (delta && diagnostics.value !== "done") diagnosticsFocus.value = moveFocus(diagnosticsFocus.value, delta, 2);
      if (click) {
        if (diagnostics.value === "done" || diagnosticsFocus.value === 0) closeDiagnostics();
        else startDiagnostics();
      }
      return;
    }
    if (busy.value) return;
    if (error.value) {
      if (click || holds > 0) dismissError();
      return;
    }
    if (kb.value) {
      const caps = layoutKeys(kb.value, kbMode.value, { w: scrW.value, h: scrH.value }).caps;
      kbRotaryFocus.value = true;
      const slots = caps.length + (kbSecret.value ? 1 : 0);
      if (holds > 0) {
        kbValue.value = backspace(kbValue.value, holds);
        return;
      }
      if (click) {
        if (kbSecret.value && kbFocus.value >= caps.length) {
          kbReveal.value = !kbReveal.value;
          return;
        }
        const cap = caps[kbFocus.value];
        if (cap) pressToken(cap.token);
        return;
      }
      kbFocus.value = moveFocus(kbFocus.value, delta, slots);
      return;
    }
    if (drawer.value) {
      const opts = drawerOptions(drawer.value, lang.value);
      if (holds > 0) {
        drawer.value = "";
        return;
      }
      if (click) {
        const id = opts[drawerCursor.value]?.id;
        if (id) pickMode(id);
        return;
      }
      if (drawerCursor.value >= 0) {
        drawerCursor.value = moveFocus(drawerCursor.value, delta, opts.length);
      }
      return;
    }
    if (holds > 0) {
      goBack();
      return;
    }
    if (step.value === "welcome") {
      if (click) {
        step.value = nextStep(step.value);
        focus.value = 0;
        error.value = "";
      }
      return;
    }
    const rows = pageRows(state());
    if (click) {
      activateIndex(focus.value);
      return;
    }
    focus.value = moveFocus(focus.value, delta, rows.length);
  };

  const listBox = () => {
    const rows = pageRows(state()).length;
    const kbTop = kb.value ? layoutKeys(kb.value, kbMode.value, { w: scrW.value, h: scrH.value }).top : null;
    const listH = listHeight(scrH.value, kbTop);
    const pin = step.value === "timezone" ? ROW_PITCH : 0;
    return { rows, listH, viewH: Math.max(ROW_PITCH, listH - pin), pin };
  };

  createGesture({
    axis: "x",
    panSlop: 12,
    region: { rect: () => busy.value ? null : {
      x: 0, y: 0, w: kb.value ? 20 : scrW.value, h: scrH.value,
    } },
    onPanEnd(c) {
      if (c.dx >= 28 && c.dx > Math.abs(c.dy)) goBack();
    },
  });

  onFrame(() => {
    if (device()?.get?.("back") === "1") goBack();
    if (pendingMode && Date.now() >= pendingUntil) {
      const picked = pendingMode;
      pendingMode = null;
      if (picked.which === "v4" && (picked.id === "dhcp" || picked.id === "static")) {
        v4.value = picked.id;
        if (picked.id !== "static") v4page.value = false;
      }
      if (picked.which === "v6" && (picked.id === "slaac" || picked.id === "static")) v6.value = picked.id;
      if (picked.which === "tz" && tzFilterOptions(lang.value).some((item) => item.id === picked.id)) {
        tzFilter.value = picked.id;
        listScroll.value = 0;
        scrollFocus = -1;
        focus.value = 0;
      }
    }
    const seq = device()?.get?.("knobSeq") || "0";
    if (seq !== knobSeq) {
      const first = knobSeq === "";
      knobSeq = seq;
      if (!first) applyKnob();
    }
    const size = screenSize();
    if (size.w !== scrW.value) scrW.value = size.w;
    if (size.h !== scrH.value) scrH.value = size.h;
    startup.sync();
    adb.sync();
    const startupError = device()?.get?.("setupError") || "";
    if (startupError) startup.acceptError(startupError);
    if (step.value === "network" || step.value === "password") {
      const hostBusy = device()?.get?.("setupBusy") === "1";
      if (hostBusy) {
        spinAt = -1;
        busy.value = true;
      } else if (spinAt < 0 || (spinAt > 0 && Date.now() - spinAt > 800)) {
        endWait();
      }
      const hostErr = device()?.get?.("setupError") || "";
      if (hostErr && hostErr !== dismissedHost && !startup.acceptError(hostErr)) error.value = hostErr;
      else if (!hostErr) dismissedHost = "";
      if (networkApplying && !busy.value) {
        networkApplying = false;
        error.value = hostErr || "net-ok";
      }
      if (linking.value) {
        if (hostBusy) linkSawBusy = true;
        else if (linkSawBusy) {
          linking.value = false;
          linkSawBusy = false;
          error.value = hostErr || "wifi-ok";
          if (!hostErr) {
            let joined = "";
            try {
              joined = String((JSON.parse(linkBody) as { ssid?: string }).ssid || "");
            } catch {
              joined = "";
            }
            if (joined) {
              aps.value = aps.value.map((ap) => ({ ...ap, connected: ap.ssid === joined }));
            }
          }
        }
      }
    }
    if ((diagnostics.value === "queued" || diagnostics.value === "running") && Date.now() >= diagnosticsPollAt) {
      diagnosticsPollAt = Date.now() + 500;
      try {
        const status = JSON.parse(device()?.get?.("diagnosticsStatus") || "{}");
        if (["queued", "running", "done", "error"].includes(status.state)) {
          diagnostics.value = status.state;
          diagnosticsError.value = typeof status.error === "string" ? status.error : "";
          if (status.state === "done") diagnosticsFocus.value = 0;
        }
      } catch { /* Keep the current job visible until the next status update. */ }
    }
    if (step.value === "welcome") {
      const nextIp = device()?.get?.("ip") || "";
      if (nextIp !== ip.value) ip.value = nextIp;
    }
    if (step.value === "network") {
      // A rotary reveal must not repeatedly query Wi-Fi/system services.
      // Refresh live network data on entry and at most once per second.
      if (!kb.value && (!networkShown || (wifiPage.value && !sawNetwork) || Date.now() >= networkRefreshAt)) {
        networkRefreshAt = Date.now() + 1000;
        networkShown = true;
        wifiOn.value = device()?.get?.("wifi") === "1";
        nfsOn.value = device()?.get?.("nfs") === "1";
        ip.value = device()?.get?.("ip") || "";
        wifiSsid.value = device()?.get?.("wifiSsid") || "";
        wifiIp.value = device()?.get?.("wifiIp") || "";
        wifiGeneration.value = device()?.get?.("wifiGeneration") || "";
        const face = device()?.get?.("iface") || "";
        if (face) iface.value = face;
        const raw = device()?.get?.("links") || "";
        const next = resolveLinks(raw, wifiOn.value, iface.value);
        const sig = next.map((link) => `${link.kind}:${link.name}`).join(",");
        if (sig !== linksSig) {
          linksSig = sig;
          links.value = next;
        }
        if (wifiPage.value) {
          if (!sawNetwork) {
            sawNetwork = true;
            device()?.set?.("wifiScan", "1");
          }
          const scan = device()?.get?.("wifiScan") || "[]";
          if (scan !== scanRaw) {
            scanRaw = scan;
            aps.value = parseScan(scan);
          }
        }
      }
      if (!wifiPage.value) sawNetwork = false;
    } else {
      sawNetwork = false;
      networkShown = false;
    }
    const depth = step.value === "network" ? (v4page.value ? 2 : advanced.value || wifiPage.value ? 1 : 0) : 0;
    const pageKey = `${step.value}:${depth}:${wifiPage.value ? "wifi" : ""}`;
    if (pageStep && pageStep !== pageKey) {
      const from = STEPS.indexOf(pageStep.split(":")[0] as (typeof STEPS)[number]);
      const to = STEPS.indexOf(step.value);
      const dir = to === from ? (depth >= pageDepth ? 1 : -1) : (to >= from ? 1 : -1);
      device()?.set?.("appPageTransition", String(dir));
    }
    pageStep = pageKey;
    pageDepth = depth;
    if (pageKey !== scrollStep) {
      scrollStep = pageKey;
      listScroll.value = 0;
      scrollFocus = -1;
    }
    const kbNow = kb.value !== "";
    if (kbNow !== scrollKb) {
      scrollKb = kbNow;
      scrollFocus = -1;
    }
    const knob = device()?.get?.("knobOn") === "1";
    knobRow.value = knob && step.value !== "welcome" && !drawer.value && !kb.value ? focus.value : -1;
    drawerRow.value = knob && drawer.value ? drawerCursor.value : -1;
    if (focus.value !== scrollFocus) {
      const box = listBox();
      if (focus.value < box.rows) {
        listScroll.value = revealScroll(listScroll.value, focus.value, box.rows, box.viewH);
      }
      scrollFocus = focus.value;
    }
    // The host owns cached page/list/drawer motion. Only genuinely dynamic
    // welcome content, setup work and a pending drawer choice keep JS hot.
    setHot(step.value === "welcome" || busy.value || pendingMode !== null || (startup.visible.value && startup.waiting()) || (adb.visible.value && adb.busy()));
  });

  const goNext = () => {
    step.value = nextStep(step.value);
    focus.value = 0;
    error.value = "";
  };

  return (
    <View class="relative w-full h-full bg-black overflow-hidden">
      <View
        class="absolute overflow-hidden"
        style={{ insetL: 0, insetT: 0, width: scrW.value, height: scrH.value }}
      >
      {step.value === "welcome" ? (
        <Welcome width={scrW.value} height={scrH.value} ip={ip.value} lang={lang.value} onNext={goNext} onLogoPress={pressLogo} />
      ) : null}
      {step.value !== "welcome" ? (
      <Text
        class="absolute text-base"
        style={{
          insetL: 8,
          insetT: 4,
          insetR: 8,
          fontSlot: FONT.base,
          textColor: COLOR.zinc100,
        }}
      >
        {titleOf(
          step.value,
          lang.value,
          advanced.value,
          v4page.value,
          wifiPage.value,
          advanced.value || wifiPage.value ? nic.value : "",
        )}
      </Text>
      ) : null}
      {step.value === "timezone" ? (
      <View
        class="absolute"
        style={{
          insetL: 8,
          insetT: LIST_TOP,
          width: Math.max(40, scrW.value - 16),
          height: ROW_H,
        }}
      >
        <ListRow
          title={tzFilterChrome(lang.value, tzFilter.value).title}
          value={tzFilterChrome(lang.value, tzFilter.value).value}
          onPress={() => openDrawer("tz")}
        />
      </View>
      ) : null}
      {step.value !== "welcome" ? (
      <View
        class="absolute overflow-hidden"
        style={{
          insetL: 0,
          insetT: LIST_TOP + listBox().pin,
          width: scrW.value,
          height: listBox().viewH,
        }}
      >
        <SetupList
          step={step.value}
          lang={lang.value}
          tzFilter={tzFilter.value}
          advanced={advanced.value}
          wifiPage={wifiPage.value}
          v4page={v4page.value}
          v4={v4.value}
          v6={v6.value}
          wifi={wifiOn.value}
          links={links.value}
          iface={iface.value}
          ip={ip.value}
          wifiSsid={wifiSsid.value}
          wifiIp={wifiIp.value}
          wifiGeneration={wifiGeneration.value}
          aps={aps.value}
          username={username.value}
          pass1={pass1.value}
          pass2={pass2.value}
          v4addr={v4addr.value}
          v4gw={v4gw.value}
          dns={dns.value}
          v6addr={v6addr.value}
          v6prefix={v6pre.value}
          v6gw={v6gw.value}
          vlan={vlan.value}
          busy={busy.value}
          focus={focus.value}
          width={scrW.value}
          scroll={listScroll.value}
          motion={device()?.get?.("knobOn") === "1" && !kb.value && !drawer.value && !busy.value && !error.value}
          interactive={!drawer.value && !error.value && !busy.value}
          onScroll={(offset) => { listScroll.value = offset; }}
          onActivate={activateIndex}
          viewH={listBox().viewH}
        />
      </View>
      ) : null}
      </View>
      <Keyboard
        open={kb.value !== ""}
        assets={{ backspace: "backspace.png", enter: "enter.png", space: "space.png" }}
        kind={kb.value || "text"}
        mode={kbMode.value}
        value={kbValue.value}
        secret={kbSecret.value}
        label={fieldLabel(kbTarget.value, lang.value)}
        revealed={kbReveal.value}
        revealLabel={kbReveal.value ? copy(lang.value).hide : copy(lang.value).show}
        focus={kbFocus.value}
        rotaryFocus={kbRotaryFocus.value}
        onFocus={(index) => {
          if (index >= 0) kbFocus.value = index;
          kbRotaryFocus.value = false;
        }}
        onToken={pressToken}
        onReveal={() => {
          kbReveal.value = !kbReveal.value;
        }}
      />
      <OptionDrawer
        open={drawer.value !== ""}
        fit={drawerShown.value === "tz"}
        title={
          drawerShown.value === "tz"
            ? tzFilterChrome(lang.value, tzFilter.value).title
            : drawerShown.value === "v6"
              ? "IPv6"
              : "IPv4"
        }
        options={
          drawerShown.value === "tz"
            ? tzFilterOptions(lang.value)
            : modeOptions(drawerShown.value === "v6" ? "v6" : "v4", lang.value)
        }
        value={
          drawerShown.value === "tz" ? tzFilter.value : drawerShown.value === "v6" ? v6.value : v4.value
        }
        onPick={(id) => pickMode(id)}
        onClose={() => {
          drawer.value = "";
        }}
      />
      {error.value ? (
        <Alert
          width={scrW.value}
          height={scrH.value}
          message={explain(error.value, lang.value)}
          action={error.value === "wifi" ? copy(lang.value).retry : copy(lang.value).dismiss}
          onClose={() => {
            if (error.value === "wifi" && linkBody) {
              const again = linkBody;
              dismissError();
              linkBody = again;
              linkSawBusy = false;
              linking.value = true;
              beginWait();
              device()?.set?.("wifiConnect", again);
              return;
            }
            dismissError();
          }}
        />
      ) : null}
      {busy.value ? (
        <Spinner
          width={scrW.value}
          height={scrH.value}
          label={
            linking.value
              ? copy(lang.value).connecting
              : wifiPage.value && aps.value.length === 0
                ? copy(lang.value).scanning
                : copy(lang.value).wait
          }
        />
      ) : null}
      {startup.visible.value && !diagnostics.value && !adb.visible.value ? <StartupDialog
        width={scrW.value} height={scrH.value} lang={lang.value}
        code={startup.status.value.code} state={startup.status.value.state}
        rotary={device()?.get?.("knobOn") === "1"} focus={startup.focus.value}
        onRetry={startup.retry} onClose={startup.close}
      /> : null}
      {diagnostics.value ? <DiagnosticsDialog
        width={scrW.value} height={scrH.value} lang={lang.value}
        state={diagnostics.value} error={diagnosticsError.value}
        rotary={device()?.get?.("knobOn") === "1"} focus={diagnosticsFocus.value}
        onStart={startDiagnostics} onClose={closeDiagnostics}
      /> : null}
      {adb.visible.value ? <AdbDialog width={scrW.value} height={scrH.value} lang={lang.value}
        state={adb.state.value} rotary={device()?.get?.("knobOn") === "1"} focus={adb.focus.value}
        onPrimary={adb.primary} onSecondary={adb.secondary} onClose={adb.close} /> : null}
    </View>
  );
}
