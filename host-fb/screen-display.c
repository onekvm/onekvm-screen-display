/*
 * OneKVM screen display — PocketJS layout, Linux fbdev presenter.
 * Logical 240x240 RGB565 UI, scaled to the live /dev/fb0 panel.
 *
 * Circular disc: bezel ticks, traveling second pip, Noto time.
 * Swipe right opens apps (icons or list). Settings is the first app.
 *
 * Other components register widgets as JSON in:
 *   /run/onekvm/display/widgets/<id>.json
 *   $ONEKVM_EXTENSION_DATA/widgets/<id>.json
 *   /usr/share/onekvm/display/widgets/<id>.json
 */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <ifaddrs.h>
#include <math.h>
#include <linux/fb.h>
#include <linux/types.h>
#include <linux/input.h>
#include <linux/kd.h>
#include <net/if.h>
#include <netinet/in.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "font_atlas.h"

#define LOG_W 240
#define LOG_H 240
#define LOG_CX 120
#define LOG_CY 120
#define LOG_R 118
#define W LOG_W
#define H LOG_H
#define CX LOG_CX
#define CY LOG_CY
#define DISC_R LOG_R

#define COL_BG     0x0000
#define COL_VOID   0x0841
#define COL_INK    0xF79E
#define COL_MUTE   0x7BEF
#define COL_DIM    0x39E7
#define COL_AMBER  0xFE40
#define COL_CYAN   0x7FFF
#define COL_VIOLET 0xC3BF
#define COL_RING   0x3186
#define COL_TICK   0x5ACB
#define COL_PLATE  0x6B6D
#define COL_DATE   COL_AMBER

/* 0 = 12 o'clock, clockwise, 6° steps. 8.8 fixed. */
static const int16_t POL_X[60] = {
	   0,  27,  53,  79, 104, 128, 150, 171, 190, 207,
	 222, 234, 243, 250, 255, 256, 255, 250, 243, 234,
	 222, 207, 190, 171, 150, 128, 104,  79,  53,  27,
	   0, -27, -53, -79,-104,-128,-150,-171,-190,-207,
	-222,-234,-243,-250,-255,-256,-255,-250,-243,-234,
	-222,-207,-190,-171,-150,-128,-104, -79, -53, -27,
};
static const int16_t POL_Y[60] = {
	-256,-255,-250,-243,-234,-222,-207,-190,-171,-150,
	-128,-104, -79, -53, -27,   0,  27,  53,  79, 104,
	 128, 150, 171, 190, 207, 222, 234, 243, 250, 255,
	 256, 255, 250, 243, 234, 222, 207, 190, 171, 150,
	 128, 104,  79,  53,  27,   0, -27, -53, -79,-104,
	-128,-150,-171,-190,-207,-222,-234,-243,-250,-255,
};

static uint16_t fb[LOG_W * LOG_H];
static uint16_t *dev;
static size_t dev_len;
static int fb_stride;
static int fb_fd = -1;
static int ev_fd = -1;
static int panel_w = LOG_W;
static int panel_h = LOG_H;
static int panel_bpp = 16;
static bool panel_round = true;
static int view_ox, view_oy, view_dw = LOG_W, view_dh = LOG_H;
static int touch_max_x = LOG_W - 1;
static int touch_max_y = LOG_H - 1;
#define MAX_WIDGETS 12
#define SWIPE_MIN 36
#define TRANSITION_FRAMES 12

static bool hdmi_on, usb_on;
static char ip_text[32] = "--.--.--.--";
static int screen; /* 0 home, 1 apps, 2 settings */
static char detail_id[32];
static int last_second = -1;
static int brightness_pct = 100;
static uint16_t prev_fb[W * H];
static uint16_t next_fb[W * H];

struct widget {
	char id[32];
	char source[32];
	char title[32];
	char glyph[4];
	char icon[32];
	char subtitle[16];
	char accent_name[16];
	uint16_t accent;
	bool on;
	bool slot_comp;
	bool slot_app;
	bool builtin;
	int order;
	char image[64];
	char frames[8][32];
	int frame_n;
	int frame_ms;
	char asset_dir[160];
};

#define ICON_MAX 32

static struct widget widgets[MAX_WIDGETS];
static int widget_n;
static char layout_comp[8][32];
static int layout_comp_n;
static char layout_app[8][32];
static int layout_app_n;
static char trans_name[16] = "slide";
static int trans_ms = 280;
static char app_view[8] = "icons";

static void parse_id_array(const char *buf, const char *key, char out[][32], int *n, int max);
static int write_file(const char *path, const char *buf, size_t n);
static void apply_brightness(void);
static void persist_app_view(void);

static const uint8_t FONT8[][8] = {
#define F(a,b,c,d,e,f,g,h) {a,b,c,d,e,f,g,h}
	F(0,0,0,0,0,0,0,0),
	F(0x10,0x10,0x10,0x10,0x10,0x00,0x10,0x00),
	F(0x28,0x28,0x00,0x00,0x00,0x00,0x00,0x00),
	F(0x28,0x7C,0x28,0x7C,0x28,0x00,0x00,0x00),
	F(0x10,0x3C,0x50,0x38,0x14,0x78,0x10,0x00),
	F(0x60,0x64,0x08,0x10,0x20,0x4C,0x0C,0x00),
	F(0x20,0x50,0x50,0x20,0x54,0x48,0x34,0x00),
	F(0x10,0x10,0x00,0x00,0x00,0x00,0x00,0x00),
	F(0x08,0x10,0x20,0x20,0x20,0x10,0x08,0x00),
	F(0x20,0x10,0x08,0x08,0x08,0x10,0x20,0x00),
	F(0x00,0x10,0x54,0x38,0x54,0x10,0x00,0x00),
	F(0x00,0x10,0x10,0x7C,0x10,0x10,0x00,0x00),
	F(0x00,0x00,0x00,0x00,0x00,0x10,0x10,0x20),
	F(0x00,0x00,0x00,0x7C,0x00,0x00,0x00,0x00),
	F(0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x00),
	F(0x04,0x08,0x10,0x20,0x40,0x00,0x00,0x00),
	F(0x38,0x44,0x4C,0x54,0x64,0x44,0x38,0x00),
	F(0x10,0x30,0x10,0x10,0x10,0x10,0x38,0x00),
	F(0x38,0x44,0x04,0x18,0x20,0x40,0x7C,0x00),
	F(0x38,0x44,0x04,0x18,0x04,0x44,0x38,0x00),
	F(0x08,0x18,0x28,0x48,0x7C,0x08,0x08,0x00),
	F(0x7C,0x40,0x78,0x04,0x04,0x44,0x38,0x00),
	F(0x18,0x20,0x40,0x78,0x44,0x44,0x38,0x00),
	F(0x7C,0x04,0x08,0x10,0x20,0x20,0x20,0x00),
	F(0x38,0x44,0x44,0x38,0x44,0x44,0x38,0x00),
	F(0x38,0x44,0x44,0x3C,0x04,0x08,0x30,0x00),
	F(0x00,0x10,0x00,0x00,0x00,0x10,0x00,0x00),
	F(0x00,0x10,0x00,0x00,0x00,0x10,0x10,0x20),
	F(0x08,0x10,0x20,0x40,0x20,0x10,0x08,0x00),
	F(0x00,0x00,0x7C,0x00,0x7C,0x00,0x00,0x00),
	F(0x20,0x10,0x08,0x04,0x08,0x10,0x20,0x00),
	F(0x38,0x44,0x04,0x08,0x10,0x00,0x10,0x00),
	F(0x38,0x44,0x5C,0x54,0x5C,0x40,0x38,0x00),
	F(0x38,0x44,0x44,0x7C,0x44,0x44,0x44,0x00),
	F(0x78,0x44,0x44,0x78,0x44,0x44,0x78,0x00),
	F(0x38,0x44,0x40,0x40,0x40,0x44,0x38,0x00),
	F(0x70,0x48,0x44,0x44,0x44,0x48,0x70,0x00),
	F(0x7C,0x40,0x40,0x78,0x40,0x40,0x7C,0x00),
	F(0x7C,0x40,0x40,0x78,0x40,0x40,0x40,0x00),
	F(0x38,0x44,0x40,0x5C,0x44,0x44,0x38,0x00),
	F(0x44,0x44,0x44,0x7C,0x44,0x44,0x44,0x00),
	F(0x38,0x10,0x10,0x10,0x10,0x10,0x38,0x00),
	F(0x04,0x04,0x04,0x04,0x44,0x44,0x38,0x00),
	F(0x44,0x48,0x50,0x60,0x50,0x48,0x44,0x00),
	F(0x40,0x40,0x40,0x40,0x40,0x40,0x7C,0x00),
	F(0x44,0x6C,0x54,0x54,0x44,0x44,0x44,0x00),
	F(0x44,0x64,0x54,0x4C,0x44,0x44,0x44,0x00),
	F(0x38,0x44,0x44,0x44,0x44,0x44,0x38,0x00),
	F(0x78,0x44,0x44,0x78,0x40,0x40,0x40,0x00),
	F(0x38,0x44,0x44,0x44,0x54,0x48,0x34,0x00),
	F(0x78,0x44,0x44,0x78,0x50,0x48,0x44,0x00),
	F(0x38,0x44,0x40,0x38,0x04,0x44,0x38,0x00),
	F(0x7C,0x10,0x10,0x10,0x10,0x10,0x10,0x00),
	F(0x44,0x44,0x44,0x44,0x44,0x44,0x38,0x00),
	F(0x44,0x44,0x44,0x44,0x44,0x28,0x10,0x00),
	F(0x44,0x44,0x44,0x54,0x54,0x54,0x28,0x00),
	F(0x44,0x44,0x28,0x10,0x28,0x44,0x44,0x00),
	F(0x44,0x44,0x28,0x10,0x10,0x10,0x10,0x00),
	F(0x7C,0x04,0x08,0x10,0x20,0x40,0x7C,0x00),
#undef F
};

