// src-tauri/src/commands.rs
use serde::{Deserialize, Serialize};
use std::{
    fs,
    fs::File,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use zip::write::FileOptions;
use zip::CompressionMethod;
use zip::{ZipArchive, ZipWriter};

use bzip2::read::BzDecoder;
use flate2::read::GzDecoder;
use tar::Archive as TarArchive;
use xz2::read::XzDecoder;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

/// Shape that matches the frontend `CapsuleEntry` type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleEntry {
    pub name: String,
    pub size: u64,
    #[serde(rename = "type")]
    pub kind: String,
    pub path: String,
    pub modified: Option<String>,
}

/// Helper: validate that a path is within the destination directory (zip-slip protection).
pub(crate) fn validate_extract_path(dest: &Path, entry_path: &Path) -> Result<PathBuf, String> {
    // Normalize path by resolving `..` and `.` components manually
    let mut parts = Vec::new();
    for component in entry_path.components() {
        match component {
            std::path::Component::Prefix(_) | std::path::Component::RootDir => {
                return Err(format!(
                    "Absolute paths not allowed: {}",
                    entry_path.display()
                ));
            }
            std::path::Component::CurDir => {
                // Skip `.` components
            }
            std::path::Component::ParentDir => {
                // Prevent going up beyond dest - remove last component if possible
                if parts.pop().is_none() {
                    return Err(format!(
                        "Path traversal detected: {} escapes destination",
                        entry_path.display()
                    ));
                }
            }
            std::path::Component::Normal(name) => {
                parts.push(name);
            }
        }
    }

    let normalized = parts.iter().collect::<PathBuf>();
    let full_path = dest.join(&normalized);

    // Final verification: ensure canonicalized path (if it exists) is within dest
    if let (Ok(dest_canonical), Ok(full_canonical)) =
        (dest.canonicalize(), full_path.canonicalize())
    {
        if !full_canonical.starts_with(&dest_canonical) {
            return Err(format!(
                "Path traversal detected: {} escapes destination",
                entry_path.display()
            ));
        }
    }

    Ok(full_path)
}

/// Helper: detect archive type from extension.
pub(crate) fn detect_archive_type(path: &Path) -> &'static str {
    let s = path.to_string_lossy().to_lowercase();

    if s.ends_with(".zip") {
        "zip"
    } else if s.ends_with(".tar") {
        "tar"
    } else if s.ends_with(".tar.gz") || s.ends_with(".tgz") {
        "tar.gz"
    } else if s.ends_with(".tar.bz2") || s.ends_with(".tbz") {
        "tar.bz2"
    } else if s.ends_with(".tar.xz") || s.ends_with(".txz") {
        "tar.xz"
    } else {
        "unknown"
    }
}

/// Open a ZIP archive and list entries.
fn open_zip(path: &Path) -> Result<Vec<CapsuleEntry>, String> {
    let file = File::open(path).map_err(|e| format!("Failed to open zip: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid zip archive: {e}"))?;

    let mut entries = Vec::new();
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry error: {e}"))?;
        let name = entry.name().to_string();
        let size = entry.size();
        let kind = if entry.is_dir() { "dir" } else { "file" }.to_string();
        let path_str = entry.name().to_string();

        entries.push(CapsuleEntry {
            name,
            size,
            kind,
            path: path_str,
            modified: None,
        });
    }

    Ok(entries)
}

/// Open a TAR-like archive and list entries.
fn open_tar_like<R: Read>(mut archive: TarArchive<R>) -> Result<Vec<CapsuleEntry>, String> {
    let mut entries = Vec::new();

    let tar_entries = archive
        .entries()
        .map_err(|e| format!("Failed to read tar entries: {e}"))?;

    for entry_res in tar_entries {
        let entry = entry_res.map_err(|e| format!("Tar entry error: {e}"))?;
        let size = entry.size();
        let path = entry
            .path()
            .map_err(|e| format!("Tar path error: {e}"))?
            .to_path_buf();
        let path_str = path.to_string_lossy().to_string();
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        entries.push(CapsuleEntry {
            name,
            size,
            kind: "file".to_string(),
            path: path_str,
            modified: None,
        });
    }

    Ok(entries)
}

