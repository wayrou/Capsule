use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::{DateTime, SecondsFormat, Utc};
use libarchive2::{Entry, EntryMut, ExtractFlags, FileType, ReadArchive, WriteDisk};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    fs::File,
    io::{self, Write},
    path::{Path, PathBuf},
    time::SystemTime,
};
use zip::write::FileOptions;
use zip::CompressionMethod;
use zip::{ZipArchive, ZipWriter};

const MAX_PREVIEW_BYTES: usize = 10 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES: usize = 512 * 1024;
const MAX_BINARY_PREVIEW_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleEntry {
    pub name: String,
    pub size: u64,
    pub kind: String,
    pub path: String,
    pub compressed_size: Option<u64>,
    pub modified: Option<String>,
    pub is_encrypted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSummary {
    pub path: String,
    pub name: String,
    pub format: String,
    pub compressed_size: u64,
    pub total_entries: usize,
    pub total_size: u64,
    pub encrypted_entries: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveCapabilities {
    pub can_preview: bool,
    pub can_extract_all: bool,
    pub can_extract_selected: bool,
    pub can_add_files: bool,
    pub can_remove_files: bool,
    pub can_save_as_zip: bool,
    pub read_only: bool,
    pub read_only_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenArchiveResult {
    pub archive: ArchiveSummary,
    pub entries: Vec<CapsuleEntry>,
    pub capabilities: ArchiveCapabilities,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub kind: String,
    pub mime: String,
    pub text: Option<String>,
    pub data_base64: Option<String>,
    pub size: u64,
    pub truncated: bool,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionResult {
    pub extracted_entries: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArchiveKind {
    Zip,
    SevenZip,
    Tar,
    TarGz,
    TarBz2,
    TarXz,
    Rar,
    Unknown,
}

impl ArchiveKind {
    fn from_path(path: &Path) -> Self {
        let lower = path.to_string_lossy().to_lowercase();

        if lower.ends_with(".zip") {
            Self::Zip
        } else if lower.ends_with(".7z") {
            Self::SevenZip
        } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
            Self::TarGz
        } else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz") || lower.ends_with(".tbz2")
        {
            Self::TarBz2
        } else if lower.ends_with(".tar.xz") || lower.ends_with(".txz") {
            Self::TarXz
        } else if lower.ends_with(".tar") {
            Self::Tar
        } else if lower.ends_with(".rar") {
            Self::Rar
        } else {
            Self::Unknown
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Zip => "ZIP",
            Self::SevenZip => "7Z",
            Self::Tar => "TAR",
            Self::TarGz => "TAR.GZ",
            Self::TarBz2 => "TAR.BZ2",
            Self::TarXz => "TAR.XZ",
            Self::Rar => "RAR",
            Self::Unknown => "ARCHIVE",
        }
    }

    fn is_zip_mutable(self) -> bool {
        matches!(self, Self::Zip)
    }
}

#[derive(Debug, Clone)]
struct EntrySnapshot {
    name: String,
    path: String,
    kind: String,
    size: u64,
    modified: Option<String>,
    is_encrypted: bool,
    file_type: FileType,
    mode: u32,
    mtime: Option<SystemTime>,
    uid: Option<u64>,
    gid: Option<u64>,
    uname: Option<String>,
    gname: Option<String>,
    symlink: Option<String>,
}

impl EntrySnapshot {
    fn to_capsule_entry(&self) -> CapsuleEntry {
        CapsuleEntry {
            name: self.name.clone(),
            size: self.size,
            kind: self.kind.clone(),
            path: self.path.clone(),
            compressed_size: None,
            modified: self.modified.clone(),
            is_encrypted: self.is_encrypted,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateZipArgs {
    pub output_path: String,
    pub input_paths: Vec<String>,
    pub compression_mode: String,
    pub parallel_compression: bool,
    pub temp_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddFilesArgs {
    pub zip: String,
    pub files: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveFilesArgs {
    pub zip_path: String,
    pub entry_paths: Vec<String>,
}

fn archive_capabilities(kind: ArchiveKind) -> ArchiveCapabilities {
    let mutable = kind.is_zip_mutable();

    ArchiveCapabilities {
        can_preview: true,
        can_extract_all: true,
        can_extract_selected: true,
        can_add_files: mutable,
        can_remove_files: mutable,
        can_save_as_zip: false,
        read_only: !mutable,
        read_only_reason: if mutable {
            None
        } else {
            Some(
                "This archive opens in read-only mode. You can explore, preview, and extract it."
                    .into(),
            )
        },
    }
}

fn normalize_archive_path(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    let trimmed = replaced
        .trim_start_matches("./")
        .trim_start_matches('/')
        .trim_end_matches('/');
    trimmed.to_string()
}

fn basename_from_path(path: &str) -> String {
    let normalized = normalize_archive_path(path);
    if normalized.is_empty() {
        return "Entry".into();
    }

    normalized
        .rsplit('/')
        .next()
        .filter(|segment| !segment.is_empty())
        .unwrap_or(&normalized)
        .to_string()
}

fn file_type_label(file_type: FileType) -> &'static str {
    match file_type {
        FileType::Directory => "dir",
        FileType::SymbolicLink => "symlink",
        FileType::RegularFile => "file",
        _ => "other",
    }
}

fn format_system_time(time: SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn detect_mime_type(filename: &str) -> String {
    let ext = filename
        .rsplit('.')
        .next()
        .unwrap_or_default()
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
        "txt" | "log" | "csv" | "yml" | "yaml" | "toml" => "text/plain".into(),
        _ => "application/octet-stream".into(),
    }
}

fn open_reader(path: &Path) -> Result<ReadArchive<'static>, String> {
    ReadArchive::open(path).map_err(|err| format!("Failed to open archive: {err}"))
}

fn snapshot_entry(entry: &Entry<'_>) -> EntrySnapshot {
    let raw_path = entry.pathname().unwrap_or_default();
    let normalized_path = normalize_archive_path(&raw_path);
    let file_type = entry.file_type();
    let name = basename_from_path(&normalized_path);
    let size = entry.size().max(0) as u64;
    let modified_time = entry.mtime();

    EntrySnapshot {
        name,
        path: normalized_path,
        kind: file_type_label(file_type).into(),
        size,
        modified: modified_time.map(format_system_time),
        is_encrypted: entry.is_encrypted()
            || entry.is_data_encrypted()
            || entry.is_metadata_encrypted(),
        file_type,
        mode: entry.mode(),
        mtime: modified_time,
        uid: entry.uid(),
        gid: entry.gid(),
        uname: entry.uname(),
        gname: entry.gname(),
        symlink: entry.symlink(),
    }
}

fn selected_match(path: &str, selected: &HashSet<String>) -> bool {
    selected.iter().any(|candidate| {
        path == candidate || (!candidate.is_empty() && path.starts_with(&format!("{candidate}/")))
    })
}

fn read_entry_bytes_limited(
    archive: &mut ReadArchive<'_>,
    limit: usize,
) -> Result<(Vec<u8>, bool), String> {
    let mut buffer = vec![0_u8; 8192];
    let mut bytes = Vec::new();
    let mut truncated = false;

    loop {
        let read = archive
            .read_data(&mut buffer)
            .map_err(|err| format!("Failed to read archive entry: {err}"))?;

        if read == 0 {
            break;
        }

        if bytes.len() < limit {
            let remaining = limit - bytes.len();
            let slice_len = remaining.min(read);
            bytes.extend_from_slice(&buffer[..slice_len]);
            if read > slice_len {
                truncated = true;
            }
        } else {
            truncated = true;
        }

        if truncated {
            archive
                .skip_data()
                .map_err(|err| format!("Failed to skip remaining entry data: {err}"))?;
            break;
        }
    }

    Ok((bytes, truncated))
}

fn replace_file(temp_path: &Path, target_path: &Path) -> Result<(), String> {
    if target_path.exists() {
        fs::remove_file(target_path)
            .map_err(|err| format!("Failed to replace archive file: {err}"))?;
    }

    fs::rename(temp_path, target_path)
        .map_err(|err| format!("Failed to rename archive file: {err}"))
}

fn validate_extract_path(dest: &Path, entry_path: &Path) -> Result<PathBuf, String> {
    let mut parts = Vec::new();

    for component in entry_path.components() {
        match component {
            std::path::Component::Prefix(_) | std::path::Component::RootDir => {
                return Err(format!(
                    "Absolute paths are not allowed in archives: {}",
                    entry_path.display()
                ));
            }
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if parts.pop().is_none() {
                    return Err(format!(
                        "Path traversal detected while extracting {}",
                        entry_path.display()
                    ));
                }
            }
            std::path::Component::Normal(segment) => parts.push(segment),
        }
    }

    Ok(dest.join(parts.iter().collect::<PathBuf>()))
}

fn build_extract_entry(snapshot: &EntrySnapshot, dest: &Path) -> Result<EntryMut, String> {
    let safe_rel = PathBuf::from(&snapshot.path);
    let out_path = validate_extract_path(dest, &safe_rel)?;

    let mut entry = EntryMut::new();
    entry
        .set_pathname(&out_path)
        .map_err(|err| format!("Failed to set extraction path: {err}"))?;
    entry.set_file_type(snapshot.file_type);
    entry.set_size(snapshot.size as i64);
    entry
        .set_perm(snapshot.mode)
        .map_err(|err| format!("Failed to apply entry permissions: {err}"))?;

    if let Some(mtime) = snapshot.mtime {
        entry.set_mtime(mtime);
    }
    if let Some(uid) = snapshot.uid {
        entry.set_uid(uid);
    }
    if let Some(gid) = snapshot.gid {
        entry.set_gid(gid);
    }
    if let Some(uname) = snapshot.uname.as_deref() {
        entry
            .set_uname(uname)
            .map_err(|err| format!("Failed to apply entry owner: {err}"))?;
    }
    if let Some(gname) = snapshot.gname.as_deref() {
        entry
            .set_gname(gname)
            .map_err(|err| format!("Failed to apply entry group: {err}"))?;
    }
    if let Some(target) = snapshot.symlink.as_deref() {
        entry
            .set_symlink(target)
            .map_err(|err| format!("Failed to apply symlink target: {err}"))?;
    }

    Ok(entry)
}

fn extract_current_entry(
    archive: &mut ReadArchive<'_>,
    disk: &mut WriteDisk,
    snapshot: &EntrySnapshot,
    dest: &Path,
) -> Result<(), String> {
    let entry = build_extract_entry(snapshot, dest)?;

    disk.write_header(&entry)
        .map_err(|err| format!("Failed to write extraction header: {err}"))?;

    if matches!(snapshot.file_type, FileType::RegularFile) {
        let mut buffer = vec![0_u8; 8192];

        loop {
            let read = archive
                .read_data(&mut buffer)
                .map_err(|err| format!("Failed to extract archive entry data: {err}"))?;
            if read == 0 {
                break;
            }
            disk.write_data(&buffer[..read])
                .map_err(|err| format!("Failed to write extracted data: {err}"))?;
        }
    } else {
        archive
            .skip_data()
            .map_err(|err| format!("Failed to advance archive reader: {err}"))?;
    }

    disk.finish_entry()
        .map_err(|err| format!("Failed to finalize extracted entry: {err}"))?;

    Ok(())
}

fn extract_matching_entries(
    archive_path: &Path,
    dest: &Path,
    selected_paths: Option<&[String]>,
) -> Result<ExtractionResult, String> {
    fs::create_dir_all(dest).map_err(|err| format!("Failed to create extraction folder: {err}"))?;

    let mut archive = open_reader(archive_path)?;
    let mut disk =
        WriteDisk::new().map_err(|err| format!("Failed to open extraction writer: {err}"))?;
    let flags = ExtractFlags::TIME
        | ExtractFlags::PERM
        | ExtractFlags::ACL
        | ExtractFlags::FFLAGS
        | ExtractFlags::XATTR
        | ExtractFlags::SECURE_NODOTDOT
        | ExtractFlags::SECURE_NOABSOLUTEPATHS
        | ExtractFlags::SECURE_SYMLINKS;

    disk.set_options(flags)
        .map_err(|err| format!("Failed to configure extraction: {err}"))?;
    disk.set_standard_lookup()
        .map_err(|err| format!("Failed to configure extraction lookup: {err}"))?;

    let selected = selected_paths.map(|paths| {
        paths
            .iter()
            .map(|path| normalize_archive_path(path))
            .collect::<HashSet<_>>()
    });

    let mut extracted_entries = 0;

    while let Some(entry) = archive
        .next_entry()
        .map_err(|err| format!("Failed to read archive entry: {err}"))?
    {
        let snapshot = snapshot_entry(&entry);
        let should_extract = selected
            .as_ref()
            .map(|set| selected_match(&snapshot.path, set))
            .unwrap_or(true);
        drop(entry);

        if should_extract {
            extract_current_entry(&mut archive, &mut disk, &snapshot, dest)?;
            extracted_entries += 1;
        } else {
            archive
                .skip_data()
                .map_err(|err| format!("Failed to skip archive entry: {err}"))?;
        }
    }

    Ok(ExtractionResult { extracted_entries })
}

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
            .map_err(|err| format!("Failed to add directory to ZIP: {err}"))?;

        for child in fs::read_dir(path).map_err(|err| format!("Failed to read folder: {err}"))? {
            let child = child.map_err(|err| format!("Failed to inspect folder entry: {err}"))?;
            add_path_to_zip(writer, &child.path(), base)?;
        }
    } else {
        let mut file =
            File::open(path).map_err(|err| format!("Failed to open input file for ZIP: {err}"))?;
        writer
            .start_file(
                &rel,
                FileOptions::default()
                    .compression_method(CompressionMethod::Deflated)
                    .unix_permissions(0o644),
            )
            .map_err(|err| format!("Failed to start ZIP entry: {err}"))?;
        io::copy(&mut file, writer).map_err(|err| format!("Failed to write ZIP entry: {err}"))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn open_archive(path: String) -> Result<OpenArchiveResult, String> {
    let archive_path = PathBuf::from(&path);
    let metadata = fs::metadata(&archive_path)
        .map_err(|err| format!("Failed to inspect archive file: {err}"))?;
    let kind = ArchiveKind::from_path(&archive_path);
    let mut archive = open_reader(&archive_path)?;
    let mut entries = Vec::new();
    let mut total_size = 0_u64;
    let mut encrypted_entries = 0_usize;

    while let Some(entry) = archive
        .next_entry()
        .map_err(|err| format!("Failed to read archive entry: {err}"))?
    {
        let snapshot = snapshot_entry(&entry);
        if snapshot.kind == "file" {
            total_size = total_size.saturating_add(snapshot.size);
        }
        if snapshot.is_encrypted {
            encrypted_entries += 1;
        }
        entries.push(snapshot.to_capsule_entry());
    }

    entries.sort_by(|left, right| left.path.cmp(&right.path));

    Ok(OpenArchiveResult {
        archive: ArchiveSummary {
            path: path.clone(),
            name: archive_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Archive")
                .to_string(),
            format: kind.label().to_string(),
            compressed_size: metadata.len(),
            total_entries: entries.len(),
            total_size,
            encrypted_entries,
        },
        entries,
        capabilities: archive_capabilities(kind),
    })
}

#[tauri::command]
pub async fn preview_archive_entry(
    archive_path: String,
    entry_path: String,
) -> Result<PreviewResult, String> {
    let archive_path = PathBuf::from(&archive_path);
    let target = normalize_archive_path(&entry_path);
    let mut archive = open_reader(&archive_path)?;

    while let Some(entry) = archive
        .next_entry()
        .map_err(|err| format!("Failed to read archive entry: {err}"))?
    {
        let snapshot = snapshot_entry(&entry);
        let matched = snapshot.path == target;
        drop(entry);

        if !matched {
            archive
                .skip_data()
                .map_err(|err| format!("Failed to skip archive entry: {err}"))?;
            continue;
        }

        let mime = detect_mime_type(&snapshot.name);

        if snapshot.kind != "file" {
            archive
                .skip_data()
                .map_err(|err| format!("Failed to skip archive entry: {err}"))?;
            return Ok(PreviewResult {
                kind: "unsupported".into(),
                mime,
                text: None,
                data_base64: None,
                size: snapshot.size,
                truncated: false,
                message: Some("Folders and links cannot be previewed.".into()),
            });
        }

        if snapshot.is_encrypted {
            archive
                .skip_data()
                .map_err(|err| format!("Failed to skip encrypted entry: {err}"))?;
            return Ok(PreviewResult {
                kind: "unsupported".into(),
                mime,
                text: None,
                data_base64: None,
                size: snapshot.size,
                truncated: false,
                message: Some("Encrypted entries cannot be previewed yet.".into()),
            });
        }

        let (bytes, truncated) = read_entry_bytes_limited(&mut archive, MAX_PREVIEW_BYTES)?;

        if mime.starts_with("image/") {
            if truncated {
                return Ok(PreviewResult {
                    kind: "unsupported".into(),
                    mime,
                    text: None,
                    data_base64: None,
                    size: snapshot.size,
                    truncated: true,
                    message: Some("This image is too large to preview inline.".into()),
                });
            }

            return Ok(PreviewResult {
                kind: "image".into(),
                mime,
                text: None,
                data_base64: Some(BASE64.encode(bytes)),
                size: snapshot.size,
                truncated: false,
                message: None,
            });
        }

        if let Ok(text) = String::from_utf8(bytes.clone()) {
            let truncated_text = if text.len() > MAX_TEXT_PREVIEW_BYTES {
                text[..MAX_TEXT_PREVIEW_BYTES].to_string()
            } else {
                text
            };
            let text_truncated = truncated || truncated_text.len() < bytes.len();

            return Ok(PreviewResult {
                kind: "text".into(),
                mime,
                text: Some(truncated_text),
                data_base64: None,
                size: snapshot.size,
                truncated: text_truncated,
                message: if text_truncated {
                    Some("Preview truncated for performance.".into())
                } else {
                    None
                },
            });
        }

        let binary_bytes = if bytes.len() > MAX_BINARY_PREVIEW_BYTES {
            bytes[..MAX_BINARY_PREVIEW_BYTES].to_vec()
        } else {
            bytes
        };
        let binary_truncated = truncated || binary_bytes.len() as u64 != snapshot.size;

        return Ok(PreviewResult {
            kind: "binary".into(),
            mime,
            text: None,
            data_base64: Some(BASE64.encode(binary_bytes)),
            size: snapshot.size,
            truncated: binary_truncated,
            message: if binary_truncated {
                Some("Showing the first chunk of binary data.".into())
            } else {
                None
            },
        });
    }

    Err("Archive entry not found".into())
}

#[tauri::command]
pub async fn extract_archive(path: String, dest: String) -> Result<ExtractionResult, String> {
    extract_matching_entries(Path::new(&path), Path::new(&dest), None)
}

#[tauri::command]
pub async fn extract_selected_entries(
    archive_path: String,
    dest: String,
    entry_paths: Vec<String>,
) -> Result<ExtractionResult, String> {
    if entry_paths.is_empty() {
        return Err("No archive entries were selected for extraction".into());
    }

    extract_matching_entries(
        Path::new(&archive_path),
        Path::new(&dest),
        Some(&entry_paths),
    )
}

#[tauri::command]
pub async fn create_zip_archive(args: CreateZipArgs) -> Result<(), String> {
    let output = PathBuf::from(&args.output_path);

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create output folder: {err}"))?;
    }

    let file =
        File::create(&output).map_err(|err| format!("Failed to create output archive: {err}"))?;
    let mut writer = ZipWriter::new(file);

    for input in &args.input_paths {
        let path = PathBuf::from(input);
        if !path.exists() {
            continue;
        }

        let base = path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| path.clone());
        add_path_to_zip(&mut writer, &path, &base)?;
    }

    writer
        .finish()
        .map_err(|err| format!("Failed to finalize ZIP archive: {err}"))?;

    let _ = (
        &args.compression_mode,
        &args.parallel_compression,
        &args.temp_dir,
    );

    Ok(())
}

#[tauri::command]
pub async fn add_files_to_zip(args: AddFilesArgs) -> Result<(), String> {
    let zip_path = PathBuf::from(&args.zip);
    let temp_path = zip_path.with_extension("tmp.zip");
    let temp_file =
        File::create(&temp_path).map_err(|err| format!("Failed to create temp archive: {err}"))?;
    let mut writer = ZipWriter::new(temp_file);

    if zip_path.exists() {
        let file =
            File::open(&zip_path).map_err(|err| format!("Failed to open existing ZIP: {err}"))?;
        let mut archive =
            ZipArchive::new(file).map_err(|err| format!("Failed to read existing ZIP: {err}"))?;

        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|err| format!("Failed to read existing ZIP entry: {err}"))?;
            let name = entry.name().to_string();

            if entry.is_dir() {
                writer
                    .add_directory(
                        &name,
                        FileOptions::default()
                            .compression_method(CompressionMethod::Deflated)
                            .unix_permissions(0o755),
                    )
                    .map_err(|err| format!("Failed to rewrite ZIP directory: {err}"))?;
            } else {
                writer
                    .start_file(
                        &name,
                        FileOptions::default()
                            .compression_method(CompressionMethod::Deflated)
                            .unix_permissions(0o644),
                    )
                    .map_err(|err| format!("Failed to rewrite ZIP entry: {err}"))?;
                io::copy(&mut entry, &mut writer)
                    .map_err(|err| format!("Failed to copy ZIP entry: {err}"))?;
            }
        }
    }

    for file in &args.files {
        let path = PathBuf::from(file);
        if !path.exists() {
            continue;
        }

        let base = path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| path.clone());
        add_path_to_zip(&mut writer, &path, &base)?;
    }

    writer
        .finish()
        .map_err(|err| format!("Failed to finalize updated ZIP: {err}"))?;
    replace_file(&temp_path, &zip_path)
}

#[tauri::command]
pub async fn remove_files_from_zip(args: RemoveFilesArgs) -> Result<(), String> {
    let zip_path = PathBuf::from(&args.zip_path);
    let temp_path = zip_path.with_extension("tmp.zip");
    let selected = args
        .entry_paths
        .into_iter()
        .map(|value| normalize_archive_path(&value))
        .collect::<HashSet<_>>();

    let file =
        File::open(&zip_path).map_err(|err| format!("Failed to open existing ZIP: {err}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|err| format!("Failed to inspect existing ZIP: {err}"))?;
    let temp_file =
        File::create(&temp_path).map_err(|err| format!("Failed to create temp archive: {err}"))?;
    let mut writer = ZipWriter::new(temp_file);

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| format!("Failed to read ZIP entry: {err}"))?;
        let name = entry.name().to_string();
        let normalized_name = normalize_archive_path(&name);

        if selected_match(&normalized_name, &selected) {
            continue;
        }

        if entry.is_dir() {
            writer
                .add_directory(
                    &name,
                    FileOptions::default()
                        .compression_method(CompressionMethod::Deflated)
                        .unix_permissions(0o755),
                )
                .map_err(|err| format!("Failed to rewrite ZIP directory: {err}"))?;
        } else {
            writer
                .start_file(
                    &name,
                    FileOptions::default()
                        .compression_method(CompressionMethod::Deflated)
                        .unix_permissions(0o644),
                )
                .map_err(|err| format!("Failed to rewrite ZIP entry: {err}"))?;
            io::copy(&mut entry, &mut writer)
                .map_err(|err| format!("Failed to copy ZIP entry data: {err}"))?;
        }
    }

    writer
        .finish()
        .map_err(|err| format!("Failed to finalize updated ZIP: {err}"))?;
    replace_file(&temp_path, &zip_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_archive_kinds() {
        assert_eq!(
            ArchiveKind::from_path(Path::new("sample.zip")),
            ArchiveKind::Zip
        );
        assert_eq!(
            ArchiveKind::from_path(Path::new("sample.7z")),
            ArchiveKind::SevenZip
        );
        assert_eq!(
            ArchiveKind::from_path(Path::new("sample.tar.gz")),
            ArchiveKind::TarGz
        );
        assert_eq!(
            ArchiveKind::from_path(Path::new("sample.tbz2")),
            ArchiveKind::TarBz2
        );
        assert_eq!(
            ArchiveKind::from_path(Path::new("sample.rar")),
            ArchiveKind::Rar
        );
        assert_eq!(
            ArchiveKind::from_path(Path::new("sample.bin")),
            ArchiveKind::Unknown
        );
    }

    #[test]
    fn normalizes_archive_paths() {
        assert_eq!(
            normalize_archive_path("./folder\\file.txt"),
            "folder/file.txt"
        );
        assert_eq!(normalize_archive_path("/folder/sub/"), "folder/sub");
        assert_eq!(normalize_archive_path("plain.txt"), "plain.txt");
    }

    #[test]
    fn matches_selected_paths_and_children() {
        let selected = HashSet::from([String::from("folder")]);
        assert!(selected_match("folder", &selected));
        assert!(selected_match("folder/file.txt", &selected));
        assert!(!selected_match("another/file.txt", &selected));
    }

    #[test]
    fn validates_extract_paths() {
        let dest = PathBuf::from("C:/tmp/output");
        assert!(validate_extract_path(&dest, Path::new("safe/file.txt")).is_ok());
        assert!(validate_extract_path(&dest, Path::new("../../escape.txt")).is_err());
        assert!(validate_extract_path(&dest, Path::new("/absolute.txt")).is_err());
    }
}
