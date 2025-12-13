# Capsule

A cozy, skeuomorphic archive viewer & extractor for desktop.

Capsule is a lightweight, drag-and-drop app for peeking inside archives and extracting them without wrestling with a wall of options. It's built with **Rust + Tauri** and a vanilla **HTML/CSS/TS** frontend.

## Features

### Core Archive Features
- 📦 **Drag & drop archives** onto the app to open them
- 🌲 **Folder tree view** with expand/collapse and folder navigation
- 📃 **File list** with size, type, and path information
- 🔍 **Search/filter** files by name or path (supports glob patterns with `*`)
- 👁️ **File preview**:
  - Text files with syntax highlighting (JS, TS, JSON, XML, Markdown, CSS, Python, Rust, Shell)
  - Image files (JPG, PNG, GIF, WebP, SVG, BMP, ICO)
  - Binary files with hex preview
  - Preview size limit: 10MB
- 📤 **Extract all** files from archive
- 📥 **Extract selected** files (right-click → Extract to…)
- ➕ **Add files** to existing archives
- ➖ **Remove files** from archives
- 💾 **Save** archive as ZIP

### User Interface
- 📑 **Tabbed interface** for multiple archives
- 📊 **Archive metadata** panel (file count, total size, compressed size, compression ratio)
- 🎨 **Multiple themes** (Light, Dark, Night Shift, North Pole)
- ⚙️ **Settings panel** with theme selection and preferences
- ℹ️ **About dialog** with version information
- 🖱️ **Context menu** for file operations

### Security
- 🔒 **Zip-slip protection** (path traversal prevention) in all extraction operations
- ✅ **Safe path validation** for all archive operations

## Supported Formats

### Read (list contents) & Extract

- `ZIP` (`.zip`)
- `TAR` family:
  - `.tar`
  - `.tar.gz`, `.tgz`
  - `.tar.bz2`, `.tbz2`
  - `.tar.xz`, `.txz`

### Write (create/modify)

- `ZIP` (`.zip`) — Full support for creating and modifying ZIP archives

If an archive type isn't recognized, Capsule will display an "Unsupported archive type" error message.

---

## Getting Started

### Prerequisites

- **Rust** (stable)  
  Install via [rustup](https://rustup.rs/).
- **Node.js** + **pnpm**  
  - Install Node from the official site or via a version manager.
  - Install pnpm:  
    ```bash
    npm install -g pnpm
    ```
- **Tauri system requirements**  
  - On Windows: Visual Studio Build Tools with C++ workload (for the MSVC toolchain).

### Clone & Install

```bash
git clone https://github.com/<your-username>/capsule.git
cd capsule
pnpm install
```

### Development

```bash
# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

The built application will be in `src-tauri/target/release/` (or `debug/` for debug builds).

### Running Tests

```bash
# Run Rust tests
cd src-tauri
cargo test

# Run TypeScript type checking
pnpm build
```

## Building for Release

### Windows

```bash
pnpm tauri build
```

This will create:
- `src-tauri/target/release/capsule.exe` — The main executable
- `src-tauri/target/release/bundle/msi/capsule_1.0.0_x64_en-US.msi` — MSI installer
- `src-tauri/target/release/bundle/nsis/capsule_1.0.0_x64-setup.exe` — NSIS installer

### macOS / Linux

Currently, Windows builds are fully supported. macOS and Linux builds are planned for future releases.

## Project Structure

```
capsule/
├── src/                 # Frontend (TypeScript, HTML, CSS)
│   ├── main.ts         # Main application logic
│   └── style.css       # Styles and themes
├── src-tauri/          # Backend (Rust)
│   ├── src/
│   │   ├── main.rs     # Tauri entry point
│   │   ├── lib.rs      # Application setup
│   │   ├── commands.rs # Archive operations
│   │   └── menu.rs     # Menu definitions
│   └── Cargo.toml      # Rust dependencies
├── package.json        # Node.js dependencies
└── README.md          # This file
```

## Known Limitations

- Preview only supports ZIP archives (TAR preview coming soon)
- Large archives (100k+ entries) may have performance issues
- Drag-out extraction to OS file manager is not yet implemented (use context menu instead)
- macOS and Linux builds are not yet available
- No support for password-protected archives
- RAR format requires external `unrar` tool (not yet integrated)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on contributing to Capsule.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