static const uint16_t DIGIT[11][20] = {
	{0x1F8,0x3FC,0x307,0x303,0x303,0x303,0x303,0x303,0x303,0x303,
	 0x303,0x303,0x303,0x303,0x303,0x303,0x307,0x3FC,0x1F8,0x000},
	{0x030,0x070,0x0F0,0x1B0,0x030,0x030,0x030,0x030,0x030,0x030,
	 0x030,0x030,0x030,0x030,0x030,0x030,0x030,0x1F8,0x1F8,0x000},
	{0x1F8,0x3FC,0x307,0x003,0x003,0x003,0x007,0x01C,0x038,0x070,
	 0x0E0,0x1C0,0x180,0x300,0x300,0x300,0x300,0x3FF,0x3FF,0x000},
	{0x1F8,0x3FC,0x307,0x003,0x003,0x003,0x01E,0x01C,0x01E,0x003,
	 0x003,0x003,0x003,0x003,0x003,0x003,0x307,0x3FC,0x1F8,0x000},
	{0x00C,0x01C,0x03C,0x06C,0x0CC,0x18C,0x30C,0x30C,0x3FF,0x3FF,
	 0x00C,0x00C,0x00C,0x00C,0x00C,0x00C,0x00C,0x00C,0x00C,0x000},
	{0x3FF,0x3FF,0x300,0x300,0x300,0x300,0x3F8,0x3FC,0x007,0x003,
	 0x003,0x003,0x003,0x003,0x003,0x003,0x307,0x3FC,0x1F8,0x000},
	{0x1F8,0x3FC,0x307,0x300,0x300,0x300,0x3F8,0x3FC,0x307,0x303,
	 0x303,0x303,0x303,0x303,0x303,0x303,0x307,0x3FC,0x1F8,0x000},
	{0x3FF,0x3FF,0x003,0x006,0x00C,0x00C,0x018,0x018,0x030,0x030,
	 0x060,0x060,0x0C0,0x0C0,0x180,0x180,0x180,0x180,0x180,0x000},
	{0x1F8,0x3FC,0x307,0x303,0x303,0x303,0x307,0x1FC,0x1F8,0x307,
	 0x303,0x303,0x303,0x303,0x303,0x303,0x307,0x3FC,0x1F8,0x000},
	{0x1F8,0x3FC,0x307,0x303,0x303,0x303,0x303,0x303,0x303,0x307,
	 0x1FF,0x0FF,0x003,0x003,0x003,0x003,0x307,0x3FC,0x1F8,0x000},
	{0x000,0x000,0x000,0x000,0x060,0x060,0x000,0x000,0x000,0x000,
	 0x000,0x000,0x060,0x060,0x000,0x000,0x000,0x000,0x000,0x000},
};

static void put(int x, int y, uint16_t c)
{
	if ((unsigned)x >= LOG_W || (unsigned)y >= LOG_H)
		return;
	fb[y * LOG_W + x] = c;
}

static unsigned expand5(unsigned v)
{
	return (v << 3) | (v >> 2);
}

static unsigned expand6(unsigned v)
{
	return (v << 2) | (v >> 4);
}

