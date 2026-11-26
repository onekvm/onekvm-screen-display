SCREEN_UI ?= $(abspath ../../packages/screen-ui)
POCKETJS ?= $(abspath ../../../tmp/pocketjs)
BUN ?= bun
FONT_REG ?= $(abspath ../../.fonts/NotoSansCJK-SC-Regular.otf)
FONT_BOLD ?= $(abspath ../../.fonts/NotoSansCJK-SC-Bold.otf)
OUT_DIR ?= $(CURDIR)/dist
DESTDIR ?=
PREFIX ?= /data/onekvm/apps/screen-sdk-example/0.1.0
VERSION ?= 0.1.0
ARCH ?= all

.PHONY: all install
all:
	mkdir -p $(OUT_DIR)/bin
	$(CC) $(CPPFLAGS) $(CFLAGS) -std=c11 -Wall -Wextra $(LDFLAGS) src/main.c -o $(OUT_DIR)/bin/screen-sdk-example
	$(BUN) $(SCREEN_UI)/build.ts --source=$(CURDIR)/home/src --outdir=$(OUT_DIR)/home --pocketjs=$(POCKETJS) --font-regular=$(FONT_REG) --font-bold=$(FONT_BOLD) --icon=false
	$(BUN) $(SCREEN_UI)/build.ts --source=$(CURDIR)/widget/src --outdir=$(OUT_DIR)/widget --pocketjs=$(POCKETJS) --font-regular=$(FONT_REG) --font-bold=$(FONT_BOLD) --icon=false

install:
	install -d $(DESTDIR)$(PREFIX)/bin $(DESTDIR)$(PREFIX)/screen-home $(DESTDIR)$(PREFIX)/screen-widget
	install -m0755 $(OUT_DIR)/bin/screen-sdk-example $(DESTDIR)$(PREFIX)/bin/
	sed -e 's/@VERSION@/$(VERSION)/g' -e 's/@ARCH@/$(ARCH)/g' manifest.json.in > $(DESTDIR)$(PREFIX)/manifest.json
	install -m0644 $(OUT_DIR)/home/main.vue-vapor.js $(OUT_DIR)/home/main.vue-vapor.pak $(DESTDIR)$(PREFIX)/screen-home/
	install -m0644 $(OUT_DIR)/widget/main.vue-vapor.js $(OUT_DIR)/widget/main.vue-vapor.pak $(DESTDIR)$(PREFIX)/screen-widget/
