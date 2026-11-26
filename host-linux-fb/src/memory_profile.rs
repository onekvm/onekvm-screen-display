//! Test-only allocation accounting for the compiled Shell lifecycle checks.
use std::alloc::{GlobalAlloc, Layout};
#[cfg(feature = "compact-heap")]
use crate::heap::Compact as Backend;
#[cfg(not(feature = "compact-heap"))]
use std::alloc::System as Backend;
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use pocket_mod::{qjs::qjs, Guest};
use pocket_ui_surface::UiSurface;
use serde_json::{json, Value};

struct Counted;
static LARGE_PTRS: [AtomicUsize; 64] = [const { AtomicUsize::new(0) }; 64];
static LARGE_SIZES: [AtomicUsize; 64] = [const { AtomicUsize::new(0) }; 64];
fn track(pointer: *mut u8, size: usize) {
    if pointer.is_null() || size < 65536 { return; }
    for (slot, bytes) in LARGE_PTRS.iter().zip(&LARGE_SIZES) {
        if slot.compare_exchange(0, pointer as usize, Relaxed, Relaxed).is_ok() {
            bytes.store(size, Relaxed); return;
        }
    }
}
fn untrack(pointer: *mut u8) {
    for (slot, bytes) in LARGE_PTRS.iter().zip(&LARGE_SIZES) {
        if slot.load(Relaxed) == pointer as usize {
            bytes.store(0, Relaxed); slot.store(0, Relaxed); return;
        }
    }
}

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
static COUNT: AtomicUsize = AtomicUsize::new(0);
#[global_allocator]
static ALLOCATOR: Counted = Counted;

unsafe impl GlobalAlloc for Counted {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = Backend.alloc(layout);
        track(pointer, layout.size());
        if !pointer.is_null() {
            let live = LIVE.fetch_add(layout.size(), Relaxed) + layout.size();
            PEAK.fetch_max(live, Relaxed);
            COUNT.fetch_add(1, Relaxed);
        }
        pointer
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let pointer = Backend.alloc_zeroed(layout);
        track(pointer, layout.size());
        if !pointer.is_null() {
            let live = LIVE.fetch_add(layout.size(), Relaxed) + layout.size();
            PEAK.fetch_max(live, Relaxed);
            COUNT.fetch_add(1, Relaxed);
        }
        pointer
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        if layout.size() >= 65536 { untrack(pointer); }
        Backend.dealloc(pointer, layout);
        LIVE.fetch_sub(layout.size(), Relaxed);
        COUNT.fetch_sub(1, Relaxed);
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        if layout.size() >= 65536 { untrack(pointer); }
        let result = Backend.realloc(pointer, layout, size);
        if result.is_null() { track(pointer, layout.size()); } else { track(result, size); }
        if !result.is_null() {
            let live = if size >= layout.size() {
                LIVE.fetch_add(size - layout.size(), Relaxed) + size - layout.size()
            } else {
                LIVE.fetch_sub(layout.size() - size, Relaxed) - (layout.size() - size)
            };
            PEAK.fetch_max(live, Relaxed);
        }
        result
    }
}

pub fn allocations() -> Value {
    json!({"large_allocations":LARGE_SIZES.iter().map(|slot|slot.load(Relaxed)).filter(|size|*size>0).collect::<Vec<_>>(),"rust_requested_live":LIVE.load(Relaxed),"rust_requested_peak":PEAK.load(Relaxed),"rust_allocation_count":COUNT.load(Relaxed)})
}

pub fn guest(guest: &Guest, surface: &UiSurface, collect: bool) -> Value {
    let usage = guest.with(|ctx| unsafe {
        let runtime = qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
        if collect { qjs::JS_RunGC(runtime); }
        let mut usage = std::mem::zeroed::<qjs::JSMemoryUsage>();
        qjs::JS_ComputeMemoryUsage(runtime, &mut usage);
        usage
    });
    let resources = surface.with_ui(|ui| {
        let fonts: Vec<_> = (0..pocketjs_core::spec::MAX_FONT_SLOTS).filter_map(|slot| {
            let font = ui.font_atlas(slot as u8)?;
            Some(json!({"slot":slot,"glyphs":font.glyph_count,"cell":[font.cell_w,font.cell_h],"density":font.raster_density,"bitmap_bytes":font.bitmap.len(),"bitmap_capacity":font.bitmap.capacity()}))
        }).collect();
        let textures: Vec<_> = (0..ui.texture_slot_count()).filter_map(|slot| {
            let (handle, texture) = ui.texture_at(slot as u32)?;
            Some(json!({"handle":handle,"size":[texture.w,texture.h],"bytes":texture.pixels.len()}))
        }).collect();
        json!({"fonts":fonts,"textures":textures})
    });
    json!({"js":{"malloc_size":usage.malloc_size,"memory_used_size":usage.memory_used_size,"malloc_count":usage.malloc_count,"object_count":usage.obj_count,"object_size":usage.obj_size,"strings":usage.str_size,"bytecode":usage.js_func_code_size,"properties":usage.prop_size,"atoms":usage.atom_size,"shapes":usage.shape_size},"resources":resources})
}
