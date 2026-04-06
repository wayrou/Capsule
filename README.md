# Capsule

Capsule is a desktop archive explorer built with Rust, Tauri, and a lightweight TypeScript frontend. The current app is tuned around a simple flow:

`Open -> Explore -> Preview -> Extract`

The interface is intentionally quiet and minimal, with a compact summary rail, integrated preview pane, lightweight tab strip, and capability-aware actions so unsupported archive operations do not show up as dead controls.

## Supported Formats

### Open, Inspect, Preview, Extract

- `ZIP` (`.zip`)
- `7-Zip` (`.7z`)
- `RAR` (`.rar`, `.rar5`)
- `TAR` family
  - `.tar`
  - `.tar.gz`, `.tgz`
  - `.tar.bz2`, `.tbz`, `.tbz2`
  - `.tar.xz`, `.txz`

### Create or Modify

- `ZIP` only

Non-ZIP archive types are surfaced as read-only where write/edit support is unavailable.

## Features

- Open archives from the file picker or drag and drop
- Search and filter entries by name or path
- Browse a generated folder tree alongside archive metadata
- Preview text, image, and binary entries inside the main workspace
- Extract the full archive or only the selected entries
- Create a new ZIP archive and add or remove files from ZIP tabs
- Work across multiple tabs without losing per-archive selection or filters
- Switch between the default light theme and an optional warm dark theme

## Project Structure

```text
Capsule/
|-- index.html
|-- src/
|   |-- main.ts
|   |-- archive-actions.ts
|   |-- dialogs.ts
|   |-- preview.ts
|   |-- render.ts
|   |-- state.ts
|   |-- style.css
|   |-- types.ts
|   `-- utils.ts
`-- src-tauri/
    |-- src/
    |   |-- commands.rs
    |   |-- lib.rs
    |   |-- main.rs
    |   `-- menu.rs
    |-- scripts/
    |   `-- setup-native-deps.ps1
    |-- vcpkg.json
    `-- vendor/
```

## Development Setup

### Prerequisites

- Rust stable via [rustup](https://rustup.rs/)
- Node.js 20+ and `pnpm`
- Visual Studio Build Tools with the Desktop C++ workload
- LLVM for `bindgen`

### Install Frontend Dependencies

```powershell
pnpm install
```

### Install Windows Native Archive Dependencies

Capsule's Rust backend uses a vendored `libarchive2` build for multi-format archive reading. On Windows, the compression libraries are installed through the Visual Studio bundled `vcpkg` instance.

```powershell
.\src-tauri\scripts\setup-native-deps.ps1
```

This installs the required `zlib`, `bzip2`, `liblzma`, `zstd`, `lz4`, and `openssl` packages into `src-tauri\vcpkg_installed` using the `x64-windows-static-md` triplet.

### Run The App

```powershell
pnpm tauri dev
```

The local Tauri/Vite development server is configured to use `http://localhost:1430`.

### Build And Verify

```powershell
pnpm build
cd src-tauri
cargo test
```

## Notes

- The Rust backend now returns structured archive metadata and capability flags instead of ZIP-specific entry lists.
- Preview support is format-agnostic and falls back cleanly for unsupported or oversized files.
- ZIP remains the only editable archive format in this pass by design.