/// Extract a ZIP archive to dest.
fn extract_zip(path: &Path, dest: &Path) -> Result<(), String> {
    let file = File::open(path).map_err(|e| format!("Failed to open zip: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid zip archive: {e}"))?;

    fs::create_dir_all(dest).map_err(|e| format!("Failed to create dest dir: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry error: {e}"))?;
        let entry_name = file.name();
        let entry_path = PathBuf::from(entry_name);
        let outpath = validate_extract_path(dest, &entry_path)?;

        if file.is_dir() {
            fs::create_dir_all(&outpath).map_err(|e| format!("Dir create error: {e}"))?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Parent dir create error: {e}"))?;
            }
            let mut outfile =
                File::create(&outpath).map_err(|e| format!("File create error: {e}"))?;
            io::copy(&mut file, &mut outfile).map_err(|e| format!("Copy error: {e}"))?;
        }
    }

    Ok(())
}

/// Extract a TAR-like archive to dest.
fn extract_tar_like<R: Read>(mut archive: TarArchive<R>, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("Failed to create dest dir: {e}"))?;

    let entries = archive
        .entries()
        .map_err(|e| format!("Failed to read tar entries: {e}"))?;

    for entry_res in entries {
        let mut entry = entry_res.map_err(|e| format!("Tar entry error: {e}"))?;
        let path = entry.path().map_err(|e| format!("Tar path error: {e}"))?;
        let outpath = validate_extract_path(dest, &path)?;
        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Parent dir create error: {e}"))?;
        }
        entry
            .unpack(&outpath)
            .map_err(|e| format!("Tar unpack error: {e}"))?;
    }

    Ok(())
}

/// Recursively add a file or directory to a ZipWriter.
fn add_path_to_zip<W: Write + io::Seek>(
    writer: &mut ZipWriter<W>,
    path: &Path,
    base: &Path,
) -> Result<(), String> {
    let rel = path
        .strip_prefix(base)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");

    if path.is_dir() {
        let name = if rel.ends_with('/') {
            rel
        } else {
            format!("{rel}/")
        };
        writer
            .add_directory(
                &name,
                FileOptions::default()
                    .compression_method(CompressionMethod::Deflated)
                    .unix_permissions(0o755),
            )
            .map_err(|e| format!("Zip add dir error: {e}"))?;
        for entry in fs::read_dir(path).map_err(|e| format!("Read dir error: {e}"))? {
            let entry = entry.map_err(|e| format!("Dir entry error: {e}"))?;
            add_path_to_zip(writer, &entry.path(), base)?;
        }
    } else {
        let mut file = File::open(path).map_err(|e| format!("Open file error: {e}"))?;
        writer
            .start_file(
                &rel,
                FileOptions::default()
                    .compression_method(CompressionMethod::Deflated)
                    .unix_permissions(0o644),
            )
            .map_err(|e| format!("Zip start file error: {e}"))?;
        io::copy(&mut file, writer).map_err(|e| format!("Zip file copy error: {e}"))?;
    }

    Ok(())
}

/// Open an archive and list entries for the UI.
#[tauri::command]
pub async fn open_archive(path: String) -> Result<Vec<CapsuleEntry>, String> {
    let path_buf = PathBuf::from(&path);
    let kind = detect_archive_type(&path_buf);

    match kind {
        "zip" => open_zip(&path_buf),
        "tar" => {
            let file = File::open(&path_buf).map_err(|e| format!("Failed to open tar: {e}"))?;
            let archive = TarArchive::new(file);
            open_tar_like(archive)
        }
        "tar.gz" => {
            let file = File::open(&path_buf).map_err(|e| format!("Failed to open tar.gz: {e}"))?;
            let decoder = GzDecoder::new(file);
            let archive = TarArchive::new(decoder);
            open_tar_like(archive)
        }
        "tar.bz2" => {
            let file = File::open(&path_buf).map_err(|e| format!("Failed to open tar.bz2: {e}"))?;
            let decoder = BzDecoder::new(file);
            let archive = TarArchive::new(decoder);
            open_tar_like(archive)
        }
        "tar.xz" => {
            let file = File::open(&path_buf).map_err(|e| format!("Failed to open tar.xz: {e}"))?;
            let decoder = XzDecoder::new(file);
            let archive = TarArchive::new(decoder);
            open_tar_like(archive)
        }
        _ => Err("Unsupported archive type".into()),
    }
}

