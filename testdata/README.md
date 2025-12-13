# Test Data

This directory contains test archives for development and testing.

## Generating Test Archives

Use the scripts in `scripts/` to generate test archives:

### Windows (PowerShell)
```powershell
.\scripts\generate-test-archive.ps1 -EntryCount 1000 -OutputPath "testdata\test-1k.zip"
```

### Linux/macOS (Bash)
```bash
chmod +x scripts/generate-test-archive.sh
./scripts/generate-test-archive.sh 1000 testdata/test-1k.zip
```

## Test Archive Types

- Small archive (100 files) - quick tests
- Medium archive (1,000 files) - normal usage tests
- Large archive (10,000+ files) - performance tests
- Very large archive (100,000 files) - stress tests

## Manual Test Archives

You can also create manual test archives with:
- Various file types (text, images, binaries)
- Nested folder structures
- Unicode filenames
- Long path names
- Various archive formats (ZIP, TAR, TAR.GZ, etc.)


