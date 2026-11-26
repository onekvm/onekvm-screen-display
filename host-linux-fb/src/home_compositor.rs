//! Interleave native home media with guest drawing, preserving painter order.
use pocketjs_core::{
    compositor::draw_op_len, damage::DamageRect, raster, resources::RenderResources, spec::draw_op,
};

#[derive(Clone, Copy, Debug)]
pub struct Surface {
    pub slot: usize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub clip: DamageRect,
}

fn paint_segment(
    ui: &impl RenderResources,
    scissors: &[[u32; 3]],
    words: &[u32],
    target: &mut [u16],
    segment: &mut Vec<u32>,
) {
    if words.is_empty() {
        return;
    }
    segment.clear();
    for scissor in scissors {
        segment.extend_from_slice(scissor);
    }
    segment.extend_from_slice(words);
    raster::render_scaled_rgb565_over(ui, segment, target, 1);
}

#[derive(Default)]
pub struct Scratch {
    scissors: Vec<[u32; 3]>,
    inherited: Vec<[u32; 3]>,
    segment: Vec<u32>,
}

pub fn render(
    ui: &impl RenderResources,
    words: &[u32],
    target: &mut [u16],
    scratch: &mut Scratch,
    mut paint_surface: impl FnMut(Surface, &mut [u16]),
) {
    let Scratch { scissors, inherited, segment } = scratch;
    scissors.clear();
    inherited.clear();
    let mut start = 0;
    let mut at = 0;
    while at < words.len() {
        let Some(end) = draw_op_len(words, at)
            .and_then(|len| at.checked_add(len))
            .filter(|end| *end <= words.len())
        else {
            break;
        };
        match words[at] {
            draw_op::SURFACE_QUAD => {
                paint_segment(ui, inherited, &words[start..at], target, segment);
                let xy = words[at + 6];
                let wh = words[at + 7];
                let x0 = xy as u16 as i16 as i32;
                let y0 = (xy >> 16) as u16 as i16 as i32;
                let surface = Surface {
                    slot: words[at + 1] as usize,
                    x: f32::from_bits(words[at + 2]) as f64,
                    y: f32::from_bits(words[at + 3]) as f64,
                    width: f32::from_bits(words[at + 4]) as f64,
                    height: f32::from_bits(words[at + 5]) as f64,
                    clip: DamageRect::new(
                        x0,
                        y0,
                        x0 + (wh & 0xffff) as i32,
                        y0 + (wh >> 16) as i32,
                    ),
                };
                if [surface.x, surface.y, surface.width, surface.height]
                    .iter()
                    .all(|value| value.is_finite())
                    && surface.width > 0.0
                    && surface.height > 0.0
                {
                    paint_surface(surface, target);
                }
                start = end;
                inherited.clone_from(scissors);
            }
            draw_op::SCISSOR => scissors.push([words[at], words[at + 1], words[at + 2]]),
            draw_op::SCISSOR_POP => {
                scissors.pop();
            }
            _ => {}
        }
        at = end;
    }
    // A malformed tail must not be reinterpreted as another drawing command.
    paint_segment(ui, inherited, &words[start..at], target, segment);
}

#[cfg(test)]
mod tests {
    use super::*;
    use pocketjs_core::Ui;

    #[test]
    fn media_respects_widgets_before_and_after_it_and_nested_clips() {
        let mut ui = Ui::new();
        ui.set_viewport(4.0, 3.0);
        let words = [
            draw_op::RECT,
            0,
            4 | (3 << 16),
            0xff0000ff,
            draw_op::SCISSOR,
            1 | (1 << 16),
            2 | (1 << 16),
            draw_op::SURFACE_QUAD,
            7,
            0f32.to_bits(),
            0f32.to_bits(),
            4f32.to_bits(),
            3f32.to_bits(),
            1 | (1 << 16),
            2 | (1 << 16),
            0,
            draw_op::RECT,
            0,
            4 | (3 << 16),
            0xff00ff00,
            draw_op::SCISSOR_POP,
            draw_op::SURFACE_QUAD,
            8,
            3f32.to_bits(),
            0f32.to_bits(),
            1f32.to_bits(),
            3f32.to_bits(),
            3,
            1 | (3 << 16),
            0,
        ];
        let mut pixels = [0; 12];
        render(&ui, &words, &mut pixels, &mut Scratch::default(), |surface, pixels| {
            let clip = surface.clip;
            for y in clip.y0..clip.y1 {
                for x in clip.x0..clip.x1 {
                    pixels[y as usize * 4 + x as usize] =
                        if surface.slot == 7 { 0xffff } else { 0x001f };
                }
            }
        });
        assert_eq!(
            pixels,
            [
                0xf800, 0xf800, 0xf800, 0x001f, 0xf800, 0x07e0, 0x07e0, 0x001f, 0xf800, 0xf800,
                0xf800, 0x001f
            ]
        );
    }
}
