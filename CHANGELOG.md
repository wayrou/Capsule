# Changelog

All notable changes to Capsule will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-XX

### Added
- **Core Archive Features**
  - Open archive via drag & drop or file dialog
  - Support for ZIP, TAR, TAR.GZ, TAR.BZ2, TAR.XZ formats
  - View file tree with expand/collapse and folder navigation
  - File list with size, type, and path information
  - Search/filter files by name or path (supports glob patterns with `*`)
  - Preview files:
    - Text files with syntax highlighting (JS, TS, JSON, XML, Markdown, CSS, Python, Rust, Shell)
    - Image files (JPG, PNG, GIF, WebP, SVG, BMP, ICO)
    - Binary files with hex preview
    - Preview size limit: 10MB
  - Extract all files from archive
  - Extract selected files (context menu: right-click → Extract to…)
  - Add files to archive
  - Remove files from archive
  - Save archive as ZIP

- **User Interface**
  - Tabbed interface for multiple archives
  - Tree view with folder navigation
  - Archive metadata panel (file count, total size, compressed size, compression ratio)
  - Multiple themes (Light, Dark, Night Shift, North Pole)
  - Settings panel with theme selection
  - About dialog
  - Context menu for file operations

- **Security**
  - Zip-slip protection (path traversal prevention) in extraction
  - Safe path validation for all archive operations

- **Developer Experience**
  - TypeScript frontend with type safety
  - Rust backend with error handling
  - Modular architecture

### Fixed
- Fixed search functionality not working
- Fixed toolbar button ID mismatches
- Fixed `remove_files_from_zip` command signature
- Fixed zip-slip vulnerability in extraction code
- Fixed preview not working for selected files
- Fixed status text theme colors

### Security
- Added path traversal protection (zip-slip) in all extraction functions
- Validated all file paths before extraction

## [Unreleased]

### Planned
- macOS build support
- Linux build support
- Drag-out extraction (drag files from app to OS file manager)
- Support for more archive formats (7z, RAR via external tools)
- Virtual scrolling for large archives (100k+ entries)
- Progress indicators for long operations
- Cancel operation support
- Unicode filename handling improvements
- Windows reserved name handling
- Long path support on Windows


