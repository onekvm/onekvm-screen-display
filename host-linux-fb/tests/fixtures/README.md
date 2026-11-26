# H.264 decoder fixture

`main-b-frames.mp4` is a two-second synthetic FFmpeg `testsrc2` animation.
It checks MP4 demuxing and continued Main-profile decoding with reordered
B frames. No third-party footage is included.

Regenerate from the repository root:

```sh
ffmpeg -v error -y -f lavfi -i 'testsrc2=size=64x48:rate=24:duration=2' \
    -an -c:v libx264 -threads 1 -profile:v main -pix_fmt yuv420p \
    -bf 2 -refs 4 -g 48 -crf 28 -movflags +faststart \
    host-linux-fb/tests/fixtures/main-b-frames.mp4
```

`network-names.otf` is a test-only subset of Noto Sans CJK SC Regular, licensed
under [OFL 1.1](../../../packaging/fonts/OFL.txt). It contains `咖啡馆網絡é𠮷` to
exercise runtime network-name glyphs, including characters outside the BMP,
without requiring installed system fonts. It was generated with FontTools
`subset.Subsetter` from `.fonts/NotoSansCJK-SC-Regular.otf`, with
`layout_features=[]`, `recalc_timestamp=False`, and the characters above.

`clock-glyphs.otf` is a test-only subset of the same font and license with
`0123456789: AMP`, generated the same way. It checks that sized text slots
match the baker's metrics and rasterize at any requested size.