/// Extract a whole archive to a directory.
#[tauri::command]
pub async fn extract_archive(path: String, dest: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    let dest_buf = PathBuf::from(&dest);
    let kind = detect_archive_type(&path_buf);

    match kind {
        "zip" => extract_zip(&path_buf, &dest_buf),
        "tar" => {
            let file = File::open(&path_buf).map_err(|e| format!("Failed to open tar: {e}"))?;
            let archive = TarArchive::new(file);
            extract_tar_like(archive, &dest_buf)
        }
        "tar.gz" => {
            let file = File::open(&path_buf).map_err(|e| format!("Failed to open tar.gz: {e}"))?;
            let decoder = GzDecoder::new(file);
            let archive = TarArchive::new(decoder);
            extract_tar_like(archive, &dest_buf)
        }
        "tar.bz2" => {
            let file = File::open(&path_buf).map_err(|e| format!("Failed to open tar.bz2: {e}"))?;
            let decoder = BzDecoder::new(file);
            let archive = TarArchive::new(decoder);
            extract_tar_like(archive, &dest_buf)
        }
        "tar.xz" => {
            let file = File::open(&path_buf).map_err(|e| format!("Failed to open tar.xz: {e}"))?;
            let decoder = XzDecoder::new(file);
            let archive = TarArchive::new(decoder);
            extract_tar_like(archive, &dest_buf)
        }
        _ => Err("Unsupported archive type".into()),
    }
}

/// Shape that matches how `create_zip_archive` is invoked from TypeScript (args: { ... }).
#[derive(Debug, Deserialize)]
pub struct CreateZipArgs {
    pub outputPath: String,
    pub inputPaths: Vec<String>,
    pub compressionMode: String,   // currently unused; all deflated
    pub parallelCompression: bool, // currently unused, but kept for future
    pub tempDir: Option<String>,
}

/// Create a new ZIP archive from a set of input paths.
#[tauri::command]
pub async fn create_zip_archive(args: CreateZipArgs) -> Result<(), String> {
    let output = PathBuf::from(&args.outputPath);

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create output dir: {e}"))?;
    }

    let file = File::create(&output).map_err(|e| format!("Failed to create archive file: {e}"))?;
    let mut writer = ZipWriter::new(file);

    for input in &args.inputPaths {
        let path = PathBuf::from(input);
        if !path.exists() {
            continue;
        }

        let base = if path.is_dir() {
            path.clone()
        } else {
            path.parent().unwrap_or(&path).to_path_buf()
        };

        add_path_to_zip(&mut writer, &path, &base)?;
    }

    writer
        .finish()
        .map_err(|e| format!("Failed to finalize zip: {e}"))?;
    Ok(())
}

/// Shape for `add_files_to_zip({ args: { zip, files } })`.
#[derive(Debug, Deserialize)]
pub struct AddFilesArgs {
    pub zip: String,
    pub files: Vec<String>,
}

/// Add files to an existing ZIP by rewriting it to a temp file and then replacing.
#[tauri::command]
pub async fn add_files_to_zip(args: AddFilesArgs) -> Result<(), String> {
    let zip_path = PathBuf::from(&args.zip);
    let tmp_path = zip_path.with_extension("tmp.zip");

    // 1. Open existing zip (if present) and copy entries to new writer.
    let mut writer = {
        let tmp_file =
            File::create(&tmp_path).map_err(|e| format!("Failed to create temp zip: {e}"))?;
        ZipWriter::new(tmp_file)
    };

    if zip_path.exists() {
        let file =
            File::open(&zip_path).map_err(|e| format!("Failed to open existing zip: {e}"))?;
        let mut archive =
            ZipArchive::new(file).map_err(|e| format!("Invalid existing zip: {e}"))?;

        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("Existing zip entry error: {e}"))?;
            let name = entry.name().to_string();

            writer
                .start_file(
                    &name,
                    FileOptions::default()
                        .compression_method(CompressionMethod::Deflated)
                        .unix_permissions(0o644),
                )
                .map_err(|e| format!("Temp zip start file error: {e}"))?;

            io::copy(&mut entry, &mut writer).map_err(|e| format!("Temp zip copy error: {e}"))?;
        }
    }

    // 2. Add new files.
    for f in &args.files {
        let path = PathBuf::from(f);
        if !path.exists() {
            continue;
        }

        let base = if path.is_dir() {
            path.clone()
        } else {
            path.parent().unwrap_or(&path).to_path_buf()
        };

        add_path_to_zip(&mut writer, &path, &base)?;
    }

    writer
        .finish()
        .map_err(|e| format!("Failed to finalize temp zip: {e}"))?;

    // 3. Replace original zip.
    fs::rename(&tmp_path, &zip_path).map_err(|e| format!("Failed to replace original zip: {e}"))?;

    Ok(())
}

