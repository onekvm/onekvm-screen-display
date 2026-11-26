//! Immutable installed resources stay file-backed instead of occupying the heap.
use std::{fs::File, io, ops::Deref, path::Path};

use memmap2::Mmap;

#[derive(Debug)]
pub enum FileBlob {
    Mapped(Mmap),
    Owned(Vec<u8>),
}

impl FileBlob {
    /// Discard resident pages while retaining the immutable mapping and inode.
    /// Later reads fault the same bytes back in, including borrowed ROM_DATA.
    pub fn release_pages(&self) {
        if let Self::Mapped(bytes) = self {
            unsafe {
                libc::madvise(bytes.as_ptr().cast_mut().cast(), bytes.len(), libc::MADV_DONTNEED);
            }
        }
    }

    pub fn open(path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        if file.metadata()?.len() == 0 {
            return Ok(Self::Owned(Vec::new()));
        }
        // Installed/versioned bundle files are immutable while in use. Updates
        // replace their inode; the old mapping remains valid for active guests.
        unsafe { Mmap::map(&file) }.map(Self::Mapped)
    }
}

impl Deref for FileBlob {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        match self {
            Self::Mapped(bytes) => bytes,
            Self::Owned(bytes) => bytes,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mapping_survives_atomic_package_replacement() {
        let dir = std::env::temp_dir().join(format!("screen-map-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("resource");
        std::fs::write(&path, b"old resource").unwrap();
        let old = FileBlob::open(&path).unwrap();
        std::fs::write(dir.join("new"), b"new resource").unwrap();
        std::fs::rename(dir.join("new"), &path).unwrap();
        old.release_pages();
        assert_eq!(&*old, b"old resource");
        assert_eq!(&*FileBlob::open(&path).unwrap(), b"new resource");
        std::fs::write(dir.join("empty"), []).unwrap();
        assert!(FileBlob::open(&dir.join("empty")).unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
