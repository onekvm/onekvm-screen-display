POCKETJS ?= $(abspath ../tmp/pocketjs)
BUN ?= $(HOME)/.bun/bin/bun
PYTHON ?= python3
SVG_PY ?= /tmp/svgvenv/bin/python
FONT_REG := $(firstword $(wildcard $(abspath .fonts/NotoSansCJK-SC-Regular.otf) $(abspath .fonts/NotoSansCJK-Regular.otf) $(abspath .fonts/IBMPlexSansSC-Regular.ttf)))
FONT_BOLD := $(firstword $(wildcard $(abspath .fonts/NotoSansCJK-SC-Bold.otf) $(abspath .fonts/NotoSansCJK-Bold.otf) $(abspath .fonts/IBMPlexSansSC-Bold.ttf) $(FONT_REG)))
APP_TITLE_CHARS := $(shell $(PYTHON) $(abspath scripts/app_title_chars.py))
HOLD_HINT_CHARS := 继续按下将返回繼續按下將返回连接連線扫码掃碼密码密碼
WIDGET_CHARS := 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.:%+-°/?_
DIST := $(abspath dist)
SETTINGS_APP_ASSETS := screen.png net.png wifi.png display.png about.png \
	region.png lock.png backspace.png enter.png space.png

INSTALL ?= install
PREFIX ?= /usr
LIBEXECDIR ?= $(PREFIX)/libexec/onekvm
SYSTEMD_UNIT_DIR ?= $(PREFIX)/lib/systemd/system
DBUS_CONFIG_DIR ?= $(PREFIX)/share/dbus-1/system.d
DBUS_SERVICE_DIR ?= $(PREFIX)/share/dbus-1/system-services
ONEKVM_DATA_DIR ?= $(PREFIX)/share/onekvm
VERSION ?= 0.1.0
HOST_BIN ?= $(firstword $(wildcard \
	host-linux-fb/target/armv7-unknown-linux-musleabihf/release/onekvm-screen-display \
	host-linux-fb/target/release/onekvm-screen-display))

.PHONY: assets fallback-font app shell-app init-app settings-app services-app security-app virtual-media-app keyboard-app stream-app stick-app power-app chrome-app bytecode host all install

# Glyphs come from scripts/init_chars.py so # and $ stay out of this line.

all: app host bytecode

assets:
	$(PYTHON) scripts/gen_ticks_svg.py
	$(SVG_PY) scripts/gen_lucide_png.py
	$(PYTHON) scripts/gen_status_icons.py
	$(SVG_PY) scripts/gen_logo_png.py
	$(PYTHON) scripts/extract_cjk_font.py
	$(PYTHON) scripts/gen_clock_digits.py
	$(PYTHON) scripts/gen_hint_atlas.py
	$(MAKE) fallback-font

# Runtime SSIDs are unknown when the small per-App atlases are baked. The host
# maps this outline face read-only and rasterizes only the missing name glyphs.
fallback-font:
	@test -n "$(FONT_REG)" || { echo "missing CJK font; run make assets"; exit 1; }
	mkdir -p $(DIST)
	cp -f $(FONT_REG) $(DIST)/fallback-font.bin
	cp -f packaging/fonts/OFL.txt $(DIST)/fallback-font.LICENSE

app: bytecode

shell-app: assets
	$(BUN) $(POCKETJS)/tools/build.ts $(abspath src/main.tsx) \
		--framework=vue-vapor \
		--outdir=$(DIST) \
		--project-root=$(abspath .) \
		--extra-chars="$(APP_TITLE_CHARS)$(HOLD_HINT_CHARS)$(WIDGET_CHARS)" \
		$(if $(FONT_REG),--font-regular=$(FONT_REG) --font-bold=$(or $(FONT_BOLD),$(FONT_REG)),)

init-app: assets
	mkdir -p $(DIST)/init
	cp -f src/backspace.png src/enter.png src/space.png src/forward.png src/logo.png src/back.png src/apply.png src/globe.png src/wifi.png src/key.png src/init/
	$(BUN) $(POCKETJS)/tools/build.ts $(abspath src/init/main.tsx) \
		--framework=vue-vapor \
		--outdir=$(DIST)/init \
		--project-root=$(abspath .) \
		--extra-chars="$$($(PYTHON) $(abspath scripts/init_chars.py))$(HOLD_HINT_CHARS)" \
		$(if $(FONT_REG),--font-regular=$(FONT_REG) --font-bold=$(or $(FONT_BOLD),$(FONT_REG)),)

