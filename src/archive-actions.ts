import { invoke } from "@tauri-apps/api/core";
import type {
  ExtractionResult,
  OpenArchiveResult,
  PreviewResult,
} from "./types";

export function openArchive(path: string): Promise<OpenArchiveResult> {
  return invoke<OpenArchiveResult>("open_archive", { path });
}

export function previewArchiveEntry(
  archivePath: string,
  entryPath: string,
): Promise<PreviewResult> {
  return invoke<PreviewResult>("preview_archive_entry", {
    archivePath,
    entryPath,
  });
}

export function extractArchive(path: string, dest: string): Promise<ExtractionResult> {
  return invoke<ExtractionResult>("extract_archive", { path, dest });
}

export function extractSelectedEntries(
  archivePath: string,
  dest: string,
  entryPaths: string[],
): Promise<ExtractionResult> {
  return invoke<ExtractionResult>("extract_selected_entries", {
    archivePath,
    dest,
    entryPaths,
  });
}

export function addFilesToZip(zip: string, files: string[]): Promise<void> {
  return invoke<void>("add_files_to_zip", {
    args: {
      zip,
      files,
    },
  });
}

export function removeFilesFromZip(zipPath: string, entryPaths: string[]): Promise<void> {
  return invoke<void>("remove_files_from_zip", {
    args: {
      zipPath,
      entryPaths,
    },
  });
}

export function createZipArchive(outputPath: string, inputPaths: string[]): Promise<void> {
  return invoke<void>("create_zip_archive", {
    args: {
      outputPath,
      inputPaths,
      compressionMode: "balanced",
      parallelCompression: true,
      tempDir: null,
    },
  });
}
