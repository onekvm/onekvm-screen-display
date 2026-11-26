//! One codec loader for home video decoding and remote-screen encoding.
use anyhow::Result;
#[cfg(feature = "system-openh264")]
use anyhow::{bail, Context};
use openh264::OpenH264API;

#[cfg(not(any(feature = "bundled-openh264", feature = "system-openh264")))]
compile_error!("select bundled-openh264 or system-openh264");

pub fn api() -> Result<OpenH264API> {
    #[cfg(feature = "system-openh264")]
    {
        // OE's ABI-matched library includes AArch64 NEON assembly; the Rust
        // crate's bundled source currently compiles scalar C++ on ARM.
        let api = unsafe {
            OpenH264API::from_blob_path_unchecked("/usr/lib/libopenh264.so.8")
        }.context("load system OpenH264 codec")?;
        #[allow(irrefutable_let_patterns)]
        if let OpenH264API::Libloading(loader) = &api {
            let version = unsafe { loader.WelsGetCodecVersion() };
            if (version.uMajor, version.uMinor, version.uRevision) != (2, 6, 0) {
                bail!("screen H.264 requires OpenH264 2.6.0");
            }
        }
        return Ok(api);
    }
    #[cfg(all(not(feature = "system-openh264"), feature = "bundled-openh264"))]
    Ok(OpenH264API::from_source())
}