chrome-app: assets
	$(BUN) $(POCKETJS)/tools/build.ts $(abspath src/chrome/main.tsx) \
		--framework=vue-vapor \
		--outdir=$(DIST)/chrome \
		--project-root=$(abspath src/chrome) \
		--extra-chars="再滑一次返回首页首頁继续按下将返回繼續按下將返回" \
		$(if $(FONT_REG),--font-regular=$(FONT_REG) --font-bold=$(or $(FONT_BOLD),$(FONT_REG)),)

settings-app: assets
	mkdir -p apps/settings/src/assets
	cp -f $(addprefix src/,$(SETTINGS_APP_ASSETS)) apps/settings/src/assets/
	mkdir -p apps/settings/src/screen-ui
	cp -f packages/screen-ui/assets/* apps/settings/src/screen-ui/
	mkdir -p $(DIST)/apps/settings $(DIST)/icons
	cp -f apps/settings/plugin.json $(DIST)/apps/settings/plugin.json
	cp -f dist/icons/settings.icon.bin $(DIST)/apps/settings/icon.bin 2>/dev/null || true
	$(BUN) $(POCKETJS)/tools/build.ts $(abspath apps/settings/src/main.tsx) \
		--framework=vue-vapor \
		--outdir=$(DIST)/apps/settings \
		--project-root=$(abspath apps/settings) \
		$(if $(APP_TITLE_CHARS),--extra-chars="$(APP_TITLE_CHARS)App 列表",) \
		$(if $(FONT_REG),--font-regular=$(FONT_REG) --font-bold=$(or $(FONT_BOLD),$(FONT_REG)),)

services-app: assets
	@set -eu; \
	app_root=$$(mktemp -d); \
	trap 'rm -rf "$$app_root"' EXIT; \
	mkdir -p "$$app_root/apps" "$$app_root/packages"; \
	cp -a src "$$app_root/src"; \
	cp -a apps/services "$$app_root/apps/"; \
	cp -a packages/screen-ui "$$app_root/packages/"; \
	cp -a packages/screen-ui/assets "$$app_root/apps/services/src/screen-ui"; \
	mkdir -p $(DIST)/apps/services; \
	cp -f apps/services/plugin.json $(DIST)/apps/services/plugin.json; \
	cp -f $(DIST)/icons/settings.icon.bin $(DIST)/apps/services/icon.bin; \
	$(BUN) $(POCKETJS)/tools/build.ts "$$app_root/apps/services/src/main.tsx" \
		--framework=vue-vapor --outdir=$(DIST)/apps/services --project-root="$$app_root" \
		--extra-chars="$(WIDGET_CHARS)[](),=@+<>" \
		$(if $(FONT_REG),--font-regular=$(FONT_REG) --font-bold=$(or $(FONT_BOLD),$(FONT_REG)),)

security-app: assets
	@set -eu; \
	app_root=$$(mktemp -d); \
	trap 'rm -rf "$$app_root"' EXIT; \
	mkdir -p "$$app_root/apps" "$$app_root/packages"; \
	cp -a src "$$app_root/src"; \
	cp -a apps/security "$$app_root/apps/"; \
	cp -a packages/screen-ui "$$app_root/packages/"; \
	cp -a packages/screen-ui/assets "$$app_root/apps/security/src/screen-ui"; \
	mkdir -p "$$app_root/apps/security/src/assets"; \
	cp src/backspace.png src/enter.png src/space.png "$$app_root/apps/security/src/assets/"; \
	mkdir -p $(DIST)/apps/security; \
	cp -f apps/security/plugin.json $(DIST)/apps/security/plugin.json; \
	cp -f $(DIST)/icons/security.icon.bin $(DIST)/apps/security/icon.bin; \
	$(BUN) $(POCKETJS)/tools/build.ts "$$app_root/apps/security/src/main.tsx" \
		--framework=vue-vapor --outdir=$(DIST)/apps/security --project-root="$$app_root" \
		--extra-chars="$(WIDGET_CHARS)[](),=@+<>" \
		$(if $(FONT_REG),--font-regular=$(FONT_REG) --font-bold=$(or $(FONT_BOLD),$(FONT_REG)),)

stream-app: assets
	cp -f src/zoom.png apps/stream/src/
	mkdir -p $(DIST)/apps/stream $(DIST)/icons
	cp -f apps/stream/plugin.json $(DIST)/apps/stream/plugin.json
	cp -f dist/icons/stream.icon.bin $(DIST)/apps/stream/icon.bin 2>/dev/null || true
	$(BUN) $(POCKETJS)/tools/build.ts $(abspath apps/stream/src/main.tsx) \
		--framework=vue-vapor \
		--outdir=$(DIST)/apps/stream \
		--project-root=$(abspath apps/stream) \
		$(if $(FONT_REG),--font-regular=$(FONT_REG) --font-bold=$(or $(FONT_BOLD),$(FONT_REG)),)

power-app: assets
	@set -eu; \
	app_root=$$(mktemp -d); \
	trap 'rm -rf "$$app_root"' EXIT; \
	mkdir -p "$$app_root/apps"; \
	cp -a apps/extension-screen apps/shared "$$app_root/apps/"; \
	mkdir -p "$$app_root/packages"; \
	cp -a packages/screen-ui "$$app_root/packages/"; \
	cp -f src/power.png "$$app_root/apps/extension-screen/src/power.png"; \
	cp -a packages/screen-ui/assets "$$app_root/apps/extension-screen/src/screen-ui"; \
	mkdir -p $(DIST)/apps/power; \
	cp -f "$$app_root/apps/extension-screen/plugin.json" $(DIST)/apps/power/plugin.json; \
	cp -f $(DIST)/icons/power.icon.bin $(DIST)/apps/power/icon.bin; \
	$(BUN) $(POCKETJS)/tools/build.ts "$$app_root/apps/extension-screen/src/main.tsx" \
		--framework=vue-vapor \
		--outdir=$(DIST)/apps/power \
		--project-root="$$app_root" \
		--extra-chars="$(APP_TITLE_CHARS)" \
		$(if $(FONT_REG),--font-regular=$(FONT_REG) --font-bold=$(or $(FONT_BOLD),$(FONT_REG)),)

stick-app: assets
	mkdir -p $(DIST)/apps/stick $(DIST)/icons
	cp -f apps/stick/plugin.json $(DIST)/apps/stick/plugin.json
	cp -f dist/icons/stick.icon.bin $(DIST)/apps/stick/icon.bin 2>/dev/null || true
	$(BUN) $(POCKETJS)/tools/build.ts $(abspath apps/stick/src/main.tsx) \
		--framework=vue-vapor \
		--outdir=$(DIST)/apps/stick \
		--project-root=$(abspath apps/stick) \
		$(if $(FONT_REG),--font-regular=$(FONT_REG) --font-bold=$(or $(FONT_BOLD),$(FONT_REG)),)

virtual-media-app keyboard-app: %-app: assets
	@set -eu; \
	app_root=$$(mktemp -d); \
	trap 'rm -rf "$$app_root"' EXIT; \
	mkdir -p "$$app_root/apps" "$$app_root/packages"; \
	cp -a src "$$app_root/src"; \
	cp -a apps/$* apps/shared "$$app_root/apps/"; \
	cp -a packages/screen-ui "$$app_root/packages/"; \
	cp -a packages/screen-ui/assets "$$app_root/apps/$*/src/screen-ui"; \
	mkdir -p "$$app_root/apps/$*/src/assets" $(DIST)/apps/$*; \
	cp src/backspace.png src/enter.png src/space.png "$$app_root/apps/$*/src/assets/"; \
	cp -f apps/$*/plugin.json $(DIST)/apps/$*/plugin.json; \
	cp -f $(DIST)/icons/$*.icon.bin $(DIST)/apps/$*/icon.bin; \
	$(BUN) $(POCKETJS)/tools/build.ts "$$app_root/apps/$*/src/main.tsx" \
		--framework=vue-vapor --outdir=$(DIST)/apps/$* --project-root="$$app_root" \
		--extra-chars="$(WIDGET_CHARS)[](),=@+<>" \
		$(if $(FONT_REG),--font-regular=$(FONT_REG) --font-bold=$(or $(FONT_BOLD),$(FONT_REG)),)