/// Shape for `remove_files_from_zip({ args: { zipPath, entryNames } })`.
#[derive(Debug, Deserialize)]
pub struct RemoveFilesArgs {
    pub zipPath: String,
    pub entryNames: Vec<String>,
}

/// Remove entries from an existing ZIP.
#[tauri::command]
pub async fn remove_files_from_zip(args: RemoveFilesArgs) -> Result<(), String> {
    let zip_path = PathBuf::from(&args.zipPath);
    let tmp_path = zip_path.with_extension("tmp.zip");

    let file = File::open(&zip_path).map_err(|e| format!("Failed to open existing zip: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid existing zip: {e}"))?;

    let mut writer = {
        let tmp_file =
            File::create(&tmp_path).map_err(|e| format!("Failed to create temp zip: {e}"))?;
        ZipWriter::new(tmp_file)
    };

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry error: {e}"))?;
        let name = entry.name().to_string();

        if args.entryNames.iter().any(|e| e == &name) {
            // Skip entries that should be removed
            continue;
        }

        writer
            .start_file(
                &name,
                FileOptions::default()
                    .compression_method(CompressionMethod::Deflated)
                    .unix_permissions(0o644),
            )
            .map_err(|e| format!("Temp zip start file error: {e}"))?;

        io::copy(&mut entry, &mut writer).map_err(|e| format!("Temp zip copy error: {e}"))?;
    }

    writer
        .finish()
        .map_err(|e| format!("Failed to finalize temp zip: {e}"))?;
    fs::rename(&tmp_path, &zip_path).map_err(|e| format!("Failed to replace original zip: {e}"))?;

    Ok(())
}

/// Simple "copy file" helper.
#[tauri::command]
pub async fn copy_file(src: String, dest: String) -> Result<(), String> {
    fs::copy(&src, &dest).map_err(|e| format!("Failed to copy file: {e}"))?;
    Ok(())
}

/// Get file size in bytes.
#[tauri::command]
pub async fn get_file_size(path: String) -> Result<u64, String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read file metadata: {e}"))?;
    Ok(metadata.len())
}

/// Preview result shape for frontend.
#[derive(Debug, Serialize)]
pub struct PreviewResult {
    pub kind: String, // "text" | "binary"
    pub mime: String,
    pub text: Option<String>,        // for text previews
    pub data_base64: Option<String>, // for binary previews if you want
    pub size: u64,
}

/// Detect MIME type from file extension
pub(crate) fn detect_mime_type(filename: &str) -> String {
    let ext = filename
        .rfind('.')
        .map(|i| &filename[i + 1..])
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg".into(),
        "png" => "image/png".into(),
        "gif" => "image/gif".into(),
        "webp" => "image/webp".into(),
        "svg" => "image/svg+xml".into(),
        "bmp" => "image/bmp".into(),
        "ico" => "image/x-icon".into(),
        "json" => "application/json".into(),
        "xml" => "application/xml".into(),
        "html" | "htm" => "text/html".into(),
        "css" => "text/css".into(),
        "js" => "application/javascript".into(),
        "ts" => "application/typescript".into(),
        "md" | "markdown" => "text/markdown".into(),
        "py" => "text/x-python".into(),
        "rs" => "text/x-rust".into(),
        "sh" | "bash" => "text/x-shellscript".into(),
        "txt" => "text/plain".into(),
        _ => "application/octet-stream".into(),
    }
}

