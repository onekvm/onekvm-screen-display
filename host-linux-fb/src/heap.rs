//! A coalescing native pool plus one disposable pool per QuickJS runtime.
use pocket_mod::Guest;
#[cfg(feature = "compact-heap")]
use std::{
    alloc::{GlobalAlloc, Layout},
    sync::Mutex,
};

pub fn guest() -> anyhow::Result<(Guest, GuestHeap)> {
    #[cfg(feature = "compact-heap")]
    {
        let heap = GuestHeap(std::rc::Rc::new(RuntimeHeap {
            pool: std::cell::RefCell::new(dlmalloc::Dlmalloc::new()),
        }));
        return Ok((Guest::new_with_alloc(JsAllocator(heap.0.clone()))?, heap));
    }
    #[cfg(not(feature = "compact-heap"))]
    Ok((Guest::new()?, GuestHeap))
}

#[cfg(feature = "compact-heap")]
pub struct GuestHeap(std::rc::Rc<RuntimeHeap>);
#[cfg(not(feature = "compact-heap"))]
pub struct GuestHeap;
impl GuestHeap {
    pub fn collect(&self) {
        #[cfg(feature = "compact-heap")]
        unsafe {
            self.0.pool.borrow_mut().trim(0);
        }
    }
}

#[cfg(feature = "compact-heap")]
struct RuntimeHeap {
    pool: std::cell::RefCell<dlmalloc::Dlmalloc>,
}
#[cfg(feature = "compact-heap")]
impl Drop for RuntimeHeap {
    fn drop(&mut self) {
        // dlmalloc deliberately does not destroy pools on Drop. This pool
        // belongs to one runtime, whose allocations have all been released.
        let heap = std::mem::replace(self.pool.get_mut(), dlmalloc::Dlmalloc::new());
        unsafe {
            heap.destroy();
        }
    }
}

#[cfg(feature = "compact-heap")]
struct JsAllocator(std::rc::Rc<RuntimeHeap>);
#[cfg(feature = "compact-heap")]
const HEADER: usize = std::mem::size_of::<usize>();
#[cfg(feature = "compact-heap")]
unsafe impl pocket_mod::qjs::allocator::Allocator for JsAllocator {
    fn alloc(&mut self, size: usize) -> *mut u8 {
        let Some(total) = size.checked_add(HEADER) else {
            return std::ptr::null_mut();
        };
        unsafe {
            let base = self.0.pool.borrow_mut().malloc(total, HEADER);
            if base.is_null() {
                return base;
            }
            base.cast::<usize>().write(size);
            base.add(HEADER)
        }
    }
    fn calloc(&mut self, count: usize, size: usize) -> *mut u8 {
        let Some(size) = count.checked_mul(size) else {
            return std::ptr::null_mut();
        };
        let pointer = self.alloc(size);
        if !pointer.is_null() {
            unsafe {
                pointer.write_bytes(0, size);
            }
        }
        pointer
    }
    unsafe fn dealloc(&mut self, pointer: *mut u8) {
        if pointer.is_null() {
            return;
        }
        let base = pointer.sub(HEADER);
        let size = base.cast::<usize>().read();
        discard_payload(pointer, size);
        self.0.pool.borrow_mut().free(base, size + HEADER, HEADER);
    }
    unsafe fn realloc(&mut self, pointer: *mut u8, size: usize) -> *mut u8 {
        if size == 0 {
            self.dealloc(pointer);
            return std::ptr::null_mut();
        }
        if pointer.is_null() {
            return self.alloc(size);
        }
        let Some(total) = size.checked_add(HEADER) else {
            return std::ptr::null_mut();
        };
        let base = pointer.sub(HEADER);
        let old = base.cast::<usize>().read();
        let next = self
            .0
            .pool
            .borrow_mut()
            .realloc(base, old + HEADER, HEADER, total);
        if next.is_null() {
            return next;
        }
        next.cast::<usize>().write(size);
        next.add(HEADER)
    }
    unsafe fn usable_size(pointer: *mut u8) -> usize {
        if pointer.is_null() {
            0
        } else {
            pointer.sub(HEADER).cast::<usize>().read()
        }
    }
}