static uint16_t mix565(uint16_t bg, uint16_t fg, unsigned a)
{
	if (a >= 250)
		return fg;
	if (a == 0)
		return bg;
	unsigned ia = 255 - a;
	unsigned r = (expand5((bg >> 11) & 31) * ia + expand5((fg >> 11) & 31) * a + 127) / 255;
	unsigned g = (expand6((bg >> 5) & 63) * ia + expand6((fg >> 5) & 63) * a + 127) / 255;
	unsigned b = (expand5(bg & 31) * ia + expand5(fg & 31) * a + 127) / 255;
	return (uint16_t)(((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3));
}

static void put_a(int x, int y, uint16_t c, unsigned a)
{
	if (!a)
		return;
	if ((unsigned)x >= LOG_W || (unsigned)y >= LOG_H)
		return;
	if (a >= 250)
		fb[y * LOG_W + x] = c;
	else
		fb[y * LOG_W + x] = mix565(fb[y * LOG_W + x], c, a);
}

static unsigned cover_edge(float dist, float r)
{
	float a = r + 0.5f - dist;
	if (a <= 0.f)
		return 0;
	if (a >= 1.f)
		return 255;
	return (unsigned)(a * 255.f + 0.5f);
}

static void fill(uint16_t c)
{
	for (int i = 0; i < W * H; i++)
		fb[i] = c;
}

static void disc(int cx, int cy, int r, uint16_t c)
{
	int pad = r + 1;
	float rf = (float)r;
	for (int y = -pad; y <= pad; y++) {
		for (int x = -pad; x <= pad; x++) {
			float dx = (float)x + 0.5f;
			float dy = (float)y + 0.5f;
			unsigned a = cover_edge(sqrtf(dx * dx + dy * dy), rf);
			if (a)
				put_a(cx + x, cy + y, c, a);
		}
	}
}

static void ring(int cx, int cy, int r, int t, uint16_t c)
{
	if (t < 1)
		t = 1;
	int pad = r + 1;
	float ro = (float)r;
	float ri = (float)(r - t);
	if (ri < 0.f)
		ri = 0.f;
	for (int y = -pad; y <= pad; y++) {
		for (int x = -pad; x <= pad; x++) {
			float dx = (float)x + 0.5f;
			float dy = (float)y + 0.5f;
			float d = sqrtf(dx * dx + dy * dy);
			float ao = ro + 0.5f - d;
			float ai = d - (ri - 0.5f);
			if (ao <= 0.f || ai <= 0.f)
				continue;
			if (ao > 1.f)
				ao = 1.f;
			if (ai > 1.f)
				ai = 1.f;
			unsigned a = (unsigned)(ao * ai * 255.f + 0.5f);
			if (a)
				put_a(cx + x, cy + y, c, a);
		}
	}
}

static void stroke_seg(float x0, float y0, float x1, float y1, float half, uint16_t c)
{
	int minx = (int)floorf((x0 < x1 ? x0 : x1) - half) - 1;
	int maxx = (int)ceilf((x0 > x1 ? x0 : x1) + half) + 1;
	int miny = (int)floorf((y0 < y1 ? y0 : y1) - half) - 1;
	int maxy = (int)ceilf((y0 > y1 ? y0 : y1) + half) + 1;
	float vx = x1 - x0, vy = y1 - y0;
	float len2 = vx * vx + vy * vy;
	for (int y = miny; y <= maxy; y++) {
		for (int x = minx; x <= maxx; x++) {
			float wx = (float)x + 0.5f - x0;
			float wy = (float)y + 0.5f - y0;
			float t = len2 > 0.f ? (wx * vx + wy * vy) / len2 : 0.f;
			if (t < 0.f)
				t = 0.f;
			if (t > 1.f)
				t = 1.f;
			float dx = wx - t * vx, dy = wy - t * vy;
			unsigned a = cover_edge(sqrtf(dx * dx + dy * dy), half);
			if (a)
				put_a(x, y, c, a);
		}
	}
}

static void rect_fill(int x, int y, int w, int h, uint16_t c)
{
	for (int j = 0; j < h; j++)
		for (int i = 0; i < w; i++)
			put(x + i, y + j, c);
}

static void icon_hdmi(int cx, int cy, uint16_t c)
{
	rect_fill(cx - 9, cy - 7, 18, 11, c);
	rect_fill(cx - 7, cy - 5, 14, 7, COL_VOID);
	rect_fill(cx - 1, cy + 4, 2, 2, c);
	rect_fill(cx - 5, cy + 6, 10, 2, c);
}

static void icon_usb(int cx, int cy, uint16_t c)
{
	disc(cx, cy - 8, 2, c);
	rect_fill(cx - 1, cy - 6, 2, 13, c);
	rect_fill(cx - 7, cy - 2, 6, 2, c);
	rect_fill(cx - 8, cy - 5, 3, 5, c);
	rect_fill(cx + 1, cy + 1, 6, 2, c);
	rect_fill(cx + 5, cy - 1, 3, 3, c);
}

static void icon_net(int cx, int cy, uint16_t c)
{
	disc(cx, cy + 6, 2, c);
	for (int r = 6; r <= 10; r += 4) {
		int r2 = r * r, ri = r - 2, ri2 = ri * ri;
		for (int y = -r; y <= 0; y++) {
			for (int x = -r; x <= r; x++) {
				int d = x * x + y * y;
				if (d <= r2 && d >= ri2)
					put(cx + x, cy + 6 + y, c);
			}
		}
	}
}

static int icon_r = 12;
static uint16_t icon_hole = COL_BG;

static void icon_settings(int cx, int cy, uint16_t c)
{
	int r = icon_r;
	disc(cx, cy, r * 7 / 10, c);
	for (int i = 0; i < 6; i++) {
		int x = cx + ((POL_X[i * 10] * r) >> 8);
		int y = cy + ((POL_Y[i * 10] * r) >> 8);
		disc(x, y, r * 32 / 100, c);
	}
	disc(cx, cy, r * 28 / 100, icon_hole);
}

static void watch_plate(int cx, int cy, int r)
{
	disc(cx, cy, r, COL_PLATE);
}

static void polar(int step, int r, int *x, int *y)
{
	step %= 60;
	if (step < 0)
		step += 60;
	*x = CX + ((POL_X[step] * r) >> 8);
	*y = CY + ((POL_Y[step] * r) >> 8);
}

static void glyph8(int x, int y, char ch, uint16_t c)
{
	if (ch >= 'a' && ch <= 'z')
		ch -= 32;
	if (ch < 32 || ch > 90)
		return;
	const uint8_t *g = FONT8[ch - 32];
	for (int row = 0; row < 8; row++) {
		uint8_t bits = g[row];
		for (int col = 0; col < 8; col++) {
			if (bits & (0x80 >> col))
				put(x + col, y + row, c);
		}
	}
}

static void text8(int x, int y, const char *s, uint16_t c)
{
	while (*s) {
		glyph8(x, y, *s++, c);
		x += 8;
	}
}

static int text8_w(const char *s)
{
	return (int)strlen(s) * 8;
}

static void text8_c(int y, const char *s, uint16_t c)
{
	text8((W - text8_w(s)) / 2, y, s, c);
}

static uint32_t utf8_next(const char **s)
{
	const unsigned char *p = (const unsigned char *)*s;
	if (!p || !*p)
		return 0;
	if (p[0] < 0x80) {
		*s += 1;
		return p[0];
	}
	if ((p[0] & 0xe0) == 0xc0 && p[1]) {
		*s += 2;
		return ((uint32_t)(p[0] & 0x1f) << 6) | (p[1] & 0x3f);
	}
	if ((p[0] & 0xf0) == 0xe0 && p[1] && p[2]) {
		*s += 3;
		return ((uint32_t)(p[0] & 0x0f) << 12) |
		       ((uint32_t)(p[1] & 0x3f) << 6) | (p[2] & 0x3f);
	}
	*s += 1;
	return p[0];
}

static const struct atlas_glyph *find_glyph(const struct atlas_glyph *gs, int n, uint32_t cp)
{
	for (int i = 0; i < n; i++) {
		if (gs[i].cp == cp)
			return &gs[i];
	}
	return NULL;
}

static void stamp_glyph(int x, int y, const uint8_t *bm, const struct atlas_glyph *g, uint16_t c)
{
	const uint8_t *p = bm + g->off;
	int x0 = x + (int)g->ox;
	int y0 = y + (int)g->oy;
	for (int row = 0; row < g->h; row++) {
		for (int col = 0; col < g->w; col++) {
			unsigned a = p[row * g->w + col];
			if (a)
				put_a(x0 + col, y0 + row, c, a);
		}
	}
}

static int text_run(int x, int y, const char *s, uint16_t c,
		    const uint8_t *bm, const struct atlas_glyph *gs, int n)
{
	const char *p = s;
	uint32_t cp;
	while ((cp = utf8_next(&p))) {
		const struct atlas_glyph *g = find_glyph(gs, n, cp);
		if (g) {
			stamp_glyph(x, y, bm, g, c);
			x += g->adv;
		} else if (cp < 127) {
			glyph8(x, y - 8, (char)cp, c);
			x += 8;
		}
	}
	return x;
}

static int text_run_w(const char *s, const struct atlas_glyph *gs, int n)
{
	const char *p = s;
	uint32_t cp;
	int w = 0;
	while ((cp = utf8_next(&p))) {
		const struct atlas_glyph *g = find_glyph(gs, n, cp);
		w += g ? g->adv : (cp < 127 ? 8 : 0);
	}
	return w;
}

static void text_ui(int x, int y, const char *s, uint16_t c)
{
	text_run(x, y, s, c, FONT_UI_BITMAP, FONT_UI_GLYPHS, FONT_UI_COUNT);
}

static int text_ui_w(const char *s)
{
	return text_run_w(s, FONT_UI_GLYPHS, FONT_UI_COUNT);
}

static void text_ui_c(int y, const char *s, uint16_t c)
{
	text_ui((W - text_ui_w(s)) / 2, y, s, c);
}

static void text_time(int x, int y, const char *s, uint16_t c)
{
	text_run(x, y, s, c, FONT_TIME_BITMAP, FONT_TIME_GLYPHS, FONT_TIME_COUNT);
}

static int text_time_w(const char *s)
{
	return text_run_w(s, FONT_TIME_GLYPHS, FONT_TIME_COUNT);
}

static void digit12(int x, int y, int idx, uint16_t c)
{
	for (int row = 0; row < 20; row++) {
		uint16_t bits = DIGIT[idx][row];
		for (int col = 0; col < 12; col++) {
			if (bits & (1 << (11 - col))) {
				put(x + col, y + row, c);
				put(x + col, y + row + 1, c);
			}
		}
	}
}

static bool panel_is_round(int w, int h)
{
	int a = w < h ? w : h;
	int d = w > h ? w - h : h - w;
	return a > 0 && d * 8 <= a;
}

static void compute_view(void)
{
	if (panel_w < 1)
		panel_w = LOG_W;
	if (panel_h < 1)
		panel_h = LOG_H;
	if (panel_w * LOG_H <= panel_h * LOG_W) {
		view_dw = panel_w;
		view_dh = panel_w * LOG_H / LOG_W;
	} else {
		view_dh = panel_h;
		view_dw = panel_h * LOG_W / LOG_H;
	}
	if (view_dw < 1)
		view_dw = 1;
	if (view_dh < 1)
		view_dh = 1;
	view_ox = (panel_w - view_dw) / 2;
	view_oy = (panel_h - view_dh) / 2;
}

static int to_log_x(int x)
{
	return (x - view_ox) * LOG_W / view_dw;
}

static int to_log_y(int y)
{
	return (y - view_oy) * LOG_H / view_dh;
}

static void blit(void)
{
	if (!dev || panel_w < 1 || panel_h < 1)
		return;
	if (dev_len < (size_t)panel_h * (size_t)fb_stride * 2)
		return;
	if (panel_w == LOG_W && panel_h == LOG_H && fb_stride == LOG_W &&
	    view_ox == 0 && view_oy == 0) {
		memcpy(dev, fb, sizeof(fb));
		return;
	}
	for (int y = 0; y < panel_h; y++) {
		uint16_t *dst = dev + y * fb_stride;
		for (int x = 0; x < panel_w; x++) {
			int lx = x - view_ox;
			int ly = y - view_oy;
			if (lx < 0 || ly < 0 || lx >= view_dw || ly >= view_dh) {
				dst[x] = COL_BG;
				continue;
			}
			int sx = lx * LOG_W / view_dw;
			int sy = ly * LOG_H / view_dh;
			dst[x] = fb[sy * LOG_W + sx];
		}
	}
}

/*
 * ST7789V/fbtft has no scanout vsync. memcpy into /dev/fb0 only dirties
 * pages; deferred_io pushes SPI later (~HZ/fps). Blitting the next frame
 * before that finishes overwrites vmem mid-transfer.
 * FBIO_WAITFORVSYNC if the panel has it; otherwise fsync flushes deferred
 * io and waits until the SPI update returns.
 */
static bool vsync_ioctl_ok = true;

static void wait_present(void)
{
	__u32 crt = 0;

	if (fb_fd < 0)
		return;
	if (vsync_ioctl_ok) {
		if (ioctl(fb_fd, FBIO_WAITFORVSYNC, &crt) == 0)
			return;
		vsync_ioctl_ok = false;
	}
	fsync(fb_fd);
}

static void present_fb(void)
{
	blit();
	wait_present();
}

static uint16_t rgb565(unsigned r, unsigned g, unsigned b)
{
	return (uint16_t)(((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3));
}

static uint16_t accent_of(const char *name)
{
	if (!name || !name[0])
		return COL_INK;
	if (name[0] == '#' && strlen(name) >= 7) {
		unsigned v = 0;
		sscanf(name + 1, "%6x", &v);
		return rgb565(v >> 16, (v >> 8) & 0xff, v & 0xff);
	}
	if (!strcasecmp(name, "amber"))
		return COL_AMBER;
	if (!strcasecmp(name, "cyan"))
		return COL_CYAN;
	if (!strcasecmp(name, "violet"))
		return COL_VIOLET;
	if (!strcasecmp(name, "ink"))
		return COL_INK;
	return COL_INK;
}

static bool json_str(const char *buf, const char *key, char *out, size_t n)
{
	char pat[48];
	snprintf(pat, sizeof(pat), "\"%s\"", key);
	const char *p = strstr(buf, pat);
	if (!p)
		return false;
	p = strchr(p + strlen(pat), ':');
	if (!p)
		return false;
	p++;
	while (*p == ' ' || *p == '\t')
		p++;
	if (*p != '"')
		return false;
	p++;
	size_t i = 0;
	while (*p && *p != '"' && i + 1 < n) {
		if (*p == '\\' && p[1])
			p++;
		out[i++] = *p++;
	}
	out[i] = 0;
	return true;
}

static bool json_bool(const char *buf, const char *key, bool fallback)
{
	char pat[48];
	snprintf(pat, sizeof(pat), "\"%s\"", key);
	const char *p = strstr(buf, pat);
	if (!p)
		return fallback;
	p = strchr(p + strlen(pat), ':');
	if (!p)
		return fallback;
	p++;
	while (*p == ' ' || *p == '\t')
		p++;
	return strncmp(p, "true", 4) == 0;
}

static int json_int(const char *buf, const char *key, int fallback)
{
	char pat[48];
	snprintf(pat, sizeof(pat), "\"%s\"", key);
	const char *p = strstr(buf, pat);
	if (!p)
		return fallback;
	p = strchr(p + strlen(pat), ':');
	if (!p)
		return fallback;
	return atoi(p + 1);
}

static bool json_has_token(const char *buf, const char *key, const char *token)
{
	char pat[48];
	snprintf(pat, sizeof(pat), "\"%s\"", key);
	const char *p = strstr(buf, pat);
	if (!p)
		return false;
	return strstr(p, token) != NULL;
}

static const char *data_dir(void)
{
	const char *d = getenv("ONEKVM_EXTENSION_DATA");
	return d && d[0] ? d : "/data/onekvm/app-data/screen-display";
}

static const char *config_path(void)
{
	static char path[256];
	const char *d = getenv("ONEKVM_EXTENSION_CONFIG");
	if (d && d[0]) {
		snprintf(path, sizeof(path), "%s/config.json", d);
		return path;
	}
	return "/run/onekvm/extensions/screen-display/config.json";
}

static struct widget *find_widget(const char *id)
{
	for (int i = 0; i < widget_n; i++) {
		if (strcmp(widgets[i].id, id) == 0)
			return &widgets[i];
	}
	return NULL;
}

static struct widget *upsert_widget(const char *id)
{
	struct widget *w = find_widget(id);
	if (w)
		return w;
	if (widget_n >= MAX_WIDGETS)
		return NULL;
	w = &widgets[widget_n++];
	memset(w, 0, sizeof(*w));
	snprintf(w->id, sizeof(w->id), "%s", id);
	w->accent = COL_INK;
	w->order = 100;
	return w;
}

static void apply_widget_json(struct widget *w, const char *buf)
{
	json_str(buf, "source", w->source, sizeof(w->source));
	json_str(buf, "title", w->title, sizeof(w->title));
	json_str(buf, "glyph", w->glyph, sizeof(w->glyph));
	json_str(buf, "icon", w->icon, sizeof(w->icon));
	json_str(buf, "subtitle", w->subtitle, sizeof(w->subtitle));
	if (json_str(buf, "accent", w->accent_name, sizeof(w->accent_name)))
		w->accent = accent_of(w->accent_name);
	if (strstr(buf, "\"on\""))
		w->on = json_bool(buf, "on", w->on);
	w->order = json_int(buf, "order", w->order);
	if (strstr(buf, "\"slots\"")) {
		w->slot_comp = json_has_token(buf, "slots", "complication");
		w->slot_app = json_has_token(buf, "slots", "app");
	}
	json_str(buf, "image", w->image, sizeof(w->image));
	if (strstr(buf, "\"frames\""))
		parse_id_array(buf, "frames", w->frames, &w->frame_n, 8);
	w->frame_ms = json_int(buf, "frame_ms", w->frame_n ? 100 : 0);
}

static uint64_t now_ms(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (uint64_t)ts.tv_sec * 1000 + (uint64_t)ts.tv_nsec / 1000000;
}

static int load_rgb565(const char *path, uint16_t *out, int *iw, int *ih)
{
	FILE *f = fopen(path, "rb");
	if (!f)
		return -1;
	char mag[4];
	uint16_t wh[2];
	if (fread(mag, 1, 4, f) != 4 || memcmp(mag, "R565", 4) != 0 ||
	    fread(wh, 2, 2, f) != 2 || !wh[0] || !wh[1] ||
	    wh[0] > ICON_MAX || wh[1] > ICON_MAX) {
		fclose(f);
		return -1;
	}
	size_t px = (size_t)wh[0] * wh[1];
	if (fread(out, 2, px, f) != px) {
		fclose(f);
		return -1;
	}
	fclose(f);
	*iw = wh[0];
	*ih = wh[1];
	return 0;
}

static void resolve_asset(const struct widget *w, const char *name, char *out, size_t n)
{
	if (!name || !name[0]) {
		out[0] = 0;
		return;
	}
	if (name[0] == '/') {
		snprintf(out, n, "%s", name);
		return;
	}
	snprintf(out, n, "%s/%s", w->asset_dir[0] ? w->asset_dir : ".", name);
}

static void blit_icon(int cx, int cy, const uint16_t *pix, int iw, int ih)
{
	int x0 = cx - iw / 2, y0 = cy - ih / 2;
	for (int y = 0; y < ih; y++) {
		for (int x = 0; x < iw; x++) {
			uint16_t c = pix[y * iw + x];
			if (c)
				put(x0 + x, y0 + y, c);
		}
	}
}

static bool widget_has_media(const struct widget *w)
{
	return w->image[0] || w->frame_n > 0;
}

static void draw_widget_media(int cx, int cy, const struct widget *w)
{
	char path[320];
	const char *name = w->image;
	if (w->frame_n > 0) {
		int step = w->frame_ms > 0 ? w->frame_ms : 100;
		name = w->frames[(now_ms() / (uint64_t)step) % (uint64_t)w->frame_n];
	}
	resolve_asset(w, name, path, sizeof(path));
	uint16_t pix[ICON_MAX * ICON_MAX];
	int iw = 0, ih = 0;
	if (path[0] && load_rgb565(path, pix, &iw, &ih) == 0)
		blit_icon(cx, cy, pix, iw, ih);
}

static void draw_widget_icon(int cx, int cy, const struct widget *w, uint16_t c)
{
	if (widget_has_media(w)) {
		draw_widget_media(cx, cy, w);
		return;
	}
	const char *id = w->icon[0] ? w->icon : w->id;
	if (!strcmp(id, "hdmi"))
		icon_hdmi(cx, cy, c);
	else if (!strcmp(id, "usb"))
		icon_usb(cx, cy, c);
	else if (!strcmp(id, "net"))
		icon_net(cx, cy, c);
	else if (!strcmp(id, "settings"))
		icon_settings(cx, cy, c);
	else
		text_ui(cx - text_ui_w(w->glyph[0] ? w->glyph : "?") / 2, cy + 4,
			w->glyph[0] ? w->glyph : "?", c);
}

static void seed_builtins(void)
{
	widget_n = 0;
	struct widget *h = upsert_widget("hdmi");
	if (h) {
		snprintf(h->source, sizeof(h->source), "screen-display");
		snprintf(h->title, sizeof(h->title), "HDMI");
		snprintf(h->glyph, sizeof(h->glyph), "H");
		snprintf(h->icon, sizeof(h->icon), "hdmi");
		snprintf(h->subtitle, sizeof(h->subtitle), hdmi_on ? "LIVE" : "IDLE");
		h->accent = COL_AMBER;
		h->on = hdmi_on;
		h->slot_comp = false;
		h->slot_app = false;
		h->builtin = true;
		h->order = 10;
	}
	struct widget *u = upsert_widget("usb");
	if (u) {
		snprintf(u->source, sizeof(u->source), "screen-display");
		snprintf(u->title, sizeof(u->title), "USB");
		snprintf(u->glyph, sizeof(u->glyph), "U");
		snprintf(u->icon, sizeof(u->icon), "usb");
		snprintf(u->subtitle, sizeof(u->subtitle), usb_on ? "HID" : "OFF");
		u->accent = COL_CYAN;
		u->on = usb_on;
		u->slot_comp = false;
		u->slot_app = false;
		u->builtin = true;
		u->order = 20;
	}
	struct widget *n = upsert_widget("net");
	if (n) {
		snprintf(n->source, sizeof(n->source), "screen-display");
		snprintf(n->title, sizeof(n->title), "NET");
		snprintf(n->glyph, sizeof(n->glyph), "N");
		snprintf(n->icon, sizeof(n->icon), "net");
		snprintf(n->subtitle, sizeof(n->subtitle), "ETH");
		n->accent = COL_VIOLET;
		n->on = true;
		n->slot_comp = false;
		n->slot_app = false;
		n->builtin = true;
		n->order = 30;
	}
	struct widget *s = upsert_widget("settings");
	if (s) {
		snprintf(s->source, sizeof(s->source), "screen-display");
		snprintf(s->title, sizeof(s->title), "设置");
		snprintf(s->glyph, sizeof(s->glyph), "S");
		snprintf(s->icon, sizeof(s->icon), "settings");
		snprintf(s->subtitle, sizeof(s->subtitle), "DISP");
		s->accent = COL_INK;
		s->on = true;
		s->slot_comp = false;
		s->slot_app = true;
		s->builtin = true;
		s->order = 90;
	}
}

static void load_widget_dir(const char *dir)
{
	DIR *d = opendir(dir);
	if (!d)
		return;
	struct dirent *e;
	while ((e = readdir(d))) {
		size_t len = strlen(e->d_name);
		if (len < 6 || strcmp(e->d_name + len - 5, ".json") != 0)
			continue;
		char path[320], buf[768];
		snprintf(path, sizeof(path), "%s/%s", dir, e->d_name);
		FILE *f = fopen(path, "r");
		if (!f)
			continue;
		size_t n = fread(buf, 1, sizeof(buf) - 1, f);
		fclose(f);
		buf[n] = 0;
		char id[32] = {0};
		if (!json_str(buf, "id", id, sizeof(id)) || !id[0]) {
			memcpy(id, e->d_name, len - 5);
			id[len - 5] = 0;
		}
		struct widget *w = upsert_widget(id);
		if (w) {
			snprintf(w->asset_dir, sizeof(w->asset_dir), "%s", dir);
			apply_widget_json(w, buf);
		}
	}
	closedir(d);
}

static void parse_id_array(const char *buf, const char *key, char out[][32], int *n, int max)
{
	char pat[48];
	snprintf(pat, sizeof(pat), "\"%s\"", key);
	const char *p = strstr(buf, pat);
	*n = 0;
	if (!p)
		return;
	p = strchr(p, '[');
	if (!p)
		return;
	const char *end = strchr(p, ']');
	if (!end)
		return;
	p++;
	while (p < end && *n < max) {
		const char *q = strchr(p, '"');
		if (!q || q >= end)
			break;
		q++;
		const char *e = strchr(q, '"');
		if (!e || e > end)
			break;
		int len = (int)(e - q);
		if (len > 31)
			len = 31;
		memcpy(out[*n], q, (size_t)len);
		out[*n][len] = 0;
		(*n)++;
		p = e + 1;
	}
}

static void load_layout(void)
{
	layout_comp_n = 0;
	layout_app_n = 0;
	FILE *f = fopen(config_path(), "r");
	if (!f)
		return;
	char buf[4096];
	size_t n = fread(buf, 1, sizeof(buf) - 1, f);
	fclose(f);
	buf[n] = 0;
	json_str(buf, "transition", trans_name, sizeof(trans_name));
	int ms = json_int(buf, "transition_ms", trans_ms);
	if (ms >= 80 && ms <= 800)
		trans_ms = ms;
	int br = json_int(buf, "brightness", brightness_pct);
	if (br >= 5 && br <= 100)
		brightness_pct = br;
	char nested[2048];
	char view[8] = {0};
	if (json_str(buf, "layout_json", nested, sizeof(nested))) {
		parse_id_array(nested, "complications", layout_comp, &layout_comp_n, 8);
		parse_id_array(nested, "apps", layout_app, &layout_app_n, 8);
		json_str(nested, "app_view", view, sizeof(view));
	} else {
		parse_id_array(buf, "complications", layout_comp, &layout_comp_n, 8);
		parse_id_array(buf, "apps", layout_app, &layout_app_n, 8);
		json_str(buf, "app_view", view, sizeof(view));
	}
	if (!strcmp(view, "list") || !strcmp(view, "icons"))
		snprintf(app_view, sizeof(app_view), "%s", view);
	if (layout_app_n <= 0) {
		snprintf(layout_app[0], sizeof(layout_app[0]), "settings");
		layout_app_n = 1;
	}
	struct stat st;
	time_t cfg_m = 0;
	if (stat(config_path(), &st) == 0)
		cfg_m = st.st_mtime;
	char bpath[320];
	snprintf(bpath, sizeof(bpath), "%s/brightness", data_dir());
	if (stat(bpath, &st) == 0 && (!cfg_m || st.st_mtime >= cfg_m)) {
		FILE *bf = fopen(bpath, "r");
		int v = 0;
		if (bf && fscanf(bf, "%d", &v) == 1 && v >= 5 && v <= 100)
			brightness_pct = v;
		if (bf)
			fclose(bf);
	}
	char vpath[320];
	snprintf(vpath, sizeof(vpath), "%s/app_view", data_dir());
	if (stat(vpath, &st) == 0 && (!cfg_m || st.st_mtime >= cfg_m)) {
		FILE *vf = fopen(vpath, "r");
		char vbuf[8] = {0};
		if (vf && fscanf(vf, "%7s", vbuf) == 1 &&
		    (!strcmp(vbuf, "list") || !strcmp(vbuf, "icons")))
			snprintf(app_view, sizeof(app_view), "%s", vbuf);
		if (vf)
			fclose(vf);
	}
	apply_brightness();
}

static int cmp_widget(const void *a, const void *b)
{
	const struct widget *wa = a, *wb = b;
	if (wa->order != wb->order)
		return wa->order - wb->order;
	return strcmp(wa->id, wb->id);
}

static void refresh_widgets(void)
{
	seed_builtins();
	load_widget_dir("/usr/share/onekvm/display/widgets");
	char dataw[320];
	snprintf(dataw, sizeof(dataw), "%s/widgets", data_dir());
	load_widget_dir(dataw);
	load_widget_dir("/run/onekvm/display/widgets");
	if (widgets[0].id[0])
		qsort(widgets, (size_t)widget_n, sizeof(widgets[0]), cmp_widget);
	load_layout();
}

static bool widget_in_list(const struct widget *w, char list[][32], int n, bool slot)
{
	if (n <= 0)
		return slot;
	for (int i = 0; i < n; i++) {
		if (strcmp(list[i], w->id) == 0)
			return true;
	}
	return false;
}

static int collect_widgets(struct widget **out, int max, bool apps)
{
	int n = 0;
	for (int i = 0; i < widget_n && n < max; i++) {
		struct widget *w = &widgets[i];
		if (w->builtin && strcmp(w->id, "settings") != 0)
			continue;
		if (apps) {
			if (w->slot_app && widget_in_list(w, layout_app, layout_app_n, true))
				out[n++] = w;
		} else if (w->slot_comp && widget_in_list(w, layout_comp, layout_comp_n, true)) {
			out[n++] = w;
		}
	}
	return n;
}

static void read_ip(void)
{
	struct ifaddrs *ifa, *p;
	if (getifaddrs(&ifa) != 0)
		return;
	for (p = ifa; p; p = p->ifa_next) {
		if (!p->ifa_addr || p->ifa_addr->sa_family != AF_INET)
			continue;
		if (!(p->ifa_flags & IFF_UP) || (p->ifa_flags & IFF_LOOPBACK))
			continue;
		struct sockaddr_in *in = (struct sockaddr_in *)p->ifa_addr;
		inet_ntop(AF_INET, &in->sin_addr, ip_text, sizeof(ip_text));
		break;
	}
	freeifaddrs(ifa);
}

static bool file_has(const char *path, const char *needle)
{
	char buf[256];
	FILE *f = fopen(path, "r");
	if (!f)
		return false;
	size_t n = fread(buf, 1, sizeof(buf) - 1, f);
	fclose(f);
	buf[n] = 0;
	return strstr(buf, needle) != NULL;
}

static bool cmd_has(const char *cmd, const char *needle)
{
	char buf[512];
	FILE *f = popen(cmd, "r");
	if (!f)
		return false;
	size_t n = fread(buf, 1, sizeof(buf) - 1, f);
	pclose(f);
	buf[n] = 0;
	return strstr(buf, needle) != NULL;
}

static void refresh_status(void)
{
	hdmi_on = file_has("/run/onekvm/status.json", "\"hdmi_connected\":true") ||
		  file_has("/tmp/onekvm-status.json", "\"hdmi_connected\":true") ||
		  cmd_has("wget -q -O- --timeout=1 --no-check-certificate "
			  "https://127.0.0.1/api/status",
			  "\"hdmi_connected\":true");
	usb_on = file_has("/sys/class/udc/ffb00000.usb/state", "configured");
	read_ip();
}

static void bezel_ticks(void)
{
	for (int i = 0; i < 60; i++) {
		int x0, y0, x1, y1;
		int hour = (i % 15 == 0);
		int five = (i % 5 == 0);
		int inner = hour ? 105 : five ? 111 : 115;
		polar(i, inner, &x0, &y0);
		polar(i, 118, &x1, &y1);
		stroke_seg((float)x0, (float)y0, (float)x1, (float)y1,
			   hour ? 1.25f : five ? 0.7f : 0.35f,
			   hour ? COL_INK : five ? COL_TICK : COL_DIM);
	}
}

static void second_pip(int sec)
{
	int x, y;
	polar(sec, 116, &x, &y);
	disc(x, y, 3, COL_DATE);
	disc(x, y, 1, COL_INK);
}

static void complication(int x, int y, const struct widget *w)
{
	disc(x, y, 16, COL_VOID);
	ring(x, y, 16, 2, w->on ? w->accent : COL_DIM);
	draw_widget_icon(x, y, w, w->on ? w->accent : COL_MUTE);
}

static void draw_home(struct tm *tm)
{
	char clock[8], date[16];
	static const char *wd[] = {"SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"};

	fill(COL_BG);
	bezel_ticks();
	second_pip(tm->tm_sec);

	snprintf(date, sizeof(date), "%s  %d", wd[tm->tm_wday], tm->tm_mday);
	text_ui_c(72, date, COL_DATE);

	snprintf(clock, sizeof(clock), "%02d:%02d", tm->tm_hour, tm->tm_min);
	text_time((W - text_time_w(clock)) / 2, 128, clock, COL_INK);
}

static bool apps_list_view(void)
{
	return strcmp(app_view, "list") == 0;
}

static void app_orb(int x, int y, const struct widget *w)
{
	icon_hole = COL_PLATE;
	icon_r = 16;
	watch_plate(x, y, 40);
	draw_widget_icon(x, y, w, COL_INK);
	icon_r = 12;
	icon_hole = COL_BG;
}

static void app_row(int x, int y, const struct widget *w)
{
	icon_hole = COL_PLATE;
	icon_r = 10;
	watch_plate(x, y, 22);
	draw_widget_icon(x, y, w, COL_INK);
	icon_r = 12;
	icon_hole = COL_BG;
	text_ui(x + 32, y + 5, w->title, COL_INK);
}

static void app_slot(int i, int n, int *x, int *y)
{
	if (apps_list_view()) {
		*x = 56;
		*y = (n == 1) ? 120 : 72 + i * 48;
		return;
	}
	static const int pos[][2] = {
		{70, 108}, {170, 108}, {120, 168},
		{70, 168}, {170, 168}, {120, 108},
	};
	if (n == 1) {
		*x = 120;
		*y = 124;
		return;
	}
	if (n == 2) {
		*x = i == 0 ? 80 : 160;
		*y = 124;
		return;
	}
	if (n == 4) {
		static const int quad[][2] = {
			{70, 104}, {170, 104}, {70, 168}, {170, 168},
		};
		*x = quad[i][0];
		*y = quad[i][1];
		return;
	}
	*x = pos[i][0];
	*y = pos[i][1];
}

static void draw_apps(void)
{
	fill(COL_BG);
	struct widget *apps[6];
	int n = collect_widgets(apps, 6, true);
	for (int i = 0; i < n; i++) {
		int x, y;
		app_slot(i, n, &x, &y);
		if (apps_list_view())
			app_row(x, y, apps[i]);
		else
			app_orb(x, y, apps[i]);
	}
}

static void draw_detail(void)
{
	const struct widget *w = find_widget(detail_id);
	fill(COL_BG);
	if (!w) {
		text_ui_c(120, "?", COL_MUTE);
		return;
	}
	icon_hole = COL_PLATE;
	icon_r = 11;
	watch_plate(CX, 46, 24);
	draw_widget_icon(CX, 46, w, COL_INK);
	icon_r = 12;
	icon_hole = COL_BG;
	text_ui_c(78, w->title, COL_INK);
	if (!strcmp(w->id, "settings")) {
		char line[24];
		text_ui_c(100, "亮度", COL_MUTE);
		int bar_x = 48, bar_w = 144, bar_y = 112;
		rect_fill(bar_x, bar_y, bar_w, 8, COL_DIM);
		rect_fill(bar_x, bar_y, bar_w * brightness_pct / 100, 8, COL_INK);
		snprintf(line, sizeof(line), "%d%%", brightness_pct);
		text_ui_c(136, line, COL_INK);
		text_ui_c(154, "显示", COL_MUTE);
		int icons = !apps_list_view();
		rect_fill(36, 168, 80, 28, icons ? COL_INK : COL_DIM);
		rect_fill(124, 168, 80, 28, icons ? COL_DIM : COL_INK);
		text_ui(36 + (80 - text_ui_w("图标")) / 2, 186, "图标",
			icons ? COL_VOID : COL_INK);
		text_ui(124 + (80 - text_ui_w("列表")) / 2, 186, "列表",
			icons ? COL_INK : COL_VOID);
	} else if (w->subtitle[0]) {
		text_ui_c(120, w->subtitle, COL_MUTE);
	}
}

static void draw_screen(int which)
{
	time_t t = time(NULL);
	struct tm tm;
	localtime_r(&t, &tm);
	if (which == 2)
		draw_detail();
	else if (which == 1)
		draw_apps();
	else
		draw_home(&tm);
	last_second = tm.tm_sec;
}

static void slide_to(int dest, int dir)
{
	draw_screen(screen);
	memcpy(prev_fb, fb, sizeof(fb));
	screen = dest;
	draw_screen(screen);
	memcpy(next_fb, fb, sizeof(fb));
	int frames = trans_ms / 16;
	if (frames < 6)
		frames = 6;
	if (frames > 24)
		frames = 24;
	if (strcmp(trans_name, "fade") == 0) {
		for (int i = 1; i <= frames; i++) {
			for (int p = 0; p < W * H; p++) {
				uint16_t a = prev_fb[p], b = next_fb[p];
				unsigned ar = (a >> 11) & 31, ag = (a >> 5) & 63, ab = a & 31;
				unsigned br = (b >> 11) & 31, bg = (b >> 5) & 63, bb = b & 31;
				unsigned r = (ar * (frames - i) + br * i) / frames;
				unsigned g = (ag * (frames - i) + bg * i) / frames;
				unsigned bl = (ab * (frames - i) + bb * i) / frames;
				fb[p] = (uint16_t)((r << 11) | (g << 5) | bl);
			}
			present_fb();
		}
	} else {
		/* slide: dest enters from the swipe side */
		for (int i = 1; i <= frames; i++) {
			int k = i * 256 / frames;
			k = (k * k * (768 - 2 * k)) >> 16; /* smoothstep-ish */
			int ox = dir * (240 - (240 * k) / 256);
			for (int y = 0; y < H; y++) {
				for (int x = 0; x < W; x++) {
					int sx = x - ox;
					uint16_t c = COL_BG;
					if (sx >= 0 && sx < W)
						c = next_fb[y * W + sx];
					else {
						int px = x - ox + (dir > 0 ? -W : W);
						if (px >= 0 && px < W)
							c = prev_fb[y * W + px];
					}
					fb[y * W + x] = c;
				}
			}
			present_fb();
		}
	}
	memcpy(fb, next_fb, sizeof(fb));
	present_fb();
}

static void persist_brightness(void)
{
	char path[320], buf[16];
	snprintf(path, sizeof(path), "%s/brightness", data_dir());
	int n = snprintf(buf, sizeof(buf), "%d\n", brightness_pct);
	write_file(path, buf, (size_t)n);
}

static void persist_app_view(void)
{
	char path[320], buf[16];
	snprintf(path, sizeof(path), "%s/app_view", data_dir());
	int n = snprintf(buf, sizeof(buf), "%s\n", app_view);
	write_file(path, buf, (size_t)n);
}

static void apply_brightness(void)
{
	DIR *d = opendir("/sys/class/backlight");
	if (!d)
		return;
	struct dirent *e;
	while ((e = readdir(d))) {
		if (e->d_name[0] == '.')
			continue;
		char path[160], maxs[16];
		snprintf(path, sizeof(path),
			 "/sys/class/backlight/%s/max_brightness", e->d_name);
		FILE *f = fopen(path, "r");
		int max = 17;
		if (f && fgets(maxs, sizeof(maxs), f))
			max = atoi(maxs);
		if (f)
			fclose(f);
		if (max < 1)
			max = 1;
		int val = brightness_pct * max / 100;
		if (val < 1)
			val = 1;
		if (val > max)
			val = max;
		snprintf(path, sizeof(path),
			 "/sys/class/backlight/%s/brightness", e->d_name);
		f = fopen(path, "w");
		if (f) {
			fprintf(f, "%d\n", val);
			fclose(f);
		}
	}
	closedir(d);
}

static void present(void)
{
	draw_screen(screen);
	present_fb();
}

static void open_app_at(int x, int y)
{
	struct widget *apps[6];
	int n = collect_widgets(apps, 6, true);
	int best = -1, bestd = apps_list_view() ? 28 * 28 : 44 * 44;
	for (int i = 0; i < n; i++) {
		int ax, ay;
		app_slot(i, n, &ax, &ay);
		if (apps_list_view()) {
			int ddy = y - ay;
			if (ddy < 0)
				ddy = -ddy;
			if (ddy <= 24 && x >= 28 && x <= 212) {
				best = i;
				break;
			}
			continue;
		}
		int ddx = x - ax, ddy = y - ay;
		int d = ddx * ddx + ddy * ddy;
		if (d < bestd) {
			bestd = d;
			best = i;
		}
	}
	if (best < 0)
		return;
	snprintf(detail_id, sizeof(detail_id), "%s", apps[best]->id);
	slide_to(2, 1);
}

static void handle_detail_tap(int x, int y)
{
	if (strcmp(detail_id, "settings") != 0)
		return;
	if (y >= 156 && y <= 204) {
		if (x < CX)
			snprintf(app_view, sizeof(app_view), "icons");
		else
			snprintf(app_view, sizeof(app_view), "list");
		persist_app_view();
		present();
		return;
	}
	if (y < 100 || y > 148)
		return;
	if (x < CX)
		brightness_pct -= 10;
	else
		brightness_pct += 10;
	if (brightness_pct < 5)
		brightness_pct = 5;
	if (brightness_pct > 100)
		brightness_pct = 100;
	apply_brightness();
	persist_brightness();
	present();
}

static int open_evdev(void)
{
	DIR *d = opendir("/dev/input");
	if (!d)
		return -1;
	struct dirent *e;
	int fd = -1;
	while ((e = readdir(d))) {
		if (strncmp(e->d_name, "event", 5) != 0)
			continue;
		char path[128];
		snprintf(path, sizeof(path), "/dev/input/%s", e->d_name);
		int c = open(path, O_RDONLY | O_NONBLOCK);
		if (c < 0)
			continue;
		unsigned long bits = 0;
		ioctl(c, EVIOCGBIT(0, sizeof(bits)), &bits);
		if (bits & (1UL << EV_ABS)) {
			struct input_absinfo ax, ay;
			if (ioctl(c, EVIOCGABS(ABS_X), &ax) == 0 && ax.maximum > ax.minimum)
				touch_max_x = ax.maximum;
			if (ioctl(c, EVIOCGABS(ABS_Y), &ay) == 0 && ay.maximum > ay.minimum)
				touch_max_y = ay.maximum;
			fd = c;
			break;
		}
		close(c);
	}
	closedir(d);
	return fd;
}

static void handle_touch(void)
{
	if (ev_fd < 0)
		return;
	struct input_event ev;
	static int down, sx, sy, cx, cy;
	while (read(ev_fd, &ev, sizeof(ev)) == sizeof(ev)) {
		if (ev.type == EV_ABS && ev.code == ABS_X) {
			int px = touch_max_x > 0 ? ev.value * (panel_w - 1) / touch_max_x : ev.value;
			cx = to_log_x(px);
		}
		if (ev.type == EV_ABS && ev.code == ABS_Y) {
			int py = touch_max_y > 0 ? ev.value * (panel_h - 1) / touch_max_y : ev.value;
			cy = to_log_y(py);
		}
		if (ev.type == EV_KEY && ev.code == BTN_TOUCH && ev.value == 1) {
			down = 1;
			sx = cx;
			sy = cy;
		}
		if (ev.type == EV_KEY && ev.code == BTN_TOUCH && ev.value == 0 && down) {
			down = 0;
			int dx = cx - sx;
			int dy = cy - sy;
			int adx = dx < 0 ? -dx : dx;
			int ady = dy < 0 ? -dy : dy;
			if (dx > SWIPE_MIN && adx > ady) {
				if (screen == 0)
					slide_to(1, 1);
			} else if (dx < -SWIPE_MIN && adx > ady) {
				if (screen == 2)
					slide_to(1, -1);
				else if (screen == 1)
					slide_to(0, -1);
			} else if (adx < 18 && ady < 18) {
				if (screen == 1)
					open_app_at(sx, sy);
				else if (screen == 2)
					handle_detail_tap(sx, sy);
			}
		}
	}
}

static void wake_backlight(void)
{
	apply_brightness();
	int blank = open("/sys/class/graphics/fb0/blank", O_WRONLY);
	if (blank >= 0) {
		if (write(blank, "0\n", 2) < 0)
			/* ignore */;
		close(blank);
	}
}

static void hide_fbcon_cursor(void)
{
	int fd = open("/sys/class/graphics/fbcon/cursor_blink", O_WRONLY);
	if (fd >= 0) {
		if (write(fd, "0\n", 2) < 0)
			/* ignore */;
		close(fd);
	}
	DIR *d = opendir("/sys/class/vtconsole");
	if (d) {
		struct dirent *e;
		while ((e = readdir(d))) {
			char namep[160], name[80], bindp[160];
			FILE *f;

			if (e->d_name[0] == '.')
				continue;
			snprintf(namep, sizeof(namep),
				 "/sys/class/vtconsole/%s/name", e->d_name);
			f = fopen(namep, "r");
			if (!f)
				continue;
			if (!fgets(name, sizeof(name), f)) {
				fclose(f);
				continue;
			}
			fclose(f);
			if (!strstr(name, "frame buffer"))
				continue;
			snprintf(bindp, sizeof(bindp),
				 "/sys/class/vtconsole/%s/bind", e->d_name);
			f = fopen(bindp, "w");
			if (f) {
				fputs("0\n", f);
				fclose(f);
			}
		}
		closedir(d);
	}
	fd = open("/dev/tty1", O_RDWR | O_NOCTTY);
	if (fd < 0)
		fd = open("/dev/tty0", O_RDWR | O_NOCTTY);
	if (fd >= 0) {
		ioctl(fd, KDSETMODE, KD_GRAPHICS);
		if (write(fd, "\033[?25l", 6) < 0)
			/* ignore */;
		close(fd);
	}
}

static int map_fb(void)
{
	fb_fd = open("/dev/fb0", O_RDWR);
	if (fb_fd < 0) {
		perror("/dev/fb0");
		return -1;
	}
	struct fb_var_screeninfo v;
	struct fb_fix_screeninfo f;
	if (ioctl(fb_fd, FBIOGET_VSCREENINFO, &v) ||
	    ioctl(fb_fd, FBIOGET_FSCREENINFO, &f)) {
		perror("fb ioctl");
		return -1;
	}
	dev_len = f.smem_len;
	fb_stride = f.line_length / 2;
	panel_w = (int)v.xres;
	panel_h = (int)v.yres;
	panel_bpp = (int)v.bits_per_pixel;
	if (panel_w < 8)
		panel_w = LOG_W;
	if (panel_h < 8)
		panel_h = LOG_H;
	panel_round = panel_is_round(panel_w, panel_h);
	compute_view();
	if (fb_stride < panel_w)
		fb_stride = panel_w;
	dev = mmap(NULL, dev_len, PROT_READ | PROT_WRITE, MAP_SHARED, fb_fd, 0);
	if (dev == MAP_FAILED) {
		perror("mmap fb");
		dev = NULL;
		return -1;
	}
	fprintf(stderr, "fb0 %dx%d bpp=%d line=%u shape=%s view=%dx%d@%d,%d\n",
		panel_w, panel_h, panel_bpp, f.line_length,
		panel_round ? "round" : "rect",
		view_dw, view_dh, view_ox, view_oy);
	if (panel_bpp != 16)
		fprintf(stderr, "warning: presenter expects RGB565\n");
	return 0;
}

static int cmd_info(void)
{
	int fd = open("/dev/fb0", O_RDONLY);
	if (fd < 0) {
		fputs("{\"ok\":false,\"error\":\"no framebuffer\"}\n", stdout);
		return 1;
	}
	struct fb_var_screeninfo v;
	if (ioctl(fd, FBIOGET_VSCREENINFO, &v) != 0) {
		close(fd);
		fputs("{\"ok\":false,\"error\":\"fb ioctl\"}\n", stdout);
		return 1;
	}
	close(fd);
	int w = (int)v.xres, h = (int)v.yres;
	bool round = panel_is_round(w, h);
	printf("{\"ok\":true,\"width\":%d,\"height\":%d,\"bpp\":%u,\"shape\":\"%s\","
	       "\"device\":\"/dev/fb0\"}\n",
	       w, h, v.bits_per_pixel, round ? "round" : "rect");
	return 0;
}

static void mkpath(const char *path)
{
	char tmp[320];
	snprintf(tmp, sizeof(tmp), "%s", path);
	for (char *p = tmp + 1; *p; p++) {
		if (*p == '/') {
			*p = 0;
			mkdir(tmp, 0755);
			*p = '/';
		}
	}
	mkdir(tmp, 0755);
}

static int write_file(const char *path, const char *buf, size_t n)
{
	char tmp[336];
	snprintf(tmp, sizeof(tmp), "%s.tmp", path);
	FILE *f = fopen(tmp, "w");
	if (!f)
		return -1;
	if (fwrite(buf, 1, n, f) != n) {
		fclose(f);
		unlink(tmp);
		return -1;
	}
	fclose(f);
	return rename(tmp, path);
}

static int cmd_widget(int argc, char **argv)
{
	if (argc < 1)
		return 2;
	if (strcmp(argv[0], "list") == 0) {
		refresh_status();
		refresh_widgets();
		fputs("{\"ok\":true,\"widgets\":[", stdout);
		for (int i = 0; i < widget_n; i++) {
			const struct widget *w = &widgets[i];
			if (i)
				fputc(',', stdout);
			printf("{\"id\":\"%s\",\"source\":\"%s\",\"title\":\"%s\",\"glyph\":\"%s\","
			       "\"icon\":\"%s\",\"subtitle\":\"%s\",\"accent\":\"%s\",\"on\":%s,"
			       "\"slots\":[%s%s%s],\"order\":%d,\"builtin\":%s}",
			       w->id, w->source, w->title, w->glyph,
			       w->icon[0] ? w->icon : w->id, w->subtitle,
			       w->accent_name[0] ? w->accent_name : "ink",
			       w->on ? "true" : "false",
			       w->slot_comp ? "\"complication\"" : "",
			       w->slot_comp && w->slot_app ? "," : "",
			       w->slot_app ? "\"app\"" : "",
			       w->order, w->builtin ? "true" : "false");
		}
		fputs("]}\n", stdout);
		return 0;
	}
	if (strcmp(argv[0], "register") == 0) {
		char buf[768];
		size_t n = fread(buf, 1, sizeof(buf) - 1, stdin);
		buf[n] = 0;
		char id[32] = {0};
		if (!json_str(buf, "id", id, sizeof(id)) || !id[0]) {
			fputs("{\"ok\":false,\"error\":\"id required\"}\n", stdout);
			return 1;
		}
		for (const char *p = id; *p; p++) {
			if (!((*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') ||
			      *p == '-' || *p == '_')) {
				fputs("{\"ok\":false,\"error\":\"invalid id\"}\n", stdout);
				return 1;
			}
		}
		char dir[320], path[360];
		snprintf(dir, sizeof(dir), "%s/widgets", data_dir());
		mkpath(dir);
		snprintf(path, sizeof(path), "%s/%s.json", dir, id);
		if (write_file(path, buf, n) != 0) {
			fputs("{\"ok\":false,\"error\":\"write failed\"}\n", stdout);
			return 1;
		}
		printf("{\"ok\":true,\"id\":\"%s\"}\n", id);
		return 0;
	}
	if (strcmp(argv[0], "unregister") == 0 && argc >= 2) {
		char path[360];
		snprintf(path, sizeof(path), "%s/widgets/%s.json", data_dir(), argv[1]);
		unlink(path);
		snprintf(path, sizeof(path), "/run/onekvm/display/widgets/%s.json", argv[1]);
		unlink(path);
		printf("{\"ok\":true,\"id\":\"%s\"}\n", argv[1]);
		return 0;
	}
	return 2;
}

int main(int argc, char **argv)
{
	if (argc >= 2 && strcmp(argv[1], "--health") == 0)
		return access("/dev/fb0", R_OK | W_OK) == 0 ? 0 : 1;
	if (argc >= 2 && (strcmp(argv[1], "--info") == 0 || strcmp(argv[1], "info") == 0))
		return cmd_info();
	if (argc >= 2 && strcmp(argv[1], "widget") == 0)
		return cmd_widget(argc - 2, argv + 2);

	hide_fbcon_cursor();
	if (map_fb() != 0)
		return 1;
	wake_backlight();
	ev_fd = open_evdev();
	mkpath("/run/onekvm/display/widgets");
	mkpath(data_dir());
	refresh_status();
	refresh_widgets();
	present();
	for (;;) {
		handle_touch();
		time_t t = time(NULL);
		struct tm tm;
		localtime_r(&t, &tm);
		bool anim = false;
		for (int i = 0; i < widget_n; i++) {
			if (widgets[i].frame_n > 1)
				anim = true;
		}
		if (tm.tm_sec != last_second) {
			if (tm.tm_sec % 5 == 0) {
				refresh_status();
				refresh_widgets();
			}
			present();
		} else if (anim) {
			present();
		}
		usleep(16000);
	}
}
