import { shallowRef } from "vue";
import { CompositorSurface, Image, Text, View } from "@pocketjs/framework/vue-vapor/components";
import { onFrame } from "@pocketjs/framework/vue-vapor/lifecycle";
import { APP_TITLE_GLYPHS, launcherApps, parseRegisteredApps } from "../apps/registry";
import { AppPage, ScrollableAppList } from "./AppLauncher";
import { HintBar } from "../chrome/HintBar";
import { nowParts } from "./clock";
import { device, requestPageSlide, requestShellPage, screenSize } from "./device";
import { HomeFace } from "./HomeFace";
import { readHomeLayout } from "./homeLayout";
import { createHomeState } from "./homeState";
import { knobRow } from "./ListRow";
import { ShellPager } from "./ShellPager";
import {
  launcherAppPages,
  launcherPageSize,
  parseLauncher,
  type AppView,
  type ScreenApp,
} from "./types";
import { INPUT_HOLD_FRAMES } from "./motion";

const HIGHLIGHT_FRAMES = INPUT_HOLD_FRAMES;

function readView(): AppView {
  return device()?.get?.("appView") === "icons" ? "icons" : "list";
}

function readLang(): string {
  const n = (device()?.get?.("language") || "").trim().toLowerCase().replace(/-/g, "_");
  if (n === "zh" || n === "zh_cn") return "zh";
  if (n === "zh_tw") return "zh_tw";
  return "en";
}