pub fn collect() {
    #[cfg(feature = "compact-heap")]
    unsafe {
        HEAP.lock().unwrap().trim(0);
    }
    crate::release_idle_bundle_pages();
    release_unused_stack();
}

/// Starting a guest touches more native code, bundle resources and font pages
/// than steady home rendering. Keep the mappings, but release their clean pages
/// after startup or teardown so Linux faults only the working set back in.
/// This covers the executable, shared libraries and read-only file mappings
/// (PAK, bytecode, fonts). Relocated/patched segments carry private pages
/// (resident or swapped) and are excluded, as are devices and anonymous
/// mappings. MADV_PAGEOUT also drops the clean pages from the page cache, which
/// is charged to the service. There is deliberately no MADV_DONTNEED fallback:
/// it would discard private copy-on-write pages that smaps may not show. Before
/// Linux 5.4 the pages simply stay.
pub fn release_cold_code_pages() {
    #[cfg(target_os = "linux")]
    {
        if unsafe { libc::syscall(libc::SYS_gettid) } != unsafe { libc::getpid() } as libc::c_long {
            return;
        }
        let Ok(maps) = std::fs::read_to_string("/proc/self/smaps") else {
            return;
        };
        let mut own_files = std::collections::BTreeSet::new();
        for (start, end, path) in clean_file_ranges(&maps) {
            unsafe {
                libc::madvise(start as *mut _, end - start, libc::MADV_PAGEOUT);
            }
            if !is_shared_library(path) {
                own_files.insert(path);
            }
        }
        // Pages already unmapped by MADV_DONTNEED (e.g. the per-second Shell
        // collection) are invisible to page-out. Drop the cached pages of the
        // host's own files; pages still mapped stay resident. Shared libraries
        // are left alone because other processes use their cache too.
        for path in own_files {
            if let Ok(file) = std::fs::File::open(path) {
                use std::os::fd::AsRawFd;
                unsafe {
                    libc::posix_fadvise(file.as_raw_fd(), 0, 0, libc::POSIX_FADV_DONTNEED);
                }
            }
        }
    }
}

fn is_shared_library(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or_default();
    name.ends_with(".so") || name.contains(".so.")
}

/// Read-only file mappings without private pages (dirty, anonymous or
/// swapped), excluding devices and memfds. Paths may contain spaces.
fn clean_file_ranges(smaps: &str) -> Vec<(usize, usize, &str)> {
    let mut ranges = Vec::new();
    // (range, path, Private_Dirty seen, no private pages so far)
    type Candidate<'a> = Option<(usize, usize, &'a str, bool, bool)>;
    fn finish<'a>(ranges: &mut Vec<(usize, usize, &'a str)>, current: Candidate<'a>) {
        if let Some((start, end, path, true, true)) = current {
            ranges.push((start, end, path));
        }
    }
    let mut current: Candidate = None;
    for line in smaps.lines() {
        if let Some((field, value)) = line.split_once(':') {
            if matches!(field, "Private_Dirty" | "Anonymous" | "Swap") {
                if let Some(candidate) = current.as_mut() {
                    candidate.3 |= field == "Private_Dirty";
                    candidate.4 &= value.split_whitespace().next() == Some("0");
                }
                continue;
            }
        }
        let Some((range, _)) = line.split_once(' ') else {
            continue;
        };
        let Some((start, end)) = range.split_once('-') else {
            continue;
        };
        let (Ok(start), Ok(end)) = (
            usize::from_str_radix(start, 16),
            usize::from_str_radix(end, 16),
        ) else {
            continue;
        };
        finish(&mut ranges, current.take());
        // range perms offset dev inode [path]
        let mut rest = line;
        let mut perms = "";
        for field in 0..5 {
            let trimmed = rest.trim_start();
            let (value, tail) = trimmed.split_once(char::is_whitespace).unwrap_or((trimmed, ""));
            if field == 1 {
                perms = value;
            }
            rest = tail;
        }
        let path = rest.trim();
        let file = path.starts_with('/') && !path.starts_with("/dev/") && !path.starts_with("/memfd:");
        current = (matches!(perms, "r-xp" | "r--p" | "r--s") && file && end > start).then_some((start, end, path, false, true));
    }
    finish(&mut ranges, current);
    ranges
}

