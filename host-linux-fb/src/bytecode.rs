//! Bind precompiled code to the source and resource table it was built with.
use crate::file_blob::FileBlob;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read},
    path::Path,
};

/// Validate source identity without retaining/decoding the entire JS string.
pub fn source_digest(path: &Path) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut chunk = [0u8; 16384];
    loop {
        let len = file.read(&mut chunk)?;
        if len == 0 {
            break;
        }
        hash.update(&chunk[..len]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub fn metadata(js: &[u8], pak: &[u8], code: &[u8], abi: &str) -> String {
    serde_json::json!({
        "abi": abi,
        "source_sha256": format!("{:x}", Sha256::digest(js)),
        "resources_sha256": format!("{:x}", Sha256::digest(pak)),
        "bytecode_sha256": format!("{:x}", Sha256::digest(code)),
    })
    .to_string()
}

pub fn packaged(dir: &Path, source_sha256: &str, pak: &[u8], abi: &str) -> Option<FileBlob> {
    let code = FileBlob::open(&dir.join("main.vue-vapor.jsc")).ok()?;
    let stored: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.join("main.vue-vapor.jsc.meta")).ok()?).ok()?;
    let expected = serde_json::json!({
        "abi": abi,
        "source_sha256": source_sha256,
        "resources_sha256": format!("{:x}", Sha256::digest(pak)),
        "bytecode_sha256": format!("{:x}", Sha256::digest(&*code)),
    });
    (stored == expected).then_some(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_mixed_bundles_and_missing_metadata() {
        let dir = std::env::temp_dir().join(format!("screen-bytecode-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("main.vue-vapor.js"), b"js").unwrap();
        let digest = source_digest(&dir.join("main.vue-vapor.js")).unwrap();
        let changed = format!("{:x}", Sha256::digest(b"new js"));
        fs::write(dir.join("main.vue-vapor.jsc"), b"old code").unwrap();
        assert!(packaged(&dir, &digest, b"pak", "abi").is_none());
        fs::write(
            dir.join("main.vue-vapor.jsc.meta"),
            metadata(b"js", b"pak", b"old code", "abi"),
        )
        .unwrap();
        assert_eq!(
            &*packaged(&dir, &digest, b"pak", "abi").unwrap(),
            b"old code"
        );
        assert!(packaged(&dir, &changed, b"pak", "abi").is_none());
        assert!(packaged(&dir, &digest, b"new pak", "abi").is_none());
        assert!(packaged(&dir, &digest, b"pak", "other abi").is_none());
        fs::write(dir.join("main.vue-vapor.jsc"), b"bad code").unwrap();
        assert!(packaged(&dir, &digest, b"pak", "abi").is_none());
        fs::remove_dir_all(dir).unwrap();
    }
}
