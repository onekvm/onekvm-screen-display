//! Avoid dirtying fbdev mmap pages (and scheduling SPI transfers) when the
//! composed pixels did not change. Framebuffer padding is never overwritten.

pub fn copy_changed_rows(
    dst: &mut [u8],
    src: &[u16],
    width: usize,
    height: usize,
    stride: usize,
) -> bool {
    let mut changed = false;
    for (pixels, row) in src
        .chunks_exact(width)
        .take(height)
        .zip(dst.chunks_exact_mut(stride * 2))
    {
        let bytes = unsafe { std::slice::from_raw_parts(pixels.as_ptr().cast::<u8>(), width * 2) };
        if row[..width * 2] != *bytes {
            row[..width * 2].copy_from_slice(bytes);
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_frames_leave_padding_and_pixels_alone() {
        let mut framebuffer = vec![0xaa; 24];
        let mut pixels = vec![0x1234; 8];
        assert!(copy_changed_rows(&mut framebuffer, &pixels, 4, 2, 6));
        let first = framebuffer.clone();
        assert!(!copy_changed_rows(&mut framebuffer, &pixels, 4, 2, 6));
        assert_eq!(framebuffer, first);
        pixels[7] = 0xbeef;
        assert!(copy_changed_rows(&mut framebuffer, &pixels, 4, 2, 6));
        assert_eq!(&framebuffer[..18], &first[..18]);
        assert_eq!(&framebuffer[18..20], &0xbeefu16.to_ne_bytes());
        assert_eq!(&framebuffer[20..], &[0xaa; 4]);
        assert!(!copy_changed_rows(&mut framebuffer, &pixels, 4, 2, 6));
    }
}