#[cfg(test)]
mod release_tests {
    use super::{clean_file_ranges, is_shared_library};

    #[test]
    fn selects_clean_read_only_file_mappings() {
        let smaps = "\
aaaa0000-aaab0000 r-xp 00000000 00:1a 42                 /usr/libexec/onekvm/onekvm-device-screen-display
Private_Dirty:         0 kB
aaab0000-aaab4000 r--p 00010000 00:1a 42                 /usr/libexec/onekvm/onekvm-device-screen-display
Private_Dirty:        16 kB
aaab4000-aaab5000 rw-p 00014000 00:1a 42                 /usr/libexec/onekvm/onekvm-device-screen-display
Private_Dirty:         4 kB
ffff0000-ffff8000 r--s 00000000 00:1a 50                 /usr/share/onekvm/screen-display/main.vue-vapor.pak
Private_Dirty:         0 kB
ffff8000-ffff9000 r--p 00000000 00:1a 51                 /data/onekvm/app-data/screen-display/app cache/x.jsc
Private_Dirty:         0 kB
ffff9000-ffffa000 rw-s 00000000 00:06 9                  /dev/fb0
Private_Dirty:         0 kB
ffffa000-ffffb000 r--s 00000000 00:06 10                 /dev/fb0
Private_Dirty:         0 kB
ffffb000-ffffc000 r--p 00000000 00:01 81                 /memfd:frames (deleted)
Private_Dirty:         0 kB
ffffc000-ffffd000 rw-p 00000000 00:00 0
Private_Dirty:         4 kB
ffffd000-ffffe000 r--p 00020000 00:1a 77                 /usr/lib/libquickjs.so.1
Private_Dirty:         0 kB
Anonymous:             0 kB
Swap:                  8 kB
ffffe000-fffff000 r--p 00021000 00:1a 77                 /usr/lib/libquickjs.so.1
Private_Dirty:         0 kB
Anonymous:             4 kB
Swap:                  0 kB
fffff000-100000000 r-xp 00000000 00:1a 78                /usr/lib/libm.so.6
Private_Dirty:         0 kB
Anonymous:             0 kB
Swap:                  0 kB
";
        assert_eq!(
            clean_file_ranges(smaps),
            vec![
                (0xaaaa0000, 0xaaab0000, "/usr/libexec/onekvm/onekvm-device-screen-display"),
                (0xffff0000, 0xffff8000, "/usr/share/onekvm/screen-display/main.vue-vapor.pak"),
                (0xffff8000, 0xffff9000, "/data/onekvm/app-data/screen-display/app cache/x.jsc"),
                (0xfffff000, 0x100000000, "/usr/lib/libm.so.6"),
            ]
        );
        assert!(is_shared_library("/usr/lib/libc.so"));
        assert!(is_shared_library("/usr/lib/libgcc_s.so.1"));
        assert!(!is_shared_library("/usr/share/onekvm/screen-display/fallback-font.bin"));
    }
}

/// Startup parsing and a large guest can fault stack pages far below the
/// current frame. Linux retains them after return. Only discard the unused
/// part of the main thread's actual stack VMA; active frames, pthread TLS,
/// guard pages and other mappings are excluded. A 64 KiB cushion also keeps
/// libc's madvise call and any red zone clear of the discarded range.
fn release_unused_stack() {
    #[cfg(target_os = "linux")]
    {
        if unsafe { libc::syscall(libc::SYS_gettid) } != unsafe { libc::getpid() } as libc::c_long {
            return;
        }
        let marker = 0u8;
        let current = &marker as *const u8 as usize;
        let Ok(maps) = std::fs::read_to_string("/proc/self/maps") else {
            return;
        };
        let Some(line) = maps.lines().find(|line| line.ends_with("[stack]")) else {
            return;
        };
        let Some((start, end)) = line
            .split_whitespace()
            .next()
            .and_then(|range| range.split_once('-'))
        else {
            return;
        };
        let (Ok(start), Ok(end)) = (
            usize::from_str_radix(start, 16),
            usize::from_str_radix(end, 16),
        ) else {
            return;
        };
        if current < start || current >= end {
            return;
        }
        let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        if page <= 0 || !(page as usize).is_power_of_two() {
            return;
        }
        let page = page as usize;
        let limit = current.saturating_sub(64 * 1024) & !(page - 1);
        if limit > start {
            unsafe {
                libc::madvise(start as *mut _, limit - start, libc::MADV_DONTNEED);
            }
        }
    }
}