function hostPage(): number {
  const n = Number(device()?.get?.("shellPage") || "0");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function setHot(on: boolean) {
  device()?.set?.("hot", on ? "1" : "0");
}

function readHomeUnderlay(): boolean {
  return device()?.get?.("backgroundImage") === "1" || device()?.get?.("widgetMedia") === "1";
}

export default function Shell() {
  const page = shallowRef(hostPage());
  const appView = shallowRef<AppView>(readView());
  const lang = shallowRef(readLang());
  const launching = shallowRef<ScreenApp | null>(null);
  const catalog = shallowRef(parseRegisteredApps(device()?.get?.("apps") || ""));
  const apps = shallowRef(launcherApps(catalog.value));
  const launcher = shallowRef(parseLauncher(device()?.get?.("launcher") || ""));
  const { home, widgets: homeWidgets, update: updateHome } = createHomeState(readHomeLayout());
  const clock = shallowRef(nowParts(lang.value, home.value.clockFormat));
  const hasUnderlay = shallowRef(readHomeUnderlay());
  const catalogGen = shallowRef(device()?.get?.("appsGen") || "1");
  const focus = shallowRef(-1);
  const capturePage = shallowRef(-1);
  const surfaceHome = shallowRef(device()?.get?.("surfaceHome") || "");
  const widgetFocus = shallowRef(-1);
  let knobSeq = "0";
  let hotFrames = 0;
  let homeUpdatedAt = 0;
  let homeSignature = JSON.stringify(home.value);

  const openApp = (app: ScreenApp) => {
    if (launching.value) return;
    setHot(true);
    launching.value = app;
    device()?.set?.("launch", app.id);
  };

  const scr = screenSize();
  const layout = () => {
    const next = { ...launcher.value };
    if (scr.h < 200) {
      next.iconRows = Math.min(next.iconRows, 2);
      next.listRows = Math.min(next.listRows, 2);
      next.iconSize = Math.min(next.iconSize, 56);
    }
    return next;
  };
  const listMode = () => appView.value === "list";
  const appPageCount = () => listMode() ? 1 : launcherAppPages(apps.value.length, false, layout());
  const hostPager = () => appPageCount() <= 1 && device()?.get?.("touchOn") === "1";
  const shownPage = () => capturePage.value < 0 ? page.value : capturePage.value === 0 ? 0 : Math.max(1, page.value);
  onFrame(() => {
    surfaceHome.value = device()?.get?.("surfaceHome") || "";
    const nextView = readView();
    const nextGen = device()?.get?.("appsGen") || "1";
    const catalogChanged = nextGen !== catalogGen.value || nextView !== appView.value;
    if (catalogChanged) {
      const selectedId = apps.value[focus.value]?.id;
      appView.value = nextView;
      catalogGen.value = nextGen;
      catalog.value = parseRegisteredApps(device()?.get?.("apps") || "");
      apps.value = launcherApps(catalog.value);
      launcher.value = parseLauncher(device()?.get?.("launcher") || "");
      const selected = selectedId ? apps.value.findIndex(app => app.id === selectedId) : -1;
      focus.value = selected >= 0 ? selected : Math.min(focus.value, apps.value.length - 1);
      if (page.value > 0) page.value = focus.value < 0 ? Math.min(page.value, appPageCount()) : listMode() ? 1 : 1 + Math.floor(focus.value / launcherPageSize(false, layout()));
      updateHome(readHomeLayout());
      hasUnderlay.value = readHomeUnderlay();
      homeSignature = JSON.stringify(home.value);
      const nextLang = readLang();
      if (nextLang !== lang.value) {
        lang.value = nextLang;
        clock.value = nowParts(nextLang, home.value.clockFormat);
      }
    }
    const rawCapture = device()?.get?.("shellCapturePage");
    capturePage.value = rawCapture === "0" ? 0 : rawCapture === "1" ? 1 : -1;
    if (capturePage.value >= 0) {
      knobRow.value = device()?.get?.("knobOn") === "1" ? focus.value : -1;
      return;
    }
    device()?.set?.("pager", hostPager() ? "1" : "0");
    if (launching.value && !device()?.get?.("launch")) {
      launching.value = null;
      setHot(false);
    }
    if (hotFrames > 0) {
      hotFrames -= 1;
    }
    // A native status/FPS notification requests one paint. Only active guest
    // motion should keep ticking afterwards; ShellPager renews its own tween.
    setHot(hotFrames > 0 || !!launching.value);
    const seq = device()?.get?.("knobSeq") || "0";
    let knobMoved = false;
    let confirm = false;
    if (seq !== knobSeq) {
      knobSeq = seq;
      if (seq !== "0") {
        let step = Number(device()?.get?.("knob") || "0");
        let click = device()?.get?.("knobClick") === "1";
        let hold = device()?.get?.("knobHold") === "1";
        const programmable = homeWidgets.value.filter(widget => widget.value.programmed);
        if (page.value === 0 && surfaceHome.value) {
          // The programmable home receives turn/click. Hold always opens the
          // system launcher, through the same app-lock check as every other path.
          step = hold ? 1 : 0; click = false; hold = false;
        } else if (page.value === 0 && device()?.get?.("surfaceFocus")) {
          if (hold) device()?.set?.("surfaceFocus", "");
          step = 0; click = false; hold = false;
        } else if (page.value === 0 && programmable.length) {
          if (hold) { widgetFocus.value = -1; hold = false; }
          if (step) {
            const next = Math.max(-1, widgetFocus.value + step);
            if (next < programmable.length) { widgetFocus.value = next; step = 0; }
            else { widgetFocus.value = -1; step = 1; }
          }
          if (click && widgetFocus.value >= 0) {
            device()?.set?.("surfaceFocus", programmable[widgetFocus.value]?.value.id || "");
            click = false;
          }
        }
        // The sequence can advance inside an App. After the host clears
        // that input on return, keep its requested launcher page.
        knobMoved = step !== 0 || click || hold;
        const count = apps.value.length;
        if (hold) focus.value = -1;
        else {
          if (step > 0 && count > 0) focus.value = Math.min(count - 1, focus.value + step);
          else if (step < 0) focus.value = Math.max(-1, focus.value + step);
          if (click) {
            if (focus.value >= 0 && focus.value < count) confirm = true;
            else if (count > 0) focus.value = 0;
          }
        }
        if (count <= 0) focus.value = -1;
        else if (focus.value >= count) focus.value = count - 1;
      }
    }
    const want = focus.value < 0
      ? 0
      : listMode()
        ? 1
        : 1 + Math.floor(focus.value / Math.max(1, launcherPageSize(false, layout())));
    const host = hostPage();
    // The host only tracks the home/app page group. In particular, returning
    // from an app selects cached home page 0 while the parked guest can still
    // be on launcher page 1 (or later). Keep the guest group in sync as well,
    // otherwise the home frame is displayed from cache but its clock callback
    // keeps taking the launcher-page early return forever.
    if (!knobMoved && host !== (page.value > 0 ? 1 : 0)) {
      page.value = host;
      if (host === 0) focus.value = -1;
    } else if (knobMoved && want !== page.value) {
      if (!requestShellPage(want)) {
        focus.value = -1;
        return;
      }
      requestPageSlide(listMode() ? undefined : want - page.value);
      page.value = want;
      // Page slides still run in the guest when the host has no touch pager.
      hotFrames = listMode() ? Math.max(hotFrames, HIGHLIGHT_FRAMES) : 0;
      setHot(hotFrames > 0);
    } else if (knobMoved && listMode()) {
      // ScrollableAppList hands viewport motion to the native compositor. A
      // second guest paint here would make a single detent wait on the slow
      // JS/raster path instead of finishing from the cached frames.
      hotFrames = 0;
      setHot(false);
    } else if (knobMoved) {
      requestPageSlide(0);
      hotFrames = 0;
      setHot(false);
    }
    if (confirm) openApp(apps.value[focus.value]);
    if (page.value > 0) { widgetFocus.value = -1; device()?.set?.("surfaceFocus", ""); }
    knobRow.value = device()?.get?.("knobOn") === "1" ? focus.value : -1;
    if (page.value !== 0) return;
    const now = Date.now();
    if (now - homeUpdatedAt >= 1000 || now < homeUpdatedAt) {
      homeUpdatedAt = now;
      const nextHome = readHomeLayout();
      const nextSignature = JSON.stringify(nextHome);
      if (nextSignature !== homeSignature) {
        homeSignature = nextSignature;
        updateHome(nextHome);
      }
      const nextUnderlay = readHomeUnderlay();
      if (nextUnderlay !== hasUnderlay.value) hasUnderlay.value = nextUnderlay;
    }
    const next = nowParts(lang.value, home.value.clockFormat);
    const cur = clock.value;
    // Only the classic dial displays seconds. Updating an invisible second
    // recreated the entire editable overview every second on Pro.
    const showSeconds = home.value.face.dial === "ticks";
    if (home.value.clockVisible && ((showSeconds && next.ss !== cur.ss) || next.mm !== cur.mm || next.hh !== cur.hh || next.period !== cur.period || next.date !== cur.date)) {
      if (home.value.face.id === "screen-display/flip" && (next.mm !== cur.mm || next.hh !== cur.hh)) {
        hotFrames = Math.max(hotFrames, 24);
        setHot(true);
      }
      clock.value = next;
    }
  });

  return (
    <View class="relative w-full h-full overflow-hidden">
      <View class="absolute w-0 h-0 overflow-hidden">
        <Image src="settings.png" />
        <Image src="security.png" />
        <Image src="stream.png" />
        <Image src="stick.png" />
        <Image src="power.png" />
        <Image src="hdmi.png" />
        <Text>{APP_TITLE_GLYPHS}</Text>
      </View>
      <ShellPager
        key={`${appView.value}:${catalogGen.value}`}
        page={shownPage()}
        capture={capturePage.value >= 0}
        width={scr.w}
        height={scr.h}
        count={1 + appPageCount()}
        hostPager={hostPager()}
        onPage={(next) => {
          page.value = next;
          if (next === 0) focus.value = -1;
          else if (!listMode()) {
            const size = launcherPageSize(false, layout());
            if (focus.value < (next - 1) * size || focus.value >= next * size) focus.value = (next - 1) * size;
          }
        }}
        renderPage={(index) => index === 0
          ? (surfaceHome.value
            ? <CompositorSurface class="absolute w-full h-full" package="screen-display/home" />
            : <HomeFace clock={clock.value} home={home.value} widgets={homeWidgets.value} hasUnderlay={hasUnderlay.value}
                selectedWidget={homeWidgets.value.filter(widget => widget.value.programmed)[widgetFocus.value]?.value.id} />)
          : (appView.value === "list"
            ? <ScrollableAppList
                apps={apps.value}
                selected={device()?.get?.("knobOn") === "1" ? focus.value : -1}
                active={page.value > 0 && !launching.value}
                onOpen={openApp}
              />
            : <AppPage
                apps={apps.value}
                list={false}
                layout={layout()}
                page={index - 1}
                selected={device()?.get?.("knobOn") === "1" ? focus.value : -1}
                onOpen={openApp}
              />)}
      />
      <HintBar />
    </View>
  );
}
