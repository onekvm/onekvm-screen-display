//! Keep a faulty contributed guest inside a bounded QuickJS turn.
use pocket_mod::{qjs::qjs, Guest};
use std::ops::Deref;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use crate::file_blob::FileBlob;

pub struct HostedGuest {
    guest: Guest,
    deadline: Option<Box<Mutex<Instant>>>,
    // Module::load enables QuickJS ROM_DATA. Bytecode must outlive every
    // function in this runtime, even after its bundle leaves the LRU.
    // Fields drop in declaration order: the guest is destroyed first.
    bytecode: Vec<Arc<FileBlob>>,
    heap: crate::heap::GuestHeap,
    _release: crate::heap::Release,
}

unsafe extern "C" fn interrupt(_: *mut qjs::JSRuntime, data: *mut std::ffi::c_void) -> i32 {
    let deadline = &*(data as *const Mutex<Instant>);
    i32::from(
        deadline
            .lock()
            .map(|deadline| Instant::now() >= *deadline)
            .unwrap_or(true),
    )
}

impl HostedGuest {
    pub fn new(limited: bool) -> anyhow::Result<Self> {
        let (guest, heap) = crate::heap::guest()?;
        let deadline =
            limited.then(|| Box::new(Mutex::new(Instant::now() + Duration::from_secs(3))));
        if let Some(deadline) = deadline.as_ref() {
            guest.with(|ctx| unsafe {
                let runtime = qjs::JS_GetRuntime(ctx.as_raw().as_ptr());
                qjs::JS_SetMemoryLimit(runtime, 32 * 1024 * 1024);
                // Vue Vapor service pages exceed 512 KiB during initial block creation.
                // One MiB matches QuickJS's normal stack bound and still leaves
                // room in the host thread for native frames.
                qjs::JS_SetMaxStackSize(runtime, 1024 * 1024);
                qjs::JS_SetInterruptHandler(
                    runtime,
                    Some(interrupt),
                    &**deadline as *const _ as *mut _,
                );
            });
        }
        Ok(Self { guest, deadline, bytecode: Vec::new(), heap, _release: crate::heap::Release })
    }
    pub fn eval_bytecode(&mut self, label: &str, bytes: Arc<FileBlob>) -> anyhow::Result<()> {
        self.bytecode.push(bytes);
        self.guest.eval_bytecode(label, self.bytecode.last().unwrap())
    }
    pub fn arm(&self, duration: Duration) {
        if let Some(deadline) = &self.deadline {
            *deadline.lock().unwrap() = Instant::now() + duration;
        }
    }
    pub fn collect(&self) {
        self.guest.with(|ctx| unsafe {
            qjs::JS_RunGC(qjs::JS_GetRuntime(ctx.as_raw().as_ptr()));
        });
        // ROM_DATA borrows immutable file mappings, not their resident pages.
        // Keep every mapping pinned; Linux can fault hot code/strings back in
        // while startup-only and hidden-page bytecode stays out of RSS.
        for bytecode in &self.bytecode { bytecode.release_pages(); }
        self.heap.collect();
        crate::heap::collect();
    }
}
impl Deref for HostedGuest {
    type Target = Guest;
    fn deref(&self) -> &Guest {
        &self.guest
    }
}
impl Drop for HostedGuest {
    fn drop(&mut self) {
        if self.deadline.is_some() {
            self.guest.with(|ctx| unsafe {
                qjs::JS_SetInterruptHandler(
                    qjs::JS_GetRuntime(ctx.as_raw().as_ptr()),
                    None,
                    std::ptr::null_mut(),
                );
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn infinite_guest_turn_is_interrupted_without_exiting_host() {
        let guest = HostedGuest::new(true).unwrap();
        guest.arm(Duration::from_millis(20));
        assert!(guest.eval("loop", "while (true) {}").is_err());
        guest.arm(Duration::from_secs(1));
        guest.eval("recovered", "globalThis.ok = true").unwrap();
    }
}