bytecode: shell-app init-app chrome-app settings-app services-app security-app virtual-media-app keyboard-app stream-app stick-app power-app
	cargo build --release --manifest-path host-linux-fb/Cargo.toml
	host-linux-fb/target/release/onekvm-screen-display compile \
		$(DIST)/main.vue-vapor.js $(DIST)/main.vue-vapor.jsc
	host-linux-fb/target/release/onekvm-screen-display compile \
		$(DIST)/init/main.vue-vapor.js $(DIST)/init/main.vue-vapor.jsc
	host-linux-fb/target/release/onekvm-screen-display compile \
		$(DIST)/chrome/main.vue-vapor.js $(DIST)/chrome/main.vue-vapor.jsc
	host-linux-fb/target/release/onekvm-screen-display compile \
		$(DIST)/apps/settings/main.vue-vapor.js $(DIST)/apps/settings/main.vue-vapor.jsc
	host-linux-fb/target/release/onekvm-screen-display compile \
		$(DIST)/apps/services/main.vue-vapor.js $(DIST)/apps/services/main.vue-vapor.jsc
	host-linux-fb/target/release/onekvm-screen-display compile \
		$(DIST)/apps/stream/main.vue-vapor.js $(DIST)/apps/stream/main.vue-vapor.jsc
	host-linux-fb/target/release/onekvm-screen-display compile \
		$(DIST)/apps/stick/main.vue-vapor.js $(DIST)/apps/stick/main.vue-vapor.jsc
	host-linux-fb/target/release/onekvm-screen-display compile \
		$(DIST)/apps/power/main.vue-vapor.js $(DIST)/apps/power/main.vue-vapor.jsc
	host-linux-fb/target/release/onekvm-screen-display compile \
		$(DIST)/apps/security/main.vue-vapor.js $(DIST)/apps/security/main.vue-vapor.jsc
	host-linux-fb/target/release/onekvm-screen-display compile \
		$(DIST)/apps/virtual-media/main.vue-vapor.js $(DIST)/apps/virtual-media/main.vue-vapor.jsc
	host-linux-fb/target/release/onekvm-screen-display compile \
		$(DIST)/apps/keyboard/main.vue-vapor.js $(DIST)/apps/keyboard/main.vue-vapor.jsc
	$(PYTHON) scripts/check_bundles.py $(DIST)