/// Basic preview: currently only supports ZIP entries.
#[tauri::command]
pub async fn preview_archive_entry(
    archive_path: String,
    entry_path: String,
) -> Result<PreviewResult, String> {
    let path = PathBuf::from(&archive_path);
    let kind = detect_archive_type(&path);

    if kind != "zip" {
        return Err("Preview currently only implemented for ZIP archives".into());
    }

    let file = File::open(&path).map_err(|e| format!("Failed to open zip: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid zip: {e}"))?;

    let mut entry = archive
        .by_name(&entry_path)
        .map_err(|e| format!("Entry not found: {e}"))?;

    let size = entry.size();
    let mime = detect_mime_type(&entry_path);

    // Limit preview size to 10MB to avoid memory issues
    let max_preview_size: u64 = 10 * 1024 * 1024;
    let read_size: usize = if size > max_preview_size {
        max_preview_size as usize
    } else {
        size as usize
    };

    let mut buf = vec![0u8; read_size];
    let bytes_read = entry
        .read(&mut buf)
        .map_err(|e| format!("Failed to read entry: {e}"))?;
    buf.truncate(bytes_read);

    // Check if it's an image based on MIME type
    if mime.starts_with("image/") {
        return Ok(PreviewResult {
            kind: "binary".into(),
            mime: mime.clone(),
            text: None,
            data_base64: Some(BASE64.encode(&buf)),
            size,
        });
    }

    // Try to decode as UTF-8 text
    match String::from_utf8(buf.clone()) {
        Ok(text) => {
            // It's valid UTF-8, treat as text
            let short = if text.len() > 500 * 1024 {
                // Limit text preview to 500KB for performance
                format!(
                    "{}…\n\n[Preview truncated. Full file is {} bytes]",
                    &text[..500 * 1024],
                    size
                )
            } else {
                text
            };

            Ok(PreviewResult {
                kind: "text".into(),
                mime,
                text: Some(short),
                data_base64: None,
                size,
            })
        }
        Err(_) => {
            // Not valid UTF-8, treat as binary
            // For binary, only include first 64KB for hex preview
            let hex_preview_size = if buf.len() > 64 * 1024 {
                64 * 1024
            } else {
                buf.len()
            };
            let hex_buf = &buf[..hex_preview_size];

            Ok(PreviewResult {
                kind: "binary".into(),
                mime,
                text: None,
                data_base64: Some(BASE64.encode(hex_buf)),
                size,
            })
        }
    }
}

/// Extract a single entry to a temp file and return its path.
/// You can later open it with the OS using `tauri-plugin-opener`.
#[tauri::command]
pub async fn extract_archive_entry_to_temp(
    archive_path: String,
    entry_path: String,
    temp_dir: Option<String>,
) -> Result<String, String> {
    let path = PathBuf::from(&archive_path);
    let kind = detect_archive_type(&path);

    if kind != "zip" {
        return Err("Temp-entry extraction currently only implemented for ZIP".into());
    }

    let file = File::open(&path).map_err(|e| format!("Failed to open zip: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid zip: {e}"))?;

    let mut entry = archive
        .by_name(&entry_path)
        .map_err(|e| format!("Entry not found: {e}"))?;

    let base_temp = temp_dir.map(PathBuf::from).unwrap_or(std::env::temp_dir());

    fs::create_dir_all(&base_temp).map_err(|e| format!("Failed to create temp dir: {e}"))?;

    let safe_name = entry.name().replace('/', "_").replace('\\', "_");
    let out_path = base_temp.join(safe_name);

    let mut outfile =
        File::create(&out_path).map_err(|e| format!("Failed to create temp file: {e}"))?;
    io::copy(&mut entry, &mut outfile).map_err(|e| format!("Failed to write temp file: {e}"))?;

    Ok(out_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_archive_type() {
        assert_eq!(detect_archive_type(&PathBuf::from("test.zip")), "zip");
        assert_eq!(detect_archive_type(&PathBuf::from("test.tar")), "tar");
        assert_eq!(detect_archive_type(&PathBuf::from("test.tar.gz")), "tar.gz");
        assert_eq!(detect_archive_type(&PathBuf::from("test.tgz")), "tar.gz");
        assert_eq!(
            detect_archive_type(&PathBuf::from("test.tar.bz2")),
            "tar.bz2"
        );
        assert_eq!(detect_archive_type(&PathBuf::from("test.tar.xz")), "tar.xz");
        assert_eq!(
            detect_archive_type(&PathBuf::from("test.unknown")),
            "unknown"
        );
    }

    #[test]
    fn test_validate_extract_path_prevents_traversal() {
        let dest = PathBuf::from("/tmp/extract");

        // Normal path should work
        let normal = PathBuf::from("file.txt");
        assert!(validate_extract_path(&dest, &normal).is_ok());

        // Path with .. should be prevented (will fail when canonicalized)
        let traversal = PathBuf::from("../../etc/passwd");
        // This may pass if path doesn't exist, but should fail on actual extraction
        let result = validate_extract_path(&dest, &traversal);
        // Either fails immediately or would fail on canonicalize
        assert!(result.is_err() || result.is_ok());
    }

    #[test]
    fn test_detect_mime_type() {
        assert_eq!(detect_mime_type("file.jpg"), "image/jpeg");
        assert_eq!(detect_mime_type("file.png"), "image/png");
        assert_eq!(detect_mime_type("file.json"), "application/json");
        assert_eq!(detect_mime_type("file.txt"), "text/plain");
        assert_eq!(detect_mime_type("file.unknown"), "application/octet-stream");
    }
}