#[cfg(feature = "compact-heap")]
static HEAP: Mutex<dlmalloc::Dlmalloc> = Mutex::new(dlmalloc::Dlmalloc::new());

#[cfg(feature = "compact-heap")]
pub struct Compact;

#[cfg(feature = "compact-heap")]
fn page_size() -> usize {
    static PAGE: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    *PAGE.get_or_init(|| {
        let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        if page > 0 && (page as usize).is_power_of_two() {
            page as usize
        } else {
            4096
        }
    })
}

#[cfg(feature = "compact-heap")]
fn mapped_size(layout: Layout) -> Option<usize> {
    let page = page_size();
    (layout.size() >= 65536 && layout.align() <= page)
        .then(|| {
            layout
                .size()
                .checked_add(page - 1)
                .map(|size| size & !(page - 1))
        })
        .flatten()
}

#[cfg(all(not(test), feature = "compact-heap"))]
#[global_allocator]
static ALLOCATOR: Compact = Compact;

#[cfg(feature = "compact-heap")]
unsafe impl GlobalAlloc for Compact {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // Large immutable resources and frame buffers must not strand small
        // long-lived objects between the pool's temporary loading buffers.
        if let Some(size) = mapped_size(layout) {
            let pointer = libc::mmap(
                std::ptr::null_mut(),
                size,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_PRIVATE | libc::MAP_ANONYMOUS,
                -1,
                0,
            );
            return if pointer == libc::MAP_FAILED {
                std::ptr::null_mut()
            } else {
                pointer.cast()
            };
        }
        HEAP.lock().unwrap().malloc(layout.size(), layout.align())
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        if mapped_size(layout).is_some() {
            return self.alloc(layout);
        }
        HEAP.lock().unwrap().calloc(layout.size(), layout.align())
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        if let Some(size) = mapped_size(layout) {
            libc::munmap(pointer.cast(), size);
            return;
        }
        discard_payload(pointer, layout.size());
        HEAP.lock()
            .unwrap()
            .free(pointer, layout.size(), layout.align());
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let Ok(next_layout) = Layout::from_size_align(size, layout.align()) else {
            return std::ptr::null_mut();
        };
        if mapped_size(layout).is_some() || mapped_size(next_layout).is_some() {
            let next = self.alloc(next_layout);
            if !next.is_null() {
                std::ptr::copy_nonoverlapping(pointer, next, layout.size().min(size));
                self.dealloc(pointer, layout);
            }
            return next;
        }
        HEAP.lock()
            .unwrap()
            .realloc(pointer, layout.size(), layout.align(), size)
    }
}

/// Purge only complete pages of an allocation whose owner has finished with
/// it. Do this BEFORE free: afterwards another heap could reuse an unmapped
/// region at the same address. Allocator headers and neighboring allocations
/// are outside the caller-owned payload and never enter this range.
#[cfg(feature = "compact-heap")]
unsafe fn discard_payload(pointer: *mut u8, size: usize) {
    let page = page_size();
    if size < page {
        return;
    }
    let start = (pointer as usize + page - 1) & !(page - 1);
    let end = (pointer as usize + size) & !(page - 1);
    if end > start {
        libc::madvise(start as *mut _, end - start, libc::MADV_DONTNEED);
    }
}