host:
	cargo build --release --manifest-path host-linux-fb/Cargo.toml

install:
	$(PYTHON) scripts/check_bundles.py $(DIST)
	@test -n "$(HOST_BIN)" || { echo "missing host binary; run make host" >&2; exit 1; }
	$(INSTALL) -Dm0755 $(HOST_BIN) \
		$(DESTDIR)$(LIBEXECDIR)/onekvm-device-screen-display
	$(INSTALL) -Dm0644 packaging/systemd/onekvm-device-screen-display.service \
		$(DESTDIR)$(SYSTEMD_UNIT_DIR)/onekvm-device-screen-display.service
	$(INSTALL) -Dm0644 packaging/dbus/org.onekvm.ScreenDisplay.conf \
		$(DESTDIR)$(DBUS_CONFIG_DIR)/org.onekvm.ScreenDisplay.conf
	$(INSTALL) -Dm0644 packaging/dbus/org.onekvm.ScreenDisplay.service \
		$(DESTDIR)$(DBUS_SERVICE_DIR)/org.onekvm.ScreenDisplay.service
	$(INSTALL) -Dm0644 packaging/onekvm/screen-display-system-plugin.json \
		$(DESTDIR)$(ONEKVM_DATA_DIR)/system-plugins/screen-display.json
	$(INSTALL) -Dm0644 packaging/onekvm/display-page.js \
		$(DESTDIR)$(ONEKVM_DATA_DIR)/system-plugins/screen-display/$(VERSION)/web/display-page.js
	$(INSTALL) -Dm0644 packaging/onekvm/launcher.json \
		$(DESTDIR)$(ONEKVM_DATA_DIR)/screen-display/launcher.json
	if [ -d "$(DIST)" ]; then \
		$(INSTALL) -d $(DESTDIR)$(ONEKVM_DATA_DIR)/screen-display; \
		cp -a $(DIST)/. $(DESTDIR)$(ONEKVM_DATA_DIR)/screen-display/; \
	fi
