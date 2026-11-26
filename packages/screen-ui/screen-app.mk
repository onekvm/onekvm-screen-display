POCKETJS ?= $(abspath ../../tmp/pocketjs)
BUN ?= bun
FONT_REG ?= $(abspath ../../onekvm-screen-display/.fonts/NotoSansCJK-SC-Regular.otf)
FONT_BOLD ?= $(abspath ../../onekvm-screen-display/.fonts/NotoSansCJK-SC-Bold.otf)
OUT_DIR ?= $(CURDIR)/dist

.PHONY: all clean
all:
	$(BUN) "$(SCREEN_UI)/build.ts" --source="$(CURDIR)/src" \
		--pocketjs="$(POCKETJS)" --outdir="$(abspath $(OUT_DIR))" \
		--font-regular="$(FONT_REG)" --font-bold="$(FONT_BOLD)"

clean:
	$(RM) -r "$(OUT_DIR)"