// HostedGuest drops this after its QuickJS runtime and pinned bytecode.
pub struct Release;
impl Drop for Release {
    fn drop(&mut self) {
        collect();
        release_cold_code_pages();
    }
}

#[cfg(all(test, feature = "compact-heap"))]
mod tests {
    use super::*;
    use pocket_mod::qjs::allocator::Allocator;

    #[test]
    fn native_reallocation_crosses_mapping_boundary_without_losing_data() {
        unsafe {
            let small = Layout::from_size_align(8192, 16).unwrap();
            let pointer = Compact.alloc_zeroed(small);
            assert!(!pointer.is_null());
            assert!(std::slice::from_raw_parts(pointer, small.size())
                .iter()
                .all(|byte| *byte == 0));
            pointer.write_bytes(0x5a, small.size());
            let pointer = Compact.realloc(pointer, small, 131073);
            assert!(!pointer.is_null());
            assert_eq!(pointer as usize % page_size(), 0);
            assert!(std::slice::from_raw_parts(pointer, small.size())
                .iter()
                .all(|byte| *byte == 0x5a));
            let large = Layout::from_size_align(131073, 16).unwrap();
            pointer.add(131072).write(0xa5);
            let pointer = Compact.realloc(pointer, large, 262144);
            assert_eq!(pointer.add(131072).read(), 0xa5);
            let larger = Layout::from_size_align(262144, 16).unwrap();
            let pointer = Compact.realloc(pointer, larger, small.size());
            assert!(std::slice::from_raw_parts(pointer, small.size())
                .iter()
                .all(|byte| *byte == 0x5a));
            Compact.dealloc(pointer, small);
            let pointer = Compact.alloc_zeroed(large);
            assert!(std::slice::from_raw_parts(pointer, large.size())
                .iter()
                .all(|byte| *byte == 0));
            Compact.dealloc(pointer, large);
        }
    }

    #[test]
    fn purging_freed_payload_pages_preserves_headers_and_neighbors() {
        let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) as usize };
        let mut bytes = vec![0xa5u8; page * 4];
        let pointer = unsafe { bytes.as_mut_ptr().add(13) };
        let size = page * 3;
        let start = (pointer as usize + page - 1) & !(page - 1);
        let end = (pointer as usize + size) & !(page - 1);
        let first = start - bytes.as_ptr() as usize;
        let last = end - bytes.as_ptr() as usize;
        unsafe {
            discard_payload(pointer, size);
        }
        assert!(bytes[..first].iter().all(|byte| *byte == 0xa5));
        assert!(bytes[first..last].iter().all(|byte| *byte == 0));
        assert!(bytes[last..].iter().all(|byte| *byte == 0xa5));
    }

    #[test]
    fn runtime_allocator_preserves_realloc_data_zeroes_and_releases_ownership() {
        let (guest, heap) = guest().unwrap();
        assert_eq!(std::rc::Rc::strong_count(&heap.0), 2);
        guest
            .eval(
                "heap",
                "globalThis.data = Array.from({length: 12000}, (_, i) => ({i, text: String(i)}));",
            )
            .unwrap();
        drop(guest);
        assert_eq!(std::rc::Rc::strong_count(&heap.0), 1);
        let mut allocator = JsAllocator(heap.0.clone());
        unsafe {
            let pointer = allocator.calloc(17, 13);
            assert!(!pointer.is_null());
            assert_eq!((pointer as usize) % 8, 0);
            assert!(std::slice::from_raw_parts(pointer, 221)
                .iter()
                .all(|byte| *byte == 0));
            pointer.write_bytes(0xa5, 221);
            let pointer = allocator.realloc(pointer, 4096);
            assert!(!pointer.is_null());
            assert!(std::slice::from_raw_parts(pointer, 221)
                .iter()
                .all(|byte| *byte == 0xa5));
            assert!(allocator.realloc(pointer, 0).is_null());
            let pointer = allocator.realloc(std::ptr::null_mut(), 32);
            assert!(!pointer.is_null());
            allocator.dealloc(pointer);
            assert!(allocator.calloc(usize::MAX, 2).is_null());
        }
    }
}
